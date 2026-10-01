import type { JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface CheckProps {
  readonly checked: boolean | 'mixed';
  readonly onChange?: ((next: boolean) => void) | undefined;
  /** Accessible name (translated). */
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Check box; "mixed" for mixed selections. Clicking a mixed box checks it. */
export function Check({ checked, onChange, label, disabled = false, demoState, class: cls, testId }: CheckProps): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      class={cx('ff-check', checked === true && 'is-on', checked === 'mixed' && 'is-mixed', disabled && 'is-disabled', demoClass(demoState), cls)}
      onClick={() => onChange?.(checked !== true)}
      data-component="Check"
      data-testid={testId ?? 'check'}
    />
  );
}
