import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import {
  clampRatio, errors, failure, success, type ErrorCode, type ReaderRequest, type ReaderState, type Result, type Session,
} from '../../shared/reader-messages';
import { connectAlignment } from '../alignment/alignment';
import { extractArticle, type Article } from '../extraction/document';
import { createSplit, MIN_WIDTH, viewportWidth } from '../layout/split';
import { ReaderPanel } from '../ui/reader-panel';
import css from '../ui/reader.css?inline';
import { createTranslation } from './translation';

export type ActiveReader = {
  id: string; state: () => ReaderState; close: () => void;
  pause: () => void; resume: () => void; clearCache: (disable?: boolean) => void;
};

const preparing: ReaderState = { status: 'preparing', total: 0, done: 0, failed: 0 };

let dismissNotice: (() => void) | undefined;

export function startReader(session: Session, afterClose: (error?: ErrorCode) => void): Result<ActiveReader> {
  dismissNotice?.();
  if (viewportWidth() < MIN_WIDTH) return failure('narrow');
  if (!document.body) return failure('unsupported-page');

  const lifecycle = new AbortController();
  let ratio = session.ratio;
  let sync = session.syncScroll;
  let hover = session.highlight;
  let paused = false;
  let cacheDisabled = false;
  let article: Article | undefined;
  let translation: ReturnType<typeof createTranslation> | undefined;
  let alignment: ReturnType<typeof connectAlignment> | undefined;
  let scroll: HTMLElement | null = null;
  let highlighted: HTMLElement | undefined;
  const targets = new Map<string, HTMLElement>();
  const split = createSplit(() => ratio, close);
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(css);
  split.shadow.adoptedStyleSheets = [stylesheet];
  split.container.style.height = '100%';
  const root = createRoot(split.container);
  const observer = new MutationObserver((records) => {
    if (!article) return;
    const changed = records.some((record) => record.type === 'characterData' &&
      record.target instanceof Text && affected.has(record.target)) || !validSources(article);
    if (changed) close('changed');
  });
  const affected = new Set<Text>();

  function state(): ReaderState {
    return translation?.state() ?? (paused ? { ...preparing, status: 'paused' } : preparing);
  }

  function notify(message: ReaderRequest) {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  }

  function close(error?: ErrorCode) {
    if (lifecycle.signal.aborted) return;
    lifecycle.abort();
    observer.disconnect();
    root.unmount();
    split.close();
    if (error) showNotice(error);
    notify({ type: 'closed', sessionId: session.id });
    afterClose(error);
  }

  function setRatio(next: number, final: boolean) {
    ratio = clampRatio(next);
    split.drag();
    if (lifecycle.signal.aborted) return;
    if (final) {
      split.verify();
      if (lifecycle.signal.aborted) return;
      notify({ type: 'resize', sessionId: session.id, ratio });
    }
    render();
  }

  function paint(id: string | null) {
    highlighted?.removeAttribute('data-active');
    highlighted = id ? targets.get(id) : undefined;
    highlighted?.setAttribute('data-active', '');
  }

  function pause() {
    paused = true;
    translation?.pause();
    if (!translation) render();
  }

  function resume() {
    paused = false;
    translation?.resume();
    if (!translation) render();
  }

  function render() {
    if (lifecycle.signal.aborted) return;
    flushSync(() => root.render(<ReaderPanel
      session={session} state={state()} nodes={article?.nodes ?? []}
      ratio={ratio} sync={sync} hover={hover} targets={targets}
      captureScroll={(element) => { scroll = element; }}
      show={(id, text) => translation?.show(id, text) ?? text}
      status={(id) => translation?.status(id) ?? 'pending'}
      onHover={(id) => alignment?.paint(id)}
      locate={(id) => alignment?.locate('source', id)}
      retry={(id) => translation?.retry(id)}
      close={() => close()} setRatio={setRatio}
      toggleSync={() => { sync = !sync; render(); }}
      toggleHover={() => { hover = !hover; if (!hover) alignment?.paint(null); render(); }}
      togglePause={() => state().status === 'paused' ? resume() : pause()}
    />));
  }

  async function initialize() {
    const locationKey = location.pathname + location.search;
    const result = await extractArticle(session.range, lifecycle.signal, split.sidebar);
    lifecycle.signal.throwIfAborted();
    if (location.pathname + location.search !== locationKey || !validSources(result)) { close('changed'); return; }
    if (!result.blocks.some((block) => block.pieces.some((piece) => piece.translate && piece.text.trim()))) {
      close('no-text');
      return;
    }

    const layoutError = split.activate();
    if (layoutError) { close(layoutError === 'incompatible' ? 'layout-start' : layoutError); return; }
    article = result;
    for (const block of article.blocks) {
      for (const node of block.snapshots.keys()) affected.add(node);
    }
    translation = createTranslation(article.blocks, session, lifecycle.signal, render);
    if (cacheDisabled) translation.clearCache(true);
    if (paused) translation.pause();
    render();
    const targetRoot = scroll;
    if (!targetRoot) { close('unavailable'); return; }
    const readingColumn = split.sidebar?.content;
    const primary = readingColumn ? article.blocks.filter((block) => readingColumn.contains(block.source)) : article.blocks;
    alignment = connectAlignment({
      blocks: article.blocks, primary: primary.length ? primary : article.blocks,
      targets, sourceViewport: split.sourceViewport, targetRoot,
      syncEnabled: () => sync, highlightEnabled: () => hover,
      showHighlight: paint, signal: lifecycle.signal,
    });
    observer.observe(result.scope, { subtree: true, characterData: true, childList: true });
    if (result.scope !== document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    navigation?.addEventListener('currententrychange', () => {
      if (location.pathname + location.search !== locationKey) close('changed');
    }, { signal: lifecycle.signal });
    void translation.run();
  }

  render();
  void initialize().catch(() => {
    if (!lifecycle.signal.aborted) close('unavailable');
  });
  return success({
    id: session.id, state, close: () => close(), pause, resume,
    clearCache(disable) {
      cacheDisabled ||= disable === true;
      translation?.clearCache(disable);
    },
  });
}

function validSources(article: Article) {
  if (!article.scope.isConnected) return false;
  return article.blocks.every((block) => block.source.isConnected &&
    Array.from(block.snapshots).every(([node, text]) => node.isConnected && node.data === text));
}

function showNotice(error: ErrorCode) {
  dismissNotice?.();
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.setAttribute('data-alignread-host', '');
  notice.textContent = errors[error];
  notice.style.setProperty('all', 'initial', 'important');
  for (const [name, value] of Object.entries({
    position: 'fixed', top: '12px', right: '12px', 'z-index': '2147483647',
    display: 'block', padding: '10px 14px', background: '#fff', color: '#273b31',
    border: '1px solid #8e9e91', 'border-radius': '6px', font: '14px system-ui, sans-serif',
    'max-width': 'calc(100vw - 24px)', 'pointer-events': 'none',
  })) notice.style.setProperty(name, value, 'important');
  document.documentElement.append(notice);

  const timer = window.setTimeout(cleanup, 5500);
  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener('pagehide', cleanup);
    notice.remove();
    if (dismissNotice === cleanup) dismissNotice = undefined;
  }
  dismissNotice = cleanup;
  window.addEventListener('pagehide', cleanup, { once: true });
}
