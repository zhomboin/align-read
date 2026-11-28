import { browser } from 'wxt/browser';
import { MIN_WIDTH, viewportWidth } from '../src/reader/layout/split';
import type { ModeTranslations } from '../src/reader/session/translation';
import type { ActiveReader } from '../src/reader/session/reader';
import { failure, isRecord, success, type ReaderCommand, type ReaderState, type Session } from '../src/shared/reader-messages';
import { readReaderPage } from '../src/shared/reader-page';

export default defineUnlistedScript(() => {
  const binding = window as Window & { __alignReadReader?: boolean };
  if (binding.__alignReadReader) return;
  binding.__alignReadReader = true;
  let active: ActiveReader | undefined;
  let lastState: ReaderState | null = null;
  let generation = 0;

  const stop = () => {
    generation++;
    active?.close();
    active = undefined;
    lastState = null;
  };

  async function open(session: Session, previousSessionId?: string) {
    if (previousSessionId === undefined) stop();
    else if (active?.id !== previousSessionId) return failure('stale');
    const command = generation;
    const mode = session.mode ?? 'dual';
    const start = mode !== 'dual'
      ? (await import('../src/reader/session/replacement-reader')).startReplacementReader
      : (await import('../src/reader/session/reader')).startReader;
    if (command !== generation) return failure('stale');
    let inherited: ModeTranslations | undefined;
    if (previousSessionId !== undefined) {
      const page = readReaderPage(location.href);
      if (active?.id !== previousSessionId || !page || page.key !== readReaderPage(session.pageUrl)?.key) {
        return failure('stale');
      }
      if (!document.body) return failure('unsupported-page');
      if (mode === 'dual' && viewportWidth() < MIN_WIDTH) return failure('narrow');
      inherited = active.translationsForMode(session);
      stop();
    }
    const started = start(session, (reason) => {
      if (active?.id !== session.id) return;
      active = undefined;
      lastState = reason ? { mode, status: 'error', done: 0, total: 0, failed: 0, error: reason } : null;
    }, inherited);
    if (!started.ok) return failure(started.error);
    const reader = started.value;
    const { source, target, range } = session;
    active = { ...reader, state: () => ({ ...reader.state(), mode, options: { source, target, range } }) };
    if (previousSessionId !== undefined) reader.focusMode();
    return success(active.state());
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== browser.runtime.id || !isRecord(message)) return;
    const command = message as ReaderCommand;
    switch (command.type) {
      case 'reader:state':
        reply(active?.state() ?? lastState);
        break;
      case 'reader:stop':
        stop();
        reply(null);
        break;
      case 'reader:pause':
        active?.pause();
        reply(active?.state() ?? null);
        break;
      case 'reader:resume':
        active?.resume();
        reply(active?.state() ?? null);
        break;
      case 'reader:retry':
        active?.retry?.();
        reply(active?.state() ?? null);
        break;
      case 'reader:clear-cache':
        active?.clearCache(command.disable);
        reply(null);
        break;
      case 'reader:start':
        void open(command.session).then(reply, () => reply(failure('unavailable')));
        return true;
      case 'reader:switch-mode':
        void open(command.session, command.previousSessionId).then(reply, () => reply(failure('unavailable')));
        return true;
    }
  });
  window.addEventListener('pagehide', stop);
});
