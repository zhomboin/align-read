import { errors, type Result } from '../shared/reader-messages';
import type { SelectionRequest, SelectionSession } from '../shared/selection-messages';
import { splitText } from '../shared/split-text';
import { onControlTap } from './control-key';
import { matchesParagraph, selectedParagraphs, type Paragraph } from './paragraph-source';

type Entry = {
  source: Paragraph;
  host: HTMLElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
  pending: boolean;
  requestId?: string;
};

export function startParagraphs(session: SelectionSession, signal: AbortSignal, currentPage: () => boolean,
  send: <T>(message: SelectionRequest) => Promise<Result<T>>) {
  const entries = new Map<Text, Entry>();
  let queue = Promise.resolve();
  let sequence = 0;

  function remove(entry: Entry) {
    entries.delete(entry.source.first);
    entry.host.remove();
    if (entry.requestId) void send({ type: 'selection:cancel-paragraph', sessionId: session.id, requestId: entry.requestId });
  }

  function attached({ source, host }: Entry) {
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
    const translated: string[] = [];
    for (const part of splitText(entry.source.text)) {
      if (!current(entry)) return;
      const requestId = String(++sequence);
      entry.requestId = requestId;
      const result = await send<string>({ type: 'selection:paragraph', sessionId: session.id, requestId, text: part });
      entry.requestId = undefined;
      if (!current(entry)) return;
      if (!result.ok) {
        entry.status.textContent = errors[result.error];
        entry.retry.hidden = result.error === 'stale';
        entry.pending = false;
        return;
      }
      translated.push(result.value);
    }
    entry.status.lang = session.target;
    const separator = ['zh-CN', 'zh-TW', 'ja', 'th'].includes(session.target) ? '' : ' ';
    entry.status.textContent = translated.join(separator);
    entry.pending = false;
  }

  function enqueue(entry: Entry) {
    entry.pending = true;
    entry.retry.hidden = true;
    entry.status.textContent = '正在翻译…';
    queue = queue.then(() => translate(entry));
  }

  function insert(source: Paragraph) {
    const host = document.createElement('span');
    host.setAttribute('data-alignread-paragraph', '');
    host.translate = false;
    host.style.setProperty('display', 'block', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{margin-block:.25em .5em;font-weight:normal;text-align:start;overflow-wrap:anywhere}';
    const status = document.createElement('span');
    status.dir = 'auto';
    status.setAttribute('role', 'status');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.setAttribute('aria-label', '重试本段翻译');
    shadow.append(style, status, retry);
    const entry: Entry = { source, host, status, retry, pending: false };
    retry.addEventListener('click', event => {
      if (event.isTrusted && !entry.pending && current(entry)) enqueue(entry);
    });
    source.parent.insertBefore(host, source.after ? source.anchor?.nextSibling ?? null : source.anchor);
    entries.set(source.first, entry);
    enqueue(entry);
  }

  onControlTap(() => {
    if (!currentPage()) return;
    const sources = selectedParagraphs();
    const allShown = sources.length > 0 && sources.every(source => {
      const entry = entries.get(source.first);
      return entry && current(entry) && !entry.pending && entry.retry.hidden;
    });
    for (const source of sources) {
      const entry = entries.get(source.first);
      if (entry && current(entry)) {
        if (allShown) remove(entry);
      } else insert(source);
    }
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
    observer.disconnect();
    for (const entry of entries.values()) remove(entry);
  }, { once: true });
}
