import { errors, type ErrorCode, type ReaderMode, type ReaderState } from '../../shared/reader-messages';
import { ReaderModeSelector } from '../../shared/reader-mode-selector';
import { ReaderProgress } from './reader-progress';

export type ReaderModeSwitch = {
  pending: boolean;
  error?: ErrorCode;
  change: (mode: ReaderMode) => void;
};

export function focusReaderMode(root: ShadowRoot) {
  root.querySelector<HTMLInputElement>('.reader-mode-field input[type=range]')?.focus({ preventScroll: true });
}

export function ReaderModeControl({ mode, modeSwitch }: { mode: ReaderMode; modeSwitch: ReaderModeSwitch }) {
  return <ReaderModeSelector className="reader-mode-field" mode={mode} onChange={modeSwitch.change} disabled={modeSwitch.pending} />;
}

export function ReplacementControls({ modeSwitch, close, state }: { modeSwitch: ReaderModeSwitch; close: () => void; state: ReaderState }) {
  return (
    <section className="replacement-controls" aria-label="AlignRead 原位翻译">
      <div className="controls" aria-busy={modeSwitch.pending}>
        <ReaderModeControl mode="replace" modeSwitch={modeSwitch} />
        <button type="button" disabled={modeSwitch.pending} onClick={close}>恢复原文</button>
      </div>
      {modeSwitch.error && <p className="mode-switch-error" role="status">{errors[modeSwitch.error]}</p>}
      <ReaderProgress state={state} />
    </section>
  );
}
