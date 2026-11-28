import { browser } from 'wxt/browser';
import { failure, type ErrorCode, type ReaderMode, type ReaderRequest, type ReaderState, type Result, type Session } from '../../shared/reader-messages';
import type { ReaderModeSwitch } from '../ui/reader-mode-controls';

export function createModeSwitch(
  session: Session, signal: AbortSignal, update: () => void, checkTarget: (mode: ReaderMode) => ErrorCode | undefined,
) {
  let pending = false;
  let error: ErrorCode | undefined;

  async function change(mode: ReaderMode) {
    if (pending || signal.aborted || mode === (session.mode ?? 'dual')) return;
    error = checkTarget(mode);
    if (error) {
      update();
      return;
    }

    pending = true;
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
