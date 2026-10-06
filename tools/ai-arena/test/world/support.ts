/**
 * Test helpers of the arena world tests (scripted controllers live only under test/): command
 * builders with per-army sequence numbers, a scripted CommandSource, world factories.
 */
import { CmdFlags, Op, type CommandEnvelope, type CommandSource } from '@faf/protocol';
import { asArmyId, asHandle, asTick, type Tick } from '@faf/fixed';
import {
  encodeBuild,
  encodeFactoryQueue,
  encodeFactoryRepeat,
  encodePosition,
  encodeStop,
  encodeTarget,
  encodeUpgrade,
} from '@faf/ai';
import { ArenaWorld, type ArenaWorldOptions } from '../../src/index.ts';

/** Builds command envelopes with increasing sequence numbers per army. */
export class Cmds {
  private readonly seq = new Array<number>(16).fill(0);

  private env(army: number, op: number, units: readonly number[], payload: Uint8Array, queue = false): CommandEnvelope {
    this.seq[army] = ((this.seq[army]! + 1) & 0xffff) || 1;
    return {
      tick: asTick(0),
      army: asArmyId(army),
      seq: this.seq[army]!,
      op: op as CommandEnvelope['op'],
      flags: queue ? CmdFlags.Queue : 0,
      units: units.map((u) => asHandle(u)),
      payload,
    };
  }

  move(army: number, units: readonly number[], x: number, z: number, queue = false): CommandEnvelope {
    return this.env(army, Op.Move, units, encodePosition(x, z), queue);
  }
  attackMove(army: number, units: readonly number[], x: number, z: number, queue = false): CommandEnvelope {
    return this.env(army, Op.AttackMove, units, encodePosition(x, z), queue);
  }
  patrol(army: number, units: readonly number[], x: number, z: number): CommandEnvelope {
    return this.env(army, Op.Patrol, units, encodePosition(x, z));
  }
  rally(army: number, units: readonly number[], x: number, z: number): CommandEnvelope {
    return this.env(army, Op.SetRally, units, encodePosition(x, z));
  }
  build(army: number, units: readonly number[], bp: number, x: number, z: number, queue = false): CommandEnvelope {
    return this.env(army, Op.Build, units, encodeBuild(bp, x, z, 0), queue);
  }
  target(army: number, op: number, units: readonly number[], target: number, queue = false): CommandEnvelope {
    return this.env(army, op, units, encodeTarget(target), queue);
  }
  factoryQueue(army: number, units: readonly number[], bp: number, count: number, queue = true): CommandEnvelope {
    return this.env(army, Op.FactoryQueue, units, encodeFactoryQueue(bp, count), queue);
  }
  factoryRepeat(army: number, units: readonly number[], items: readonly number[]): CommandEnvelope {
    return this.env(army, Op.FactoryRepeat, units, encodeFactoryRepeat(items.length > 0, items));
  }
  upgrade(army: number, units: readonly number[], bp: number): CommandEnvelope {
    return this.env(army, Op.Upgrade, units, encodeUpgrade(bp));
  }
  stop(army: number, units: readonly number[]): CommandEnvelope {
    return this.env(army, Op.Stop, units, encodeStop());
  }
  raw(army: number, op: number, units: readonly number[], payload: Uint8Array): CommandEnvelope {
    return this.env(army, op, units, payload);
  }
}

/** Scripted CommandSource: commands scheduled per tick (optionally computed lazily). */
export class ScriptSource implements CommandSource {
  private readonly at = new Map<number, (() => CommandEnvelope[])[]>();

  add(tick: number, fn: () => CommandEnvelope | CommandEnvelope[]): this {
    const list = this.at.get(tick) ?? [];
    list.push(() => {
      const r = fn();
      return Array.isArray(r) ? r : [r];
    });
    this.at.set(tick, list);
    return this;
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] {
    const list = this.at.get(tick as number);
    if (list === undefined) return [];
    const out: CommandEnvelope[] = [];
    for (const f of list) out.push(...f());
    return out;
  }
}

/** Setons 1v1 (army 0 SW-Mid, army 1 NO-Mid). */
export function setonsWorld(seed = 1, extra: Partial<ArenaWorldOptions> = {}): ArenaWorld {
  return ArenaWorld.create({
    map: 'setons',
    seed,
    armies: [
      { army: 0, startIndex: 0 },
      { army: 1, startIndex: 1 },
    ],
    ...extra,
  });
}

export function hollowWorld(seed = 1): ArenaWorld {
  return ArenaWorld.create({
    map: 'hollow-ridge',
    seed,
    armies: [
      { army: 0, startIndex: 0 },
      { army: 1, startIndex: 1 },
    ],
  });
}

/** Steps the world n ticks with an optional per-tick command provider. */
export function run(world: ArenaWorld, n: number, cmdsAt?: (tick: number) => CommandEnvelope[]): void {
  for (let i = 0; i < n; i++) world.step(cmdsAt?.(world.tick) ?? []);
}

/** Steps until `pred` holds (or `max` ticks); returns the tick. */
export function runUntil(world: ArenaWorld, pred: () => boolean, max: number): number {
  for (let i = 0; i < max && !pred(); i++) world.step([]);
  return world.tick;
}

/** Local frame of a start: f towards the enemy start, s perpendicular (like ecosim `local`). */
export function localFrame(world: ArenaWorld, army: number, enemy: number): (f: number, s: number) => { x: number; z: number } {
  const a = world.startOf(army);
  const b = world.startOf(enemy);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  const fx = dx / l;
  const fz = dz / l;
  return (f, s) => ({ x: a.x + fx * f - fz * s, z: a.z + fz * f + fx * s });
}
