import { describe, expect, test } from 'vitest';
import {
  ALERT_EVERY_TICKS,
  HUD_SCENARIO_IDS,
  SIM_TICK_S,
  applyHudScenario,
  createHudScenario,
  createSnapshotGenerator,
  queueCountsOf,
  quantizeHp,
} from '../../src/demo/scenarios.ts';
import { createHudModel } from '../../src/model/index.ts';
import { MINIMAP_KIND_BLIP, MINIMAP_KIND_GHOST, countMinimapUnits } from '../../src/model/minimap.ts';
import { captureSnapshot, snapshotVersions } from '../../src/model/snapshot.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

describe('HudSnapshot capture', () => {
  test('writing a scenario through the scheduler and capturing it again yields the same data', () => {
    for (const id of HUD_SCENARIO_IDS) {
      const scenario = createHudScenario(id);
      const model = createHudModel({ units: CAT });
      applyHudScenario(model, scenario);
      const back = captureSnapshot(model, 0, snapshotVersions(scenario.snapshot));
      const { minimap: mmA, eco: ecoA, ...a } = scenario.snapshot;
      const { minimap: mmB, eco: ecoB, ...b } = back;
      expect(b, id).toEqual(a);
      // Consumers are only written while the flow details are open (4 Hz, ui.md §5.1).
      expect(ecoB, id).toEqual(scenario.ui.detailsOpen ? ecoA : { ...ecoA, consumers: [] });
      expect(mmB.units).toBe(mmA.units);
      expect(mmB.fog).toBe(mmA.fog);
      expect(mmB.camera).toEqual(mmA.camera);
    }
  });
});

describe('scenarios (ui.md §12)', () => {
  test('mockup states: selection, card, alerts, flow details, pause, speed, team mode', () => {
    const vogt = createHudScenario('vogt');
    expect(vogt.snapshot.selection.kind).toBe('single');
    expect(vogt.snapshot.card.selectedTypes).toEqual(['core:cmd_commander']);
    expect(vogt.ui.tooltip).toMatchObject({ kind: 'unit', typeId: 'core:str_t1_pgen', slot: 'KeyW' });
    const army = createHudScenario('armee');
    expect(army.snapshot.selection.multi?.total).toBe(19);
    expect(army.snapshot.selection.multi?.groups).toHaveLength(5);
    expect(army.snapshot.orders.states.attack?.armed).toBe(true);
    const stall = createHudScenario('fabrik-stall');
    expect(stall.snapshot.eco.energy.flow).toBeLessThan(1);
    expect(stall.ui.detailsOpen).toBe(true);
    expect(stall.snapshot.alerts.items[0]!.type).toBe('energyStall');
    expect(createHudScenario('pause-cvd')).toMatchObject({ paused: true, ui: { teams: 'cvd' } });
    const dense = createHudScenario('dichtester-fall');
    expect(dense.paused).toBe(true);
    expect(dense.snapshot.alerts.items).toHaveLength(5);
    expect(dense.snapshot.eco.consumers.filter((c) => c.paused)).toHaveLength(1);
    expect(dense.snapshot.factory.queue?.repeat).toBe(true);
    expect(dense.ui.tooltip).not.toBeNull();
    expect(createHudScenario('kompakt').speed).toBe(2);
  });

  test('perf-500: 500 own units, 60 units / 24 types, flow details open, alerts, 800 minimap entries', () => {
    const s = createHudScenario('perf-500');
    expect(s.snapshot.match.units).toBe(500);
    expect(s.snapshot.selection.multi?.total).toBe(60);
    expect(s.snapshot.selection.multi?.groups).toHaveLength(24);
    expect(s.ui.detailsOpen).toBe(true);
    expect(s.snapshot.alerts.items.length).toBeGreaterThanOrEqual(3);
    const mm = countMinimapUnits(s.snapshot.minimap.units);
    expect(mm.own).toBe(500);
    expect(mm.other).toBe(300);
    expect(s.snapshot.minimap.units.count).toBe(800);
    // Enemies outside the vision show up as blips / ghosts.
    expect(mm.byKind[MINIMAP_KIND_BLIP]! + mm.byKind[MINIMAP_KIND_GHOST]!).toBeGreaterThan(0);
  });

  test('queue counts include the item in production', () => {
    expect(queueCountsOf({ current: { typeId: 'a' }, blocks: [{ typeId: 'a', count: 5 }, { typeId: 'b', count: 2 }], repeat: false, paused: false })).toEqual({ a: 6, b: 2 });
    expect(queueCountsOf(null)).toEqual({});
  });
});

describe('SnapshotGenerator', () => {
  test('is deterministic for a seed', () => {
    const run = (): number[] => {
      const gen = createSnapshotGenerator(createHudScenario('perf-500', { seed: 42 }));
      const out: number[] = [];
      for (let i = 0; i < 120; i++) {
        const s = gen.next();
        out.push(s.eco.mass.stored, s.eco.energy.income, s.selection.multiStats!.avgHpPct, s.minimap.units.x[7]!);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  test('one tick = 0.1 s sim time; storage stays within capacity; unchanged sections keep their references', () => {
    const gen = createSnapshotGenerator(createHudScenario('vogt'));
    const s0 = gen.current();
    let prev = s0;
    for (let i = 0; i < 300; i++) {
      const s = gen.next();
      expect(s.tick).toBe(i + 1);
      expect(s.timeS).toBeCloseTo(prev.timeS + SIM_TICK_S, 6);
      for (const r of [s.eco.mass, s.eco.energy]) {
        expect(r.stored).toBeGreaterThanOrEqual(0);
        expect(r.stored).toBeLessThanOrEqual(r.capacity);
        expect(r.flow).toBeGreaterThan(0);
        expect(r.flow).toBeLessThanOrEqual(1);
      }
      expect(s.orders).toBe(s0.orders);
      expect(s.eco.mass.incomeBySource).toBe(s0.eco.mass.incomeBySource);
      prev = s;
    }
  });

  test('the factory completes items: queue event (version bump) and matching badges', () => {
    const gen = createSnapshotGenerator(createHudScenario('fabrik'));
    const v0 = gen.current().factory.version;
    let s = gen.current();
    for (let i = 0; i < 400 && s.factory.version === v0; i++) s = gen.next();
    expect(s.factory.version).toBe(v0 + 1);
    expect(s.card.version).toBeGreaterThan(gen.current().card.version - 1);
    expect(s.card.queueCounts).toEqual(queueCountsOf(s.factory.queue));
    expect(s.factory.progress).toBeLessThan(0.2);
  });

  test('alerts arrive every 15 s as events with a minimap ping; fog every 5 ticks; units every tick', () => {
    const gen = createSnapshotGenerator(createHudScenario('armee'));
    const a0 = gen.current().alerts.version;
    let fogChanges = 0;
    let lastFog = gen.current().minimap.fog;
    let lastUnits = gen.current().minimap.units;
    for (let i = 0; i < ALERT_EVERY_TICKS; i++) {
      const s = gen.next();
      if (s.minimap.fog !== lastFog) fogChanges++;
      expect(s.minimap.units).not.toBe(lastUnits);
      lastFog = s.minimap.fog;
      lastUnits = s.minimap.units;
    }
    const s = gen.current();
    expect(s.alerts.version).toBeGreaterThan(a0);
    expect(fogChanges).toBe(ALERT_EVERY_TICKS / 5);
    expect(s.minimap.pings.some((p) => Math.abs(p.bornS - s.timeS) < 1e-6)).toBe(true);
  });

  test('HP moves in frame steps (u8) and only for units in combat', () => {
    expect(quantizeHp(0.5)).toBeCloseTo(128 / 255, 9);
    const gen = createSnapshotGenerator(createHudScenario('perf-500'));
    gen.next(); // the generator starts from u8-quantized samples
    const before = Array.from(gen.current().selection.multiStats!.unitHp);
    const after = Array.from(gen.next().selection.multiStats!.unitHp);
    const changed = after.filter((v, i) => v !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(4);
  });
});
