import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { HUD_METRICS, computeHudLayout, layoutPanels, placeTooltip, rectsOverlap } from '../../src/hud/root/layout.ts';
import { computeUiScale } from '../../src/hud/root/scale.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const css = (p: string): string => readFileSync(resolve(SRC, p), 'utf8');

/** rem value of a custom property in tokens.css → px at scale 1. */
function tokenPx(name: string): number {
  const m = new RegExp(`${name}:\\s*([0-9.]+)rem`).exec(css('styles/tokens.css'));
  if (m === null) throw new Error(`token ${name} missing`);
  return Number(m[1]) * 16;
}

const VIEWS: readonly (readonly [string, number, number, number])[] = [
  ['1080p @1.0', 1920, 1080, 1],
  ['1440p @1.25', 2560, 1440, 1.25],
  ['1440p kompakt @1.0', 2560, 1440, 1],
  ['720p @0.8', 1280, 720, computeUiScale(1280, 720)],
];

describe('HUD geometry from the tokens (ui.md §3.3, §4.2)', () => {
  test('HUD_METRICS match tokens.css', () => {
    expect(tokenPx('--hud-gutter')).toBe(HUD_METRICS.gutter);
    expect(tokenPx('--hud-top-h')).toBe(HUD_METRICS.topH);
    expect(tokenPx('--hud-dock-h')).toBe(HUD_METRICS.dockH);
    expect(tokenPx('--hud-minimap')).toBe(HUD_METRICS.minimap);
    expect(tokenPx('--hud-card-w')).toBe(HUD_METRICS.cardW);
  });

  test('root.css places the dock like the mockup: minimap | minmax(0, 1fr) | card, click-through root', () => {
    const root = css('hud/root/root.css');
    expect(root).toMatch(/\.dock \{[^}]*grid-template-columns: var\(--hud-minimap\) minmax\(0, 1fr\) var\(--hud-card-w\)/);
    expect(root).toMatch(/\.dock \{[^}]*bottom: var\(--hud-gutter\); height: var\(--hud-dock-h\)/);
    expect(root).toMatch(/\.hud-root \{[^}]*pointer-events: none/);
    expect(root).toMatch(/:where\(\.hud-root\) > \* \{ pointer-events: auto; \}/);
    expect(root).toMatch(/\.tipbox \{[^}]*z-index: var\(--z-tooltip\)/);
    expect(root).toMatch(/\.hud-root \{[^}]*z-index: var\(--z-hud\)/);
    expect(root).toMatch(/\.hud-root \.groups \{ margin-left: var\(--sp-1\); \}/);
  });

  test('1080p: positions of ui.md §4.2 (groups at x = 232, dock 8 … 1912, 79 % world)', () => {
    const l = computeHudLayout(1920, 1080, 1);
    expect(l.eco).toEqual({ x: 8, y: 8, w: 628, h: 60 });
    expect(l.minimap).toEqual({ x: 8, y: 852, w: 216, h: 220 });
    expect(l.selection.x).toBe(228);
    expect(l.card).toEqual({ x: 1588, y: 852, w: 324, h: 220 });
    expect(l.groups.x).toBe(232);
    expect(l.groups.w).toBe(538);
    expect(l.alertsTop).toBe(56);
    expect(l.worldFree).toBeCloseTo(0.789, 3);
    expect(l.tooltipBottom).toBe(800);
  });

  test.each(VIEWS)('%s: fixed panels do not overlap and stay inside the viewport', (_name, w, h, s) => {
    const l = computeHudLayout(w, h, s);
    const panels = Object.entries(layoutPanels(l));
    for (let i = 0; i < panels.length; i++) {
      const [na, a] = panels[i]!;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(w);
      expect(a.y + a.h).toBeLessThanOrEqual(h);
      for (let j = i + 1; j < panels.length; j++) {
        const [nb, b] = panels[j]!;
        expect(rectsOverlap(a, b), `${na} / ${nb}`).toBe(false);
      }
    }
    // Control groups sit over the selection panel, 4 px inside, independent of the selection (R1).
    expect(l.groups.x).toBeCloseTo(l.selection.x + 4 * s, 6);
    // Room for the order bar (14 × 40 px buttons + gaps + hint) between the groups and the card's right edge.
    expect(l.stripFree).toBeGreaterThan((14 * 40 + 11 * 2 + 2 * 4) * s);
  });

  test('1440p: the extra width goes into the middle column; kompakt leaves more world', () => {
    const std = computeHudLayout(2560, 1440, 1.25);
    const compact = computeHudLayout(2560, 1440, 1);
    expect(std.minimap.w).toBe(270);
    expect(std.card.w).toBe(405);
    expect(compact.worldFree).toBeGreaterThan(std.worldFree);
    expect(std.worldFree).toBeCloseTo(0.8, 1);
  });
});

describe('placeTooltip (point/rect anchors)', () => {
  const root = { w: 1920, h: 1080 };
  const tip = { w: 320, h: 200 };
  test('right of / below a point, flipped at the edges, clamped to the gutter', () => {
    expect(placeTooltip({ kind: 'point', x: 100, y: 100 }, tip, root, 8)).toEqual({ x: 116, y: 116 });
    expect(placeTooltip({ kind: 'point', x: 1800, y: 1000 }, tip, root, 8)).toEqual({ x: 1464, y: 784 });
  });
  test('below a rect, above when there is no room; right-aligned when too wide', () => {
    expect(placeTooltip({ kind: 'rect', x: 8, y: 8, w: 312, h: 60 }, tip, root, 8)).toEqual({ x: 8, y: 72 });
    expect(placeTooltip({ kind: 'rect', x: 1700, y: 950, w: 200, h: 40 }, tip, root, 8)).toEqual({ x: 1580, y: 746 });
  });
});
