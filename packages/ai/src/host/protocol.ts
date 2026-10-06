/**
 * Message protocol between the simulation side and an AI worker (PLAN §3.10 "AI-Worker",
 * ai.md §2.1). Version tag `AI_WORKER_PROTOCOL`.
 *
 *   sim → worker  init      {static (structured-clone-able), profileName, gameSeed, openings, brainSpec, …}
 *   worker → sim  ready     {opening, managers}
 *   sim → worker  perceive  {tick N, bytes = perception snapshot of N (transferable)}
 *   worker → sim  result    {tick N, batch = protocol encodeBatch of the commands for N + lead
 *                            (transferable), aborted, ops, …, telemetry since the last result}
 *   worker → sim  error     {tick, message}   (init or think failed; the sim stops the match)
 *
 * Every perceive is answered by exactly one result, in order. `AiStatic` is not cloneable as is
 * (its blueprint table carries functions): the message carries the table's SOURCE (today the raw
 * roster.json, `bpTableFromRoster`) and the worker rebuilds the identical table. Adapter boundary:
 * from MS9 the source is the compiled blueprint bundle (`BlueprintViewTable`, @faf/blueprints).
 */
import type { TelemetryEvent } from '../blackboard.ts';
import { bpTableFromRoster } from '../data/roster-adapter.ts';
import { DIFFICULTIES, type Difficulty } from '../openings.ts';
import type { AiStatic } from '../types.ts';
import { AI_TIMEOUT_MS, type AiHostEnv } from './clock.ts';

export const AI_WORKER_PROTOCOL = 'faf-ai-worker/1';

/** Source of the blueprint table the worker rebuilds (structured-clone-able). */
export interface BpTableSource {
  readonly kind: 'roster';
  /** Raw docs/design/roster.json (schema faf-roster/1). */
  readonly roster: unknown;
  readonly extraCategoryNames?: readonly string[];
}

/** AiStatic without functions: the blueprint table is replaced by its source. */
export type AiStaticWire = Omit<AiStatic, 'bps'> & { readonly bps: BpTableSource };

/** Converts AiStatic for postMessage (typed arrays are cloned by the channel). */
export function toAiStaticWire(s: AiStatic, bps: BpTableSource): AiStaticWire {
  return {
    army: s.army,
    gameSeed: s.gameSeed,
    map: { name: s.map.name, sizeWu: s.map.sizeWu, mapClass: s.map.mapClass },
    spots: s.spots.map((p) => ({ index: p.index, kind: p.kind, x: p.x, z: p.z })),
    passLowRes: s.passLowRes,
    passCellWu: s.passCellWu,
    passDim: s.passDim,
    heightLowRes: s.heightLowRes,
    components: s.components,
    sectors: null,
    bps,
    starts: s.starts.map((p) => ({ x: p.x, z: p.z })),
    armyStart: [...s.armyStart],
    activeArmies: [...s.activeArmies],
  };
}

/** Rebuilds AiStatic in the worker (blueprint table from its source). */
export function fromAiStaticWire(w: AiStaticWire): AiStatic {
  if (w.bps.kind !== 'roster') throw new Error(`AiStaticWire: unknown blueprint source '${String((w.bps as { kind?: unknown }).kind)}'`);
  const bps = bpTableFromRoster(w.bps.roster, w.bps.extraCategoryNames ?? []);
  return { ...w, sectors: null, bps };
}

export interface AiInitMessage {
  readonly type: 'init';
  readonly protocol: typeof AI_WORKER_PROTOCOL;
  readonly static: AiStaticWire;
  readonly profileName: Difficulty;
  readonly gameSeed: number;
  /** Raw ai-openings.json (parsed and validated in the worker). */
  readonly openings: unknown;
  /** Brain factory specifier 'module#export' (resolved by the environment's factory loader). */
  readonly brainSpec: string;
  readonly openingId?: string;
  readonly maxMs?: number;
  readonly env?: AiHostEnv;
  readonly timeoutMs?: number;
  readonly budgetScale?: number;
}

export interface AiPerceiveMessage {
  readonly type: 'perceive';
  readonly tick: number;
  /** Perception snapshot of `tick` (transferred). */
  readonly bytes: Uint8Array;
}

export interface AiShutdownMessage {
  readonly type: 'shutdown';
}

export type AiToWorkerMessage = AiInitMessage | AiPerceiveMessage | AiShutdownMessage;

export interface AiReadyMessage {
  readonly type: 'ready';
  readonly opening: string | null;
  readonly managers: readonly string[];
  readonly timeoutMs: number;
}

export interface AiResultMessage {
  readonly type: 'result';
  /** Think tick N; the commands apply at N + lead. */
  readonly tick: number;
  /** protocol encodeBatch of the commands (transferred). */
  readonly batch: Uint8Array;
  readonly aborted: boolean;
  /** Ops of managers, opening and emitter (ThinkResult.opsTotal). */
  readonly ops: number;
  readonly ingestOps: number;
  readonly opsByManager: Readonly<Record<string, number>>;
  readonly dropped: number;
  /** Wall-clock duration of the think inside the worker (diagnostics). */
  readonly ms: number;
  readonly telemetry: readonly TelemetryEvent[];
}

export interface AiErrorMessage {
  readonly type: 'error';
  /** Think tick, −1 for init/protocol errors. */
  readonly tick: number;
  readonly message: string;
}

export type AiFromWorkerMessage = AiReadyMessage | AiResultMessage | AiErrorMessage;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

/** Validates a sim → worker message; null if malformed. */
export function parseAiToWorkerMessage(x: unknown): AiToWorkerMessage | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'init': {
      if (x.protocol !== AI_WORKER_PROTOCOL) return null;
      if (!isObj(x.static) || !isObj(x.static.bps)) return null;
      if (typeof x.profileName !== 'string' || !(DIFFICULTIES as readonly string[]).includes(x.profileName)) return null;
      if (!isInt(x.gameSeed) || typeof x.brainSpec !== 'string' || x.brainSpec.length === 0) return null;
      if (x.openingId !== undefined && typeof x.openingId !== 'string') return null;
      if (x.maxMs !== undefined && !isInt(x.maxMs)) return null;
      if (x.env !== undefined && !(typeof x.env === 'string' && x.env in AI_TIMEOUT_MS)) return null;
      if (x.timeoutMs !== undefined && !(typeof x.timeoutMs === 'number' && x.timeoutMs > 0)) return null;
      if (x.budgetScale !== undefined && !(typeof x.budgetScale === 'number' && x.budgetScale > 0)) return null;
      return x as unknown as AiInitMessage;
    }
    case 'perceive':
      if (!isInt(x.tick) || x.tick < 0 || !(x.bytes instanceof Uint8Array)) return null;
      return x as unknown as AiPerceiveMessage;
    case 'shutdown':
      return { type: 'shutdown' };
    default:
      return null;
  }
}

/** Validates a worker → sim message; null if malformed. */
export function parseAiFromWorkerMessage(x: unknown): AiFromWorkerMessage | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'ready':
      if (!(x.opening === null || typeof x.opening === 'string') || !Array.isArray(x.managers)) return null;
      return x as unknown as AiReadyMessage;
    case 'result':
      if (!isInt(x.tick) || !(x.batch instanceof Uint8Array) || typeof x.aborted !== 'boolean') return null;
      if (typeof x.ops !== 'number' || !isObj(x.opsByManager) || !Array.isArray(x.telemetry)) return null;
      return x as unknown as AiResultMessage;
    case 'error':
      if (!isInt(x.tick) || typeof x.message !== 'string') return null;
      return x as unknown as AiErrorMessage;
    default:
      return null;
  }
}
