import { CmdFlags, Op } from '@faf/protocol';
import { decodeAiPayload, OrderKind, type AiBrain, type EncodedCommand, type ThinkResult } from '../../../src/index.ts';
import { FakeWorld } from '../../../src/testing/index.ts';
import { loadStatic } from '../../support/fixtures.ts';
import { COMMANDER_ID, MANAGERS, T, brainFor } from './build-support.ts';
interface BuildOrder {
  readonly bp: number;
  readonly x: number;
  readonly z: number;
}

const BUILD_TICKS = 40;
const PRODUCE_TICKS = 80;
const UPGRADE_TICKS = 300;

/** Tiny scripted world for the flow tests (see flow.test.ts). */
export class ToyWorld {
  readonly w: FakeWorld;
  private readonly queues = new Map<number, BuildOrder[]>();
  private readonly progress = new Map<number, number>();
  private readonly facQueue = new Map<number, number[]>();
  private readonly facLoop = new Map<number, { items: number[]; i: number }>();
  private readonly facProgress = new Map<number, number>();
  private readonly upgrades = new Map<number, number>();
  rejected = 0;

  constructor(readonly brain: AiBrain) {
    this.w = new FakeWorld(brain.static);
    const s = brain.analysis.ownStart;
    this.w.addOwn(COMMANDER_ID, s.x, s.z);
  }

  private occupied(bp: number, x: number, z: number): boolean {
    const b = T.list[bp]!;
    for (const h of this.w.ownHandles()) {
      const u = this.w.own(h);
      const ub = T.list[u.bp]!;
      if (!ub.isStructure) continue;
      if (Math.abs(u.x - x) * 2 < b.footprint[0] + ub.footprint[0] - 1e-9 && Math.abs(u.z - z) * 2 < b.footprint[1] + ub.footprint[1] - 1e-9) return true;
    }
    return false;
  }

  apply(cmds: readonly EncodedCommand[]): void {
    for (const c of cmds) {
      const p = decodeAiPayload(c.op, c.payload);
      const queued = (c.flags & CmdFlags.Queue) !== 0;
      for (const h of c.units) {
        if (!this.w.ownHandles().includes(h)) continue;
        const u = this.w.own(h);
        if (p.op === 'build') {
          const q = queued ? (this.queues.get(h) ?? []) : [];
          q.push({ bp: p.value.bp, x: p.value.x, z: p.value.z });
          this.queues.set(h, q);
          if (!queued) this.progress.set(h, 0);
        } else if (p.op === 'factoryQueue') {
          const q = queued ? (this.facQueue.get(h) ?? []) : [];
          for (let i = 0; i < p.value.count; i++) q.push(p.value.bp);
          this.facQueue.set(h, q);
        } else if (p.op === 'factoryRepeat') {
          this.facLoop.set(h, { items: [...p.value.items], i: 0 });
          u.factoryRepeat = p.value.on;
        } else if (p.op === 'upgrade') {
          u.upgradingTo = p.value;
          this.upgrades.set(h, 0);
        } else if (p.op === 'target' || p.op === 'position') {
          if (c.op === Op.SetRally) continue;
          this.queues.delete(h);
          u.order = c.op === Op.Assist ? OrderKind.Assist : c.op === Op.Guard ? OrderKind.Guard : c.op === Op.Repair ? OrderKind.Repair : OrderKind.Move;
          u.orderTarget = p.op === 'target' ? p.value : 0;
          u.queueLength = 0;
        }
      }
    }
  }

  step(ticks: number): void {
    const w = this.w;
    for (const h of [...this.queues.keys()]) {
      const u = w.own(h);
      const q = this.queues.get(h)!;
      const cur = q[0];
      if (cur === undefined) {
        this.queues.delete(h);
        u.order = OrderKind.Idle;
        u.queueLength = 0;
        continue;
      }
      u.order = OrderKind.Build;
      u.orderBp = cur.bp;
      u.orderX = cur.x;
      u.orderZ = cur.z;
      u.queueLength = q.length - 1;
      const pr = (this.progress.get(h) ?? 0) + ticks;
      this.progress.set(h, pr);
      if (pr >= BUILD_TICKS) {
        if (this.occupied(cur.bp, cur.x, cur.z)) {
          this.rejected++;
          w.event({ kind: 'commandRejected', tick: w.tick, seq: 0, reason: 'placement', unit: h });
        } else w.addOwn(T.list[cur.bp]!.id, cur.x, cur.z);
        q.shift();
        this.progress.set(h, 0);
        if (q.length === 0) {
          this.queues.delete(h);
          u.order = OrderKind.Idle;
          u.queueLength = 0;
        }
      }
    }
    for (const h of w.ownHandles()) {
      const u = w.own(h);
      const b = T.list[u.bp]!;
      // Assist/guard targets that vanished: idle.
      if ((u.order === OrderKind.Assist || u.order === OrderKind.Guard || u.order === OrderKind.Repair) && !w.ownHandles().includes(u.orderTarget)) {
        u.order = OrderKind.Idle;
      }
      if (b.categoryNames.includes('FACTORY') && b.isStructure) {
        const q = this.facQueue.get(h) ?? [];
        const loop = this.facLoop.get(h);
        const next = q[0] ?? (loop !== undefined && loop.items.length > 0 ? loop.items[loop.i % loop.items.length] : undefined);
        u.factoryBp = next ?? -1;
        u.queueLength = q.length;
        if (next !== undefined && u.upgradingTo < 0) {
          const pr = (this.facProgress.get(h) ?? 0) + ticks;
          if (pr >= PRODUCE_TICKS) {
            w.addOwn(T.list[next]!.id, u.x + 6, u.z + 6);
            if (q.length > 0) q.shift();
            else if (loop !== undefined) loop.i++;
            this.facProgress.set(h, 0);
          } else this.facProgress.set(h, pr);
        }
      }
      const up = this.upgrades.get(h);
      if (up !== undefined) {
        if (up + ticks >= UPGRADE_TICKS) {
          u.bp = u.upgradingTo;
          u.upgradingTo = -1;
          this.upgrades.delete(h);
        } else this.upgrades.set(h, up + ticks);
      }
    }
    // Coarse economy from the own structures.
    let mass = 1;
    let energy = 20;
    let upkeep = 0;
    for (const h of w.ownHandles()) {
      const b = T.list[w.own(h).bp]!;
      if (!b.isStructure) continue;
      mass += b.massPerSec;
      energy += b.energyPerSec;
      upkeep += b.upkeepEnergyPerSec;
    }
    w.setEco({ massIncome: mass, energyIncome: energy, energyUpkeep: upkeep, energyDemand: 30, massDemand: mass * 0.8, energyStored: 2000, massStored: 200 });
    w.advance(ticks);
  }
}

export function play(map: string, openingId: string, thinks: number): { brain: AiBrain; toy: ToyWorld; results: ThinkResult[] } {
  const brain = brainFor(loadStatic(map, 0, 1), {
    managers: [MANAGERS.opening, MANAGERS.economy, MANAGERS.tech, MANAGERS.engineer],
    openingId,
  });
  const toy = new ToyWorld(brain);
  const results: ThinkResult[] = [];
  const every = brain.profile.thinkEvery;
  for (let i = 0; i < thinks; i++) {
    const r = brain.think(toy.w.perceive());
    toy.apply(r.commands);
    results.push(r);
    toy.step(every);
  }
  return { brain, toy, results };
}

