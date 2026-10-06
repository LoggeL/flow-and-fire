import type { ReadonlySignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { UnitCatalog } from '../../data/catalog.ts';
import { unitName } from '../../data/roster.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useUnitCatalog } from '../../model/index.ts';
import { ABILITY_TEXT, orderDef } from '../../model/orders.ts';
import { clamp01, useBindEffect } from '../../ui/bind.ts';
import { demoClass } from '../../ui/Button.tsx';
import type { DemoState } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { keyLabel } from '../../ui/keys.ts';
import type { KeyboardLayout } from '../../ui/keys.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import type { CellView } from './cells.ts';
import { cellText, lockText, orderName, orderShort, unitShort } from './labels.ts';

export interface CardCellProps {
  readonly view: CellView;
  readonly layout: KeyboardLayout;
  /** Head builder/structure of the page (lock texts name the factory). */
  readonly headTypeId?: string | null | undefined;
  /** Roving tab stop of the grid (ui.md §8.5). */
  readonly focusable?: boolean | undefined;
  /** Static demo states for the gallery (hover, pressed, focus). */
  readonly demoState?: DemoState | undefined;
  /** 140-ms flash after a key press or click (ui.md §7.6). */
  readonly flash?: boolean | undefined;
  /** Production progress per type id (10 Hz); bound to --p without re-rendering the cell. */
  readonly progress?: ReadonlySignal<Readonly<Record<string, number>>> | undefined;
  /** Countdown seconds text of the self-destruct cell (1 Hz), bound as text. */
  readonly countdownText?: ReadonlySignal<string> | undefined;
  /** Key combination for the self-destruct label (Strg+Entf …). */
  readonly selfDestructKeys?: string | undefined;
  readonly testId?: string | undefined;
}

/** Name text of a cell (≤ 10 characters, data-fit). */
function cellName(units: UnitCatalog, view: CellView): string {
  switch (view.kind) {
    case 'unit':
      return view.typeId !== null ? unitShort(units, view.typeId) : '';
    case 'upgrade':
      return cellText('ui.card.cell.upgrade');
    case 'ability':
      return cellText(view.ability !== null ? ABILITY_TEXT[view.ability] : 'ui.card.cell.ability');
    case 'pause':
      return cellText('ui.card.cell.pause');
    case 'order':
      return view.orderId !== null ? orderShort(view.orderId) : '';
    case 'empty':
      return '';
  }
}

function disabledText(view: CellView): string {
  if (view.disabled === null) return '';
  if (view.disabled === 'cap') return t('ui.card.disabled.cap');
  if (view.disabled === 'upgrading') return t('ui.card.disabled.upgrading');
  return t(`ui.orders.reason.${view.disabled}`);
}

/** Accessible name including the key (ui.md §8.5) and the lock/disabled reason. */
export function cellAriaLabel(units: UnitCatalog, view: CellView, key: string, headTypeId: string | null, selfDestructKeys: string): string {
  if (view.kind === 'empty') return t('ui.card.cell.emptyLabel', { key });
  if (view.orderId === 'selfDestruct') return t('ui.card.cell.selfDestructLabel', { name: orderName('selfDestruct'), keys: selfDestructKeys });
  let name: string;
  if (view.kind === 'order' && view.orderId !== null) name = orderName(view.orderId);
  else if (view.kind === 'upgrade') name = t('ui.card.cell.upgradeLabel', { name: view.typeId ? unitName(units, view.typeId) : '', key });
  else if (view.kind === 'ability') name = t('ui.card.cell.abilityLabel', { name: view.ability ? t(ABILITY_TEXT[view.ability]) : '', key });
  else if (view.kind === 'pause') name = t('ui.card.cell.pauseLabel', { name: view.typeId ? unitName(units, view.typeId) : '', key });
  else name = view.typeId ? unitName(units, view.typeId) : '';
  if (view.kind === 'upgrade' || view.kind === 'ability' || view.kind === 'pause') {
    return view.disabled !== null ? t('ui.card.cell.disabledLabel', { name, key, reason: disabledText(view) }) : name;
  }
  if (view.lock !== null) return t('ui.card.cell.lockedLabel', { name, key, reason: lockText(units, view.lock, headTypeId) });
  if (view.disabled !== null) return t('ui.card.cell.disabledLabel', { name, key, reason: disabledText(view) });
  return t('ui.card.cell.label', { name, key });
}

/**
 * One 58-px command card cell (ui.md §5.6, §3.7; mockup hud.js `cell`): key top left, strategic icon
 * (or line icon for orders/upgrade/ability/pause), short name with data-fit, tech stripes or queue badge,
 * lock left of the icon, progress stripe at the bottom. Presentational: clicks are handled by the grid
 * (one delegated listener per panel, ui.md §9.2) through `data-slot`.
 */
export function CardCell(props: CardCellProps): JSX.Element {
  const { view, layout } = props;
  void locale.value; // subscribe: names follow the locale (t() and unitText read it too)
  const progRef = useRef<HTMLElement>(null);
  const { progress, countdownText } = props;
  const typeId = view.typeId;

  useBindEffect(() => {
    const el = progRef.current;
    if (el === null || progress === undefined || typeId === null) return;
    const v = String(clamp01(progress.value[typeId] ?? 0));
    if (el.style.getPropertyValue('--p') !== v) el.style.setProperty('--p', v);
  }, [progress, typeId, view.progress]);

  const key = view.countdown && countdownText !== undefined ? countdownText : keyLabel(view.keyCode, layout);
  const keyText = keyLabel(view.keyCode, layout);
  const empty = view.kind === 'empty';
  const units = useUnitCatalog();
  const name = cellName(units, view);
  const locked = view.lock !== null;
  const disabled = view.disabled !== null && !view.countdown;
  const label = cellAriaLabel(units, view, keyText, props.headTypeId ?? null, props.selfDestructKeys ?? t('ui.orders.key.selfDestruct'));
  const def = view.orderId !== null ? orderDef(view.orderId) : null;

  return (
    <button
      type="button"
      role="gridcell"
      class={cx(
        'ff-cell',
        view.kind === 'upgrade' && 'ff-cell--upgrade',
        view.danger && 'ff-cell--danger',
        empty && 'is-empty',
        locked && 'is-locked',
        (locked || disabled) && 'is-disabled',
        view.active && 'is-active',
        view.countdown && 'is-countdown',
        view.toggle === 'on' && 'is-on',
        view.toggle === 'mixed' && 'is-mixed',
        props.flash && 'is-flash',
        demoClass(props.demoState),
      )}
      tabIndex={props.focusable ? 0 : -1}
      aria-label={label}
      aria-disabled={empty || locked || disabled ? 'true' : undefined}
      aria-selected={view.active ? 'true' : undefined}
      data-slot={view.slot}
      data-kind={view.kind}
      data-unit={typeId ?? undefined}
      data-order={view.orderId ?? undefined}
      data-behavior={def?.behavior}
      data-component="CardCell"
      data-testid={props.testId ?? `card-cell-${view.slot}`}
    >
      <span class="ff-cell__key" data-fit="">
        {key}
      </span>
      {view.badge > 0 ? <span class="ff-cell__badge num">{view.badge > 99 ? '99+' : String(view.badge)}</span> : null}
      {view.stripes !== null ? (
        <span class="ff-cell__tiers" aria-hidden="true">
          {view.stripes.map((s, i) => (
            <i key={i} class={s === 'out' ? undefined : s} />
          ))}
        </span>
      ) : null}
      {view.cycle !== null ? (
        <span class="ff-cell__dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} class={i === view.cycle ? 'on' : undefined} />
          ))}
        </span>
      ) : null}
      {view.toggle === 'on' || view.toggle === 'mixed' ? <span class="ff-cell__mark" aria-hidden="true" /> : null}
      {view.kind === 'unit' && typeId !== null ? (
        <span class="ff-cell__icon">
          <StrategicIcon typeId={typeId} />
        </span>
      ) : null}
      {view.icon !== null && view.kind !== 'unit' ? <LineIcon name={view.icon} /> : null}
      {locked ? (
        <span class="ff-cell__lock" aria-hidden="true">
          <LineIcon name="lock" />
        </span>
      ) : null}
      {empty ? null : (
        <span class="ff-cell__name" data-fit="">
          {name}
        </span>
      )}
      {view.progress ? (
        <span class="ff-cell__prog" aria-hidden="true">
          <i ref={progRef} />
        </span>
      ) : null}
    </button>
  );
}
