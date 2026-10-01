/**
 * Automatic layout check of a rendered story (port of docs/design/ui-mockups/tools/shoot.mjs, ui.md §4.4,
 * §8.3, §9.2):
 *   (a) [data-panel] rectangles do not overlap and stay inside the story viewport
 *   (b) [data-fit] elements are not clipped (scrollWidth/scrollHeight > client + 1)
 *   (c) visible text ≥ 11 px × scale (floor 10 px when scale < 0.95), 0.5 px tolerance like shoot.mjs
 *   (d) DOM nodes under [data-hud-root] (else the story root) ≤ nodeBudget; an <svg> counts as
 *       <svg><use> (2 nodes) whatever its content, exactly like shoot.mjs
 *   (e) no console.error / pageerror (collected by attachErrorCollector, plus window.__HUD_GALLERY__.errors)
 * Measuring runs in the page (measureLayout, self-contained); judging runs in Node (pure helpers below,
 * unit-tested in test/layout-check.test.ts).
 */
import type { Page } from '@playwright/test';

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface NamedBox extends Box {
  readonly name: string;
}

export interface FitMeasure {
  readonly label: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface TextMeasure {
  readonly label: string;
  readonly fontSize: number;
}

export interface LayoutMeasures {
  readonly found: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly panels: readonly NamedBox[];
  readonly fit: readonly FitMeasure[];
  readonly texts: readonly TextMeasure[];
  readonly nodes: number;
  readonly nodeScope: 'hud-root' | 'story-root';
}

export type LayoutCheckKind = 'panels' | 'fit' | 'font' | 'nodes';

export interface LayoutCheckOptions {
  readonly scale: number;
  readonly nodeBudget: number;
  readonly checks?: readonly LayoutCheckKind[];
}

export interface LayoutReport {
  readonly issues: readonly string[];
  readonly measures: LayoutMeasures;
}

/** Minimum readable font size in CSS px for a UI scale (ui.md §3.2 --fs-micro, §8.3). */
export function minFontPx(scale: number): number {
  return scale < 0.95 ? 10 : 11 * scale;
}

/** Overlap of two boxes along x and y (negative = gap). */
export function overlapOf(a: Box, b: Box): { readonly x: number; readonly y: number } {
  return {
    x: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}

/** (a) Panel overlaps (> 1 px in both axes) and panels outside the viewport (0.5 px tolerance). */
export function panelIssues(panels: readonly NamedBox[], vp: { readonly width: number; readonly height: number }): string[] {
  const out: string[] = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const o = overlapOf(panels[i]!, panels[j]!);
      if (o.x > 1 && o.y > 1) out.push(`panels overlap: ${panels[i]!.name} / ${panels[j]!.name} (${Math.round(o.x)}×${Math.round(o.y)} px)`);
    }
  }
  for (const p of panels) {
    if (p.left < -0.5 || p.top < -0.5 || p.right > vp.width + 0.5 || p.bottom > vp.height + 0.5) {
      out.push(
        `panel outside viewport: ${p.name} (${Math.round(p.left)},${Math.round(p.top)}–${Math.round(p.right)},${Math.round(p.bottom)} in ${vp.width}×${vp.height})`,
      );
    }
  }
  return out;
}

/** (b) Clipped [data-fit] labels. */
export function fitIssues(fit: readonly FitMeasure[]): string[] {
  const cut = fit.filter((f) => f.scrollWidth > f.clientWidth + 1 || f.scrollHeight > f.clientHeight + 1);
  return cut.length === 0 ? [] : [`clipped [data-fit]: ${cut.map((f) => `„${f.label}“`).join(', ')}`];
}

/** (c) Text below the minimum size (0.5 px tolerance, like shoot.mjs' 10.5 for 11 px). */
export function fontIssues(texts: readonly TextMeasure[], scale: number): string[] {
  const min = minFontPx(scale) - 0.5;
  const small = texts.filter((t) => t.fontSize < min);
  if (small.length === 0) return [];
  const sample = small
    .slice(0, 5)
    .map((t) => `„${t.label}“ ${t.fontSize}px`)
    .join(', ');
  return [`text < ${minFontPx(scale).toFixed(2)} px (scale ${scale}): ${small.length} (${sample})`];
}

/** (d) DOM budget. */
export function nodeIssues(nodes: number, budget: number, scope: string): string[] {
  return nodes > budget ? [`DOM nodes under ${scope}: ${nodes} > budget ${budget}`] : [];
}

export function judgeLayout(m: LayoutMeasures, opts: LayoutCheckOptions): string[] {
  if (!m.found) return ['story root [data-story-root] not found'];
  const checks = opts.checks ?? ['panels', 'fit', 'font', 'nodes'];
  const out: string[] = [];
  if (checks.includes('panels')) out.push(...panelIssues(m.panels, m.viewport));
  if (checks.includes('fit')) out.push(...fitIssues(m.fit));
  if (checks.includes('font')) out.push(...fontIssues(m.texts, opts.scale));
  if (checks.includes('nodes')) out.push(...nodeIssues(m.nodes, opts.nodeBudget, m.nodeScope === 'hud-root' ? '[data-hud-root]' : '[data-story-root]'));
  return out;
}

/**
 * Runs in the page: measures the story below [data-story-root]. Self-contained (serialized by Playwright).
 */
export function measureLayout(): LayoutMeasures {
  const root = document.querySelector<HTMLElement>('[data-story-root]');
  if (root === null) {
    return { found: false, viewport: { width: 0, height: 0 }, panels: [], fit: [], texts: [], nodes: 0, nodeScope: 'story-root' };
  }
  const base = root.getBoundingClientRect();
  const visible = (el: Element): boolean => {
    if (el.closest('[hidden]') !== null) return false;
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const label = (el: Element): string => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '') return text.slice(0, 40);
    return el.getAttribute('data-panel') || el.getAttribute('data-component') || el.tagName.toLowerCase();
  };
  const panels: NamedBox[] = [];
  for (const el of Array.from(root.querySelectorAll('[data-panel]'))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const name = el.getAttribute('data-panel') || el.getAttribute('data-component') || el.tagName.toLowerCase();
    panels.push({ name, left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top });
  }
  const fit: FitMeasure[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-fit]'))) {
    if (!visible(el)) continue;
    fit.push({
      label: label(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  }
  const texts: TextMeasure[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    let hasText = false;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') {
        hasText = true;
        break;
      }
    }
    if (!hasText || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    // Screen-reader-only text (1 × 1 px, clipped) is not visible text.
    if (r.width <= 1 && r.height <= 1) continue;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) === 0) continue;
    texts.push({ label: label(el), fontSize: parseFloat(cs.fontSize) });
  }
  const hud = root.querySelector('[data-hud-root]');
  const scope = hud ?? root;
  const svgs = scope.querySelectorAll('svg').length;
  const svgInner = scope.querySelectorAll('svg *').length;
  const nodes = scope.querySelectorAll('*').length - svgInner + svgs;
  return {
    found: true,
    viewport: { width: base.width, height: base.height },
    panels,
    fit,
    texts,
    nodes,
    nodeScope: hud === null ? 'story-root' : 'hud-root',
  };
}

export async function runLayoutCheck(page: Page, opts: LayoutCheckOptions): Promise<LayoutReport> {
  const measures = await page.evaluate(measureLayout);
  return { issues: judgeLayout(measures, opts), measures };
}

/** Collects console errors and page errors of a page (check (e)). */
export function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}
