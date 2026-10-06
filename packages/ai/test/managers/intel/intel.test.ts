import { describe, expect, it } from 'vitest';
import { LocalThreatEstimate } from '../../../src/index.ts';
import {
  createIntelManager,
  GRID_CELL_WU,
  intelManager,
  ThreatGrid,
  type IntelManager,
} from '../../../src/managers/intel/index.ts';
import { decoded, flat512, harness, ID, ofOp, Op, streamKey, T } from '../platoon/harness.ts';

const tankThreat = T.byId(ID.tank)!.threatSurface;

describe('ThreatGrid (ai.md §5.6)', () => {
  it('cells of 16 WU: Setons 64 × 64, 512 WU 32 × 32; full inside the range, half in the 8-WU rim', () => {
    let now = 0;
    expect(new ThreatGrid(1024, () => now).dim).toBe(64);
    const g = new ThreatGrid(512, () => now);
    expect(g.dim).toBe(32);
    const cells = new Int32Array(64);
    const w = new Float64Array(64);
    const n = g.discCells(200, 200, 18, 8, cells, w); // Punze: 18 + 8 WU
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(12);
    expect([...w.slice(0, n)].every((x) => x === 1 || x === 0.5)).toBe(true);
    now = 5;
    g.beginPass();
    const c = g.cellOf(200, 200);
    g.addLive(c, 0, 84, now);
    expect(g.live(c, 0)).toBe(0); // live layer not published yet (memory follows at once)
    g.publish(now);
    expect(g.live(c, 0)).toBe(84);
    expect(g.threatAt('surface', 200, 200)).toBe(84);
    expect(g.threatAt('surface', 200 + GRID_CELL_WU * 3, 200)).toBe(0);
  });
});

describe('IntelManager', () => {
  it('AI-INT-02: T_surface halves after 13–14 s in the fog, ghost structures stay', () => {
    const h = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0 });
    const w = h.world;
    w.addOwn(ID.fac, 130, 128); // own sight far away from the pulk
    const pulk: number[] = [];
    for (let i = 0; i < 5; i++) pulk.push(w.addEnemy(ID.tank, 320 + i, 320));
    w.addEnemy(ID.pd, 300, 300, { kind: 'ghost' });
    h.run(4); // intel runs on odd k: passes at ticks 5 and 15
    const bb = h.brain.blackboard;
    const g = h.manager().grid;
    expect(bb.threat).toBe(g);
    const at = { x: 322, z: 320 };
    const live = g.threatAt('surface', at.x, at.z);
    expect(live).toBeCloseTo(5 * tankThreat, 6);
    const pdAt = g.threatAt('surface', 300, 300);
    expect(pdAt).toBeGreaterThanOrEqual(T.byId(ID.pd)!.threatSurface);
    // the pulk disappears in the fog at tick 20; its memory is stamped at the last pass (tick 15)
    for (const id of pulk) w.removeEnemy(id);
    const stamp = 15; // last intel pass that saw the pulk
    h.run(40);
    const cell = g.cellOf(at.x, at.z);
    expect(g.live(cell, 0)).toBe(0);
    expect(g.memTick[cell]).toBe(stamp);
    // lazy decay: 0.95^floor((t − t_mem) / 1 s)
    expect(g.mobile(cell, 0, stamp + 130) / live).toBeGreaterThan(0.5); // 13 s: 0.513
    expect(g.mobile(cell, 0, stamp + 140) / live).toBeLessThan(0.5); // 14 s: 0.488
    expect(g.mobile(cell, 0, stamp + 140) / live).toBeGreaterThan(0.45);
    expect(g.threatAt('surface', at.x, at.z)).toBeCloseTo(g.mobile(cell, 0, h.brain.blackboard.tick), 9);
    expect(g.threatAt('surface', 300, 300)).toBeCloseTo(pdAt, 9); // structures never decay
  });

  it('seen emptiness clears the memory; enemyDestroyed removes a ghost structure', () => {
    const h = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0 });
    const w = h.world;
    const e = w.addEnemy(ID.tank, 320, 320);
    const pd = w.addEnemy(ID.pd, 360, 360, { kind: 'ghost' });
    h.run(4);
    const g = h.manager().grid;
    expect(g.threatAt('surface', 320, 320)).toBeGreaterThan(0);
    w.removeEnemy(e);
    w.addOwn(ID.tank, 320, 320); // own sight over the cell, nothing there
    w.removeEnemy(pd, true);
    h.run(4);
    expect(g.threatAt('surface', 320, 320)).toBe(0);
    expect(g.threatAt('surface', 360, 360)).toBe(0);
    expect(g.lastSeenAt(320, 320)).toBeGreaterThan(0);
  });

  it('grid costs ≈ ai.md §2.3: 300 enemies + 300 own units on a Setons-sized map ≤ 7,000 ops (Normal: one pass)', () => {
    const st = flat512([], 1024);
    const h = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0, static: st });
    const w = h.world;
    // ai.md mix: mostly Punzen, some Meißel, some Rinnen (Ø ≈ 12 cells)
    for (let i = 0; i < 300; i++) {
      const id = i % 10 < 7 ? ID.tank : i % 10 < 9 ? ID.tank2 : ID.arty2;
      w.addEnemy(id, 500 + (i % 20) * 12, 500 + Math.floor(i / 20) * 12);
    }
    for (let i = 0; i < 300; i++) w.addOwn(ID.tank, 200 + (i % 20) * 12, 200 + Math.floor(i / 20) * 12);
    const rs = h.run(4);
    const m = h.manager();
    expect(m.passes).toBe(2);
    expect(m.lastPassOps).toBeLessThanOrEqual(7000);
    expect(m.lastPassOps).toBeGreaterThan(3000);
    for (const r of rs) expect(r.opsByManager.intel ?? 0).toBeLessThanOrEqual(7000);
  });

  it('cursor continuation at the Easy budget (4,000): pass spread over runs, same grid, ≤ 2 s old', () => {
    const build = (difficulty: 'easy' | 'normal') => {
      const st = flat512([], 1024);
      const h = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0, static: st, difficulty });
      const w = h.world;
      for (let i = 0; i < 300; i++) w.addEnemy(i % 3 === 0 ? ID.arty2 : ID.tank, 500 + (i % 20) * 12, 500 + Math.floor(i / 20) * 12, { kind: 'visible' });
      for (let i = 0; i < 300; i++) w.addOwn(ID.tank, 200 + (i % 20) * 12, 200 + Math.floor(i / 20) * 12);
      return h;
    };
    const easy = build('easy');
    const rs = easy.run(6); // Easy thinks every 10 ticks, intel every think
    const m = easy.manager();
    expect(m.passes).toBeGreaterThanOrEqual(2);
    for (const r of rs) expect(r.opsByManager.intel ?? 0).toBeLessThanOrEqual(4000);
    // at least one pass needed two runs
    expect(m.grid.publishedTick).toBeGreaterThan(0);
    const normal = build('normal');
    normal.run(4);
    const gn = normal.manager().grid;
    const ge = m.grid;
    // Easy has no memory, but the live layer of a completed pass is the same (visible units only)
    for (const [x, z] of [
      [520, 520],
      [600, 540],
      [700, 560],
    ] as const) {
      expect(ge.live(ge.cellOf(x, z), 0)).toBeCloseTo(gn.live(gn.cellOf(x, z), 0), 6);
    }
    expect(easy.brain.blackboard.tick - ge.publishedTick).toBeLessThanOrEqual(20);
  });

  it('blips: median threat of the highest seen tech over 5 × 5 cells; Easy ignores blips and ghosts', () => {
    const h = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0 });
    h.world.addEnemy(null, 256, 256);
    h.run(4);
    const g = h.manager().grid;
    expect(g.threatAt('surface', 256, 256)).toBeCloseTo(tankThreat, 9); // T1 median = Punze
    expect(g.threatAt('surface', 256 + 32, 256 - 32)).toBeCloseTo(tankThreat, 9);
    expect(g.threatAt('surface', 256 + 48, 256)).toBe(0);
    const e = harness<IntelManager>(createIntelManager({ scouting: false }), { tick: 0, difficulty: 'easy' });
    e.world.addEnemy(null, 256, 256);
    e.world.addEnemy(ID.pd, 300, 300, { kind: 'ghost' });
    e.world.addEnemy(ID.pd, 200, 300, { kind: 'visible' });
    e.run(4);
    const ge = e.manager().grid;
    expect(ge.threatAt('surface', 256, 256)).toBe(0);
    expect(ge.threatAt('surface', 300, 300)).toBe(0);
    expect(ge.threatAt('surface', 200, 300)).toBeGreaterThan(0);
  });

  it('scouting: first route straight to the enemy start, then oldest enemy expansions and the contested zone; telemetry', () => {
    const spots = [
      { kind: 'mass' as const, x: 300, z: 440 },
      { kind: 'mass' as const, x: 440, z: 300 },
      { kind: 'mass' as const, x: 460, z: 460 },
      { kind: 'mass' as const, x: 250, z: 262 },
    ];
    const h = harness<IntelManager>(intelManager, { tick: 700, static: flat512(spots) });
    const w = h.world;
    const scout = w.addOwn(ID.scout, 150, 150);
    const [r0, r1] = h.run(2);
    const moves = [...decoded(r0!), ...decoded(r1!)].filter((c) => c.op === Op.Move && c.units.includes(scout));
    expect(moves.length).toBeGreaterThanOrEqual(3);
    const pts = moves.map((c) => (c.pl.op === 'position' ? { x: c.pl.value.x, z: c.pl.value.z } : null));
    const es = h.brain.analysis.enemyStart;
    expect(pts[0]).toMatchObject({ x: es.x, z: es.z });
    expect(moves[0]!.flags & 1).toBe(0); // first order replaces, the rest is a shift queue
    expect(moves.slice(1).every((c) => (c.flags & 1) === 1)).toBe(true);
    expect(pts[pts.length - 1]).toMatchObject({ x: 250, z: 262 }); // back over the contested zone
    expect(h.brain.blackboard.reservations.unitOwner(scout)).toBe('intel');
    expect(h.brain.blackboard.telemetry.count('scoutSeenEnemyBase')).toBe(0);
    // the scout arrives at the enemy start ⇒ telemetry once; new route when idle ≥ 2 s
    const u = w.own(scout);
    u.x = es.x;
    u.z = es.z;
    u.order = 0;
    u.queueLength = 0;
    const later = h.run(10);
    expect(h.brain.blackboard.telemetry.count('scoutSeenEnemyBase')).toBe(1);
    const again = later.flatMap((r) => ofOp(r, Op.Move)).filter((c) => c.units.includes(scout));
    expect(again.length).toBeGreaterThan(0);
    const firstAgain = again[0]!.pl;
    expect(firstAgain.op === 'position' && firstAgain.value.x === es.x && firstAgain.value.z === es.z).toBe(false);
  });

  it('determinism: identical passes and streams in two runs; before the first pass the local estimate stays', () => {
    const run = (): { key: string; grid: number[] } => {
      const h = harness<IntelManager>(intelManager, { tick: 0 });
      const w = h.world;
      w.addOwn(ID.scout, 140, 140);
      w.addOwn(ID.tank, 200, 200);
      for (let i = 0; i < 20; i++) w.addEnemy(i % 2 ? ID.tank : ID.arty2, 300 + i * 3, 310);
      w.addEnemy(null, 250, 330);
      expect(h.brain.blackboard.threat).toBeInstanceOf(LocalThreatEstimate);
      const rs = h.run(30);
      const g = h.manager().grid;
      const vals: number[] = [];
      for (let c = 0; c < g.cells; c++) vals.push(g.cellThreat(c, 0, h.brain.blackboard.tick));
      return { key: streamKey(rs), grid: vals };
    };
    const a = run();
    const b = run();
    expect(a.key).toBe(b.key);
    expect(a.grid).toEqual(b.grid);
  });
});
