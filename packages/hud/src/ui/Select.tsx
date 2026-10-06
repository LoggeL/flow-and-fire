import type { JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface SelectOption<T extends string> {
  readonly value: T;
  /** Translated label. */
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

export interface SelectProps<T extends string> {
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
  readonly onChange?: ((value: T) => void) | undefined;
  /** Accessible name (translated). */
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Native select in the Gießhalle style (keyboard behaviour stays native). */
export function Select<T extends string>(props: SelectProps<T>): JSX.Element {
  const { options, value, onChange, disabled = false } = props;
  return (
    <select
      class={cx('ff-select', disabled && 'is-disabled', demoClass(props.demoState), props.class)}
      value={value}
      disabled={disabled}
      aria-label={props.label}
      onChange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        const opt = options.find((o) => o.value === v);
        if (opt) onChange?.(opt.value);
      }}
      data-component="Select"
      data-testid={props.testId ?? 'select'}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
