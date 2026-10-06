import type { JSX } from 'preact';
import { t } from '../../i18n/t.ts';
import type { CardPage } from '../../model/card.ts';
import { useHud } from '../../model/index.ts';
import {
  ABILITY_TEXT,
  FIRE_STATES,
  FIRE_STATE_TEXT,
  ORDER_TEXT,
  fireStateAt,
  orderDef,
  orderIcon,
  orderState,
} from '../../model/orders.ts';
import type { OrderId, OrderState } from '../../model/orders.ts';
import { cx } from '../../ui/cx.ts';
import type { KeyboardLayout } from '../../ui/keys.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { TooltipFrame } from '../../ui/TooltipFrame.tsx';
import { isMacPlatform, orderKeyCap, orderName } from './labels.ts';
import { cardSpec } from './spec.ts';

export interface OrderTooltipProps {
  readonly orderId: OrderId;
  /** Order state (default: model.orders.states). */
  readonly state?: OrderState | undefined;
  /** Card page that decides grid key vs. Alt + key (default: current page). */
  readonly page?: CardPage | undefined;
  readonly layout?: KeyboardLayout | undefined;
  readonly mac?: boolean | undefined;
  /** Remaining self-destruct seconds (default: model). */
  readonly countdown?: number | null | undefined;
  readonly testId?: string | undefined;
}

/** State line of the tooltip (armed, toggle, fire mode, countdown, capable units). */
export function orderStateText(id: OrderId, state: OrderState, countdown: number | null): string | null {
  const def = orderDef(id);
  if (id === 'selfDestruct' && countdown !== null) return t('ui.orders.state.countdown', { n: String(Math.ceil(countdown)) });
  if (state.armed === true) return t('ui.orders.state.armed');
  if (def.behavior === 'cycle') {
    const cur = fireStateAt(state.cycle);
    const next = FIRE_STATES[(FIRE_STATES.indexOf(cur) + 1) % FIRE_STATES.length] ?? 'free';
    return t('ui.orders.tip.cycle', { current: t(FIRE_STATE_TEXT[cur]), next: t(FIRE_STATE_TEXT[next]) });
  }
  if (def.behavior === 'toggle') {
    const mode = state.toggle ?? 'off';
    const text = t(mode === 'on' ? 'ui.orders.state.on' : mode === 'mixed' ? 'ui.orders.state.mixed' : 'ui.orders.state.off');
    return id === 'ability' ? `${t(ABILITY_TEXT[state.ability ?? 'shield'])}: ${text}` : text;
  }
  if (state.badge !== undefined && state.badge > 0) return t('ui.orders.state.capable', { n: state.badge });
  return null;
}

/**
 * Order tooltip on the shared TooltipFrame (ui.md §5.12 „Befehl“): name, key(s), behaviour, state,
 * description, the reason when disabled and the feature hint (IDs · first milestone).
 */
export function OrderTooltip(props: OrderTooltipProps): JSX.Element {
  const model = useHud();
  const id = props.orderId;
  const def = orderDef(id);
  const state = props.state ?? orderState(model.orders.states.value, id);
  const page = props.page ?? cardSpec(model).value.page;
  const layout = props.layout ?? model.keyboardLayout.value;
  const scheme = model.menus.settings.values.value.keyScheme;
  const countdown = props.countdown !== undefined ? props.countdown : model.orders.selfDestructCountdown.value;
  const keys = orderKeyCap(id, page, layout, { mac: props.mac ?? isMacPlatform(), scheme });
  const disabled = !state.enabled;
  const stateText = orderStateText(id, state, countdown);
  const stopHint = id === 'stop' && (page === 'build' || page === 'production');
  return (
    <div class="order-tip-host" data-component="OrderTooltip" data-testid={props.testId ?? `order-tooltip-${id}`} data-order={id}>
    <TooltipFrame
      class={cx('order-tip', def.behavior === 'countdown' && 'is-danger', disabled && 'is-disabled')}
      testId="order-tooltip-frame"
      icon={
        <span class="order-tip__icon" aria-hidden="true">
          <LineIcon name={orderIcon(id, state)} />
        </span>
      }
      name={orderName(id)}
      keyHint={keys}
      body={
        <>
          <dl class="order-tip__rows">
            <dt>{t('ui.orders.tip.behavior')}</dt>
            <dd>{t(`ui.orders.behavior.${def.behavior}`)}</dd>
            {stateText !== null ? (
              <>
                <dt>{t('ui.orders.tip.state')}</dt>
                <dd data-testid="order-tooltip-state">{stateText}</dd>
              </>
            ) : null}
          </dl>
          {disabled ? (
            <div class="order-tip__reason" data-testid="order-tooltip-reason">
              <LineIcon name="warn" />
              {t('ui.orders.unavailable', { reason: t(`ui.orders.reason.${state.reason ?? 'noSelection'}`) })}
            </div>
          ) : null}
          <div>{t(ORDER_TEXT[id].desc)}</div>
          {stopHint ? <div class="ff-lo">{t('ui.orders.key.stopBuilders')}</div> : null}
        </>
      }
      foot={<span data-testid="order-tooltip-feature">{t('ui.orders.feature', { ids: def.features.join(', '), milestone: def.milestone })}</span>}
    />
    </div>
  );
}
