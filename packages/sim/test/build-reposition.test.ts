import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { CmdFlags, encodeBuild, Op, type CommandEnvelope } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { createWorld, MoverState, step, UnitBits, type World } from '../src/index.ts';
import { economyPhase } from '../src/economy.ts';
import { queueLength } from '../src/orders.ts';
import { spawnUnit } from '../src/units.ts';
import { gameTable, nextSeq } from './support/fixtures.ts';

function command(world: World, units: readonly number[], op: Op, payload: Uint8Array, flags = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(0), seq: nextSeq(0), op, flags,
    units: units.map(unit => world.units.handle(unit) as Handle), payload };
}

describe('construction after a working builder is displaced', () => {
  it('recovers real separation beyond build range and completes the shared head after its peer dies', () => {
    const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 7, armyCount: 2, mapSizeWu: 64 });
    const U = world.units.col, M = world.movers.col;
    spawnUnit(world, bp.indexOf('core:cmd_commander'), 0, fx(4.5), fx(4.5), 0);
    const engineers = [
      spawnUnit(world, bp.indexOf('core:eng_t1'), 0, fx(15.501), fx(20.49), 0),
      spawnUnit(world, bp.indexOf('core:eng_t1'), 0, fx(15.501), fx(20.51), 0),
    ];
    const primary = engineers[0]!, survivor = engineers[1]!, factoryBp = bp.indexOf('core:fac_land_t1');
    const range = bp.buildRangeRawCol[bp.indexOf('core:eng_t1')]!;
    const distanceSquared = (unit: number): number => (U.x[unit]! - fx(20.5)) ** 2 + (U.z[unit]! - fx(20.5)) ** 2;
    expect(engineers.every(unit => distanceSquared(unit) <= range ** 2)).toBe(true);
    world.armies.col.massStored.set(0, 650000);
    world.armies.col.energyStored.set(0, 3900000);
    const builds = Array.from({ length: 20 }, (_, i) => command(world, engineers, Op.Build,
      encodeBuild({ bp: factoryBp, yaw: 0, x: fx(20.5 + i % 5 * 7), z: fx(20.5 + Math.floor(i / 5) * 7) }), CmdFlags.Queue));
    step(world, builds);
    const targetHandle = U.buildTarget[primary]!, site = world.units.resolve(targetHandle);
    expect(site).toBeGreaterThanOrEqual(0);
    expect(U.buildTarget[survivor]).toBe(targetHandle);
    expect(U.buildDone.get(site)).toBeGreaterThan(0);
    expect(world.frameFlowContributor[primary]).toBe(1);
    expect(world.frameFlowContributor[survivor]).toBe(1);

    // Normal Movement separation of the two 0.4WU-radius engineers, without changing
    // their blueprint/range or disabling any physics, moves both just beyond 5WU.
    for (let tick = 0; tick < 8 && !engineers.every(unit => distanceSquared(unit) > range ** 2); tick++) step(world);
    expect(engineers.every(unit => distanceSquared(unit) > range ** 2)).toBe(true);
    expect(engineers.every(unit => M.state[U.mover[unit]!] === MoverState.Idle)).toBe(true);
    expect(engineers.map(unit => queueLength(world, unit))).toEqual([20, 20]);
    const head = U.orderHead[survivor]!, progress = U.buildDone.get(site);
    // This is the lost-contribution state: before another Orders phase can recover it,
    // the unmodified economy excludes both out-of-range builders and cannot advance it.
    economyPhase(world);
    expect(world.frameFlowContributor[primary]).toBe(0);
    expect(world.frameFlowContributor[survivor]).toBe(0);
    expect(world.frameFlowPower.get(site)).toBe(0);
    expect(U.buildDone.get(site)).toBe(progress);

    step(world, [command(world, [primary], Op.SelfDestruct, new Uint8Array(0))]);
    expect(world.units.isLive(primary)).toBe(false);
    expect(U.orderHead[survivor]).toBe(head);
    expect(U.buildTarget[survivor]).toBe(targetHandle);
    expect(M.state[U.mover[survivor]!]).toBe(MoverState.Moving);
    let contributed = false;
    for (let tick = 0; tick < 900 && U.orderHead[survivor] === head; tick++) {
      step(world);
      contributed ||= world.frameFlowContributor[survivor] === 1;
    }
    expect(contributed).toBe(true);
    expect(world.units.resolve(targetHandle)).toBe(site);
    expect(U.buildDone.get(site)).toBe(65536);
    expect(U.flags[site]! & UnitBits.UnderConstruction).toBe(0);
    expect(U.orderHead[survivor]).not.toBe(head);
    expect(queueLength(world, survivor)).toBe(19);
  });
});
