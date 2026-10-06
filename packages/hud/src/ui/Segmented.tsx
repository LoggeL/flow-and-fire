import type { JSX } from 'preact';
import { focusSibling } from './Tab.tsx';
import { cx } from './cx.ts';

export interface SegmentOption<T extends string | number> {
  readonly value: T;
  /** Translated label. */
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

export interface SegmentedProps<T extends string | number> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange?: ((value: T) => void) | undefined;
  /** Accessible name of the group (translated). */
  readonly label: string;
  readonly disabled?: boolean | undefined;
  /** Static demo states for the gallery. */
  readonly demoHover?: T | undefined;
  readonly demoFocus?: T | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Segmented choice (radio group): arrow keys move and select. */
export function Segmented<T extends string | number>(props: SegmentedProps<T>): JSX.Element {
  const { options, value, onChange, disabled = false } = props;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (disabled || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const next = focusSibling(e.currentTarget as HTMLElement, '[role="radio"]', document.activeElement, e.key);
    if (!next) return;
    e.preventDefault();
    const opt = options[Number(next.dataset.index)];
    if (opt) onChange?.(opt.value);
  };
  return (
    <div
      class={cx('ff-seg', disabled && 'is-disabled', props.class)}
      role="radiogroup"
      aria-label={props.label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      data-component="Segmented"
      data-testid={props.testId ?? 'segmented'}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled || o.disabled}
            class={cx(selected && 'is-selected', props.demoHover === o.value && 'is-hover', props.demoFocus === o.value && 'is-focus')}
            onClick={() => onChange?.(o.value)}
            data-index={i}
            data-value={String(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
