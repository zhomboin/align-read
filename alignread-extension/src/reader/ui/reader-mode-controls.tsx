import { errors, type ErrorCode, type ReaderMode } from '../../shared/reader-messages';
import { READER_MODE_OPTIONS } from '../../shared/reader-mode-options';
import { SegmentedControl } from '../../shared/segmented-control';

export type ReaderModeSwitch = {
  pending: boolean;
  error?: ErrorCode;
  change: (mode: ReaderMode) => void;
};

export function focusReaderMode(root: ShadowRoot) {
  root.querySelector<HTMLInputElement>('.reader-mode-field input:checked')?.focus({ preventScroll: true });
}

export function ReaderModeControl({ mode, modeSwitch }: { mode: ReaderMode; modeSwitch: ReaderModeSwitch }) {
  return <SegmentedControl label="翻译模式" className="reader-mode-field" options={READER_MODE_OPTIONS}
    value={mode} change={modeSwitch.change} disabled={modeSwitch.pending} />;
}

export function ReplacementControls({ modeSwitch, close }: { modeSwitch: ReaderModeSwitch; close: () => void }) {
  return (
    <section className="replacement-controls" aria-label="AlignRead 原位翻译">
      <div className="controls" aria-busy={modeSwitch.pending}>
        <ReaderModeControl mode="replace" modeSwitch={modeSwitch} />
        <button type="button" disabled={modeSwitch.pending} onClick={close}>恢复原文</button>
      </div>
      {modeSwitch.error && <p className="mode-switch-error" role="status">{errors[modeSwitch.error]}</p>}
    </section>
  );
}
