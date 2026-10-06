/**
 * (c) SPK7 analogue (PLAN §4 SPK7, §3.4 scheduler): both armies' AI (Normal, default brain) run in
 * Node worker threads (AsyncAiSource over the @faf/ai/host protocol); the "sim" is a real-time
 * scheduler loop in the main thread like the sim-host scheduler:
 *
 * - accumulator with target period 100 ms / speed (3x ⇒ 33.3 ms per tick), at most 3 ticks per slice,
 * - a lagging sim slows down (the accumulator is clamped to 3 ticks, no unlimited catch-up),
 * - a tick whose commands are 'pending' is retried on the next event-loop turn (the sim waits).
 *
 * Measured: share of ticks on which the sim had to wait for 'pending' (gate < 1 %), wait time per
 * waiting tick (p95), effective speed, step and think times. The loop starts after both workers have
 * reported `ready` (loading phase, as in the game).
 */
import { asTick } from '@faf/fixed';
import type { AsyncAiSource } from '@faf/ai/host';
import type { CommandEnvelope } from '@faf/protocol';
import { summarize, type Summary } from '../stats/summary.ts';
import { closeAiSides } from '../host-node/sides.ts';
import { nextTurn, sleep, wallNow } from './clock.ts';
import { aiSides, setonsDuel } from './common.ts';

/** PLAN §3.4: at most 3 ticks per scheduler slice. */
export const MAX_TICKS_PER_SLICE = 3;

export interface Spk7Result {
  readonly speed: number;
  readonly tickMs: number;
  readonly ticks: number;
  readonly ticksWaited: number;
  /** ticksWaited / ticks in %. */
  readonly waitedPct: number;
  readonly pendingPolls: number;
  /** Wall ms from the first 'pending' of a tick until it could step (waiting ticks only). */
  readonly waitMs: Summary;
  readonly realMs: number;
  /** Achieved game speed (1 = 10 ticks/s). */
  readonly effectiveSpeed: number;
  readonly stepMs: Summary;
  /** Think wall time inside the workers. */
  readonly thinkMs: Summary;
  readonly slices: number;
  readonly readyMs: number;
  readonly aborted: number;
}

export interface Spk7Options {
  readonly ticks?: number;
  readonly speed?: number;
  readonly seed?: number;
  readonly brainSpec?: string;
}

export async function benchSpk7(o: Spk7Options = {}): Promise<Spk7Result> {
  const ticks = o.ticks ?? 3000;
  const speed = o.speed ?? 3;
  const tickMs = 100 / speed;
  const world = setonsDuel(o.seed ?? 7);
  const sides = await aiSides(world, 'normal', 'worker', o.brainSpec);
  try {
    const sources = sides.map((s) => s.source as AsyncAiSource);
    const r0 = wallNow();
    while (sources.some((s) => s.ready === null)) {
      for (const s of sources) if (s.error !== null) throw s.error;
      if (wallNow() - r0 > 120_000) throw new Error('spk7: AI workers not ready after 120 s');
      await sleep(2);
    }
    const readyMs = wallNow() - r0;

    const cmds: CommandEnvelope[] = [];
    const stepMs: number[] = [];
    const waitMs: number[] = [];
    let ticksWaited = 0;
    let pendingPolls = 0;
    let waitStart = -1;
    let slices = 0;
    let acc = 0;
    const start = wallNow();
    let last = start;
    while (!world.over && world.tick < ticks) {
      const now = wallNow();
      acc += now - last;
      last = now;
      if (acc > MAX_TICKS_PER_SLICE * tickMs) acc = MAX_TICKS_PER_SLICE * tickMs;
      slices++;
      let blocked = false;
      for (let n = 0; n < MAX_TICKS_PER_SLICE && acc >= tickMs && world.tick < ticks && !world.over; n++) {
        const t = world.tick;
        cmds.length = 0;
        let ready = true;
        for (const s of sides) {
          const r = s.source.commandsFor(asTick(t));
          if (r === 'pending') {
            ready = false;
            break;
          }
          for (const e of r) cmds.push(e);
        }
        if (!ready) {
          pendingPolls++;
          if (waitStart < 0) {
            waitStart = wallNow();
            ticksWaited++;
          }
          blocked = true;
          break;
        }
        if (waitStart >= 0) {
          waitMs.push(wallNow() - waitStart);
          waitStart = -1;
        }
        const a = wallNow();
        world.step(cmds);
        stepMs.push(wallNow() - a);
        acc -= tickMs;
      }
      if (blocked) await nextTurn();
      else {
        const due = tickMs - acc - (wallNow() - last);
        if (due > 1.5) await sleep(due - 1);
        else await nextTurn();
      }
    }
    const realMs = wallNow() - start;
    const think: number[] = [];
    let aborted = 0;
    for (const s of sides) {
      for (const v of s.stats.ms) think.push(v);
      aborted += s.stats.aborted;
    }
    const n = stepMs.length;
    return {
      speed,
      tickMs,
      ticks: n,
      ticksWaited,
      waitedPct: n > 0 ? (100 * ticksWaited) / n : 0,
      pendingPolls,
      waitMs: summarize(waitMs),
      realMs,
      effectiveSpeed: realMs > 0 ? (n * 100) / realMs : 0,
      stepMs: summarize(stepMs),
      thinkMs: summarize(think),
      slices,
      readyMs,
      aborted,
    };
  } finally {
    await closeAiSides(sides);
  }
}
