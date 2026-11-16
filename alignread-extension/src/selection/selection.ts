import { browser } from 'wxt/browser';
import { errors, failure, type Result } from '../shared/reader-messages';
import { MAX_SELECTION_LENGTH, type SelectionRequest, type SelectionSession } from '../shared/selection-messages';
import { createPanel } from './panel';
import { readSelection, sameSelection, type SelectedText } from './source';

function send<T>(message: SelectionRequest): Promise<Result<T>> {
  return browser.runtime.sendMessage(message).then(
    (result: Result<T> | undefined) => result ?? failure('unavailable'),
    () => failure('unavailable'),
  );
}

export function startSelection(session: SelectionSession, onStop: () => void) {
  const panel = createPanel(session);
  const pageUrl = location.href;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  let selected: SelectedText | undefined;
  let frame = 0;
  let open = false;
  let translation = '';
  let sequence = 0;
  let requestId: string | undefined;

  function cancel() {
    if (!requestId) return;
    const previous = requestId;
    requestId = undefined;
    void send({ type: 'selection:cancel', sessionId: session.id, requestId: previous });
  }

  function stop() {
    if (signal.aborted) return;
    lifecycle.abort();
    cancelAnimationFrame(frame);
    cancel();
    panel.host.remove();
    selected = undefined;
    translation = '';
    void send({ type: 'selection:closed', sessionId: session.id });
    onStop();
  }

  function currentPage() {
    if (location.href !== pageUrl || !panel.host.isConnected) stop();
    return !signal.aborted;
  }

  function dismiss(restoreFocus = false) {
    const focused = restoreFocus && panel.shadow.activeElement !== null;
    cancel();
    open = false;
    translation = '';
    panel.render('', '', '', false);
    panel.position(selected?.range, false);
    if (focused) panel.trigger.focus({ preventScroll: true });
  }

  function refresh() {
    if (!currentPage()) return;
    const next = readSelection();
    if (selected && sameSelection(selected, next)) {
      panel.position(selected.range, open);
      return;
    }
    selected = next;
    dismiss();
  }

  function scheduleRefresh() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  }

  async function translate(focusCard = false) {
    if (!currentPage() || !selected) return;
    if (!sameSelection(selected, readSelection())) { refresh(); return; }
    cancel();
    const source = selected;
    open = true;
    translation = '';
    if (source.text.length > MAX_SELECTION_LENGTH) {
      panel.render('', '', `选区过长，请选取不超过 ${MAX_SELECTION_LENGTH} 字符的文字。`, false);
      panel.position(source.range, true);
      if (focusCard) panel.close.focus({ preventScroll: true });
      return;
    }

    const id = String(++sequence);
    requestId = id;
    panel.render(source.text, '', '正在翻译…', false);
    panel.position(source.range, true);
    if (focusCard) panel.close.focus({ preventScroll: true });
    const result = await send<string>({ type: 'selection:translate', sessionId: session.id, requestId: id, text: source.text });
    if (requestId !== id || !currentPage()) return;
    requestId = undefined;
    if (!sameSelection(source, readSelection())) { refresh(); return; }
    if (result.ok) {
      translation = result.value;
      panel.render(source.text, translation, '', false);
    } else {
      const message = result.error === 'timeout' ? '翻译请求超时，请重试。' :
        result.error === 'stale' ? '本次翻译已结束，请重新开启选词翻译。' : errors[result.error];
      panel.render(source.text, '', message, result.error !== 'stale');
    }
    panel.position(source.range, true);
  }

  panel.trigger.addEventListener('click', (event) => { void translate(event.detail === 0); }, { signal });
  panel.retry.addEventListener('click', (event) => { void translate(event.detail === 0); }, { signal });
  panel.close.addEventListener('click', () => dismiss(true), { signal });
  panel.copy.addEventListener('click', async () => {
    if (!currentPage() || !translation || !selected) return;
    if (!sameSelection(selected, readSelection())) { refresh(); return; }
    const source = selected;
    const text = translation;
    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else copied = copyText(text);
    } catch {
      copied = copyText(text);
    }
    if (!open || selected !== source || translation !== text || !currentPage()) return;
    panel.render(source.text, text, copied ? '已复制' : '复制失败，请重试。', false);
    panel.position(source.range, true);
  }, { signal });

  document.addEventListener('pointerdown', (event) => {
    if (open && event.target !== panel.host) {
      selected = undefined;
      dismiss();
    }
  }, { signal, capture: true });
  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(true);
  }, { signal, capture: true });
  document.addEventListener('selectionchange', scheduleRefresh, { signal });
  window.addEventListener('scroll', scheduleRefresh, { signal, capture: true, passive: true });
  window.addEventListener('resize', scheduleRefresh, { signal });
  window.addEventListener('hashchange', stop, { signal });
  window.addEventListener('popstate', () => { currentPage(); }, { signal });
  refresh();
  return { id: session.id, stop };
}

function copyText(text: string) {
  // Plain HTTP pages may have no Clipboard API. Use the active click without changing the selection.
  const controller = new AbortController();
  let copied = false;
  window.addEventListener('copy', (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
    copied = true;
  }, { signal: controller.signal, capture: true });
  try {
    document.execCommand('copy');
    return copied;
  } catch {
    return false;
  } finally {
    controller.abort();
  }
}
