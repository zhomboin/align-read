import { browser } from 'wxt/browser';
import { failure, isRecord, success, type Result } from '../shared/reader-messages';
import type { SelectionCommand, SelectionKind, SelectionRequest, SelectionSession } from '../shared/selection-messages';
import { sameSelectionPage } from '../shared/selection-page';

export async function send<T>(message: SelectionRequest): Promise<Result<T>> {
  try {
    return (await browser.runtime.sendMessage(message) as Result<T> | undefined) ?? failure('unavailable');
  } catch {
    return failure('unavailable');
  }
}

type Controls = { isConnected?: () => boolean; setShortcut?: (shortcut: string) => void };

export function installSelectionFeature(kind: SelectionKind,
  start: (session: SelectionSession, signal: AbortSignal, currentPage: () => boolean) => Controls) {
  const binding = kind === 'paragraph' ? '__alignReadParagraph' : '__alignReadSelection';
  const scope = window as Window & { __alignReadParagraph?: boolean; __alignReadSelection?: boolean };
  if (scope[binding]) return;
  scope[binding] = true;
  let active: { id: string; lifecycle: AbortController; controls: Controls } | undefined;
  let pageUrl = location.href;

  function stop() {
    if (!active) return;
    const { id, lifecycle } = active;
    active = undefined;
    lifecycle.abort();
    void send({ type: `${kind}:closed`, sessionId: id });
  }

  function currentPage() {
    const url = location.href;
    if (active?.controls.isConnected?.() === false || !sameSelectionPage(pageUrl, url, name =>
      !!document.getElementById(name) || Array.from(document.getElementsByName(name)).some(el => el.tagName === 'A'))) stop();
    pageUrl = url;
    return Boolean(active);
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== browser.runtime.id || !isRecord(message) || typeof message.type !== 'string' ||
      !message.type.startsWith(kind + ':')) return;
    const command = message as SelectionCommand;
    if (command.type === `${kind}:state`) {
      reply(currentPage() ? active?.id : null);
    } else if (command.type === `${kind}:stop`) {
      stop();
      reply(null);
    } else if (command.type === 'paragraph:shortcut' && kind === 'paragraph') {
      if (active?.id === command.sessionId) active.controls.setShortcut?.(command.shortcut);
      reply(null);
    } else if (command.type === 'selection:start' || command.type === 'paragraph:start') {
      stop();
      pageUrl = location.href;
      const lifecycle = new AbortController();
      const { signal } = lifecycle;
      active = { id: command.session.id, lifecycle, controls: {} };
      try {
        active.controls = start(command.session, signal, currentPage);
        window.addEventListener('pagehide', stop, { signal });
        window.addEventListener('hashchange', currentPage, { signal });
        window.addEventListener('popstate', currentPage, { signal });
        (window as Window & { navigation?: EventTarget }).navigation?.addEventListener('currententrychange', currentPage, { signal });
        reply(success(null));
      } catch {
        stop();
        reply(failure('unavailable'));
      }
    }
  });
}
