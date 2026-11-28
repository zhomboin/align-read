import type { Block, Piece } from '../extraction/document';

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(language: string) {
  let current = segmenters.get(language);
  if (!current) {
    current = new Intl.Segmenter(language === 'auto' ? undefined : language, { granularity: 'sentence' });
    segmenters.set(language, current);
  }
  return current;
}

// 每句单独持有请求 ID 和原文范围。无法保留完整句子边界的混排段落沿用段落定位。
export function prepareSentenceRanges(blocks: Block[], language: string) {
  for (const block of blocks) {
    if (block.tag !== 'p' || block.pieces.length !== 1 || block.snapshots.size !== 1) continue;
    const piece = block.pieces[0]!;
    const node = block.snapshots.keys().next().value!;
    if (!piece.translate || piece.href || piece.marks.length) continue;
    const sentences = Array.from(segmenter(language).segment(piece.text));
    if (sentences.length < 2) continue;
    // 网页常用缩进和换行排版。将折叠空白后的偏移还原为原始文字节点的 UTF-16 偏移。
    let offsets: number[] | undefined;
    if (piece.text !== node.data) {
      if (node.data.replace(/\s+/g, ' ') !== piece.text) continue;
      offsets = Array.from(node.data.matchAll(/\s+|\S/g), match => match.index!);
      offsets.push(node.length);
    }
    const counts = new Map<string, number>();
    for (const { segment } of sentences) {
      const text = segment.trim();
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    block.pieces = sentences.map(({ segment, index }): Piece => {
      const text = segment.trim();
      if (!text || text.length > 1500 || counts.get(text) !== 1) return { ...piece, text: segment };
      const range = new Range();
      const start = index + segment.indexOf(text);
      const end = start + text.length;
      range.setStart(node, offsets?.[start] ?? start);
      range.setEnd(node, offsets?.[end] ?? end);
      return { ...piece, text: segment, sentence: range };
    });
  }
}

function singleTargetSentence(text: string, language: string) {
  return Boolean(text.trim()) && Array.from(segmenter(language).segment(text.trim())).length === 1;
}

export function readerSelection(scroll: HTMLElement) {
  const root = scroll.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  return root.getSelection?.() ?? document.getSelection();
}

export function selectedSentence(scroll: HTMLElement, language: string) {
  const selection = readerSelection(scroll);
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
  const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement;
  const start = element(selection.anchorNode);
  const end = element(selection.focusNode);
  const block = start?.closest<HTMLElement>('[data-reader-block]');
  if (!block || !end || !block.contains(end) || !scroll.contains(block)) return;
  const sentence = start?.closest<HTMLElement>('[data-reader-sentence]');
  const text = sentence?.textContent?.trim();
  const unique = sentence?.contains(end) && text && singleTargetSentence(text, language) &&
    Array.from(block.children).every(other => other === sentence || other.textContent?.trim() !== text);
  return { blockId: block.dataset.readerBlock!, pieceId: unique ? sentence?.dataset.readerSentence : undefined };
}
