import { describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { createRtsMap, readAllCommands, readRtsReplay } from '@faf/formats';
import { decodeBatch, encodeBuild, encodeTogglePause, Op, type CommandEnvelope } from '@faf/protocol';
import { snapshot, unitHandles } from '@faf/sim';
import { convertCommandLog, HeadlessSim, parseCommandLog, replayLog, ReplayPlayer } from '../src/index.ts';

function equalArena(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength);
  // Compare every byte through native Buffer comparison, avoiding per-byte assertion recursion.
  expect(Buffer.compare(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength), Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))).toBe(0);
}

describe('constructed extractor upgrade recording and replay', () => {
  it('builds on a real mass spot, records paid upgrade/pause/resume and reproduces the complete arena after rewind', async () => {
    const simBin = (await compileContent({ includeTest: true })).simBin;
    const map = createRtsMap({ sizeWu: 64, name: 'extractor-upgrade-replay', starts: [
      { army: 0, x: fx(8), z: fx(8) }, { army: 1, x: fx(56), z: fx(56) },
    ], spots: [{ kind: 'mass', x: fx(12), z: fx(8) }] });
    const sim = new HeadlessSim({ simBin, map, seed: 93, armyCount: 2, playerArmy: 0, initialization: { kind: 'skirmish', faction: 0 }, keyframes: false });
    const initialHash = sim.fullHash(), commander = unitHandles(sim.world, 0)[0]!;
    let seq = 0;
    const submit = (handle: number, op: Op, payload: Uint8Array): void => {
      const c: CommandEnvelope = { tick: asTick(0), army: asArmyId(0), seq: ++seq, op, flags: 0, units: [handle as Handle], payload };
      sim.submit([c]); sim.step();
    };
    const t1 = sim.world.bp.indexOf('core:str_t1_mex'), t2 = sim.world.bp.indexOf('core:str_t2_mex');
    submit(commander, Op.Build, encodeBuild({ bp: t1, yaw: 0, x: fx(12), z: fx(8) }));
    let u = -1;
    while (sim.tick < 300) {
      u = Array.from(unitHandles(sim.world, 0)).map(h => sim.world.units.resolve(h)).find(i => sim.world.units.col.bp[i] === t1) ?? -1;
      if (u >= 0 && sim.world.units.col.buildDone.get(u) === 65536) break;
      sim.step();
    }
    expect(u).toBeGreaterThanOrEqual(0); expect(sim.world.units.col.buildDone.get(u)).toBe(65536);
    const handle = sim.world.units.handle(u), U = sim.world.units.col;
    const pose = [U.x[u], U.y[u], U.z[u], U.yaw[u]], count = sim.world.armies.col.unitCount[0];
    const footprint = sim.world.nav.st.foot.slice();
    const payload = new Uint8Array(2); new DataView(payload.buffer).setUint16(0, t2, true);
    submit(handle, Op.Upgrade, payload);
    expect(U.bp[u]).toBe(t1); expect(U.repairDone.get(u)).toBeGreaterThan(0); expect(U.repairPaidMass.get(u)).toBeGreaterThan(0);
    sim.step(30); submit(handle, Op.TogglePause, encodeTogglePause(true));
    const progress = U.repairDone.get(u); sim.step(5); expect(U.repairDone.get(u)).toBe(progress);
    submit(handle, Op.TogglePause, encodeTogglePause(false));
    const checkpointTick = sim.tick, checkpoint = snapshot(sim.world), checkpointHash = sim.fullHash();
    while (U.bp[u] !== t2 && sim.tick < 3000) sim.step();
    expect(U.bp[u]).toBe(t2); sim.step();
    expect(witness()).toEqual({ handle, pose, count, hp: 2100, income: 600 });
    equalArena(sim.world.nav.st.foot, footprint);
    const final = snapshot(sim.world), finalHash = sim.fullHash(), finalRule = sim.ruleHash();
    function witness() { return { handle: sim.world.units.handle(u), pose: [U.x[u], U.y[u], U.z[u], U.yaw[u]], count: sim.world.armies.col.unitCount[0], hp: U.hp[u], income: sim.world.bp.massIncomeMilliPerTickCol[U.bp[u]!] }; }
    const bytes = sim.exportLog(), log = parseCommandLog(bytes);
    expect(log.tainted).toBe(false);
    const recorded = log.commands.flatMap(e => decodeBatch(log.bytes.subarray(e.offset, e.offset + e.length)));
    expect(recorded.map(c => c.op)).toEqual([Op.Build, Op.Upgrade, Op.TogglePause, Op.TogglePause]);
    expect(recorded[1]).toMatchObject({ army: 0, seq: 2, units: [handle], payload });
    const durable = replayLog(bytes, { simBin, map, keyframes: false });
    expect(durable.mismatches).toEqual([]); equalArena(snapshot(durable.sim.world), final);
    expect([durable.sim.fullHash(), durable.sim.ruleHash()]).toEqual([finalHash, finalRule]);
    const converted = convertCommandLog(bytes, { simBin, map }); expect(converted.verified).toBe(true); expect(converted.mismatches).toEqual([]);
    const replay = readRtsReplay(converted.bytes);
    expect(readAllCommands(replay).flatMap(e => decodeBatch(e.batch))).toEqual(recorded);
    const player = ReplayPlayer.open(replay, { simBin, map, keyframes: false });
    expect(player.fullHash()).toBe(initialHash); player.runUntil(checkpointTick);
    equalArena(snapshot(player.world), checkpoint); expect(player.fullHash()).toBe(checkpointHash);
    const result = player.playToEnd(); expect(result.complete).toBe(true); expect(result.tainted).toBe(false); expect(result.divergences).toEqual([]);
    equalArena(snapshot(player.world), final); expect([result.fullHash, result.ruleHash]).toEqual([finalHash, finalRule]);
    player.seek(0); expect(player.fullHash()).toBe(initialHash); expect(player.playToEnd().fullHash).toBe(finalHash);
    expect(player.divergences).toEqual([]);
  });
});
