import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { clickModsFromEvent } from '../../commands/mods.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { ORDER_BAR_GROUPS, orderDef, orderState, orderStatesKey } from '../../model/orders.ts';
import type { OrderId } from '../../model/orders.ts';
import type { DemoState } from '../../ui/Button.tsx';
import { Key } from '../../ui/Key.tsx';
import { keyLabel } from '../../ui/keys.ts';
import { isMacPlatform, orderKeysText } from './labels.ts';
import { OrderButton } from './OrderButton.tsx';
import { cardSpec, orderBarVisible } from './spec.ts';
import { useTooltipOwner } from './tooltipTarget.ts';

export interface OrderBarProps {
  /** Static demo states per order (gallery). */
  readonly demo?: Readonly<Partial<Record<OrderId, DemoState>>> | undefined;
  /** macOS key hints (Ctrl+⌫); default: detected. */
  readonly mac?: boolean | undefined;
  readonly testId?: string | undefined;
}

function orderOf(target: EventTarget | null, bar: HTMLElement): OrderId | null {
  const el = (target as Element | null)?.closest?.('[data-order]');
  if (el === null || el === undefined || !bar.contains(el)) return null;
  return el.getAttribute('data-order') as OrderId;
}

/**
 * Order bar above the command card (ui.md §5.8): right-aligned, three groups in grid order
 * [Q W E R T] [A S D F G] [Y X C ·], visible while the card shows a build, production or structure page
 * (keys Alt + grid key). With a pure combat selection the orders sit in the grid itself and the bar is
 * hidden. Buttons keep fixed places even when disabled. One delegated listener for clicks and hover.
 */
export function OrderBar(props: OrderBarProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const tip = useTooltipOwner(model.tooltip);
  const page = cardSpec(model).value.page;
  const visible = orderBarVisible(page);
  // Order states arrive at 4 Hz; re-render only when the visible state changes.
  const statesKey = useComputed(() => orderStatesKey(model.orders.states.value));
  void statesKey.value;
  const states = model.orders.states.peek();
  const countdownActive = useComputed(() => model.orders.selfDestructCountdown.value !== null);
  const countdownText = useComputed(() => {
    const n = model.orders.selfDestructCountdown.value;
    return n === null ? '' : String(Math.max(0, Math.ceil(n)));
  });
  const layout = model.keyboardLayout.value;
  const scheme = model.menus.settings.values.value.keyScheme;
  const mac = props.mac ?? isMacPlatform();

  if (!visible) {
    return (
      <div
        class="orders is-hidden"
        aria-hidden="true"
        data-component="OrderBar"
        data-testid={props.testId ?? 'order-bar'}
        data-visible="false"
      />
    );
  }

  const activate = (e: MouseEvent): void => {
    const id = orderOf(e.target, e.currentTarget as HTMLElement);
    if (id === null) return;
    const st = orderState(states, id);
    const counting = id === 'selfDestruct' && countdownActive.peek();
    if (!st.enabled && !counting) return;
    commands.activateOrder(id, clickModsFromEvent(e));
  };

  return (
    <div
      class="orders"
      role="toolbar"
      aria-label={t('ui.orders.bar')}
      data-component="OrderBar"
      data-panel="orders"
      data-testid={props.testId ?? 'order-bar'}
      data-visible="true"
      onClick={activate}
      onContextMenu={(e) => {
        e.preventDefault();
        activate(e);
      }}
      onPointerOver={(e) => {
        const id = orderOf(e.target, e.currentTarget);
        if (id !== null) tip.show({ kind: 'order', orderId: id }, false);
      }}
      onPointerLeave={() => tip.hide()}
      onFocusIn={(e) => {
        const id = orderOf(e.target, e.currentTarget);
        if (id !== null) tip.show({ kind: 'order', orderId: id }, true);
      }}
      onFocusOut={() => tip.hide()}
    >
      <span class="orders__hint">
        {t('ui.orders.hint')} <Key>{keyLabel('AltLeft', layout)}</Key>
        {scheme === 'wasd' ? <Key>{keyLabel('ShiftLeft', layout)}</Key> : null}+
      </span>
      {ORDER_BAR_GROUPS.map((group, gi) => (
        <div class="orders__grp" key={gi}>
          {group.map((id) => {
            const def = orderDef(id);
            const counting = id === 'selfDestruct' && countdownActive.value;
            return (
              <OrderButton
                key={id}
                id={id}
                state={orderState(states, id)}
                keyText={def.key === null ? '' : keyLabel(def.key, layout)}
                keysLabel={orderKeysText(id, page, layout, { mac, scheme })}
                countdown={counting}
                countdownText={countdownText}
                demoState={props.demo?.[id]}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
