/**
 * Paths (A* on the 2-WU grid), abstract combat, vision and ghosts of the arena world (tai-p2).
 */
import { describe, expect, it } from 'vitest';
import { PathFinder, polylineLength } from '../../src/index.ts';
import { Cmds, hollowWorld, localFrame, run, runUntil, setonsWorld } from './support.ts';

const TANK = 'core:lnd_t1_tank';
const ENG = 'core:lnd_t1_engineer';
const MEX = 'core:str_t1_mex';

describe('arena paths', () => {
  it('Setons: start army 0 → start army 1 over the land bridge ≈ 463 WU (± 5 %)', () => {
    const w = setonsWorld();
    const a = w.startOf(0);
    const b = w.startOf(1);
    const p = w.paths.find(a.x, a.z, b.x, b.z)!;
    expect(p).not.toBeNull();
    const len = polylineLength(a.x, a.z, p);
    expect(Math.abs(len - 463) / 463).toBeLessThanOrEqual(0.05);
    // every leg is walkable (grid line free)
    let px = a.x;
    let pz = a.z;
    for (let i = 0; i < p.length; i += 2) {
      expect(w.paths.lineFree(px, pz, p[i]!, p[i + 1]!)).toBe(true);
      px = p[i]!;
      pz = p[i + 1]!;
    }
    // same request again: identical
    expect(w.paths.find(a.x, a.z, b.x, b.z)).toEqual(p);
  });

  it('Hollow Ridge: start → enemy start takes the detour over the ridge (≈ 570 WU ± 5 %)', () => {
    const w = hollowWorld();
    const a = w.startOf(0);
    const b = w.startOf(1);
    const p = w.paths.find(a.x, a.z, b.x, b.z)!;
    const len = polylineLength(a.x, a.z, p);
    expect(Math.abs(len - 570) / 570).toBeLessThanOrEqual(0.05);
    expect(w.paths.stats.searches).toBe(1);
    // same cells again: served from the cache, identical
    expect(w.paths.find(a.x, a.z, b.x, b.z)).toEqual(p);
    expect(w.paths.stats.cacheHits).toBe(1);
    expect(w.paths.stats.searches).toBe(1);
  });

  it('a commander walks the path at motion.speed', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const v = w.commander(0)!;
    const goal = localFrame(w, 0, 1)(0, 60);
    const len = polylineLength(v.x, v.z, w.paths.find(v.x, v.z, goal.x, goal.z)!);
    w.step([c.move(0, [v.handle], goal.x, goal.z)]);
    const t = runUntil(w, () => v.orders.length === 0, 2000);
    expect(Math.abs(t / 10 - len / 1.7)).toBeLessThanOrEqual(0.3);
  });

  it('orders to unreachable places end: island build is rejected, a move onto a cliff stops nearby', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const v = w.commander(0)!;
    const home = w.paths.component(w.paths.cellOf(v.x, v.z));
    const island = w.map.spots.find((s) => s.kind === 'mass' && w.paths.component(w.paths.cellOf(s.x, s.z)) !== home)!;
    expect(island).toBeDefined();
    const e = w.spawn(0, ENG, v.x + 2, v.z);
    const cmd = c.build(0, [e], w.bpIndex(MEX), island.x, island.z);
    w.step([cmd]);
    run(w, 2);
    expect(w.unit(e)!.orders.length).toBe(0);
    expect(w.events[0]!.filter((x) => x.kind === 'commandRejected')).toEqual([
      { kind: 'commandRejected', tick: 0, seq: cmd.seq, reason: 'other', unit: e },
    ]);
    // a cliff cell next to the base: the unit walks to the nearest passable cell and the order ends
    let cliff = -1;
    const d = w.baseStatic.passDim;
    const c0 = w.paths.cellOf(v.x, v.z);
    for (let r = 1; r < 60 && cliff < 0; r++) {
      for (const k of [c0 + r, c0 - r, c0 + r * d, c0 - r * d]) {
        if (k >= 0 && k < d * d && w.paths.pass[k] === 0 && w.paths.component(w.paths.nearestPassable(w.paths.centerX(k), w.paths.centerZ(k))) === home) {
          cliff = k;
          break;
        }
      }
    }
    expect(cliff).toBeGreaterThanOrEqual(0);
    w.step([c.move(0, [e], w.paths.centerX(cliff), w.paths.centerZ(cliff))]);
    runUntil(w, () => w.unit(e)!.orders.length === 0, 2000);
    expect(w.unit(e)!.orders.length).toBe(0);
  });

  it('unreachable goals fail, blocked goals snap to the nearest passable cell', () => {
    const pass = new Uint8Array(32 * 32).fill(1);
    for (let z = 0; z < 32; z++) pass[z * 32 + 16] = 0; // wall at column 16
    const pf = new PathFinder(pass, 32, 2);
    expect(pf.find(4, 4, 60, 4)).toBeNull();
    const p = pf.find(4, 4, 33, 30)!; // cell (16, 15) is blocked → nearest passable
    expect(p).not.toBeNull();
    expect(pf.isPassableAt(p.at(-2)!, p.at(-1)!)).toBe(true);
    // corner cutting is not allowed
    const pass2 = new Uint8Array(4 * 4).fill(1);
    pass2[1 * 4 + 2] = 0;
    pass2[2 * 4 + 1] = 0;
    const pf2 = new PathFinder(pass2, 4, 2);
    expect(pf2.lineFree(3, 3, 5, 5)).toBe(false); // (1,1) and (2,2) only touch diagonally
    const around = pf2.find(3, 3, 5, 5)!;
    expect(polylineLength(3, 3, around)).toBeGreaterThan(Math.sqrt(8) + 1);
  });

  it('A* is deterministic and prefers the lower cell index on ties', () => {
    const pass = new Uint8Array(64 * 64).fill(1);
    for (let z = 10; z < 54; z++) pass[z * 64 + 32] = 0;
    const a = new PathFinder(pass.slice(), 64, 2).find(40, 64, 88, 64);
    const b = new PathFinder(pass.slice(), 64, 2).find(40, 64, 88, 64);
    expect(a).toEqual(b);
    expect(a!.length).toBeGreaterThan(2);
  });
});

describe('arena combat', () => {
  it('10 Punzen beat 7 Punzen', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const own: number[] = [];
    const foe: number[] = [];
    for (let i = 0; i < 10; i++) {
      const p = at(70, -9 + 2 * i);
      own.push(w.spawn(0, TANK, p.x, p.z));
    }
    for (let i = 0; i < 7; i++) {
      const p = at(120, -6 + 2 * i);
      foe.push(w.spawn(1, TANK, p.x, p.z));
    }
    const mid0 = at(130, 0);
    const mid1 = at(60, 0);
    w.step([c.attackMove(0, own, mid0.x, mid0.z), c.attackMove(1, foe, mid1.x, mid1.z)]);
    runUntil(w, () => foe.every((h) => w.unit(h) === null) || own.every((h) => w.unit(h) === null), 1500);
    const ownAlive = own.filter((h) => w.unit(h) !== null).length;
    const foeAlive = foe.filter((h) => w.unit(h) !== null).length;
    expect(foeAlive).toBe(0);
    // Lanchester square law: √(10² − 7²) ≈ 7 survivors, simplified model ⇒ at least 4
    expect(ownAlive).toBeGreaterThanOrEqual(4);
    const lost = w.events[0]!.filter((e) => e.kind === 'ownDestroyed').length;
    expect(lost).toBe(10 - ownAlive);
    const killed = w.events[0]!.filter((e) => e.kind === 'enemyDestroyed').length;
    expect(killed).toBe(7);
    expect(w.events[0]!.some((e) => e.kind === 'ownDamaged' && e.attacker !== 0 && e.attackerBp === w.bpIndex(TANK))).toBe(true);
  });

  it('commander death defeats the army and ends the match', () => {
    const w = setonsWorld();
    const v1 = w.commander(1)!;
    const tank = w.spawn(0, TANK, 100, 100);
    w.kill(v1.handle);
    expect(w.over).toBe(true);
    expect(w.winner).toBe(0);
    expect(w.defeated[1]).toBe(true);
    expect(w.unitsOf(1).length).toBe(0);
    expect(w.unit(tank)).not.toBeNull();
  });

  it('losing a generator exempts 60 s from the energy-stall statistic', () => {
    const w = setonsWorld();
    const at = localFrame(w, 0, 1)(-10, -8);
    const pg = w.spawn(0, 'core:str_t1_pgen', at.x, at.z);
    run(w, 5);
    w.kill(pg);
    const before = w.eco.statsOf(0).exemptTicks;
    run(w, 700);
    expect(w.eco.statsOf(0).exemptTicks - before).toBe(600);
  });
});

describe('arena vision', () => {
  it('sighting, ghost memory and seen/unseen destruction', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const mexPos = at(90, 0);
    const mex = w.spawn(1, MEX, mexPos.x, mexPos.z);
    run(w, 2);
    expect(w.unit(mex)!.seenMask & 1).toBe(0);
    expect(w.ghosts[0]!.has(mex)).toBe(false);
    const e = w.spawn(0, ENG, at(40, 0).x, at(40, 0).z);
    const near = at(80, 0);
    w.step([c.move(0, [e], near.x, near.z)]);
    runUntil(w, () => (w.unit(mex)!.seenMask & 1) !== 0, 600);
    expect(w.events[0]!.some((x) => x.kind === 'enemySighted' && x.id === mex)).toBe(true);
    expect(w.ghosts[0]!.get(mex)).toMatchObject({ bp: w.bpIndex(MEX), x: mexPos.x, z: mexPos.z, stale: false });
    // walk away: the ghost stays, the unit is no longer visible
    const back = at(30, 0);
    w.step([c.move(0, [e], back.x, back.z)]);
    runUntil(w, () => w.unit(e)!.orders.length === 0, 600);
    run(w, 2);
    expect(w.unit(mex)!.seenMask & 1).toBe(0);
    expect(w.ghosts[0]!.has(mex)).toBe(true);
    // destroyed unseen: ghost stays (stale) until the place is seen again
    w.kill(mex);
    run(w, 2);
    expect(w.ghosts[0]!.get(mex)?.stale).toBe(true);
    expect(w.events[0]!.some((x) => x.kind === 'enemyDestroyed')).toBe(false);
    w.step([c.move(0, [e], near.x, near.z)]);
    runUntil(w, () => !w.ghosts[0]!.has(mex), 600);
    expect(w.ghosts[0]!.has(mex)).toBe(false);
  });

  it('seen destruction removes the ghost with an enemyDestroyed event; no radar in the arena', () => {
    const w = setonsWorld();
    const at = localFrame(w, 0, 1);
    const p = at(20, 0);
    const mex = w.spawn(1, MEX, p.x, p.z);
    run(w, 2);
    expect(w.ghosts[0]!.has(mex)).toBe(true);
    w.kill(mex);
    expect(w.ghosts[0]!.has(mex)).toBe(false);
    expect(w.events[0]!.filter((x) => x.kind === 'enemyDestroyed').length).toBe(1);
    // a Funke has radar 40 in the roster, the arena ignores it (MS9 core without radar)
    const far = at(31, 25);
    const tank = w.spawn(1, TANK, far.x, far.z);
    w.spawn(0, 'core:lnd_t1_scout', at(0, 25).x, at(0, 25).z);
    run(w, 2);
    expect(w.unit(tank)!.seenMask & 1).toBe(0);
  });
});
