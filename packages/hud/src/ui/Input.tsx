import type { JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface InputProps {
  readonly value: string;
  readonly onInput?: ((value: string) => void) | undefined;
  /** Accessible name (translated). */
  readonly label: string;
  /** Translated placeholder. */
  readonly placeholder?: string | undefined;
  readonly type?: 'text' | 'number' | 'search' | undefined;
  readonly maxLength?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Text input (seed, player name, console). Focus here routes all keys to the field (ui.md §7.2 layer 1). */
export function Input(props: InputProps): JSX.Element {
  const { disabled = false, invalid = false } = props;
  return (
    <input
      type={props.type ?? 'text'}
      class={cx('ff-input', disabled && 'is-disabled', invalid && 'is-invalid', demoClass(props.demoState), props.class)}
      value={props.value}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      disabled={disabled}
      aria-label={props.label}
      aria-invalid={invalid || undefined}
      spellcheck={false}
      autoComplete="off"
      onInput={(e) => props.onInput?.((e.currentTarget as HTMLInputElement).value)}
      data-component="Input"
      data-testid={props.testId ?? 'input'}
    />
  );
}
