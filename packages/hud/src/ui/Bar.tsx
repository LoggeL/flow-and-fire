import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { hpLevel } from '../model/selection.ts';
import { clamp01, isSignal, peekValue, useBindEffect } from './bind.ts';
import type { MaybeSignal } from './bind.ts';
import { cx } from './cx.ts';

export type BarKind = 'hp' | 'shield' | 'build' | 'mass' | 'energy';
/** 'auto' derives warn/crit from the value (HP thresholds 55 % / 30 %, ui.md §3.7). */
export type BarLevel = 'auto' | 'normal' | 'warn' | 'crit';

export interface BarProps {
  readonly kind: BarKind;
  /** Fill 0..1; a signal is bound to --v without re-rendering. */
  readonly value: MaybeSignal<number>;
  /** Default: 'auto' for hp, 'normal' otherwise. Critical bars are hatched (never colour alone). */
  readonly level?: MaybeSignal<BarLevel> | undefined;
  /** Marker positions 0..1 (e.g. tap-shot threshold). */
  readonly marks?: readonly number[] | undefined;
  /** Accessible description (translated); without it the bar is decorative. */
  readonly label?: string | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

function levelClass(level: BarLevel, v: number): 'is-warn' | 'is-crit' | null {
  const l = level === 'auto' ? hpLevel(v) : level;
  if (l === 'warn') return 'is-warn';
  if (l === 'crit') return 'is-crit';
  return null;
}

/** Bar (hp/shield/build/mass/energy) drawn with transform: scaleX(var(--v)), never width. */
export function Bar(props: BarProps): JSX.Element {
  const { kind, value, marks, label } = props;
  const level = props.level ?? (kind === 'hp' ? 'auto' : 'normal');
  const ref = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLElement>(null);
  const v0 = clamp01(peekValue(value));
  const cls0 = levelClass(peekValue(level), v0);

  useBindEffect(() => {
    if (!isSignal(value) && !isSignal(level)) return;
    const v = clamp01(isSignal(value) ? value.value : value);
    const c = levelClass(isSignal(level) ? level.value : level, v);
    const el = ref.current;
    const fill = fillRef.current;
    if (!el || !fill) return;
    fill.style.setProperty('--v', String(v));
    el.classList.toggle('is-warn', c === 'is-warn');
    el.classList.toggle('is-crit', c === 'is-crit');
  }, [value, level]);

  return (
    <div
      ref={ref}
      class={cx('ff-bar', `ff-bar--${kind}`, cls0, props.class)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      data-component="Bar"
      data-testid={props.testId ?? `bar-${kind}`}
    >
      <i ref={fillRef} style={{ '--v': String(v0) }} />
      {marks?.map((m, i) => (
        <span key={i} class="ff-bar__mark" style={{ left: `${clamp01(m) * 100}%` }} />
      ))}
    </div>
  );
}
