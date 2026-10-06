/**
 * Test brain factories (loadable by brain spec 'file:…/brains.ts#<export>' in worker threads and
 * tournament pool workers). A scripted, deterministic brain through the real @faf/ai pipeline
 * (createBrain, managers with ctx.step, CommandEmitter, APM, budget):
 *
 * - opening: the commander builds a land factory at the analysis slot (12 | 0), then alternates
 *   mass extractors on the nearest free known spots and power generators on the eco ring,
 * - factory: every complete factory without a repeat loop gets a loop tank, tank, bot,
 * - platoon: idle combat units are sent by attack-move to the enemy start (± RNG jitter) once
 *   at least 6 are idle.
 *
 * Variants for the host tests: `createLateBrain` (the worker answers late: sleeps 70 ms every 20th
 * think — two ticks at 3x speed plus margin), `createStallBrain` (blocks 250 ms inside a platoon
 * step at tick 600 ⇒ the headless emergency limit of 200 ms aborts the think).
 */
import {
  createBrain,
  createDefaultBrain,
  DEFAULT_MANAGER_FACTORIES,
  defaultManagerFactories,
  defineManager,
  dist,
  OrderKind,
  Prio,
  type AiBrain,
  type ManagerContext,
  type ManagerFactory,
  type ManagerInitContext,
  type ThinkResult,
} from '@faf/ai';

/** Blocks the thread for `ms` (test fixture only; the AI code never sleeps). */
export function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const openingManager: ManagerFactory = defineManager('opening', (init) => {
  const bps = init.static.bps;
  const fac = bps.byId('core:str_t1_fac_land')!.index;
  const mex = bps.byId('core:str_t1_mex')!.index;
  const pgen = bps.byId('core:str_t1_pgen')!.index;
  const facSlot = init.analysis.toWorld(12, 0);
  const home = init.analysis.ownStart;
  let ring = 0;
  let builds = 0;
  return (ctx) => {
    let acu = 0;
    let acuIdle = false;
    let hasFactory = false;
    ctx.view.forEachOwn(null, (u) => {
      const b = bps.list[u.bp]!;
      if (b.categoryNames.includes('COMMAND')) {
        acu = u.handle;
        acuIdle = u.order === OrderKind.Idle && u.queueLength === 0;
      }
      if (u.bp === fac) hasFactory = true;
    });
    if (acu === 0 || !acuIdle) return;
    if (!hasFactory) {
      ctx.step(() => {
        ctx.emitter.build(acu, fac, facSlot.x, facSlot.z, 0, Prio.P2);
      });
      return;
    }
    if (builds % 2 === 0) {
      let best = -1;
      let bestD = 0;
      let bx = 0;
      let bz = 0;
      for (const s of ctx.view.freeMassSpots()) {
        if (!ctx.budget.take(1)) break;
        const d = dist(s.x, s.z, home.x, home.z);
        if (d > 120) continue;
        if (best < 0 || d < bestD || (d === bestD && s.index < best)) {
          best = s.index;
          bestD = d;
          bx = s.x;
          bz = s.z;
        }
      }
      if (best >= 0) {
        ctx.step(() => {
          ctx.emitter.build(acu, mex, bx, bz, 0, Prio.P2);
          return () => {
            builds++;
          };
        });
        return;
      }
    }
    for (let tries = 0; tries < 8; tries++) {
      const p = init.analysis.ecoRingSlot(ring);
      if (!ctx.budget.take(8)) return;
      if (ctx.view.canPlace(pgen, p.x, p.z, 0)) {
        ctx.step(() => {
          ctx.emitter.build(acu, pgen, p.x, p.z, 0, Prio.P2);
          return () => {
            ring++;
            builds++;
          };
        });
        return;
      }
      ring++;
    }
  };
});

const factoryManager: ManagerFactory = defineManager('factory', (init) => {
  const bps = init.static.bps;
  const fac = bps.byId('core:str_t1_fac_land')!.index;
  const tank = bps.byId('core:lnd_t1_tank')!.index;
  const bot = bps.byId('core:lnd_t1_bot')!.index;
  return (ctx) => {
    const idle: number[] = [];
    ctx.view.forEachOwn(null, (u) => {
      if (u.bp === fac && u.complete && !u.factoryRepeat) idle.push(u.handle);
    });
    for (const f of idle) {
      ctx.step(() => {
        ctx.emitter.factoryRepeat(f, [tank, tank, bot], Prio.P3);
      });
    }
  };
});

/** Hook of the stall step: called inside a work step at `stallAt` after its command was emitted. */
export interface StallSpec {
  readonly stallAt: number;
  readonly stall: () => void;
}

/** Commits of completed stall steps (tests check that an aborted step never commits). */
export const stallCommits: number[] = [];

function platoonThink(init: ManagerInitContext, stall: StallSpec | null): (ctx: ManagerContext) => void {
  const bps = init.static.bps;
  const target = init.analysis.enemyStart;
  const home = init.analysis.ownStart;
  return (ctx) => {
    const idle: number[] = [];
    let acu = 0;
    ctx.view.forEachOwn(null, (u) => {
      const b = bps.list[u.bp]!;
      if (b.isStructure || !u.complete) return;
      if (b.categoryNames.includes('COMMAND')) acu = u.handle;
      if (b.categoryNames.includes('COMMAND') || b.categoryNames.includes('ENGINEER')) return;
      if (u.order === OrderKind.Idle) idle.push(u.handle);
    });
    // Step A (always completes): nudge the first idle unit towards the front (P4).
    if (idle.length > 0) {
      ctx.step(() => {
        ctx.emitter.move([idle[0]!], target.x * 0.1 + home.x * 0.9, target.z * 0.1 + home.z * 0.9, Prio.P4);
      });
    }
    // Stall step: emits a recall of the commander, then blocks (wall clock) — must be rolled back.
    if (stall !== null && ctx.tick === stall.stallAt && acu !== 0) {
      ctx.step(() => {
        ctx.emitter.move([acu], home.x + 3, home.z + 3, Prio.P1);
        stall.stall();
        return () => {
          stallCommits.push(ctx.tick);
        };
      });
    }
    if (idle.length < 6) return;
    // Step B: the wave (attack-move with seeded jitter).
    ctx.step(() => {
      const jx = ctx.rng.nextInt(17) - 8;
      const jz = ctx.rng.nextInt(17) - 8;
      ctx.emitter.attackMove(idle, target.x + jx, target.z + jz, Prio.P1);
    });
  };
}

const platoonManager: ManagerFactory = defineManager('platoon', (init) => platoonThink(init, null));

/** The scripted fixture brain (deterministic; same seed ⇒ same command stream). */
export function createFixtureBrain(): AiBrain {
  return createBrain({ managers: [openingManager, factoryManager, platoonManager] });
}

/** Fixture brain whose think sleeps 70 ms on every 20th think (the worker answers late). */
export function createLateBrain(): AiBrain {
  const brain = createFixtureBrain();
  const think = brain.think.bind(brain);
  let n = 0;
  brain.think = (view, opts) => {
    n++;
    if (n % 20 === 0) sleepMs(70);
    return think(view, opts);
  };
  return brain;
}

/** Fixture brain with a stall step at `stall.stallAt` (AI-DET-04). */
export function createFixtureBrainWithStall(stall: StallSpec): AiBrain {
  const stallPlatoon = defineManager('platoon', (init) => platoonThink(init, stall));
  return createBrain({ managers: [openingManager, factoryManager, stallPlatoon] });
}

/** Tick of the stall step of `createStallBrain`. */
export const STALL_TICK = 600;

/** Fixture brain that blocks 250 ms in a platoon step at tick 600 (headless limit 200 ms ⇒ abort). */
export function createStallBrain(): AiBrain {
  return createFixtureBrainWithStall({ stallAt: STALL_TICK, stall: () => sleepMs(250) });
}

// ---- createDefaultBrain variants (AI-DET-03/04 with the real managers) -------------------------

/** createDefaultBrain whose think sleeps 70 ms on every 20th think (the worker answers late). */
export function createLateDefaultBrain(): AiBrain {
  const brain = createDefaultBrain();
  const think = brain.think.bind(brain);
  let n = 0;
  brain.think = (view, opts) => {
    n++;
    if (n % 20 === 0) sleepMs(70);
    return think(view, opts);
  };
  return brain;
}

/** Stall inside the default PlatoonManager: the first work step at a tick ≥ `stallAfter` that emits a command. */
export interface PlatoonStallSpec {
  readonly stallAfter: number;
  readonly stall: () => void;
  /** Receives every think result of the brain (sync host only). */
  readonly onResult?: (r: ThinkResult) => void;
}

/** What happened to the stalled step (one record per stalling brain). */
export interface PlatoonStallRecord {
  tick: number;
  /** Commands the step had emitted when the stall hit. */
  emitted: number;
  /** Whether the step's commit ran (it must not after an abort). */
  committed: boolean;
}

/** Records of stalled default-brain platoon steps in this thread. */
export const platoonStalls: PlatoonStallRecord[] = [];

function stallingPlatoon(spec: PlatoonStallSpec): ManagerFactory {
  const inner = DEFAULT_MANAGER_FACTORIES.platoon!;
  return {
    name: inner.name,
    create: (init) => {
      const m = inner.create(init);
      let armed = true;
      return {
        name: m.name,
        budgetKey: m.budgetKey,
        think: (ctx) => {
          if (!armed || ctx.tick < spec.stallAfter) {
            m.think(ctx);
            return;
          }
          const wrapped: ManagerContext = {
            ...ctx,
            step: (work) =>
              ctx.step(() => {
                const before = ctx.emitter.mark();
                const commit = work();
                const emitted = ctx.emitter.mark() - before;
                if (!armed || emitted === 0) return commit;
                armed = false;
                const rec: PlatoonStallRecord = { tick: ctx.tick, emitted, committed: false };
                platoonStalls.push(rec);
                spec.stall();
                return () => {
                  rec.committed = true;
                  if (typeof commit === 'function') commit();
                };
              }),
          };
          m.think(wrapped);
        },
      };
    },
  };
}

/** createDefaultBrain whose PlatoonManager stalls in the middle of a step (AI-DET-04). */
export function createDefaultBrainWithPlatoonStall(spec: PlatoonStallSpec): AiBrain {
  const managers = defaultManagerFactories().map((f) => (f.name === 'platoon' ? stallingPlatoon(spec) : f));
  const brain = createBrain({ managers });
  if (spec.onResult !== undefined) {
    const think = brain.think.bind(brain);
    const onResult = spec.onResult;
    brain.think = (view, opts) => {
      const r = think(view, opts);
      onResult(r);
      return r;
    };
  }
  return brain;
}

/** Earliest tick of the default-brain platoon stall (the first wave forms from ≈ 3:30). */
export const DEFAULT_STALL_AFTER = 2400;

/** createDefaultBrain that blocks 250 ms inside a platoon step from tick 2400 (headless limit 200 ms ⇒ abort). */
export function createDefaultStallBrain(): AiBrain {
  return createDefaultBrainWithPlatoonStall({ stallAfter: DEFAULT_STALL_AFTER, stall: () => sleepMs(250) });
}

/** Spins (burns CPU of this thread) for `ms` of thread CPU time — unlike sleepMs it counts on a CPU clock. */
export function spinCpuMs(ms: number): void {
  const t0 = process.threadCpuUsage();
  for (;;) {
    const d = process.threadCpuUsage(t0);
    if ((d.user + d.system) / 1000 >= ms) return;
  }
}

/** Fixture brain that burns 250 ms of CPU in a platoon step at tick 600 (aborts on both clocks). */
export function createBusyStallBrain(): AiBrain {
  return createFixtureBrainWithStall({ stallAt: STALL_TICK, stall: () => spinCpuMs(250) });
}
