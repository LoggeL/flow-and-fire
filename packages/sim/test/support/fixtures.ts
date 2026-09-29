import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileBlueprints, decodeSimBin, defineUnit, type SimBpTable } from '@faf/blueprints';
import {
  CommandBatchEncoder,
  encodeCheatKill,
  encodeCheatSpawn,
  encodeMove,
  Op,
  type CommandEnvelope,
} from '@faf/protocol';

/** The checked-in game bundle (core:cube = sim id 0). */
export function gameSimBin(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL('../../../../content/generated/sim.bin', import.meta.url))));
}

export function gameTable(): SimBpTable {
  return decodeSimBin(gameSimBin());
}

/** A table with core:cube (0) and a faster test cube (1) built directly by the compiler. */
export function testTable(): SimBpTable {
  const base = {
    categories: ['LAND', 'MOBILE'],
    sim: {
      health: { max: 100 },
      motion: { layer: 'land' as const, speed: 3, accel: 3, turnRateDeg: 180, sizeClass: 1, footprint: [1, 1] as [number, number], maxSlope: 0.6, radius: 0.3 },
    },
    view: { placeholder: { hull: 'box' as const, size: [0.5, 0.5, 0.5] as [number, number, number] } },
  };
  const r = compileBlueprints(
    [
      { source: 'a.ts', def: defineUnit({ id: 'core:cube', ...base }) },
      { source: 'b.ts', def: defineUnit({ id: 'test:fast', extends: 'core:cube', sim: { motion: { speed: 8, accel: 10, turnRateDeg: 360 } } }) },
    ],
    { includeTest: true },
  );
  return decodeSimBin(r.simBin);
}

/** WU → Fx raw. */
export function wu(v: number): number {
  return fx(v);
}

const seqs = new Map<number, number>();
/** Next seq for an army (test-local counter). */
export function nextSeq(army: number): number {
  const s = (seqs.get(army) ?? 0) + 1;
  seqs.set(army, s & 0xffff);
  return s & 0xffff;
}

export function spawnCmd(army: number, count: number, xWu: number, zWu: number, spreadWu: number, bp = 0, byArmy = army, seq = nextSeq(byArmy)): CommandEnvelope {
  return {
    tick: asTick(0),
    army: asArmyId(byArmy),
    seq,
    op: Op.Cheat,
    flags: 0,
    units: [],
    payload: encodeCheatSpawn({ bp, army, count, x: fx(xWu), z: fx(zWu), spread: fx(spreadWu) }),
  };
}

export function moveCmd(army: number, units: readonly Handle[], xWu: number, zWu: number, seq = nextSeq(army), flags = 0): CommandEnvelope {
  return {
    tick: asTick(0),
    army: asArmyId(army),
    seq,
    op: Op.Move,
    flags,
    units,
    payload: encodeMove({ x: fx(xWu), y: fx(0), z: fx(zWu) }),
  };
}

export function stopCmd(army: number, units: readonly Handle[], seq = nextSeq(army)): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Stop, flags: 0, units, payload: new Uint8Array(0) };
}

export function killCmd(army: number, units: readonly Handle[], seq = nextSeq(army)): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Cheat, flags: 0, units, payload: encodeCheatKill() };
}

/** Encodes envelopes into a batch (fresh bytes). */
export function batch(envs: readonly CommandEnvelope[]): Uint8Array {
  const e = new CommandBatchEncoder();
  for (const env of envs) e.add(env);
  return e.view().slice();
}
