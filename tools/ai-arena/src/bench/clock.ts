/**
 * Wall clock and timers of the benchmarks (the only arena modules besides host/clock.ts of @faf/ai
 * that may read the clock, determinism guard allowlist tools/ai-arena/src/bench/**). Measurements
 * never feed back into the arena or an AI decision.
 */
import { performance } from 'node:perf_hooks';
import { systemClock, type AiClock } from '@faf/ai/host';

/** Monotonic ms. */
export function wallNow(): number {
  return performance.now();
}

/** Resolves after `ms` (setTimeout granularity ≈ 1 ms). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms < 0 ? 0 : ms));
}

/** Resolves on the next event-loop turn (lets worker messages in). */
export function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Clock of the AI host's emergency stop (ai.md §2.3) in arena runs:
 * - 'wall': performance.now() (the definition of ai.md; browser and real headless runs),
 * - 'thread': CPU time of the calling thread (process.threadCpuUsage, Node ≥ 23.9). Time the thread
 *   is not running — descheduled on a loaded machine, page-in stalls, a whole-process freeze — does
 *   not count, so a think is only aborted when it computes too long. Tournaments on a shared machine
 *   use it by default (TRACK-AI tai-p7: simultaneous 0.3–3 s freezes of all pool threads produced
 *   aiTimeout marks with normal op counts).
 */
export type HostClockKind = 'wall' | 'thread';

export const HOST_CLOCK_KINDS: readonly HostClockKind[] = ['wall', 'thread'];

type ThreadCpuUsage = () => { user: number; system: number };

function threadCpuUsageFn(): ThreadCpuUsage | null {
  const f = (process as unknown as { threadCpuUsage?: ThreadCpuUsage }).threadCpuUsage;
  return typeof f === 'function' ? f.bind(process) : null;
}

/** Whether this Node provides per-thread CPU time (otherwise 'thread' falls back to the wall clock). */
export function threadCpuAvailable(): boolean {
  return threadCpuUsageFn() !== null;
}

/** CPU time of the calling thread in ms (user + system); wall clock where unavailable. */
export const threadCpuClock: AiClock = {
  now(): number {
    const f = threadCpuUsageFn();
    if (f === null) return performance.now();
    const u = f();
    return (u.user + u.system) / 1000;
  },
};

/** The emergency-stop clock of a kind. */
export function hostClock(kind: HostClockKind): AiClock {
  return kind === 'thread' ? threadCpuClock : systemClock;
}
