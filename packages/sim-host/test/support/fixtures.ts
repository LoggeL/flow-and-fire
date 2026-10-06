import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { encodeBatch, encodeCheatKill, encodeCheatSpawn, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import { unitHandles, type World } from '@faf/sim';
import type { HeadlessSim } from '../../src/index.ts';

/** The checked-in game bundle (core:cube = sim id 0). */
export function gameSimBin(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL('../../../../content/generated/sim.bin', import.meta.url))));
}

/** content/maps/hollow-ridge.rtsmap bytes (fresh copy). */
export function hollowRidgeBytes(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL('../../../../content/maps/hollow-ridge.rtsmap', import.meta.url))));
}

/** hollow-ridge as a fresh ArrayBuffer (InitMessage.map). */
export function hollowRidgeBuffer(): ArrayBuffer {
  const b = hollowRidgeBytes();
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}

/** sim.bin as a fresh ArrayBuffer (InitMessage.simBin). */
export function gameSimBinBuffer(): ArrayBuffer {
  const b = gameSimBin();
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}

export function spawnCmd(army: number, count: number, xWu: number, zWu: number, spreadWu: number, seq: number, byArmy = army, bp = 0): CommandEnvelope {
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

export function moveCmd(army: number, units: readonly Handle[], xWu: number, zWu: number, seq: number, flags = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Move, flags, units, payload: encodeMove({ x: fx(xWu), y: fx(0), z: fx(zWu) }) };
}

export function stopCmd(army: number, units: readonly Handle[], seq: number): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Stop, flags: 0, units, payload: new Uint8Array(0) };
}

export function killCmd(army: number, units: readonly Handle[], seq: number): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Cheat, flags: 0, units, payload: encodeCheatKill() };
}

export function batchOf(envs: readonly CommandEnvelope[]): Uint8Array {
  return encodeBatch(envs);
}

export function bufferOf(envs: readonly CommandEnvelope[]): ArrayBuffer {
  const b = encodeBatch(envs);
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}

/**
 * Reference scenario "host-1000": 1,000 cubes (900 army 0, 100 army 1) with commands at many
 * different ticks (moves of sub-groups, kills + respawn, stops, a foreign-unit command that must
 * be rejected). Commands depend only on the world state, so every run issues identical commands.
 */
export function scenarioCommands(w: World, tick: number): CommandEnvelope[] {
  const seq = (tick * 4) & 0xffff;
  switch (tick) {
    case 1:
      return [spawnCmd(0, 900, 128, 128, 40, seq), spawnCmd(1, 100, 384, 384, 20, seq)];
    case 5:
      return [moveCmd(0, unitHandles(w, 0), 300, 200, seq)];
    case 137: {
      const a1 = unitHandles(w, 1);
      return [moveCmd(1, a1, 220, 260, seq), moveCmd(1, unitHandles(w, 0).slice(0, 50), 10, 10, seq + 1)];
    }
    case 300: {
      const a0 = unitHandles(w, 0);
      return [moveCmd(0, a0.slice(0, a0.length >> 1), 100, 400, seq), moveCmd(0, a0.slice(a0.length >> 1), 420, 60, seq + 1)];
    }
    case 555: {
      const a0 = unitHandles(w, 0);
      return [stopCmd(0, a0.filter((_, i) => i % 5 === 0), seq)];
    }
    case 700: {
      const a0 = unitHandles(w, 0);
      return [killCmd(0, a0.filter((_, i) => i % 18 === 0), seq), spawnCmd(0, 50, 256, 256, 10, seq + 1)];
    }
    case 1001:
      return [moveCmd(1, unitHandles(w, 1), 480, 480, seq)];
    case 1100:
      return [moveCmd(0, unitHandles(w, 0), 400, 100, seq)];
    case 1333: {
      const a0 = unitHandles(w, 0);
      return [moveCmd(0, a0.filter((_, i) => i % 2 === 0), 60, 450, seq)];
    }
    case 1500: {
      const a0 = unitHandles(w, 0);
      return [stopCmd(0, a0.filter((_, i) => i % 3 === 0), seq), moveCmd(1, unitHandles(w, 1), 50, 50, seq + 1)];
    }
    case 1777:
      return [moveCmd(0, unitHandles(w, 0), 256, 256, seq), killCmd(1, unitHandles(w, 1).slice(0, 10), seq + 1)];
    default:
      return [];
  }
}

/** Continues the scenario on a headless sim up to `untilTick`. */
export function runScenario(sim: HeadlessSim, untilTick: number, onTick?: (tick: number) => void): void {
  while (sim.tick < untilTick) {
    const t = sim.tick + 1;
    const cmds = scenarioCommands(sim.world, t);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
    onTick?.(t);
  }
}

/**
 * Move batches for the "driving cubes" load (alloc test, bench): `groups` groups of `perGroup`
 * handles, `variants` different target sets with targets in [minWu, minWu + spanWu)². Reusable
 * Uint8Arrays.
 */
export function driveBatches(handles: readonly Handle[], groups: number, variants: number, seqBase: number, minWu = 64, spanWu = 384): Uint8Array[] {
  const perGroup = Math.floor(handles.length / groups);
  const out: Uint8Array[] = [];
  for (let k = 0; k < variants; k++) {
    const envs: CommandEnvelope[] = [];
    for (let g = 0; g < groups; g++) {
      const a = ((k * groups + g + 1) * 2654435761) >>> 0;
      envs.push(moveCmd(0, handles.slice(g * perGroup, (g + 1) * perGroup), minWu + (a % spanWu), minWu + ((a >>> 9) % spanWu), (seqBase + k * groups + g) & 0xffff));
    }
    out.push(encodeBatch(envs));
  }
  return out;
}
