import type { Language } from '../../shared/reader-messages';
import { createParagraphFeedback } from '../../selection/paragraph-feedback';
import type { Block } from '../extraction/document';
import type { createTranslation } from './translation';

type Row = { view: ReturnType<typeof createParagraphFeedback>; state?: string };
type Translation = ReturnType<typeof createTranslation>;

// 将译文放在该组原文的最后一个直属节点之后，保留列表、表格以及混排容器的顺序。
function insertionAnchor(block: Block): Node | undefined {
  const protectedControl = block.source.closest('a,button,summary,label');
  if (protectedControl) return protectedControl;
  const last = block.ranges.at(-1);
  if (!last) return;
  let anchor = last.endContainer;
  while (anchor.parentNode && anchor.parentNode !== block.source) anchor = anchor.parentNode;
  return anchor.parentNode === block.source ? anchor : undefined;
}

export function createBilingualParagraphs(target: Language) {
  const rows = new Map<string, Row>();

  function clear() {
    for (const { view } of rows.values()) view.host.remove();
    rows.clear();
  }

  function reconcile(blocks: Block[]) {
    const keep = new Set(blocks.map(block => block.id));
    for (const [id, row] of rows) {
      if (keep.has(id)) continue;
      row.view.host.remove();
      rows.delete(id);
    }
  }

  function render(blocks: Block[], translation: Translation) {
    for (const block of blocks) {
      const anchor = insertionAnchor(block);
      if (!anchor?.isConnected || !anchor.parentNode) continue;
      let row = rows.get(block.id);
      if (!row) {
        const view = createParagraphFeedback(target);
        row = { view };
        rows.set(block.id, row);
        view.retry.addEventListener('click', event => {
          if (event.isTrusted) translation.retry(block.id);
        });
      }
      if (anchor.nextSibling !== row.view.host) {
        anchor.parentNode.insertBefore(row.view.host, anchor.nextSibling);
      }
      const state = translation.status(block.id);
      if (row.state === state) continue;
      row.state = state;
      if (state === 'done') {
        row.view.done(block.pieces.map(piece => piece.lineBreak ? '\n' : translation.show(piece.id, piece.text)).join(''));
      } else if (state === 'failed') {
        row.view.failed(translation.blockError(block.id) ?? 'invalid-response');
      } else row.view.queued();
    }
  }

  return { clear, reconcile, render };
}
