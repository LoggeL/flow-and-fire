import { effect } from '@preact/signals';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import { TOOLTIP_DELAY_MS } from '../../model/tooltip.ts';
import type { TooltipAnchor, TooltipTarget } from '../../model/tooltip.ts';
import { cx } from '../../ui/cx.ts';
import { PanelBoundary } from '../../ui/PanelBoundary.tsx';
import { OrderTooltip } from '../card/OrderTooltip.tsx';
import { ResourceTooltip } from '../top/ResourceTooltip.tsx';
import { UnitTooltip } from '../top/UnitTooltip.tsx';
import { HUD_METRICS, placeTooltip } from './layout.ts';

export interface TooltipLayerProps {
  /** Delay before a pointer-hover tooltip appears (ui.md §5.12: 350 ms; keyboard focus: at once). */
  readonly delayMs?: number | undefined;
  /** macOS key hints in order tooltips. */
  readonly mac?: boolean | undefined;
  readonly testId?: string | undefined;
}

interface Shown {
  readonly target: TooltipTarget;
  readonly anchor: TooltipAnchor;
}

/** Content of the tooltip by target kind (each renders exactly one 320-px root node). */
export function TooltipContent({ target, mac }: { readonly target: TooltipTarget; readonly mac?: boolean | undefined }): JSX.Element {
  if (target.kind === 'resource') return <ResourceTooltip resource={target.resource} />;
  if (target.kind === 'order') return <OrderTooltip orderId={target.orderId} mac={mac} />;
  const { kind: _kind, ...unit } = target;
  return <UnitTooltip {...unit} />;
}

/**
 * Tooltip layer (ui.md §5.12, §9.1): ONE reused node for all tooltips. Shows `model.tooltip.target` after
 * 350 ms (keyboard focus and moving between targets while one is open: at once), hides at once. Anchor
 * "card": right-aligned above the command card by CSS; anchor point/rect: positioned next to it with the
 * tooltip size measured once on opening (no layout reads while its content updates). Contents refresh at
 * ≤ 4 Hz: the resource tooltip samples at 4 Hz, unit and order tooltips follow 4-Hz/event signals.
 */
export function TooltipLayer(props: TooltipLayerProps): JSX.Element {
  const { tooltip } = useHud();
  const delay = props.delayMs ?? TOOLTIP_DELAY_MS;
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const dispose = effect(() => {
      const target = tooltip.target.value;
      const anchor = tooltip.anchor.value;
      const viaKeyboard = tooltip.viaKeyboard.peek();
      cancel();
      if (target === null) {
        if (shownRef.current !== null) setShown(null);
        return;
      }
      const next: Shown = { target, anchor };
      if (viaKeyboard || shownRef.current !== null || delay <= 0) {
        setShown(next);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        setShown(next);
      }, delay);
    });
    return () => {
      cancel();
      dispose();
    };
  }, [tooltip, delay]);

  // Position for point/rect anchors: measured once per opening (target/anchor change), then only transform.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    if (shown === null || shown.anchor.kind === 'card') {
      box.style.transform = '';
      return;
    }
    const host = box.parentElement;
    const rootRect = host !== null ? host.getBoundingClientRect() : { width: 0, height: 0 };
    const tipRect = box.getBoundingClientRect();
    const scale = tipRect.width > 0 ? tipRect.width / HUD_METRICS.tooltipW : 1;
    const pos = placeTooltip(shown.anchor, { w: tipRect.width, h: tipRect.height }, { w: rootRect.width, h: rootRect.height }, HUD_METRICS.gutter * scale);
    box.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
  }, [shown]);

  const anchorKind = shown === null ? 'none' : shown.anchor.kind;
  return (
    <div
      ref={boxRef}
      class={cx('tipbox', shown !== null && `tipbox--${anchorKind === 'card' ? 'card' : 'free'}`)}
      data-component="TooltipLayer"
      data-testid={props.testId ?? 'tooltip-layer'}
      data-panel={shown !== null ? 'tooltip' : undefined}
      data-anchor={anchorKind}
      data-kind={shown?.target.kind ?? 'none'}
      role="tooltip"
      aria-label={t('ui.hud.tooltip')}
      hidden={shown === null}
    >
      {shown !== null ? (
        <PanelBoundary name="Tooltip" resetKey={shown.target}>
          <TooltipContent target={shown.target} mac={props.mac} />
        </PanelBoundary>
      ) : null}
    </div>
  );
}
