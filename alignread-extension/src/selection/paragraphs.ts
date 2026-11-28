import { paragraphDisplay } from '../shared/paragraph-display';
import { send } from './session';
import type { SelectionSession } from '../shared/selection-messages';
import { splitText } from '../shared/split-text';
import { DEFAULT_PARAGRAPH_SHORTCUT, listenForShortcut } from '../shared/paragraph-shortcut';
import { createParagraphFeedback } from './paragraph-feedback';
import { matchesParagraph, selectedParagraphs, type Paragraph } from './paragraph-source';

type Entry = {
  source: Paragraph;
  view: ReturnType<typeof createParagraphFeedback>;
  requestId?: string;
  translated?: string;
};

export function startParagraphs(session: SelectionSession, signal: AbortSignal, currentPage: () => boolean) {
  const entries = new Map<Text, Entry>();
  let queue = Promise.resolve();
  let sequence = 0;

  function remove(entry: Entry) {
    entries.delete(entry.source.first);
    entry.view.host.remove();
    if (entry.requestId) void send({ type: 'paragraph:cancel', sessionId: session.id, requestId: entry.requestId });
  }

  function attached({ source, view: { host } }: Entry) {
    if (!host.isConnected || host.parentElement !== source.parent) return false;
    if (!source.anchor) return source.parent.lastChild === host;
    return (source.after ? host.previousSibling : host.nextSibling) === source.anchor;
  }

  function current(entry: Entry) {
    if (!currentPage() || entries.get(entry.source.first) !== entry) return false;
    if (attached(entry) && matchesParagraph(entry.source)) return true;
    remove(entry);
    return false;
  }

  async function translate(entry: Entry) {
    if (!current(entry)) return;
    entry.view.loading();
    const translated: string[] = [];
    for (const part of splitText(entry.source.text)) {
      const requestId = String(++sequence);
      entry.requestId = requestId;
      const result = await send<string>({ type: 'paragraph:translate', sessionId: session.id, requestId, text: part });
      entry.requestId = undefined;
      if (!current(entry)) return;
      if (!result.ok) {
        entry.view.failed(result.error);
        return;
      }
      translated.push(result.value);
    }
    const separator = ['zh-CN', 'zh-TW', 'ja', 'th'].includes(session.target) ? '' : ' ';
    entry.translated = translated.join(separator);
    entry.view.done(entry.translated);
  }

  function enqueue(entry: Entry) {
    entry.view.queued();
    queue = queue.then(() => translate(entry));
  }

  function insert(source: Paragraph) {
    const view = createParagraphFeedback(session.target);
    const entry: Entry = { source, view };
    view.retry.addEventListener('click', event => {
      if (event.isTrusted && !view.pending && current(entry)) enqueue(entry);
    });
    source.parent.insertBefore(view.host, source.after ? source.anchor?.nextSibling ?? null : source.anchor);
    entries.set(source.first, entry);
    enqueue(entry);
  }

  const display = paragraphDisplay();
  display.takeSelection = (options, reuse) => {
    const completed = new Map<string, string>();
    for (const entry of entries.values()) {
      if (reuse && session.source === options.source && session.target === options.target &&
        entry.translated && current(entry)) completed.set(entry.source.text, entry.translated);
      if (entries.has(entry.source.first)) remove(entry);
    }
    return completed;
  };

  let shortcut = session.shortcut ?? DEFAULT_PARAGRAPH_SHORTCUT;
  const resetKeys = listenForShortcut(pressed => {
    if (display.fullPage || pressed !== shortcut || !currentPage()) return false;
    const sources = selectedParagraphs();
    const allShown = sources.length > 0 && sources.every(source => {
      const entry = entries.get(source.first);
      return entry && current(entry) && !entry.view.pending && entry.view.retry.hidden;
    });
    for (const source of sources) {
      const entry = entries.get(source.first);
      if (entry && current(entry)) {
        if (allShown) remove(entry);
      } else insert(source);
    }
    return sources.length > 0;
  }, signal);

  const observer = new MutationObserver(records => {
    if (!entries.size || !currentPage()) return;
    const changes = records.filter(record => record.type !== 'childList' ||
      [...record.addedNodes, ...record.removedNodes].some(node =>
        !(node instanceof HTMLElement && node.hasAttribute('data-alignread-paragraph'))));
    for (const entry of entries.values()) {
      const owner = entry.source.owner;
      if (!attached(entry)) remove(entry);
      else if (changes.some(record => owner.contains(record.target) ||
        (record.type === 'attributes' && (record.target as Element).contains(owner)))) current(entry);
    }
  });
  observer.observe(document, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'contenteditable', 'role', 'open', 'translate']
  });
  signal.addEventListener('abort', () => {
    delete display.takeSelection;
    observer.disconnect();
    for (const entry of entries.values()) remove(entry);
  }, { once: true });
  return {
    setShortcut(next: string) {
      shortcut = next;
      resetKeys();
    },
  };
}
