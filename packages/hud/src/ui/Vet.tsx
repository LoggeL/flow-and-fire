import type { JSX } from 'preact';
import { t } from '../i18n/t.ts';
import { cx } from './cx.ts';
import type { Tone } from './Key.tsx';

export const VET_MAX = 5;

export interface VetProps {
  /** 0..max */
  readonly level: number;
  readonly max?: number | undefined;
  readonly tone?: Tone | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Veterancy diamonds (U9): filled diamonds up to `level`. */
export function Vet({ level, max = VET_MAX, tone = 'neutral', class: cls, testId }: VetProps): JSX.Element {
  const n = Math.max(0, Math.min(max, Math.round(level)));
  const pips: JSX.Element[] = [];
  for (let i = 0; i < max; i++) pips.push(<i key={i} class={i < n ? 'on' : undefined} />);
  return (
    <span
      class={cx('ff-vet', tone !== 'neutral' && `ff-vet--${tone}`, cls)}
      role="img"
      aria-label={t('ui.common.vet', { n, max })}
      data-component="Vet"
      data-testid={testId ?? 'vet'}
      data-level={n}
    >
      {pips}
    </span>
  );
}
