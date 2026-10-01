import { describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { createRtsMap, readAllCommands, readRtsReplay } from '@faf/formats';
import { decodeBatch, Op, type CommandEnvelope } from '@faf/protocol';
import { unitHandles, type World } from '@faf/sim';
import { convertCommandLog, HeadlessSim, parseCommandLog, replayLog, ReplayPlayer } from '../src/index.ts';
import { gameSimBin } from './support/fixtures.ts';

/** Observable gameplay state alongside both hashes; no direct arena mutations seed this fixture. */
function commanderState(w: World, handle: number) {
  const u = w.units.resolve(handle), U = w.units.col, A = w.armies.col, bp = U.bp[u]!;
  return {
    tick: w.tick, handle: w.units.handle(u), blueprint: w.bp.ids[bp],
    hp: U.hp[u], maxHp: w.bp.maxHpCol[bp], buildPower: w.bp.buildPowerQ16PerTickCol[bp],
    position: [U.x[u], U.y[u], U.z[u], U.yaw[u]],
    progress: U.repairDone.get(u), paidMass: U.repairPaidMass.get(u), paidEnergy: U.repairPaidEnergy.get(u),
    orderHead: U.orderHead[u], ackSeq: A.lastAckSeq[0],
    massStored: A.massStored.get(0), energyStored: A.energyStored.get(0),
  };
}

describe('commander upgrade through recorded simulation and replay', () => {
  it('records a real paid Upgrade command and reproduces progress, completion and exact final hashes after rewind', () => {
    const simBin = gameSimBin();
    // Starts keep the commanders out of weapon range throughout this stationary upgrade.
    const map = createRtsMap({ sizeWu: 64, name: 'commander-upgrade-replay', starts: [
      { army: 0, x: fx(8), z: fx(8) }, { army: 1, x: fx(56), z: fx(56) },
    ] });
    const initialization = { kind: 'skirmish' as const, faction: 0 };
    const sim = new HeadlessSim({ simBin, map, seed: 93, armyCount: 2, playerArmy: 0, initialization, keyframes: false });
    const handle = unitHandles(sim.world, 0)[0]!, u = sim.world.units.resolve(handle);
    const initial = commanderState(sim.world, handle), initialHash = sim.fullHash();
    expect(initial.blueprint).toBe('core:cmd_commander');
    expect([initial.massStored, initial.energyStored]).toEqual([650000, 3900000]);
    const target = sim.world.bp.indexOf('core:cmd_commander_engineering');
    expect(target).toBeGreaterThanOrEqual(0);
    const payload = new Uint8Array(2); new DataView(payload.buffer).setUint16(0, target, true);
    const command: CommandEnvelope = {
      tick: asTick(0), army: asArmyId(0), seq: 1, op: Op.Upgrade, flags: 0,
      units: [handle as Handle], payload,
    };
    sim.submit([command]); sim.step();
    expect(sim.world.armies.col.lastAckSeq[0]).toBe(1);
    expect(sim.world.units.col.bp[u]).toBe(sim.world.bp.indexOf('core:cmd_commander'));
    expect(sim.world.units.col.repairDone.get(u)).toBeGreaterThan(0);
    expect(sim.world.units.col.repairPaidMass.get(u)).toBeGreaterThan(0);
    let spentMass: number = sim.world.armies.col.massSpent.get(0), spentEnergy: number = sim.world.armies.col.energySpent.get(0);
    while (sim.tick < 300) {
      sim.step(); spentMass += sim.world.armies.col.massSpent.get(0); spentEnergy += sim.world.armies.col.energySpent.get(0);
    }
    const midway = commanderState(sim.world, handle), midwayFullHash = sim.fullHash(), midwayRuleHash = sim.ruleHash();
    expect(midway.blueprint).toBe('core:cmd_commander'); expect(midway.progress).toBe(32768);
    expect([midway.paidMass, midway.paidEnergy]).toEqual([150000, 1500000]);
    while (sim.world.units.col.bp[u] !== target && sim.tick < 700) {
      sim.step(); spentMass += sim.world.armies.col.massSpent.get(0); spentEnergy += sim.world.armies.col.energySpent.get(0);
    }
    expect(sim.tick).toBe(600);
    expect([spentMass, spentEnergy]).toEqual([300000, 3000000]);
    expect(sim.world.units.col.bp[u]).toBe(target);
    sim.step(); // The completed order leaves the queue through the ordinary Orders phase.
    const final = commanderState(sim.world, handle), finalFullHash = sim.fullHash(), finalRuleHash = sim.ruleHash();
    expect(final.handle).toBe(initial.handle); expect(final.position).toEqual(initial.position);
    expect([final.hp, final.maxHp, final.buildPower, final.orderHead]).toEqual([16000, 16000, 131072, -1]);
    expect([final.massStored, final.energyStored]).toEqual([410100, 2102000]);

    const bytes = sim.exportLog(), log = parseCommandLog(bytes);
    expect(log.tainted).toBe(false); expect(log.header.initialization).toEqual(initialization);
    const recorded = log.commands.flatMap(entry => decodeBatch(log.bytes.subarray(entry.offset, entry.offset + entry.length)));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ tick: 1, army: 0, seq: 1, op: Op.Upgrade, flags: 0, units: [handle] });
    expect(recorded[0]!.payload).toEqual(payload);
    const durable = replayLog(bytes, { simBin, map, keyframes: false });
    expect(durable.mismatches).toEqual([]);
    expect(commanderState(durable.sim.world, handle)).toEqual(final);
    expect([durable.sim.fullHash(), durable.sim.ruleHash()]).toEqual([finalFullHash, finalRuleHash]);

    const converted = convertCommandLog(bytes, { simBin, map });
    expect(converted.verified).toBe(true); expect(converted.mismatches).toEqual([]);
    const replay = readRtsReplay(converted.bytes);
    expect(readAllCommands(replay).flatMap(entry => decodeBatch(entry.batch))).toEqual(recorded);
    const player = ReplayPlayer.open(replay, { simBin, map, keyframes: false });
    expect(player.fullHash()).toBe(initialHash);
    player.runUntil(300);
    expect(commanderState(player.world, handle)).toEqual(midway);
    expect([player.fullHash(), player.ruleHash()]).toEqual([midwayFullHash, midwayRuleHash]);
    const result = player.playToEnd();
    expect(result.divergences).toEqual([]); expect(result.tainted).toBe(false); expect(result.complete).toBe(true);
    expect(result.compared).toBeGreaterThan(0); expect(result.subCompared).toBeGreaterThan(0);
    expect(commanderState(player.world, handle)).toEqual(final);
    expect([result.fullHash, result.ruleHash]).toEqual([finalFullHash, finalRuleHash]);
    player.seek(0); expect(commanderState(player.world, handle)).toEqual(initial); expect(player.fullHash()).toBe(initialHash);
    player.runUntil(300); expect(commanderState(player.world, handle)).toEqual(midway);
    expect(player.playToEnd().fullHash).toBe(finalFullHash); expect(player.ruleHash()).toBe(finalRuleHash);
    expect(player.divergences).toEqual([]);
  });
});
