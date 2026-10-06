import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx.ts';
import type { Tone } from './Key.tsx';
import { LineIcon } from './LineIcon.tsx';
import type { LineIconName } from './icons.ts';

export interface BadgeProps {
  readonly tone?: Tone | undefined;
  readonly icon?: LineIconName | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/** Status badge (neutral, ok, info, warn, crit, ember). Always carries text, never colour alone. */
export function Badge({ tone = 'neutral', icon, class: cls, testId, children }: BadgeProps): JSX.Element {
  return (
    <span
      class={cx('ff-badge', tone !== 'neutral' && `ff-badge--${tone}`, cls)}
      data-component="Badge"
      data-testid={testId ?? 'badge'}
      data-tone={tone}
    >
      {icon ? <LineIcon name={icon} /> : null}
      {children}
    </span>
  );
}
