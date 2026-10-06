import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx.ts';
import { LineIcon } from './LineIcon.tsx';
import type { LineIconName } from './icons.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
/** Static demo states for the gallery (mirror :hover / :active / :focus-visible). */
export type DemoState = 'hover' | 'pressed' | 'focus';

export function demoClass(state: DemoState | undefined): string | undefined {
  if (state === 'hover') return 'is-hover';
  if (state === 'pressed') return 'is-pressed';
  if (state === 'focus') return 'is-focus';
  return undefined;
}

export interface ButtonProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly icon?: LineIconName | undefined;
  /** Accessible name (required for icon-only buttons; already translated). */
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly onClick?: ((e: MouseEvent) => void) | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/** Menu/dialog button (ui.md §6: primary, secondary, ghost, danger × sm/md/lg/icon). */
export function Button(props: ButtonProps): JSX.Element {
  const { variant = 'secondary', size = 'md', icon, label, disabled = false, demoState } = props;
  return (
    <button
      type={props.type ?? 'button'}
      class={cx(
        'ff-btn',
        variant !== 'secondary' && `ff-btn--${variant}`,
        size !== 'md' && `ff-btn--${size}`,
        demoClass(demoState),
        disabled && 'is-disabled',
        props.class,
      )}
      disabled={disabled}
      aria-label={label}
      autoFocus={props.autoFocus}
      onClick={props.onClick}
      data-component="Button"
      data-testid={props.testId ?? 'button'}
      data-variant={variant}
    >
      {icon ? <LineIcon name={icon} /> : null}
      {props.children}
    </button>
  );
}
