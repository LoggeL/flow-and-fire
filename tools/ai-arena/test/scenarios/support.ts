/**
 * Shared helpers of the arena scenario tests (tai-p5, ai.md §9): opening runs against a passive
 * scripted army, unit lookups and manager access.
 */
import { OrderKind, type AiBrain, type ManagerName, type Opening } from '@faf/ai';
import type { CommandEnvelope } from '@faf/protocol';
import { runScenario, scenarioOpenings, sec, type ScenarioResult, type ScenarioRuntime, type ScenarioSpec } from '../../src/scenarios/index.ts';
import type { ArenaUnit } from '../../src/world/unit.ts';
import type { ArenaWorld } from '../../src/world/world.ts';

export { sec };

export const ID = {
  tank: 'core:lnd_t1_tank',
  bot: 'core:lnd_t1_bot',
  arty: 'core:lnd_t1_arty',
  scout: 'core:lnd_t1_scout',
  engineer: 'core:lnd_t1_engineer',
  pd: 'core:str_t1_pd',
  mex: 'core:str_t1_mex',
  pgen: 'core:str_t1_pgen',
  facLand: 'core:str_t1_fac_land',
} as const;

export function openingById(id: string): Opening {
  const o = scenarioOpenings().openings.find((x) => x.id === id);
  if (o === undefined) throw new Error(`no opening ${id}`);
  return o;
}

/** Army 0 plays `openingId` (Normal, default brain); army 1 is a passive scripted side. */
export function openingRun(
  map: string,
  openingId: string,
  seconds: number,
  extra: Partial<Omit<ScenarioSpec, 'map' | 'seed' | 'sides' | 'until'>> & {
    seed?: number;
    until?: ScenarioSpec['until'];
    /** Keeps the passive enemy commander alive (long runs: the AI's waves would end the match). */
    keepEnemyAlive?: boolean;
  } = {},
): ScenarioResult {
  const { seed, until, keepEnemyAlive, cheats, ...rest } = extra;
  const all = [...(cheats ?? [])];
  if (keepEnemyAlive === true) {
    all.push({
      every: 10,
      run: (rt) => {
        const c = rt.world.commander(1);
        if (c !== null && c.alive) rt.world.setHp(c.handle, 1);
      },
    });
  }
  return runScenario({
    map,
    seed: seed ?? 1,
    sides: [{ army: 0, ai: { openingId } }, { army: 1 }],
    until: until ?? { seconds },
    cheats: all,
    ...rest,
  });
}

/** A manager instance of a brain (diagnostics accessor of the default brain). */
export function managerOf<T>(brain: AiBrain, name: ManagerName): T {
  const m = brain.manager?.(name);
  if (m === undefined) throw new Error(`brain has no manager ${name}`);
  return m as unknown as T;
}

/** Live units of an army with a blueprint id. */
export function unitsOf(world: ArenaWorld, army: number, bpId: string): ArenaUnit[] {
  const bp = world.bpIndex(bpId);
  return world.unitsOf(army).filter((u) => u.alive && u.bp.index === bp);
}

/** Current build order of a unit (null if its first order is not Build). */
export function buildOrderOf(u: ArenaUnit): { bp: number; x: number; z: number } | null {
  const o = u.orders[0];
  if (o === undefined || o.kind !== OrderKind.Build) return null;
  return { bp: o.bp, x: o.x, z: o.z };
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Tick of the n-th completed own structure of a blueprint (observer helper), or null. */
export class CompletionLog {
  readonly ticks = new Map<number, number>();

  observe(world: ArenaWorld, army: number, tick: number): void {
    for (const u of world.unitsOf(army)) if (u.alive && u.complete && !this.ticks.has(u.handle)) this.ticks.set(u.handle, tick);
  }
}

/**
 * Scripted command: the passive enemy commander walks 120 WU behind its start (away from the AI), out
 * of the scout's first look — scenarios whose 180-s enemy window must not contain it.
 */
export function hideEnemyCommander(rt: ScenarioRuntime): CommandEnvelope {
  const a = rt.brain(0).analysis;
  const c = rt.world.commander(1)!;
  const dx = a.enemyStart.x - a.ownStart.x;
  const dz = a.enemyStart.z - a.ownStart.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  const size = rt.world.baseStatic.map.sizeWu;
  const x = Math.min(size - 4, Math.max(4, c.x + (dx / l) * 120));
  const z = Math.min(size - 4, Math.max(4, c.z + (dz / l) * 120));
  return rt.cmd.move(1, [c.handle], x, z);
}
