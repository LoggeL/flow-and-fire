import { useSignal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

/** Content box of a container in CSS px, or null while unmeasured. */
export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/** Fixed cell geometry of a slot grid, in rem (gap may be px). */
export interface CellGeometry {
  readonly widthRem: number;
  readonly heightRem: number;
  readonly gapRem: number;
  readonly gapPx: number;
}

/** Type tiles: 4.25 × 4.75 rem, gap var(--sp-1) (hud.css .tiles). */
export const TILE_GEOMETRY: CellGeometry = { widthRem: 4.25, heightRem: 4.75, gapRem: 0.25, gapPx: 0 };
/** Single units: 2.125 × 2.375 rem (34 × 38 px at 1.0), gap 2 px (hud.css .units). */
export const UNIT_GEOMETRY: CellGeometry = { widthRem: 2.125, heightRem: 2.375, gapRem: 0, gapPx: 2 };

/**
 * Number of whole slots of a fixed-size grid in a box (ui.md §4.4: fixed slots plus "+N").
 * `maxRows` limits the rows (type tiles use one row). Returns `fallback` while the box is unmeasured
 * (width or height 0, e.g. in happy-dom or before the first ResizeObserver callback).
 */
export function gridCapacity(size: BoxSize | null, g: CellGeometry, remPx: number, fallback: number, maxRows = Infinity): number {
  if (size === null || !(size.width > 0) || !(size.height > 0) || !(remPx > 0)) return fallback;
  const gap = g.gapRem * remPx + g.gapPx;
  const cw = g.widthRem * remPx;
  const ch = g.heightRem * remPx;
  // Half a pixel of tolerance against sub-pixel rounding of rem sizes.
  const cols = Math.max(0, Math.floor((size.width + gap + 0.5) / (cw + gap)));
  const rows = Math.min(maxRows, Math.max(0, Math.floor((size.height + gap + 0.5) / (ch + gap))));
  return Math.min(fallback, Math.max(1, cols * Math.max(1, rows)));
}

/**
 * Measures the content box of `ref` with a ResizeObserver (ui.md §9.2: sizes are measured once per
 * resize and cached, never read in the update path). The signal stays null where no ResizeObserver
 * exists or the element has no layout.
 */
export function useBoxSize(ref: RefObject<Element>): ReadonlySignal<BoxSize | null> {
  const size: Signal<BoxSize | null> = useSignal<BoxSize | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (r === undefined) return;
      const prev = size.peek();
      const w = Math.round(r.width * 2) / 2;
      const h = Math.round(r.height * 2) / 2;
      if (prev !== null && prev.width === w && prev.height === h) return;
      size.value = { width: w, height: h };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
