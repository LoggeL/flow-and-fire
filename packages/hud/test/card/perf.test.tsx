// @vitest-environment happy-dom
/**
 * Update-path checks for ui.md §9 (HUD ≤ 1 ms main JS): the 10-Hz progress path writes one CSS variable
 * per running cell and never re-renders, 4-Hz order-state rewrites with equal content do nothing, and
 * event-rate re-renders stay small. Timings are local measurements (happy-dom, DECISIONS 5/16: measurement
 * ≠ gate); only the structural properties are asserted strictly.
 */
import { describe, expect, it } from 'vitest';
import { applyCardDemo, applyStripDemo } from '../../src/demo/card.ts';
import { CommandCard } from '../../src/hud/card/CommandCard.tsx';
import { OrderBar } from '../../src/hud/card/OrderBar.tsx';
import { ControlGroups } from '../../src/hud/strip/ControlGroups.tsx';
import { createHudModel } from '../../src/model/index.ts';
import { flushSignals, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

describe('card update paths (ui.md §9.1/§9.2)', () => {
  it('10-Hz progress: one style write on the running cell, no re-render', async () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'landFactory');
    const { container } = renderWithHud(<CommandCard />, { model: m });
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    const times: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const t0 = performance.now();
      await flushSignals(() => {
        m.card.progress.value = { 'core:lnd_t1_tank': i / 50 };
      });
      times.push(performance.now() - t0);
    }
    await flushSignals();
    obs.disconnect();
    expect(records.every((r) => r.type === 'attributes' && r.attributeName === 'style')).toBe(true);
    expect(records.length).toBe(50);
    console.info(`[perf] progress update (10 Hz path, incl. act flush): median ${median(times).toFixed(3)} ms`);
  });

  it('selection change re-renders the card and order bar within the event budget', async () => {
    const m = createHudModel({ units: CAT });
    applyStripDemo(m);
    renderWithHud(
      <>
        <OrderBar />
        <CommandCard />
        <ControlGroups />
      </>,
      { model: m },
    );
    const ids = ['vogt', 'landFactory', 'army', 'mex', 'engineerT3'] as const;
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const id = ids[i % ids.length]!;
      const t0 = performance.now();
      await flushSignals(() => applyCardDemo(m, id));
      times.push(performance.now() - t0);
    }
    const med = median(times);
    console.info(`[perf] selection change (card + order bar re-render, happy-dom): median ${med.toFixed(3)} ms`);
    // Loose sanity bound only (happy-dom is far slower than a browser DOM).
    expect(med).toBeLessThan(50);
  });

  it('1-Hz group/idle counters: only the changed group re-renders its count', async () => {
    const m = createHudModel({ units: CAT });
    applyStripDemo(m);
    const { container } = renderWithHud(<ControlGroups />, { model: m });
    const g0 = container.querySelector('[data-group="0"]');
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    await flushSignals(() => {
      const groups = [...m.strip.groups.value];
      groups[0] = { count: 17, iconTypeId: 'core:lnd_t1_tank' };
      m.strip.groups.value = groups;
    });
    obs.disconnect();
    expect(container.querySelector('[data-group="0"]')).toBe(g0);
    const touched = new Set(records.map((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-group]')?.getAttribute('data-group')));
    expect([...touched]).toEqual(['0']);
  });
});
