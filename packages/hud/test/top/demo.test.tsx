// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { AlertFeed, MatchStatus, ResourceBar } from '../../src/hud/top/index.ts';
import { DEMO_ALERT_EVENTS, DEMO_TOOLTIPS, ECO_PRESETS, applyAlertPreset, applyBannerPreset, applyEcoPreset, applyFlowDetailsPreset, applyMatchPreset, createEcoDemoTicker } from '../../src/demo/index.ts';
import type { EcoPresetName } from '../../src/demo/index.ts';
import { findUnit } from '../../src/data/roster.ts';
import { ALERT_TYPES, bannerKind, capLevel, createHudModel, olderAlertCount, visibleAlerts } from '../../src/model/index.ts';
import { flushSignals, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

describe('top demo presets', () => {
  test('eco presets reach the intended meter states', () => {
    const expected: Record<EcoPresetName, [string, string]> = {
      normal: ['normal', 'normal'],
      overflow: ['normal', 'overflow'],
      stallSoon: ['stallSoon', 'normal'],
      stallMass: ['stall', 'normal'],
      stallEnergy: ['normal', 'stall'],
      stall: ['stall', 'stall'],
    };
    for (const name of Object.keys(ECO_PRESETS) as EcoPresetName[]) {
      const m = createHudModel({ units: CAT });
      applyEcoPreset(m, name);
      expect([m.eco.mass.status.value, m.eco.energy.status.value], name).toEqual(expected[name]);
    }
  });

  test('flow details, match and banner presets', () => {
    const m = createHudModel({ units: CAT });
    applyFlowDetailsPreset(m, 'paused');
    expect(m.eco.detailsOpen.value).toBe(true);
    expect(m.eco.interactive.value).toBe(true);
    expect(m.eco.consumers.value.filter((c) => c.paused).map((c) => c.id)).toEqual([4]);
    applyFlowDetailsPreset(m, 'closed');
    expect(m.eco.detailsOpen.value).toBe(false);
    applyMatchPreset(m, 'capNear');
    expect(capLevel(m.match.units.value, m.match.unitCap.value)).toBe('near');
    applyMatchPreset(m, 'capReached');
    expect(capLevel(m.match.units.value, m.match.unitCap.value)).toBe('reached');
    for (const [preset, kind] of [
      ['none', null],
      ['pause', 'pause'],
      ['background', 'background'],
      ['speed', 'speed'],
      ['lag', 'simLag'],
      ['contextLoss', 'contextLoss'],
    ] as const) {
      applyBannerPreset(m, preset);
      expect(bannerKind(m.match.pause.value, m.match.speed.value, m.match.simLag.value, m.match.contextLost.value)).toBe(kind);
    }
  });

  test('alert presets: every type has a demo event; the mixed feed shows 3 + "2 ältere"', () => {
    expect(Object.keys(DEMO_ALERT_EVENTS).sort()).toEqual([...ALERT_TYPES].sort());
    const m = createHudModel({ units: CAT });
    applyAlertPreset(m, 'mixed');
    const items = m.alerts.items.value;
    expect(items).toHaveLength(5);
    expect(visibleAlerts(items)).toHaveLength(3);
    expect(olderAlertCount(items, m.alerts.historyCount.value)).toBe(2);
    applyAlertPreset(m, 'all');
    expect(new Set(m.alerts.items.value.map((a) => a.type)).size).toBe(10);
    applyAlertPreset(m, 'merged');
    expect(m.alerts.items.value.map((a) => a.count)).toEqual([3]);
    expect(m.alerts.items.value[0]?.id).toBe(1); // ids restart with every preset
  });

  test('tooltip targets exist in the roster; Ember Boiler I has adjacency, the Reeve none', () => {
    for (const target of Object.values(DEMO_TOOLTIPS)) expect(findUnit(CAT, target.typeId), target.typeId).toBeDefined();
    expect(findUnit(CAT, DEMO_TOOLTIPS.boiler.typeId)?.adjacency).not.toBeNull();
    expect(findUnit(CAT, DEMO_TOOLTIPS.reeve.typeId)?.adjacency).toBeNull();
  });

  test('eco demo ticker is deterministic and keeps storage within capacity', () => {
    const run = (seed: number): number[] => {
      const m = createHudModel({ units: CAT });
      applyEcoPreset(m, 'normal');
      const ticker = createEcoDemoTicker(m, seed);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        ticker.step();
        out.push(m.eco.mass.stored.value, m.eco.energy.income.value);
        expect(m.eco.energy.stored.value).toBeLessThanOrEqual(m.eco.energy.capacity.value);
        expect(m.eco.mass.stored.value).toBeGreaterThanOrEqual(0);
      }
      return out;
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });
});

describe('local measurement (not a gate, DECISIONS 5/16)', () => {
  test('10 Hz eco + 1 Hz status/alert updates with the whole top zone mounted', async () => {
    const model = createHudModel({ units: CAT });
    applyEcoPreset(model, 'normal');
    applyFlowDetailsPreset(model, 'bottleneck');
    applyMatchPreset(model, 'normal');
    applyAlertPreset(model, 'mixed');
    renderWithHud(
      <>
        <ResourceBar />
        <MatchStatus />
        <AlertFeed />
      </>,
      { model },
    );
    const ticker = createEcoDemoTicker(model, 3);
    const N = 300;
    let total = 0;
    let max = 0;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await flushSignals(() => {
        ticker.step();
        if (i % 10 === 0) {
          model.match.timeS.value += 1;
          model.match.units.value = 64 + (i % 7);
        }
      });
      const dt = performance.now() - t0;
      total += dt;
      if (dt > max) max = dt;
    }
    // happy-dom is far slower than a browser; the number goes into docs/status/track-hud-p2-top.md only.
    console.info(`[hud-p2 measure] top zone tick: mean ${(total / N).toFixed(3)} ms, max ${max.toFixed(3)} ms (happy-dom, ${N} ticks)`);
    expect(total).toBeGreaterThan(0);
  });
});
