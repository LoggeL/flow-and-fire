// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  fitIssues,
  fontIssues,
  judgeLayout,
  measureLayout,
  minFontPx,
  nodeIssues,
  overlapOf,
  panelIssues,
} from '../e2e/support/layout-check.ts';
import type { LayoutMeasures } from '../e2e/support/layout-check.ts';
import { storyTitle, wantsPseudo } from '../e2e/support/env.ts';

const vp = { width: 1920, height: 1080 };
const box = (name: string, left: number, top: number, right: number, bottom: number) => ({ name, left, top, right, bottom });

describe('layout check helpers (port of shoot.mjs)', () => {
  it('(a) overlap > 1 px in both axes and outside the viewport', () => {
    expect(overlapOf(box('a', 0, 0, 10, 10), box('b', 5, 5, 20, 20))).toEqual({ x: 5, y: 5 });
    expect(panelIssues([box('eco', 8, 8, 632, 68), box('status', 1500, 8, 1912, 48)], vp)).toEqual([]);
    // Touching edges or 1 px overlap is fine (sub-pixel rounding).
    expect(panelIssues([box('a', 0, 0, 100, 100), box('b', 99, 0, 200, 100)], vp)).toEqual([]);
    expect(panelIssues([box('minimap', 8, 852, 224, 1072), box('sel', 200, 852, 1592, 1072)], vp)).toEqual([
      'panels overlap: minimap / sel (24×220 px)',
    ]);
    expect(panelIssues([box('card', 1596, 852, 1925, 1072)], vp)).toEqual([
      'panel outside viewport: card (1596,852–1925,1072 in 1920×1080)',
    ]);
  });

  it('(b) clipped labels ([data-fit] and truncating text)', () => {
    const f = (label: string, sw: number, cw: number, sh = 10, ch = 10) => ({ label, scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch });
    expect(fitIssues([f('Punze', 40, 50), f('Glutkessel', 51, 50)])).toEqual([]);
    expect(fitIssues([f('[Žáþƒšţéľľé~~~]', 70, 50), f('ok', 10, 10, 14, 12)])).toEqual(['clipped labels: „[Žáþƒšţéľľé~~~]“ (70 > 50 px), „ok“ (10 > 10 px)']);
  });

  it('(c) minimum font size: 11 px × scale, 10 px floor below 0.95', () => {
    expect(minFontPx(1)).toBe(11);
    expect(minFontPx(1.25)).toBe(13.75);
    expect(minFontPx(0.8)).toBe(10);
    expect(minFontPx(0.9)).toBe(10);
    expect(fontIssues([{ label: 'Q', fontSize: 11 }], 1)).toEqual([]);
    expect(fontIssues([{ label: 'Q', fontSize: 10.5 }], 1)).toEqual([]);
    expect(fontIssues([{ label: 'Q', fontSize: 10 }, { label: 'W', fontSize: 11 }], 1)).toEqual(['text < 11.00 px (scale 1): 1 („Q“ 10px)']);
    expect(fontIssues([{ label: 'Q', fontSize: 11 }], 1.25)).toHaveLength(1);
    expect(fontIssues([{ label: 'Q', fontSize: 10 }], 0.8)).toEqual([]);
  });

  it('(d) node budget', () => {
    expect(nodeIssues(700, 700, '[data-hud-root]')).toEqual([]);
    expect(nodeIssues(701, 700, '[data-hud-root]')).toEqual(['DOM nodes under [data-hud-root]: 701 > budget 700']);
  });

  it('judgeLayout selects checks', () => {
    const m: LayoutMeasures = {
      found: true,
      viewport: vp,
      panels: [box('a', 0, 0, 100, 100), box('b', 50, 50, 150, 150)],
      fit: [{ label: 'x', scrollWidth: 20, clientWidth: 10, scrollHeight: 1, clientHeight: 1 }],
      texts: [{ label: 't', fontSize: 9 }],
      nodes: 900,
      nodeScope: 'hud-root',
    };
    expect(judgeLayout(m, { scale: 1, nodeBudget: 700 })).toHaveLength(4);
    expect(judgeLayout(m, { scale: 1, nodeBudget: 700, checks: ['fit'] })).toEqual(['clipped labels: „x“ (20 > 10 px)']);
    expect(judgeLayout({ ...m, found: false }, { scale: 1, nodeBudget: 700 })).toEqual(['story root [data-story-root] not found']);
  });

  it('measureLayout counts <svg><use> as 2 nodes and prefers [data-hud-root]', () => {
    document.body.innerHTML =
      '<div data-story-root><p>x</p><div data-hud-root><button><svg><use href="#a"></use></svg></button>' +
      '<svg><g><path></path><path></path></g></svg><span>1</span></div></div>';
    const m = measureLayout();
    expect(m.found).toBe(true);
    expect(m.nodeScope).toBe('hud-root');
    // button + (svg+use) + (svg counted as svg+use, inner g/path ignored) + span = 1 + 2 + 2 + 1
    expect(m.nodes).toBe(6);
    document.body.innerHTML = '<div data-story-root><span>a</span><span>b</span></div>';
    expect(measureLayout()).toMatchObject({ nodes: 2, nodeScope: 'story-root' });
    document.body.innerHTML = '';
    expect(measureLayout().found).toBe(false);
  });

  it('titles and pseudo selection', () => {
    expect(storyTitle({ source: 'top', id: 'resource-meter--stall' })).toBe('grp=top resource-meter--stall');
    expect(storyTitle({ source: 'top', id: 'x' }, 'pseudo')).toBe('grp=top x pseudo');
    expect(wantsPseudo({ layout: 'fullscreen', tags: ['no-pseudo'] })).toBe(true);
    expect(wantsPseudo({ layout: 'component', tags: [] })).toBe(true);
    expect(wantsPseudo({ layout: 'component', tags: ['no-pseudo'] })).toBe(false);
  });
});
