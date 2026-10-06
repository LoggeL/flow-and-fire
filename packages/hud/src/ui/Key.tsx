import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx.ts';
import { keyLabel } from './keys.ts';
import type { KeyboardLayout } from './keys.ts';

export type Tone = 'neutral' | 'ok' | 'info' | 'warn' | 'crit' | 'ember';

export interface KeyProps {
  readonly tone?: Tone | 'copper' | undefined;
  /** Physical key (KeyboardEvent.code); the label follows `layout`. Ignored when children are given. */
  readonly code?: string | undefined;
  readonly layout?: KeyboardLayout | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/** Key cap (Plex Mono). */
export function Key({ tone = 'neutral', code, layout = 'de', class: cls, testId, children }: KeyProps): JSX.Element {
  return (
    <kbd
      class={cx('ff-key', tone !== 'neutral' && `ff-key--${tone}`, cls)}
      data-component="Key"
      data-testid={testId ?? 'key'}
      data-tone={tone}
    >
      {children ?? (code ? keyLabel(code, layout) : null)}
    </kbd>
  );
}
