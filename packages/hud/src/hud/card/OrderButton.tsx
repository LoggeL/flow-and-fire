import type { ReadonlySignal } from '@preact/signals';
import type { JSX } from 'preact';
import { t } from '../../i18n/t.ts';
import { fireStateAt, orderDef, orderIcon } from '../../model/orders.ts';
import type { OrderId, OrderState } from '../../model/orders.ts';
import { demoClass } from '../../ui/Button.tsx';
import type { DemoState } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { orderName } from './labels.ts';

export interface OrderButtonProps {
  readonly id: OrderId;
  readonly state: OrderState;
  /** Key cap text in the corner (grid key label; empty for self-destruct in the bar, ui.md §5.8). */
  readonly keyText: string;
  /** Full key hint for the accessible name („Alt+Q“, „Strg+Entf“). */
  readonly keysLabel: string;
  /** Self-destruct countdown running (seconds replace the key, is-countdown). */
  readonly countdown?: boolean | undefined;
  /** Countdown seconds (1 Hz), bound as text. */
  readonly countdownText?: ReadonlySignal<string> | undefined;
  readonly demoState?: DemoState | undefined;
  /** Roving/normal tab stop (default focusable). */
  readonly tabIndex?: number | undefined;
  readonly testId?: string | undefined;
}

/** Accessible name: name, keys and – when disabled – the reason (ui.md §8.5). */
export function orderAriaLabel(id: OrderId, state: OrderState, keysLabel: string): string {
  const base = t('ui.orders.label', { name: orderName(id), keys: keysLabel });
  if (state.enabled) return base;
  const reason = t(`ui.orders.reason.${state.reason ?? 'noSelection'}`);
  return `${base} – ${t('ui.orders.unavailable', { reason })}`;
}

/**
 * 40-px order button of the order bar (ui.md §5.8, §3.7; mockup hud.js `orderBtn`): states Standard,
 * Hover, Scharf (is-armed), An (is-on), Gemischt (is-mixed), Zyklus (dots), Deaktiviert (reason in the
 * tooltip), Fokus, Gefahr (self-destruct), Countdown. Presentational: the bar delegates clicks via `data-order`.
 */
export function OrderButton(props: OrderButtonProps): JSX.Element {
  const { id, state } = props;
  const def = orderDef(id);
  const disabled = !state.enabled && props.countdown !== true;
  const cycle = def.behavior === 'cycle' ? fireStateAt(state.cycle) : null;
  const cycleIndex = cycle === 'free' ? 0 : cycle === 'return' ? 1 : 2;
  return (
    <button
      type="button"
      class={cx(
        'ff-order',
        def.behavior === 'countdown' && 'ff-order--danger',
        state.armed === true && 'is-armed',
        state.toggle === 'on' && 'is-on',
        state.toggle === 'mixed' && 'is-mixed',
        disabled && 'is-disabled',
        props.countdown === true && 'is-countdown',
        demoClass(props.demoState),
      )}
      tabIndex={props.tabIndex}
      aria-label={orderAriaLabel(id, state, props.keysLabel)}
      aria-disabled={disabled ? 'true' : undefined}
      aria-pressed={def.behavior === 'toggle' ? (state.toggle === 'on' ? 'true' : state.toggle === 'mixed' ? 'mixed' : 'false') : undefined}
      data-order={id}
      data-behavior={def.behavior}
      data-component="OrderButton"
      data-testid={props.testId ?? `order-${id}`}
    >
      {cycle !== null ? (
        <span class="ff-order__dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} class={i === cycleIndex ? 'on' : undefined} />
          ))}
        </span>
      ) : null}
      {state.badge !== undefined && state.badge > 0 ? <span class="ff-order__badge num">{String(state.badge)}</span> : null}
      <LineIcon name={orderIcon(id, state)} />
      <span class="ff-order__key">{props.countdown === true && props.countdownText !== undefined ? props.countdownText : props.keyText}</span>
    </button>
  );
}
