import { describe, expect, it } from 'vitest';
import {
  canPlaceKnown,
  HEADER_BYTES,
  OrderKind,
  PerceptionWriter,
  placementContext,
  readSnapshotHeader,
  SnapshotPerception,
  type KnownUnit,
  type OwnUnit,
  type PerceptionEvent,
} from '../src/index.ts';
import { FakeWorld, flatStatic } from '../src/testing/index.ts';
import { loadRoster, loadStatic } from './support/fixtures.ts';

const T = loadRoster();
const idx = (id: string): number => T.byId(id)!.index;

const OWN: OwnUnit = {
  handle: 0x00100005,
  bp: idx('core:lnd_t1_engineer'),
  x: 12.25,
  z: 99.5,
  hpFrac: 0.75,
  buildFrac: 1,
  complete: true,
  order: OrderKind.Build,
  orderTarget: 0x00200009,
  orderBp: idx('core:str_t1_mex'),
  orderX: 20.5,
  orderZ: 30,
  queueLength: 2,
  factoryBp: -1,
  factoryProgress: 0,
  factoryRepeat: false,
  upgradingTo: -1,
  lastDamagedTick: 1234,
};
const FAC: OwnUnit = {
  ...OWN,
  handle: 7,
  bp: idx('core:str_t1_fac_land'),
  order: OrderKind.Idle,
  orderTarget: 0,
  orderBp: -1,
  factoryBp: idx('core:lnd_t1_tank'),
  factoryProgress: 0.4,
  factoryRepeat: true,
  upgradingTo: idx('core:str_t2_fac_land'),
  complete: false,
  buildFrac: 0.5,
  lastDamagedTick: -1,
};
const ENEMY: KnownUnit = { id: 0x00300001, army: 1, kind: 'visible', bp: idx('core:lnd_t1_tank'), x: 400.125, z: 300, hpFrac: 0.5, lastSeenTick: 100 };
const GHOST: KnownUnit = { id: 42, army: 1, kind: 'ghost', bp: idx('core:str_t1_mex'), x: 50, z: 60, hpFrac: 0.2, lastSeenTick: 50 };
const BLIP: KnownUnit = { id: 43, army: 1, kind: 'blip', bp: -1, x: 1, z: 2, hpFrac: 1, lastSeenTick: 100 };
const EVENTS: PerceptionEvent[] = [
  { kind: 'ownDamaged', tick: 99, unit: 7, attacker: 0x00300001, attackerBp: idx('core:lnd_t1_tank'), amount: 23.5 },
  { kind: 'ownDestroyed', tick: 99, unit: 8, bp: idx('core:lnd_t1_engineer') },
  { kind: 'ownCompleted', tick: 100, unit: 7, bp: idx('core:str_t1_fac_land') },
  { kind: 'enemySighted', tick: 100, id: 0x00300001, army: 1, bp: idx('core:lnd_t1_tank') },
  { kind: 'enemyDestroyed', tick: 100, id: 44, army: 1, bp: -1 },
  { kind: 'commandRejected', tick: 100, seq: 65535, reason: 'placement', unit: 0x00100005 },
];

function write(w: PerceptionWriter, own: OwnUnit[], known: KnownUnit[], events: PerceptionEvent[]): Uint8Array {
  w.begin(100, 0).setEco({
    massIncome: 5,
    energyIncome: 60.5,
    energyUpkeep: 4,
    massStored: 300,
    energyStored: 2000,
    massCapacity: 650,
    energyCapacity: 3900,
    massRatio: 1,
    energyRatio: 0.5,
    massDemand: 8,
    energyDemand: 70,
  });
  for (const u of own) w.addOwn(u);
  for (const k of known) w.addKnown(k);
  for (const e of events) w.addEvent(e);
  return w.finish().slice();
}

describe('perception snapshot', () => {
  const s = flatStatic({ bps: T, sizeWu: 512 });

  it('roundtrips every field and is byte-deterministic', () => {
    const w = new PerceptionWriter();
    const bytes = write(w, [OWN, FAC], [ENEMY, GHOST, BLIP], EVENTS);
    expect(bytes.length).toBe(HEADER_BYTES + 2 * 80 + 3 * 40 + 6 * 32);
    expect(readSnapshotHeader(bytes)).toMatchObject({ version: 1, army: 0, tick: 100, own: 2, known: 3, events: 6 });
    const again = write(new PerceptionWriter(), [OWN, FAC], [ENEMY, GHOST, BLIP], EVENTS);
    expect(again).toEqual(bytes);
    // writer reuse after growth keeps bytes identical
    write(w, Array.from({ length: 200 }, (_, i) => ({ ...OWN, handle: i + 1 })), [], []);
    expect(write(w, [OWN, FAC], [ENEMY, GHOST, BLIP], EVENTS)).toEqual(bytes);

    const v = new SnapshotPerception(s, bytes);
    expect(v.tick).toBe(100);
    expect(v.army).toBe(0);
    expect(v.ownCount).toBe(2);
    expect(v.knownEnemyCount).toBe(3);
    expect(v.eco()).toMatchObject({ energyIncome: 60.5, energyRatio: 0.5, energyDemand: 70 });
    const own: OwnUnit[] = [];
    v.forEachOwn(null, (u) => own.push({ ...u }));
    expect(own).toEqual([OWN, FAC]);
    const known: KnownUnit[] = [];
    v.forEachKnownEnemy(null, (u) => known.push({ ...u }));
    expect(known).toEqual([ENEMY, { ...GHOST, hpFrac: 1 }, BLIP]);
    const events: PerceptionEvent[] = [];
    v.forEachEvent((e) => events.push(e));
    expect(events).toEqual(EVENTS);
  });

  it('filters by category; blips only match a null filter', () => {
    const v = new SnapshotPerception(s, write(new PerceptionWriter(), [OWN, FAC], [ENEMY, GHOST, BLIP], []));
    const structures: number[] = [];
    v.forEachOwn(T.compile('STRUCTURE'), (u) => structures.push(u.handle));
    expect(structures).toEqual([7]);
    const mobile: number[] = [];
    v.forEachKnownEnemy(T.compile('MOBILE'), (u) => mobile.push(u.id));
    expect(mobile).toEqual([ENEMY.id]);
  });

  it('rejects bad snapshots and a foreign army', () => {
    const bytes = write(new PerceptionWriter(), [OWN], [], []);
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => new SnapshotPerception(s, bad)).toThrow(/magic/);
    expect(() => new SnapshotPerception(s, bytes.subarray(0, bytes.length - 1))).toThrow(/length/);
    expect(() => new SnapshotPerception({ ...s, army: 1 }, bytes)).toThrow(/army/);
    expect(() => new PerceptionWriter().addOwn(OWN)).toThrow(/begin/);
    expect(() => new PerceptionWriter().begin(0, 0).addKnown({ ...BLIP, bp: 3 })).toThrow(/blips/);
  });
});

describe('canPlaceKnown / freeMassSpots — known occupancy only (AI-PERC-02, unit part)', () => {
  const s = flatStatic({
    bps: T,
    sizeWu: 256,
    spots: [
      { kind: 'mass', x: 100, z: 100 },
      { kind: 'mass', x: 140, z: 100 },
      { kind: 'hydro', x: 60, z: 180 },
    ],
    blocked: (cx, cz) => cx === 100 && cz >= 10 && cz < 20,
    height: (cx, cz) => (cx >= 110 && cz < 5 ? cx - 110 : 0),
  });
  const pgen = idx('core:str_t1_pgen');
  const mex = idx('core:str_t1_mex');
  const fac = idx('core:str_t1_fac_land');
  const hydro = idx('core:str_t1_hydro');

  it('terrain, map bounds, spots and footprint overlaps', () => {
    const ctx = placementContext(s);
    expect(canPlaceKnown(ctx, [], pgen, 50, 50, 0)).toBe(true);
    expect(canPlaceKnown(ctx, [], pgen, 0.5, 50, 0)).toBe(false); // outside the map
    expect(canPlaceKnown(ctx, [], pgen, 201, 30, 0)).toBe(false); // blocked cell column x = 200..202
    expect(canPlaceKnown(ctx, [], fac, 240, 4, 0)).toBe(false); // height span > 1 WU
    expect(canPlaceKnown(ctx, [], mex, 100, 100, 0)).toBe(true);
    expect(canPlaceKnown(ctx, [], mex, 100.5, 99.5, 0)).toBe(true); // ±1 WU on the spot
    expect(canPlaceKnown(ctx, [], mex, 103, 100, 0)).toBe(false); // off-spot
    expect(canPlaceKnown(ctx, [], hydro, 60, 180, 0)).toBe(true);
    expect(canPlaceKnown(ctx, [], mex, 60, 180, 0)).toBe(false); // wrong spot kind
    expect(canPlaceKnown(ctx, [], pgen, 101, 100, 0)).toBe(false); // non-extractor on a spot
    const known = [{ bp: fac, x: 50, z: 50 }];
    expect(canPlaceKnown(ctx, known, pgen, 50, 50, 0)).toBe(false);
    expect(canPlaceKnown(ctx, known, pgen, 55, 50, 0)).toBe(true); // touching edge = adjacency
    expect(canPlaceKnown(ctx, known, pgen, 54.9, 50, 0)).toBe(false);
    expect(canPlaceKnown(ctx, [], idx('core:lnd_t1_tank'), 50, 50, 0)).toBe(false); // not a structure
    expect(canPlaceKnown(ctx, [], pgen, 50, 50, 4)).toBe(false);
  });

  it('a hidden enemy mex changes nothing; the ghost of a seen one occupies the spot', () => {
    const world = new FakeWorld(s);
    world.addOwn('core:lnd_t1_engineer', 90, 90);
    const noEnemy = world.perceive();
    // "In the fog": the sim knows the enemy mex, but it is not in the perception.
    const inFog = world.perceive();
    expect(inFog.freeMassSpots()).toEqual(noEnemy.freeMassSpots());
    expect(noEnemy.freeMassSpots().map((sp) => sp.index)).toEqual([0, 1]);
    for (const [x, z] of [
      [100, 100],
      [140, 100],
      [120, 120],
    ] as const) {
      expect(inFog.canPlace(mex, x, z, 0)).toBe(noEnemy.canPlace(mex, x, z, 0));
    }
    // Seen by the engineer: now a ghost structure in the perception ⇒ spot occupied, replanning.
    world.addEnemy('core:str_t1_mex', 100, 100, { kind: 'ghost' });
    const seen = world.perceive();
    expect(seen.freeMassSpots().map((sp) => sp.index)).toEqual([1]);
    expect(seen.canPlace(mex, 100, 100, 0)).toBe(false);
    expect(seen.canPlace(mex, 140, 100, 0)).toBe(true);
    // Own construction sites occupy as well; mobile units never block.
    world.addOwn('core:str_t1_mex', 140, 100, { complete: false });
    world.addEnemy('core:lnd_t1_tank', 60, 180);
    const v = world.perceive();
    expect(v.freeMassSpots()).toEqual([]);
    expect(v.freeHydroSpots().map((sp) => sp.index)).toEqual([2]);
  });

  it('real map: fac1 slot of the Setons base is placeable, the start ring spots are free', () => {
    const st = loadStatic('setons', 0);
    const w = new FakeWorld(st);
    w.addOwn('core:cmd_commander', 354, 678);
    const v = w.perceive();
    expect(v.freeMassSpots().length).toBe(108);
    expect(v.canPlace(mex, 338, 678, 0)).toBe(true);
    expect(v.canPlace(fac, 354 + 0.7 * 12, 678 - 0.72 * 12, 0)).toBe(true);
  });
});
