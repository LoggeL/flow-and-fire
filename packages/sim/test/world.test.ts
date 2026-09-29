import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PHASES,
  CAP_UNITS,
  createWorld,
  PHASE_NAMES,
  PhaseId,
  step,
  unitHandles,
  unitInfo,
  UNITS_SCHEMA,
  type PhaseProbe,
} from '../src/index.ts';
import { gameSimBin, gameTable, spawnCmd } from './support/fixtures.ts';

describe('world layout (PLAN §3.5)', () => {
  it('Units carries the complete §3.5 column set in order', () => {
    expect(Object.keys(UNITS_SCHEMA)).toEqual([
      'bp', 'army', 'layer', 'state', 'flags',
      'x', 'y', 'z', 'px', 'py', 'pz', 'yaw', 'pyaw', 'bank',
      'vx', 'vz', 'hp', 'buildDone', 'vetMass', 'vet', 'lastHitBy',
      'orderHead', 'orderTail', 'weaponFirst', 'weaponCount', 'formation', 'groupOffset',
      'mover', 'air', 'builder', 'factory', 'shield', 'intel', 'eco',
    ]);
    const w = createWorld({ simBin: gameSimBin(), seed: 1, armyCount: 2 });
    expect(w.units.cap).toBe(CAP_UNITS);
    expect(w.arena.regions.map((r) => r.name)).toEqual([
      'world', 'armies', 'alliance', 'units', 'movers',
      'grid.fine.start', 'grid.fine.cursor', 'grid.fine.items', 'grid.fine.cellOf',
      'grid.coarse.start', 'grid.coarse.cursor', 'grid.coarse.items', 'grid.coarse.cellOf',
      'hashlog',
      'map.terrain', 'map.heights', 'map.starts', 'map.spots',
    ]);
    // The map lives in the static area: after the dynamic range, outside rule and full hash.
    expect(w.arena.regions.filter((r) => r.area === 'static').map((r) => r.name)).toEqual(['map.terrain', 'map.heights', 'map.starts', 'map.spots']);
    expect(w.arena.staticStart).toBe(w.arena.dynamicEnd);
    for (const r of w.arena.fullRegions) expect(r.area, r.name).toBe('dynamic');
    expect(w.arena.regions.filter((r) => r.derived).map((r) => r.name.split('.')[1] ?? r.name)).toEqual([
      'fine', 'fine', 'fine', 'fine', 'coarse', 'coarse', 'coarse', 'coarse', 'hashlog',
    ]);
  });

  it('pins the layout hash of the default 512 WU world (layout change ⇒ format change)', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2 });
    const other = createWorld({ bpTable: gameTable(), seed: 999, armyCount: 16 });
    expect(other.layoutHash).toBe(w.layoutHash);
    expect(w.layoutHash >>> 0).toBe(LAYOUT_HASH_512);
    expect(createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2, mapSizeWu: 1024 }).layoutHash).not.toBe(w.layoutHash);
    // Arena size stays moderate (no swap on the dev machine; PLAN ≈ 17 MB at 10 km incl. everything).
    expect(w.arena.byteLength).toBeLessThan(4 * 1024 * 1024);
  });

  it('sets unused columns of a spawned unit to 0 / −1', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2 });
    step(w, [spawnCmd(0, 1, 10, 10, 0)]);
    const i = unitInfo(w, unitHandles(w)[0]!)!.slot;
    const U = w.units.col;
    for (const c of ['orderHead', 'orderTail', 'formation', 'groupOffset', 'air', 'builder', 'factory', 'shield', 'intel', 'eco'] as const) {
      expect(U[c][i], c).toBe(-1);
    }
    // Test plane: flat at height 0.
    for (const c of ['bank', 'vet', 'weaponFirst', 'weaponCount', 'y', 'py'] as const) expect(U[c][i], c).toBe(0);
    expect(U.buildDone.get(i)).toBe(0);
    expect(U.lastHitBy[i]).toBe(0xffffffff);
    expect(U.mover[i]).toBe(0);
    expect(w.movers.owner[0]).toBe(i);
    expect(w.units.handle(i) >>> 20).toBe(w.units.gen[i]);
    expect(U.layer[i]).toBe(0);
  });
});

describe('phases (PLAN §3.4)', () => {
  it('declares all 16 phase ids and runs the MS1 phases in order, HashTick inside Output every 10 ticks', () => {
    expect(PhaseId.CommandApply).toBe(1);
    expect(PhaseId.Output).toBe(16);
    expect(PHASE_NAMES.length).toBe(18);
    const log: string[] = [];
    const probe: PhaseProbe = {
      begin: (p) => log.push(`+${PHASE_NAMES[p]}`),
      end: (p) => log.push(`-${PHASE_NAMES[p]}`),
    };
    const w = createWorld({ bpTable: gameTable(), seed: 1, armyCount: 1 });
    for (let t = 0; t < 9; t++) step(w, null);
    step(w, null, probe);
    const expected: string[] = [];
    for (const p of ACTIVE_PHASES) {
      expected.push(`+${PHASE_NAMES[p]}`);
      if (p === PhaseId.Output) expected.push('+HashTick', '-HashTick');
      expected.push(`-${PHASE_NAMES[p]}`);
    }
    expect(log).toEqual(expected);
    log.length = 0;
    step(w, null, probe);
    expect(log).not.toContain('+HashTick');
    expect(w.tick).toBe(11);
  });
});

/** Pinned layout hash (update deliberately when the arena schema changes). */
const LAYOUT_HASH_512 = 0x9c64c907;
