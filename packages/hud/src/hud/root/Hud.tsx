import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import type { HudModel } from '../../model/index.ts';
import type { ResourceKind } from '../../model/eco.ts';
import { ORDER_IDS } from '../../model/orders.ts';
import type { OrderId } from '../../model/orders.ts';
import type { TooltipTarget } from '../../model/tooltip.ts';
import { cx } from '../../ui/cx.ts';
import { CommandCard } from '../card/CommandCard.tsx';
import { useCardHotkeys } from '../card/useCardHotkeys.ts';
import { Minimap } from '../minimap/Minimap.tsx';
import type { MinimapProps } from '../minimap/Minimap.tsx';
import { SelectionPanel } from '../selection/SelectionPanel.tsx';
import { Strip } from '../strip/Strip.tsx';
import { AlertFeed } from '../top/AlertFeed.tsx';
import { MatchStatus } from '../top/MatchStatus.tsx';
import { PauseBanner } from '../top/PauseBanner.tsx';
import { ResourceBar } from '../top/ResourceBar.tsx';
import { resolveUiScale } from './scale.ts';
import type { HudScaleSetting } from './scale.ts';
import { TooltipLayer } from './TooltipLayer.tsx';
import { PanelBoundary } from '../../ui/PanelBoundary.tsx';

export interface HudProps {
  /** macOS key hints (Ctrl+⌫); default: detected by the card components. */
  readonly mac?: boolean | undefined;
  /** Bind the grid/strip hotkeys to the commands (gallery; the game binds its own input layer). */
  readonly hotkeys?: boolean | undefined;
  /**
   * Scale setting to apply from the root's own size ('auto' = ui.md §4.1, measured by ResizeObserver); omit
   * to leave `model.scale` to the caller (gallery stories, settings).
   */
  readonly scaleSetting?: HudScaleSetting | undefined;
  /** Pass-through to the minimap (context factories for tests, renderer hook for measurements). */
  readonly minimap?: Omit<MinimapProps, 'testId'> | undefined;
  /** Tooltip delay override (tests). */
  readonly tooltipDelayMs?: number | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Parses a `data-tip` attribute ("resource:mass", "order:move", "unit:core:lnd_t1_tank"). */
export function parseTipAttr(value: string | null): TooltipTarget | null {
  if (value === null) return null;
  const i = value.indexOf(':');
  if (i < 0) return null;
  const kind = value.slice(0, i);
  const rest = value.slice(i + 1);
  if (kind === 'resource' && (rest === 'mass' || rest === 'energy')) return { kind: 'resource', resource: rest as ResourceKind };
  if (kind === 'order' && (ORDER_IDS as readonly string[]).includes(rest)) return { kind: 'order', orderId: rest as OrderId };
  if (kind === 'unit' && rest !== '') return { kind: 'unit', typeId: rest, mode: 'info' };
  return null;
}

/**
 * Delegated tooltip hover/focus for elements with `data-tip` (one listener pair on the root, ui.md §9.2):
 * sets `model.tooltip.target` with a rect anchor (measured in the pointer handler, not in the update path)
 * and clears only a target it set itself.
 */
function useTipDelegation(model: HudModel, rootRef: { readonly current: HTMLElement | null }): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const tip = model.tooltip;
    let mine: TooltipTarget | null = null;
    let mineEl: Element | null = null;
    const open = (el: Element, viaKeyboard: boolean): void => {
      const target = parseTipAttr(el.getAttribute('data-tip'));
      if (target === null) return;
      if (mineEl === el && mine !== null && tip.target.peek() === mine) return;
      const r = el.getBoundingClientRect();
      const base = root.getBoundingClientRect();
      mine = target;
      mineEl = el;
      tip.anchor.value = { kind: 'rect', x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      tip.viaKeyboard.value = viaKeyboard;
      tip.target.value = target;
    };
    const close = (): void => {
      if (mine !== null && tip.target.peek() === mine) tip.target.value = null;
      mine = null;
      mineEl = null;
    };
    const tipEl = (node: EventTarget | null): Element | null => (node instanceof Element ? node.closest('[data-tip]') : null);
    const onOver = (e: Event): void => {
      const el = tipEl(e.target);
      if (el !== null && root.contains(el)) open(el, false);
    };
    const onOut = (e: Event): void => {
      const el = tipEl(e.target);
      if (el === null || el !== mineEl) return;
      const related = (e as PointerEvent).relatedTarget;
      if (related instanceof Node && el.contains(related)) return;
      close();
    };
    const onFocusIn = (e: Event): void => {
      const el = tipEl(e.target);
      if (el !== null && root.contains(el)) open(el, true);
    };
    const onFocusOut = (e: Event): void => {
      const el = tipEl(e.target);
      if (el !== null && el === mineEl) close();
    };
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerout', onOut);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      close();
    };
  }, [model]);
}

/** Writes model.scale from the root's size (ResizeObserver) for a scale setting. */
function useAutoScale(model: HudModel, rootRef: { readonly current: HTMLElement | null }, setting: HudScaleSetting | undefined): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || setting === undefined) return undefined;
    const apply = (w: number, h: number): void => {
      if (w > 0 && h > 0) model.scale.value = resolveUiScale(setting, w, h);
    };
    if (typeof ResizeObserver !== 'function') {
      apply(typeof innerWidth === 'number' ? innerWidth : 0, typeof innerHeight === 'number' ? innerHeight : 0);
      return undefined;
    }
    const ro = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e !== undefined) apply(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [model, setting]);
}

/**
 * The in-game HUD root (ui.md §4.2, §10): resources top left, status + alerts top right, banner top centre,
 * dock at the bottom (minimap 216 | selection minmax(0, 1fr) | command card 324) with the strip above it
 * (filters over the minimap, control groups fixed at x = 232, order bar right-aligned) and the tooltip layer.
 * The root lets pointer events through to the world (`pointer-events: none`); only panels catch them.
 */
export function Hud(props: HudProps): JSX.Element {
  const model = useHud();
  const rootRef = useRef<HTMLDivElement>(null);
  useTipDelegation(model, rootRef);
  useAutoScale(model, rootRef, props.scaleSetting);
  useCardHotkeys(props.hotkeys === true ? undefined : null, { mac: props.mac });
  return (
    <div
      ref={rootRef}
      class={cx('hud-root', props.class)}
      data-component="Hud"
      data-testid={props.testId ?? 'hud'}
      data-hud-root=""
      role="region"
      aria-label={t('ui.hud.region')}
    >
      <PanelBoundary name="ResourceBar">
        <ResourceBar />
      </PanelBoundary>
      <PanelBoundary name="PauseBanner">
        <PauseBanner />
      </PanelBoundary>
      <PanelBoundary name="MatchStatus">
        <MatchStatus />
      </PanelBoundary>
      <PanelBoundary name="AlertFeed">
        <AlertFeed />
      </PanelBoundary>
      <PanelBoundary name="Strip">
        <Strip mac={props.mac} />
      </PanelBoundary>
      <footer class="dock" data-testid="hud-dock" aria-label={t('ui.hud.dock')}>
        <PanelBoundary name="Minimap">
          <Minimap {...(props.minimap ?? {})} />
        </PanelBoundary>
        <PanelBoundary name="SelectionPanel">
          <SelectionPanel />
        </PanelBoundary>
        <PanelBoundary name="CommandCard">
          <CommandCard mac={props.mac} />
        </PanelBoundary>
      </footer>
      <TooltipLayer mac={props.mac} delayMs={props.tooltipDelayMs} />
    </div>
  );
}
