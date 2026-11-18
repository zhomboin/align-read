import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import {
  clampRatio, errors, failure, success, type ErrorCode, type ReaderRequest, type ReaderState, type Result, type Session,
} from '../../shared/reader-messages';
import { readReaderPage } from '../../shared/reader-page';
import { connectAlignment } from '../alignment/alignment';
import { extractArticle, type Article } from '../extraction/document';
import { createSplit, MIN_WIDTH, viewportWidth } from '../layout/split';
import { ReaderPanel } from '../ui/reader-panel';
import css from '../ui/reader.css?inline';
import { createArticleIdentity } from './article-identity';
import { routeText, watchSourceChanges } from './source-changes';
import { createTranslation } from './translation';

export type ActiveReader = {
  id: string; state: () => ReaderState; close: () => void;
  pause: () => void; resume: () => void; clearCache: (disable?: boolean) => void;
};

const refreshDelay = 80;
const layoutRecoveryTime = 400;

let dismissNotice: (() => void) | undefined;

export function startReader(session: Session, afterClose: (error?: ErrorCode) => void): Result<ActiveReader> {
  dismissNotice?.();
  if (viewportWidth() < MIN_WIDTH) return failure('narrow');
  if (!document.body) return failure('unsupported-page');
  const initialPage = readReaderPage(location.href);
  if (session.pageUrl && (!initialPage || readReaderPage(session.pageUrl)?.key !== initialPage.key)) return failure('stale');

  const lifecycle = new AbortController();
  let ratio = session.ratio;
  let sync = session.syncScroll;
  let hover = session.highlight;
  let article: Article | undefined;
  const identity = createArticleIdentity();
  const translation = createTranslation(session, lifecycle.signal, render);
  let alignment: ReturnType<typeof connectAlignment> | undefined;
  let alignmentLife: AbortController | undefined;
  let initialLayout = true;
  let pageKey = initialPage?.key ?? location.href.split('#', 1)[0]!;
  let viewKey = initialPage?.viewKey ?? pageKey;
  let pageHash = location.hash;
  const outgoing = new WeakMap<Text, { key: string; text: string }>();
  let pageText = new Map<Text, string>();
  let waitingForRoute = false;
  let waitForMutation = false;
  let revision = 0;
  let timer = 0;
  let layoutBlockedAt: number | undefined;
  let contextUnavailable = false;
  let extraction: AbortController | undefined;
  let scroll: HTMLElement | null = null;
  let highlighted: HTMLElement | undefined;
  const targets = new Map<string, HTMLElement>();
  const split = createSplit(() => ratio, layoutChanged);
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(css);
  split.shadow.adoptedStyleSheets = [stylesheet];
  split.container.style.height = '100%';
  const root = createRoot(split.container);
  const flushChanges = watchSourceChanges(() => split.sourceViewport, () => article?.scope,
    lifecycle.signal, checkPage, sourceChanged);

  function state(): ReaderState {
    return translation.state();
  }

  function notify(message: ReaderRequest) {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  }

  function close(error?: ErrorCode) {
    if (lifecycle.signal.aborted) return;
    lifecycle.abort();
    clearTimeout(timer);
    extraction?.abort();
    disconnectAlignment();
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

  function render() {
    if (lifecycle.signal.aborted) return;
    flushSync(() => root.render(<ReaderPanel
      session={session} state={state()} nodes={article?.nodes ?? []}
      ratio={ratio} sync={sync} hover={hover} targets={targets}
      captureScroll={(element) => { scroll = element; }}
      show={translation.show}
      status={translation.status}
      onHover={(id) => alignment?.paint(id)}
      locate={(id) => alignment?.locate('source', id)}
      retry={translation.retry}
      close={() => close()} setRatio={setRatio}
      toggleSync={() => { sync = !sync; render(); }}
      toggleHover={() => { hover = !hover; if (!hover) alignment?.paint(null); render(); }}
      togglePause={() => state().status === 'paused' ? translation.resume() : translation.pause()}
    />));
  }

  function disconnectAlignment() {
    alignmentLife?.abort();
    alignmentLife = undefined;
    alignment = undefined;
    paint(null);
  }

  function align(result: Article) {
    const targetRoot = scroll;
    if (!targetRoot) { close('unavailable'); return; }
    const readingColumn = split.sidebar?.content;
    const primary = readingColumn ? result.blocks.filter((block) => readingColumn.contains(block.source)) : result.blocks;
    alignmentLife = new AbortController();
    alignment = connectAlignment({
      blocks: result.blocks, primary: primary.length ? primary : result.blocks,
      targets, sourceViewport: split.sourceViewport, targetRoot,
      syncEnabled: () => sync, highlightEnabled: () => hover,
      showHighlight: paint, signal: alignmentLife.signal,
    });
  }

  function checkPage(): boolean {
    if (lifecycle.signal.aborted) return false;
    const page = readReaderPage(location.href);
    const nextKey = page?.key ?? location.href.split('#', 1)[0]!;
    const fragmentChanged = pageHash !== location.hash;
    pageHash = location.hash;
    if (nextKey === pageKey) {
      const restored = split.restoreContext();
      const unavailable = split.sourceViewport !== document.body || !split.container.isConnected;
      if (fragmentChanged || restored || unavailable !== contextUnavailable) sourceChanged();
      contextUnavailable = unavailable;
      return true;
    }
    if (!page || page.origin !== initialPage?.origin) {
      close('unsupported-page');
      return false;
    }
    if (page.sensitive && page.key !== initialPage?.key) {
      close('sensitive-site');
      return false;
    }
    revision++;
    extraction?.abort();
    if (page.viewKey === viewKey) {
      pageKey = page.key;
      translation.refreshAddress();
      disconnectAlignment();
      scheduleRefresh();
      return true;
    }
    for (const [node, text] of pageText) outgoing.set(node, { key: viewKey, text });
    pageText.clear();
    waitForMutation = initialLayout;
    waitingForRoute = true;
    pageKey = page.key;
    viewKey = page.viewKey;
    translation.resetPage();
    disconnectAlignment();
    article = undefined;
    if (scroll) scroll.scrollTop = 0;
    render();
    scheduleRefresh();
    return true;
  }

  function sourceChanged() {
    waitForMutation = false;
    revision++;
    translation.hold();
    disconnectAlignment();
    scheduleRefresh();
  }

  function layoutChanged(error: 'narrow' | 'incompatible') {
    if (error === 'narrow') {
      close(error);
      return;
    }
    sourceChanged();
  }

  function scheduleRefresh(delay = refreshDelay) {
    if (timer || extraction || waitForMutation || lifecycle.signal.aborted) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (checkPage() && !timer && !extraction && !waitForMutation) void refresh();
    }, delay);
  }

  async function refresh() {
    const current = revision;
    const href = location.href;
    const key = viewKey;
    const controller = new AbortController();
    extraction = controller;
    try {
      split.restoreContext();
      if (!initialLayout) {
        const layoutError = split.checkGeometry();
        if (layoutError) {
          const now = performance.now();
          layoutBlockedAt ??= now;
          if (layoutError === 'narrow' || now - layoutBlockedAt >= layoutRecoveryTime) close(layoutError);
          else sourceChanged();
          return;
        }
        layoutBlockedAt = undefined;
        split.refreshSidebar();
      }
      const result = await extractArticle(session.range, controller.signal, split.sidebar, (node) => {
        const previous = outgoing.get(node);
        return Boolean(previous && previous.key !== key && previous.text === node.data);
      });
      flushChanges();
      if (controller.signal.aborted || lifecycle.signal.aborted || current !== revision) return;
      if (!validSources(result)) { sourceChanged(); return; }
      const source = routeText(result);
      if (waitingForRoute && !source.size) return;
      const hasText = result.blocks.some((block) => block.pieces.some((piece) => piece.translate && piece.text.trim()));
      if (!hasText) {
        if (initialLayout && !waitingForRoute) { close('no-text'); return; }
        article = undefined;
        pageText.clear();
        translation.replace([], href);
        translation.hold();
        render();
        return;
      }
      if (initialLayout) {
        const layoutError = split.activate();
        if (layoutError) { close(layoutError === 'incompatible' ? 'layout-start' : layoutError); return; }
        initialLayout = false;
      }
      waitingForRoute = false;
      pageText = source;
      for (const node of pageText.keys()) outgoing.delete(node);
      disconnectAlignment();
      identity.reconcile(result, article);
      article = result;
      translation.replace(result.blocks, href);
      render();
      align(result);
      translation.run();
    } catch {
      if (!controller.signal.aborted && !lifecycle.signal.aborted) close('unavailable');
    } finally {
      extraction = undefined;
      if (revision !== current) scheduleRefresh();
    }
  }

  render();
  scheduleRefresh(0);
  return success({
    id: session.id, state, close: () => close(), pause: translation.pause, resume: translation.resume,
    clearCache: translation.clearCache,
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
