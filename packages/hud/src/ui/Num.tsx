import { computed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { fmtInt } from '../format/index.ts';
import { isSignal } from './bind.ts';
import type { MaybeSignal } from './bind.ts';
import { cx } from './cx.ts';

export interface NumProps {
  readonly value: MaybeSignal<number>;
  /** Formatter (default fmtInt, locale from the locale signal). */
  readonly format?: ((v: number) => string) | undefined;
  /** Reserved minimum width in ch so ticks never shift neighbours (ui.md §1.3, §9.2). */
  readonly ch?: number | undefined;
  readonly align?: 'left' | 'right' | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/**
 * Tabular number bound to a signal. The formatted string is a computed signal rendered as a text
 * binding: the text node is written only when the formatted string changes, the component never re-renders.
 */
export function Num({ value, format = fmtInt, ch, align = 'right', class: cls, testId }: NumProps): JSX.Element {
  const bound = useMemo<ReadonlySignal<string> | null>(
    () => (isSignal(value) ? computed(() => format(value.value)) : null),
    [value, format],
  );
  // Plain values format during render (re-rendered by the parent, and on locale change via the signal read).
  const text = bound ?? format(value as number);
  return (
    <span
      class={cx('num', 'ff-numbox', cls)}
      style={ch ? { minWidth: `${ch}ch`, textAlign: align } : { textAlign: align }}
      data-component="Num"
      data-testid={testId ?? 'num'}
    >
      {text}
    </span>
  );
}
