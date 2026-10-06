/**
 * HUD geometry from the design tokens (ui.md §3.3, §4.2): the fixed panel rectangles at a viewport and UI
 * scale, computed the way root.css / the group CSS place them (1rem = 16 px × scale). Used by tests (no
 * overlap at 1080p/1440p/720p, control groups at x = 232 @1.0) and by the game for world-space math
 * (free world area, tooltip anchor above the card). Panels whose width depends on text (status, order bar,
 * alerts) are not part of it; the gallery's layout check measures those in the browser.
 */

/** Token values in CSS px at scale 1.0 (tokens.css / group CSS). */
export const HUD_METRICS = {
  gutter: 8,
  topH: 60,
  meterW: 312,
  gap: 4,
  statusH: 40,
  dockH: 220,
  minimap: 216,
  cardW: 324,
  stripH: 40,
  filterBtn: 34,
  groupW: 52,
  groupH: 34,
  groupGap: 2,
  groupCount: 10,
  /** Extra inset of the control groups over the selection panel (x = 232 @1.0, R1). */
  groupsInset: 4,
  tooltipW: 320,
  /** Gap between tooltip and strip (mockup: 8 px). */
  tooltipGap: 8,
} as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface HudLayout {
  readonly scale: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly eco: Rect;
  readonly minimap: Rect;
  readonly selection: Rect;
  readonly card: Rect;
  readonly filters: Rect;
  readonly groups: Rect;
  /** Top of the status box (right-aligned, 40 px high). */
  readonly statusTop: number;
  /** Top of the alert feed (right-aligned, under the status). */
  readonly alertsTop: number;
  /** Tooltip anchored above the card: right edge and bottom edge (the height depends on the content). */
  readonly tooltipRight: number;
  readonly tooltipBottom: number;
  /** Room between the control groups and the right edge of the card (where the order bar ends). */
  readonly stripFree: number;
  /** Share of the height above the dock (the strip above it is click-through; ui.md §4.2: ≈ 79 % at 1080p). */
  readonly worldFree: number;
}

/** Fixed HUD rectangles for a viewport and UI scale. */
export function computeHudLayout(width: number, height: number, scale: number): HudLayout {
  const m = HUD_METRICS;
  const s = (px: number): number => px * scale;
  const dockTop = height - s(m.gutter) - s(m.dockH);
  const stripTop = dockTop - s(m.gap) - s(m.stripH);
  const midX = s(m.gutter) + s(m.minimap) + s(m.gap);
  const cardX = width - s(m.gutter) - s(m.cardW);
  const groupsX = midX + s(m.groupsInset);
  const groupsW = s(m.groupCount * m.groupW + (m.groupCount - 1) * m.groupGap);
  return {
    scale,
    viewport: { width, height },
    eco: { x: s(m.gutter), y: s(m.gutter), w: s(2 * m.meterW + m.gap), h: s(m.topH) },
    minimap: { x: s(m.gutter), y: dockTop, w: s(m.minimap), h: s(m.dockH) },
    selection: { x: midX, y: dockTop, w: cardX - s(m.gap) - midX, h: s(m.dockH) },
    card: { x: cardX, y: dockTop, w: s(m.cardW), h: s(m.dockH) },
    filters: { x: s(m.gutter), y: stripTop + s(m.stripH - m.filterBtn), w: s(m.minimap), h: s(m.filterBtn) },
    groups: { x: groupsX, y: stripTop + s(m.stripH - m.groupH), w: groupsW, h: s(m.groupH) },
    statusTop: s(m.gutter),
    alertsTop: s(m.gutter + m.statusH + 8),
    tooltipRight: width - s(m.gutter),
    tooltipBottom: stripTop - s(m.tooltipGap),
    stripFree: cardX + s(m.cardW) - (groupsX + groupsW),
    worldFree: dockTop / height,
  };
}

/** Overlap of two rectangles (> 1 px in both axes, like the gallery layout check). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 1 && oy > 1;
}

/** The fixed panel rectangles of a layout by name. */
export function layoutPanels(l: HudLayout): Readonly<Record<'eco' | 'minimap' | 'selection' | 'card' | 'filters' | 'groups', Rect>> {
  return { eco: l.eco, minimap: l.minimap, selection: l.selection, card: l.card, filters: l.filters, groups: l.groups };
}

/**
 * Tooltip position for a point or rect anchor (CSS px inside the HUD root): right of/below the anchor,
 * flipped to the other side when it would leave the root, clamped to the gutter. `tip` is the tooltip size
 * measured once when it opens.
 */
export function placeTooltip(
  anchor: { readonly kind: 'point'; readonly x: number; readonly y: number } | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  tip: { readonly w: number; readonly h: number },
  root: { readonly w: number; readonly h: number },
  gutter: number,
): { readonly x: number; readonly y: number } {
  const OFFSET = 16;
  let x: number;
  let y: number;
  if (anchor.kind === 'point') {
    x = anchor.x + OFFSET;
    y = anchor.y + OFFSET;
    if (x + tip.w > root.w - gutter) x = anchor.x - OFFSET - tip.w;
    if (y + tip.h > root.h - gutter) y = anchor.y - OFFSET - tip.h;
  } else {
    x = anchor.x;
    y = anchor.y + anchor.h + gutter / 2;
    if (x + tip.w > root.w - gutter) x = anchor.x + anchor.w - tip.w;
    if (y + tip.h > root.h - gutter) y = anchor.y - gutter / 2 - tip.h;
  }
  const maxX = Math.max(gutter, root.w - gutter - tip.w);
  const maxY = Math.max(gutter, root.h - gutter - tip.h);
  return { x: Math.min(Math.max(x, gutter), maxX), y: Math.min(Math.max(y, gutter), maxY) };
}
