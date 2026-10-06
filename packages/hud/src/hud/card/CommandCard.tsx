import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { clickModsFromEvent } from '../../commands/mods.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { FIRE_STATE_TEXT, fireStateAt, orderState, orderStatesKey } from '../../model/orders.ts';
import type { DemoState } from '../../ui/Button.tsx';
import { GRID_ROWS, SLOT_CODES } from '../../ui/keys.ts';
import type { SlotCode } from '../../ui/keys.ts';
import { Panel } from '../../ui/Panel.tsx';
import { CardCell } from './CardCell.tsx';
import { cellActionable, cellViews } from './cells.ts';
import type { CellView } from './cells.ts';
import { cardHeadText, gridLabel, isMacPlatform, selfDestructKeys } from './labels.ts';
import { cardSpec } from './spec.ts';
import { TechTabs } from './TechTabs.tsx';
import { cellTooltipTarget, useTooltipOwner } from './tooltipTarget.ts';

export interface CommandCardProps {
  /** Static demo states per cell (gallery: hover, pressed, focus). */
  readonly demoCells?: Readonly<Partial<Record<SlotCode, DemoState>>> | undefined;
  /** Static demo state of one tech tab (gallery). */
  readonly demoTab?: { readonly tier: number; readonly state: DemoState } | undefined;
  /** macOS key hints (Ctrl+⌫); default: detected. */
  readonly mac?: boolean | undefined;
  readonly testId?: string | undefined;
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** Next cell index for grid arrow navigation (5 × 3, no wrap across edges; Home/End = row start/end). */
export function gridNavIndex(index: number, key: string): number {
  const row = Math.floor(index / 5);
  const col = index % 5;
  switch (key) {
    case 'ArrowLeft':
      return col > 0 ? index - 1 : index;
    case 'ArrowRight':
      return col < 4 ? index + 1 : index;
    case 'ArrowUp':
      return row > 0 ? index - 5 : index;
    case 'ArrowDown':
      return row < GRID_ROWS.length - 1 ? index + 5 : index;
    case 'Home':
      return row * 5;
    case 'End':
      return row * 5 + 4;
    default:
      return index;
  }
}

function slotOf(target: EventTarget | null, grid: HTMLElement): SlotCode | null {
  const el = (target as Element | null)?.closest?.('[data-slot]');
  if (el === null || el === undefined || !grid.contains(el)) return null;
  return el.getAttribute('data-slot') as SlotCode;
}

/**
 * Command card (ui.md §5.6, 324 px): head per page („Bau · Vogt“, „Produktion · Landwerk I“,
 * „Gebäude · Zapfstelle I“, „Befehle · N Einheiten“), tech tabs and the 5 × 3 grid from resolveCardPage.
 * Clicks: cardActivate(slot, mods) incl. right click (button 2) and Shift/Ctrl; on the orders page
 * activateOrder(id, mods). role="grid" with arrow navigation once focused (ui.md §8.5).
 * Structure re-renders on events (selection, tab, queue, cap, order state changes); production progress
 * binds at 10 Hz per cell without re-rendering.
 */
export function CommandCard(props: CommandCardProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const card = model.card;
  const tip = useTooltipOwner(model.tooltip);
  const gridId = useId();
  const [focusIndex, setFocusIndex] = useState(0);

  const spec = cardSpec(model).value;
  const units = model.units.value;
  const statesKey = useComputed(() => orderStatesKey(model.orders.states.value));
  void statesKey.value;
  const states = model.orders.states.peek();
  const counting = useComputed(() => model.orders.selfDestructCountdown.value !== null).value;
  const countdownText = useComputed(() => {
    const n = model.orders.selfDestructCountdown.value;
    return n === null ? '' : String(Math.max(0, Math.ceil(n)));
  });
  const layout = model.keyboardLayout.value;
  const flash = card.flashSlot.value;
  const mac = props.mac ?? isMacPlatform();
  const sdKeys = selfDestructKeys(mac);

  const views = cellViews(spec, {
    queueCounts: card.queueCounts.value,
    armedSlot: card.armedSlot.value,
    capReached: card.capReached.value,
    orderStates: states,
    countdown: counting ? (model.orders.selfDestructCountdown.peek() ?? 0) : null,
    units,
  });

  const viewAt = (slot: SlotCode): CellView | undefined => views[SLOT_CODES.indexOf(slot)];

  const activate = (e: MouseEvent): void => {
    const slot = slotOf(e.target, e.currentTarget as HTMLElement);
    if (slot === null) return;
    const v = viewAt(slot);
    if (v === undefined) return;
    const abort = v.countdown; // clicking a running self-destruct aborts it
    if (!abort && !cellActionable(v)) return;
    const mods = clickModsFromEvent(e);
    if (spec.page === 'orders') {
      if (v.orderId !== null) commands.activateOrder(v.orderId, mods);
      return;
    }
    commands.cardActivate(slot, mods);
  };

  const showTip = (target: EventTarget | null, grid: HTMLElement, viaKeyboard: boolean): void => {
    const slot = slotOf(target, grid);
    const v = slot === null ? undefined : viewAt(slot);
    tip.show(v === undefined ? null : cellTooltipTarget(units, v, spec, card.buildPower.peek()), viaKeyboard);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!NAV_KEYS.has(e.key)) return;
    const grid = e.currentTarget as HTMLElement;
    const slot = slotOf(e.target, grid);
    if (slot === null) return;
    const next = gridNavIndex(SLOT_CODES.indexOf(slot), e.key);
    e.preventDefault();
    e.stopPropagation(); // arrows inside the focused grid never pan the camera
    const el = grid.querySelector<HTMLElement>(`[data-slot="${SLOT_CODES[next] ?? 'KeyQ'}"]`);
    if (el !== null) {
      setFocusIndex(next);
      el.focus();
    }
  };

  const fire = orderState(states, 'fireState');
  const showFire = spec.page === 'orders' && fire.enabled && states.fireState !== undefined;
  const headText = cardHeadText(units, spec, card.unitCount.value);
  const fireText = showFire ? t('ui.card.head.fireState', { mode: t(FIRE_STATE_TEXT[fireStateAt(fire.cycle)]) }) : '';

  return (
    <Panel
      tone="copper"
      component="CommandCard"
      panelId="card"
      class="card"
      label={t('ui.card.region')}
      testId={props.testId ?? 'command-card'}
    >
      <div class="ff-ph" data-page={spec.page}>
        <span class="card__title" data-fit="" data-fit-allow-ellipsis="pseudo" title={headText} data-testid="card-head">
          {headText}
        </span>
        {spec.maxTab > 0 ? (
          <TechTabs spec={spec} controls={gridId} onSelect={(tier) => commands.setTab(tier)} demo={props.demoTab} />
        ) : null}
        {showFire ? (
          // Supplementary head text (the fire state also shows on its grid cell with dots + tooltip): may be
          // cut with an ellipsis on narrow docks, the full text stays in the title (DECISIONS HUD-6).
          <span class="ff-ph__end" data-testid="card-fire-state" data-fit-allow-ellipsis="pseudo" title={fireText}>
            {fireText}
          </span>
        ) : null}
      </div>
      <div
        id={gridId}
        class="card__grid"
        role="grid"
        aria-label={gridLabel(spec.page)}
        data-page={spec.page}
        data-testid="card-grid"
        onClick={activate}
        onContextMenu={(e) => {
          e.preventDefault();
          activate(e);
        }}
        onPointerOver={(e) => showTip(e.target, e.currentTarget, false)}
        onPointerLeave={() => tip.hide()}
        onFocusIn={(e) => {
          const slot = slotOf(e.target, e.currentTarget);
          if (slot !== null) setFocusIndex(SLOT_CODES.indexOf(slot));
          showTip(e.target, e.currentTarget, true);
        }}
        onFocusOut={() => tip.hide()}
        onKeyDown={onKeyDown}
      >
        {GRID_ROWS.map((row, r) => (
          <div role="row" class="card__row" key={r}>
            {row.map((slot) => {
              const i = SLOT_CODES.indexOf(slot);
              const v = views[i];
              if (v === undefined) return null;
              return (
                <CardCell
                  key={`${spec.page}-${slot}`}
                  view={v}
                  layout={layout}
                  headTypeId={spec.headTypeId}
                  focusable={i === focusIndex}
                  demoState={props.demoCells?.[slot]}
                  flash={flash === slot}
                  progress={card.progress}
                  countdownText={countdownText}
                  selfDestructKeys={sdKeys}
                />
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
}
