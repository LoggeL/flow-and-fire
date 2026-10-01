import type { JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface SwitchProps {
  readonly on: boolean;
  readonly onChange?: ((next: boolean) => void) | undefined;
  /** Accessible name (translated). */
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** On/off switch (settings). */
export function Switch({ on, onChange, label, disabled = false, demoState, class: cls, testId }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      class={cx('ff-switch', on && 'is-on', disabled && 'is-disabled', demoClass(demoState), cls)}
      onClick={() => onChange?.(!on)}
      data-component="Switch"
      data-testid={testId ?? 'switch'}
    />
  );
}
