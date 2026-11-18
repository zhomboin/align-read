import { browser } from 'wxt/browser';
import type { ActiveReader } from '../src/reader/session/reader';
import { failure, isRecord, type ReaderCommand, type ReaderState, type Session } from '../src/shared/reader-messages';

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

  async function open(session: Session) {
    stop();
    const command = generation;
    const mode = session.mode ?? 'dual';
    const start = mode === 'replace'
      ? (await import('../src/reader/session/replacement-reader')).startReplacementReader
      : (await import('../src/reader/session/reader')).startReader;
    if (command !== generation) return failure('stale');
    const started = start(session, (reason) => {
      if (active?.id !== session.id) return;
      active = undefined;
      lastState = reason ? { mode, status: 'error', done: 0, total: 0, failed: 0, error: reason } : null;
    });
    if (!started.ok) return failure(started.error);
    const reader = started.value;
    active = { ...reader, state: () => ({ ...reader.state(), mode }) };
    return { ok: true, value: active.state() };
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
    }
  });
  window.addEventListener('pagehide', stop);
});
