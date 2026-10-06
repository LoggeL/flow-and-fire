/**
 * Tooltip targets of card cells and order buttons (ui.md §5.12). The card only names what is hovered or
 * focused (model.tooltip.target, anchored above the card); the tooltip layer renders it after 350 ms
 * (keyboard focus at once). Clearing only touches a target this component set itself.
 */
import { useRef } from 'preact/hooks';
import type { CardPageSpec } from '../../data/card-logic.ts';
import type { UnitCatalog } from '../../data/catalog.ts';
import { t } from '../../i18n/t.ts';
import type { TooltipSection, TooltipTarget } from '../../model/tooltip.ts';
import type { CellView } from './cells.ts';

/** Build power of the head builder from the roster (fallback when the game did not report assist BP). */
export function headBuildPower(units: UnitCatalog, spec: CardPageSpec, reported: number | null): number | undefined {
  if (reported !== null && reported > 0) return reported;
  const head = spec.headTypeId === null ? undefined : units.find(spec.headTypeId);
  const bp = head?.economy.buildPower ?? 0;
  return bp > 0 ? bp : undefined;
}

/** Tooltip target of a cell, or null for empty cells. */
export function cellTooltipTarget(units: UnitCatalog, view: CellView, spec: CardPageSpec, buildPower: number | null): TooltipTarget | null {
  if (view.kind === 'empty') return null;
  if (view.orderId !== null && (view.kind === 'order' || view.kind === 'ability' || view.kind === 'pause')) {
    return { kind: 'order', orderId: view.orderId };
  }
  if (view.typeId === null) return null;
  const bp = headBuildPower(units, spec, buildPower);
  let disabledReason: string | undefined;
  if (view.disabled === 'cap') disabledReason = t('ui.card.disabled.cap');
  else if (view.disabled === 'upgrading') disabledReason = t('ui.card.disabled.upgrading');
  return {
    kind: 'unit',
    typeId: view.typeId,
    slot: view.slot,
    builderBp: bp,
    mode: spec.page === 'production' && view.kind === 'unit' ? 'factory' : 'build',
    locked: view.lock,
    disabledReason,
  };
}

/** Same tooltip content (pointerover fires for every child element; the layer must not restart its delay). */
export function sameTooltipTarget(a: TooltipTarget, b: TooltipTarget): boolean {
  if (a.kind === 'order' && b.kind === 'order') return a.orderId === b.orderId;
  if (a.kind === 'resource' && b.kind === 'resource') return a.resource === b.resource;
  if (a.kind === 'unit' && b.kind === 'unit') {
    return a.typeId === b.typeId && a.slot === b.slot && a.mode === b.mode && a.disabledReason === b.disabledReason && a.locked === b.locked;
  }
  return false;
}

export interface TooltipOwner {
  show(target: TooltipTarget | null, viaKeyboard: boolean): void;
  hide(): void;
}

/** Sets/clears model.tooltip.target for one component (never clears a target someone else set). */
export function useTooltipOwner(tooltip: TooltipSection): TooltipOwner {
  const mine = useRef<TooltipTarget | null>(null);
  const hide = (): void => {
    if (mine.current !== null && tooltip.target.peek() === mine.current) tooltip.target.value = null;
    mine.current = null;
  };
  const show = (target: TooltipTarget | null, viaKeyboard: boolean): void => {
    if (target === null) {
      hide();
      return;
    }
    if (mine.current !== null && sameTooltipTarget(mine.current, target) && tooltip.target.peek() === mine.current) return;
    mine.current = target;
    tooltip.anchor.value = { kind: 'card' };
    tooltip.viaKeyboard.value = viaKeyboard;
    tooltip.target.value = target;
  };
  return { show, hide };
}
