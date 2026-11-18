import { browser } from 'wxt/browser';
import { failure, type ErrorCode, type ReaderMode, type ReaderRequest, type ReaderState, type Result, type Session } from '../../shared/reader-messages';
import { MIN_WIDTH, viewportWidth } from '../layout/split';
import type { ReaderModeSwitch } from '../ui/reader-mode-controls';

export function createModeSwitch(session: Session, signal: AbortSignal, update: () => void) {
  let pending = false;
  let error: ErrorCode | undefined;

  async function change(mode: ReaderMode) {
    if (pending || signal.aborted || mode === (session.mode ?? 'dual')) return;
    if (mode === 'dual' && viewportWidth() < MIN_WIDTH) {
      error = 'narrow';
      update();
      return;
    }

    pending = true;
    error = undefined;
    update();
    const message = { type: 'switch-mode', sessionId: session.id, mode, pageUrl: location.href } satisfies ReaderRequest;
    const result: Result<ReaderState> = await browser.runtime.sendMessage(message).then(
      (reply: Result<ReaderState> | undefined) => reply ?? failure('unavailable'),
      () => failure('unavailable'),
    );
    if (signal.aborted) return;
    pending = false;
    error = result.ok ? undefined : result.error;
    update();
  }

  return (): ReaderModeSwitch => ({ pending, error, change });
}
