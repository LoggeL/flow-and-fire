import type { JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface RangeProps {
  readonly value: number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly onChange?: ((value: number) => void) | undefined;
  /** Accessible name (translated). */
  readonly label: string;
  /** Spoken value (e.g. "80 %"). */
  readonly valueText?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Fill fraction as CSS percentage for the WebKit track gradient. */
export function rangeFill(value: number, min: number, max: number): string {
  const f = max > min ? (value - min) / (max - min) : 0;
  return `${Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10}%`;
}

/** Slider (volumes, render scale). */
export function Range(props: RangeProps): JSX.Element {
  const { value, min = 0, max = 100, step = 1, onChange, disabled = false } = props;
  return (
    <input
      type="range"
      class={cx('ff-range', disabled && 'is-disabled', demoClass(props.demoState), props.class)}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={props.label}
      aria-valuetext={props.valueText}
      style={{ '--v': rangeFill(value, min, max) }}
      onInput={(e) => onChange?.(Number((e.currentTarget as HTMLInputElement).value))}
      data-component="Range"
      data-testid={props.testId ?? 'range'}
    />
  );
}
