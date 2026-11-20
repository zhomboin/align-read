import { useId, useLayoutEffect, useRef } from 'react';
import type { ReaderMode } from './reader-messages';
import { READER_MODE_OPTIONS } from './reader-mode-options';

type Props = {
  className: string;
  mode: ReaderMode;
  disabled: boolean;
  onChange: (mode: ReaderMode) => void;
};

export function ReaderModeSelector({ className, mode, disabled, onChange }: Props) {
  const labelId = useId();
  const slider = useRef<HTMLInputElement>(null);
  const index = mode === 'replace' ? 1 : 0;

  useLayoutEffect(() => {
    if (slider.current) slider.current.valueAsNumber = index;
  }, [index]);

  // 拖动结束后再切换阅读器，让滑块在原工具栏内完成整个手势。
  useLayoutEffect(() => {
    const input = slider.current!;
    function commit() {
      const next = READER_MODE_OPTIONS[input.valueAsNumber === 1 ? 1 : 0].value;
      input.valueAsNumber = index;
      if (next !== mode) onChange(next);
    }
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [index, mode, onChange]);

  function label(option: typeof READER_MODE_OPTIONS[number]) {
    return <button type="button" className="mode-name" tabIndex={-1} aria-pressed={mode === option.value}
      onClick={() => {
        slider.current?.focus({ preventScroll: true });
        if (mode !== option.value) onChange(option.value);
      }}>{option.label}</button>;
  }

  return <fieldset className={`mode-selector ${className}`} dir="ltr" disabled={disabled}>
    <legend id={labelId}>翻译模式</legend>
    <div className="mode-track-control">
      {label(READER_MODE_OPTIONS[0])}
      <input ref={slider} type="range" min="0" max="1" step="1" defaultValue={index}
        aria-labelledby={labelId} aria-valuetext={READER_MODE_OPTIONS[index].label} />
      {label(READER_MODE_OPTIONS[1])}
    </div>
  </fieldset>;
}
