import { browser } from 'wxt/browser';
import { failure, success, type ErrorCode, type ReaderRequest, type Result, type Session } from '../../shared/reader-messages';
import { readReaderPage } from '../../shared/reader-page';
import { canReplaceText, extractArticle, type Article } from '../extraction/document';
import { displayComment } from '../extraction/code-comments';
import { MIN_WIDTH, viewportWidth } from '../layout/split';
import { createReplacementToolbar } from '../ui/replacement-toolbar';
import { createArticleIdentity } from './article-identity';
import { createModeSwitch } from './mode-switch';
import type { ActiveReader } from './reader';
import { trackReplacementText } from './replacement-text';
import { routeText, watchSourceChanges } from './source-changes';
import { createTranslation } from './translation';

const refreshDelay = 80;

export function startReplacementReader(session: Session, afterClose: (error?: ErrorCode) => void): Result<ActiveReader> {
  const initialPage = readReaderPage(location.href);
  if (!document.body || !initialPage) return failure('unsupported-page');
  const { key: initialKey, origin } = initialPage;
  if (session.pageUrl && readReaderPage(session.pageUrl)?.key !== initialKey) return failure('stale');

  const lifecycle = new AbortController();
  const toolbar = createReplacementToolbar();
  const modeSwitch = createModeSwitch(session, lifecycle.signal, renderToolbar, () => {
    if (viewportWidth() < MIN_WIDTH) return 'narrow';
  });
  const identity = createArticleIdentity();
  const replacement = trackReplacementText();
  const translation = createTranslation(session, lifecycle.signal, applyTranslations);
  const outgoing = new WeakMap<Text, { key: string; text: string }>();
  const appliedBlocks = new Set<string>();
  let sourceBody = document.body;
  let page = initialPage;
  let pageHash = location.hash;
  let article: Article | undefined;
  let pageText = new Map<Text, string>();
  let revision = 0;
  let articleRevision = -1;
  let timer = 0;
  let extraction: AbortController | undefined;
  let waitingForRoute = false;
  let waitForMutation = false;
  let started = false;
  let closing = false;

  const flushChanges = watchSourceChanges(() => document.body, () => article?.scope,
    lifecycle.signal, checkPage, sourceChanged, replacement);

  function close(error?: ErrorCode) {
    if (closing) return;
    closing = true;
    // Process site writes before deciding which nodes the extension still owns.
    flushChanges();
    lifecycle.abort();
    extraction?.abort();
    clearTimeout(timer);
    replacement.restoreExcept();
    toolbar.close();
    void browser.runtime.sendMessage({ type: 'closed', sessionId: session.id } satisfies ReaderRequest)
      .catch(() => undefined);
    afterClose(error);
  }

  function renderToolbar() {
    if (closing) return;
    toolbar.mount();
    toolbar.render(modeSwitch(), () => close());
  }

  function checkPage() {
    if (closing) return false;
    const next = readReaderPage(location.href);
    if (!next || next.origin !== origin) {
      close('unsupported-page');
      return false;
    }
    toolbar.mount();
    const hashChanged = pageHash !== location.hash;
    const bodyChanged = sourceBody !== document.body;
    pageHash = location.hash;
    sourceBody = document.body;
    if (next.key === page.key) {
      if (hashChanged || bodyChanged) sourceChanged();
      return true;
    }
    if (next.sensitive && next.key !== initialKey) {
      close('sensitive-site');
      return false;
    }
    const viewChanged = next.viewKey !== page.viewKey;
    if (viewChanged) {
      for (const [node, text] of pageText) outgoing.set(node, { key: page.viewKey, text });
      pageText.clear();
      replacement.restoreExcept();
      translation.resetPage();
      article = undefined;
      waitingForRoute = true;
    } else {
      translation.refreshAddress();
    }
    page = next;
    sourceChanged();
    if (viewChanged && !started && !bodyChanged) waitForMutation = true;
    return true;
  }

  function sourceChanged() {
    waitForMutation = false;
    revision++;
    extraction?.abort();
    translation.hold();
    scheduleRefresh();
  }

  function scheduleRefresh(delay = refreshDelay) {
    if (closing || timer || extraction || waitForMutation) return;
    timer = window.setTimeout(() => {
      timer = 0;
      flushChanges();
      if (!closing && !timer && !waitForMutation && document.body) void refresh();
    }, delay);
  }

  async function refresh() {
    const current = revision;
    const href = location.href;
    const viewKey = page.viewKey;
    const controller = new AbortController();
    extraction = controller;
    try {
      const result = await extractArticle(session.range, controller.signal, undefined, (node) => {
        if (replacement.siteControls(node)) return true;
        const previous = outgoing.get(node);
        return Boolean(previous && previous.key !== viewKey && previous.text === replacement.readText(node));
      }, replacement, session.replaceComments);
      flushChanges();
      if (closing || current !== revision || controller.signal.aborted) return;

      const source = routeText(result);
      if (waitingForRoute && !source.size) return;
      const retained = new Set<Text>();
      for (const block of result.blocks) {
        for (const node of block.replacements?.keys() ?? []) retained.add(node);
      }
      replacement.restoreExcept(retained);
      if (!retained.size && !started && !waitingForRoute) {
        close('no-text');
        return;
      }

      started = true;
      waitingForRoute = false;
      pageText = source;
      for (const node of pageText.keys()) outgoing.delete(node);
      identity.reconcile(result, article);
      article = result;
      articleRevision = current;
      appliedBlocks.clear();
      translation.replace(result.blocks, href);
      applyTranslations();
      translation.run();
    } catch {
      if (!controller.signal.aborted && !closing) close('unavailable');
    } finally {
      extraction = undefined;
      if (revision !== current) scheduleRefresh();
    }
  }

  function applyTranslations() {
    flushChanges();
    if (closing || articleRevision !== revision || !article) return;
    for (const block of article.blocks) {
      if (!block.replacements?.size || appliedBlocks.has(block.id)) continue;
      if (translation.status(block.id) !== 'done') {
        for (const node of block.replacements.keys()) replacement.restore(node);
        continue;
      }
      if ([...block.snapshots].some(([node, original]) =>
        !node.isConnected || replacement.readText(node) !== original)) continue;
      let applied = true;
      for (const [node, fragments] of block.replacements) {
        const isComment = fragments.some((fragment) => typeof fragment !== 'string' && fragment.comment);
        if (!canReplaceText(node, isComment)) {
          replacement.restore(node);
          applied = false;
          continue;
        }
        const value = fragments.map((fragment) => {
          if (typeof fragment === 'string') return fragment;
          const translated = translation.show(fragment.id, fragment.text);
          return fragment.comment ? displayComment(fragment.text, translated) : translated;
        }).join('');
        replacement.apply(node, block.snapshots.get(node)!, value);
      }
      if (applied) appliedBlocks.add(block.id);
    }
  }

  renderToolbar();
  scheduleRefresh(0);
  return success({
    id: session.id, state: translation.state, close: () => close(),
    pause: translation.pause, resume: translation.resume, retry: translation.retry, clearCache: translation.clearCache,
    focusMode: toolbar.focusMode,
  });
}
