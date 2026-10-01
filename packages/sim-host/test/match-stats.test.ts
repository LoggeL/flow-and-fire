import { afterEach, describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { createRtsMap, readRtsReplay, writeRtsMap } from '@faf/formats';
import { Op, type CommandEnvelope, type MatchStatsMsg } from '@faf/protocol';
import { hasMatchEnded, unitHandles, UnitBits, type World } from '@faf/sim';
import { convertCommandLog, HeadlessSim, MatchStats, ReplayPlayer } from '../src/index.ts';
import { bufferOf, gameSimBin } from './support/fixtures.ts';
import { makeTestHost, type TestHost } from './support/host.ts';

const SPOT = { kind: 'mass' as const, x: fx(22), z: fx(10) };
const map = createRtsMap({ sizeWu: 64, name: 'match-stats', starts: [{ army: 0, x: fx(10), z: fx(10) }, { army: 1, x: fx(54), z: fx(54) }], spots: [SPOT] });
const init = { kind: 'skirmish' as const, faction: 0 };
let seq = 0;
function cmd(op: Op, units: readonly number[], payload: Uint8Array, army = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: ++seq, op, flags: 0, units: units as Handle[], payload };
}
function build(w: World, builder: number, id: string, x: number, z: number): CommandEnvelope {
  const payload = new Uint8Array(12), dv = new DataView(payload.buffer);
  dv.setUint16(0, w.bp.indexOf(id), true); dv.setUint16(2, 0, true); dv.setInt32(4, x, true); dv.setInt32(8, z, true);
  return cmd(Op.Build, [builder], payload);
}
function finished(w: World, id: string): number {
  const bp = w.bp.indexOf(id), U = w.units.col; let n = 0;
  for (let u = 0; u < w.units.highWater; u++) if (w.units.isLive(u) && U.bp[u] === bp && (U.flags[u]! & UnitBits.UnderConstruction) === 0) n++;
  return n;
}

/** A real short match: ACU builds an extractor and a factory, then the player surrenders. */
function playMatch() {
  seq = 0;
  const simBin = gameSimBin(), sim = new HeadlessSim({ simBin, map, seed: 31, armyCount: 2, playerArmy: 0, initialization: init, keyframes: false });
  const w = sim.world, stats = new MatchStats(2), acu = unitHandles(w, 0)[0]!;
  const ledger = { income: 0, spent: 0, overflow: 0, stored0: w.armies.col.massStored.get(0) };
  const step = (commands: CommandEnvelope[] = []) => {
    if (commands.length) sim.submit(commands);
    sim.step(); stats.observe(w);
    ledger.income += w.armies.col.massIncome.get(0); ledger.spent += w.armies.col.massSpent.get(0); ledger.overflow += w.armies.col.massOverflow.get(0);
  };
  step([build(w, acu, 'core:str_t1_mex', SPOT.x, SPOT.z), { ...build(w, acu, 'core:fac_land_t1', fx(18) + 2048, fx(20) + 2048), flags: 1 }]);
  for (let n = 0; n < 900 && finished(w, 'core:fac_land_t1') === 0; n++) step();
  expect(finished(w, 'core:str_t1_mex')).toBe(1); expect(finished(w, 'core:fac_land_t1')).toBe(1);
  const own = unitHandles(w, 0);
  step([cmd(Op.SelfDestruct, own, new Uint8Array(0))]);
  for (let n = 0; n < 200 && !hasMatchEnded(w); n++) step();
  expect(hasMatchEnded(w)).toBe(true);
  stats.settle(w);
  return { sim, simBin, stats: stats.snapshot(), ledger, ownBefore: own.length, w };
}

describe('authoritative match statistics', () => {
  it('sums committed economy ticks and counts the tick events of a real match', () => {
    const { stats, ledger, ownBefore, w } = playMatch();
    expect(stats.complete).toBe(true); expect(stats.fromTick).toBe(1); expect(stats.toTick).toBe(w.tick);
    const [player, ai] = stats.armies;
    // The counter is the exact sum of the World's per-tick values (milli units → whole units).
    expect(player!.massProduced).toBe(Math.floor(ledger.income / 1000));
    expect(player!.massSpent).toBe(Math.floor(ledger.spent / 1000));
    // Independent ledger check: storage change = income − spending − overflow.
    expect(ledger.income - ledger.spent - ledger.overflow).toBe(w.armies.col.massStored.get(0) - ledger.stored0);
    expect(player).toMatchObject({ unitsBuilt: 0, structuresBuilt: 2, unitsLost: ownBefore });
    expect(player!.massBuilt).toBe(w.bp.massCostCol[w.bp.indexOf('core:str_t1_mex')]! + w.bp.massCostCol[w.bp.indexOf('core:fac_land_t1')]!);
    expect(player!.firstFactoryTick).not.toBeNull(); expect(player!.commanderLostTick).not.toBeNull();
    expect(ai).toMatchObject({ unitsBuilt: 0, structuresBuilt: 0, unitsLost: 0, firstFactoryTick: null, commanderLostTick: null });
    expect(player!.massIncomeSeries.length).toBe(Math.floor(w.tick / 100));
  });

  it('is reproduced exactly from the recorded commands, without touching hashes or layout', () => {
    const { sim, simBin, stats } = playMatch();
    const converted = convertCommandLog(sim.exportLog(), { simBin, map });
    expect(converted.verified).toBe(true);
    const player = ReplayPlayer.open(readRtsReplay(converted.bytes), { simBin, map, keyframes: false }), replayed = new MatchStats(2);
    while (player.tick < player.endTick) { player.step(); replayed.observe(player.world); }
    replayed.settle(player.world);
    expect(player.result().divergences).toEqual([]);
    expect(replayed.snapshot()).toEqual(stats);
  });

  it('marks re-observed or skipped ticks as incomplete rather than double counting', () => {
    const sim = new HeadlessSim({ simBin: gameSimBin(), map, seed: 5, armyCount: 2, playerArmy: 0, initialization: init, keyframes: false });
    const stats = new MatchStats(2);
    sim.step(); stats.observe(sim.world); const once = stats.snapshot();
    stats.observe(sim.world); expect(stats.snapshot().complete).toBe(false);
    expect(stats.snapshot().armies[0]!.massProduced).toBe(once.armies[0]!.massProduced);
  });
});

describe('host delivery', () => {
  let h: TestHost | null = null;
  afterEach(() => { h?.close(); h = null; });
  it('posts the totals once, only after the match ended', () => {
    const bytes = writeRtsMap(map), buffer = bytes.slice().buffer;
    h = makeTestHost({ map: buffer, initialization: init });
    h.wake.advance(300);
    expect(h.of('matchStats' as never)).toHaveLength(0);
    const own = unitHandles(h.host.core.world, 0);
    h.host.submit(bufferOf([{ tick: asTick(0), army: asArmyId(0), seq: 1, op: Op.SelfDestruct, flags: 0, units: own as Handle[], payload: new Uint8Array(0) }]));
    h.wake.advance(3000);
    const posted = h.msgs.filter(m => m.t === 'matchStats') as MatchStatsMsg[];
    expect(posted).toHaveLength(1);
    expect(hasMatchEnded(h.host.core.world)).toBe(true);
    expect(posted[0]!.stats.armies[0]).toMatchObject({ unitsLost: own.length });
    expect(posted[0]!.stats.armies[0]!.commanderLostTick).not.toBeNull();
    h.wake.advance(1000);
    expect(h.msgs.filter(m => m.t === 'matchStats')).toHaveLength(1);
  });
});
