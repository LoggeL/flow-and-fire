/**
 * Command builder for scripted scenario sides (PLAN §3.12 ScenarioBuilder analogue): envelopes with
 * the provisional AI payloads (@faf/ai commands/payloads.ts) and increasing sequence numbers per
 * army. The envelope tick is irrelevant (the match loop applies a command in the tick it is
 * delivered); seq 0 is never used (like the AI emitter).
 */
import { asArmyId, asHandle, asTick } from '@faf/fixed';
import { CmdFlags, Op, type CommandEnvelope } from '@faf/protocol';
import { encodeBuild, encodeFactoryQueue, encodeFactoryRepeat, encodePosition, encodeStop, encodeTarget, encodeUpgrade } from '@faf/ai';

export class ScenarioCommands {
  private readonly seq = new Array<number>(16).fill(0);

  private env(army: number, op: number, units: readonly number[], payload: Uint8Array, queue: boolean): CommandEnvelope {
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
    return this.env(army, Op.Patrol, units, encodePosition(x, z), false);
  }

  attack(army: number, units: readonly number[], target: number, queue = false): CommandEnvelope {
    return this.env(army, Op.Attack, units, encodeTarget(target), queue);
  }

  guard(army: number, units: readonly number[], target: number): CommandEnvelope {
    return this.env(army, Op.Guard, units, encodeTarget(target), false);
  }

  build(army: number, units: readonly number[], bp: number, x: number, z: number, queue = false): CommandEnvelope {
    return this.env(army, Op.Build, units, encodeBuild(bp, x, z, 0), queue);
  }

  factoryQueue(army: number, units: readonly number[], bp: number, count: number, queue = true): CommandEnvelope {
    return this.env(army, Op.FactoryQueue, units, encodeFactoryQueue(bp, count), queue);
  }

  factoryRepeat(army: number, units: readonly number[], items: readonly number[]): CommandEnvelope {
    return this.env(army, Op.FactoryRepeat, units, encodeFactoryRepeat(items.length > 0, items), false);
  }

  upgrade(army: number, units: readonly number[], bp: number): CommandEnvelope {
    return this.env(army, Op.Upgrade, units, encodeUpgrade(bp), false);
  }

  stop(army: number, units: readonly number[]): CommandEnvelope {
    return this.env(army, Op.Stop, units, encodeStop(), false);
  }
}
