import { useId } from 'react';

type Choice<T extends string> = { value: T; label: string };
type Props<T extends string> = {
  label: string;
  className: string;
  options: readonly [Choice<T>, Choice<T>];
  value: T;
  change: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({ label, className, options, value, change, disabled }: Props<T>) {
  const name = useId();

  return <fieldset className={`segmented-field ${className}`} disabled={disabled}>
    <legend>{label}</legend>
    <div className="segmented-choices" data-second={value === options[1].value}>
      {options.map((option) => <label key={option.value}>
        <input
          type="radio"
          name={name}
          value={option.value}
          checked={value === option.value}
          onChange={() => change(option.value)}
        />
        <span>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
