/**
 * Control and status messages between main thread and sim host (PLAN §3.6 "Kanäle").
 * All messages are structured-clonable plain objects, discriminated by `t`. Command batches
 * travel as `CmdMessage` with their ArrayBuffer transferred.
 */

import { MAX_ARMIES } from '@faf/fixed';

/** Game speed limits (A6: 0.25x–3x), in permille for the frame header. */
export const SPEED_MIN_PERMILLE = 250;
export const SPEED_MAX_PERMILLE = 3000;
/** Maximum number of watched units (`ctl.watch`). */
export const MAX_WATCH = 64;
/** Viewer value meaning "all armies" (replay / observer perspective). */
export const VIEWER_ALL = -1;

export type TransportKind = 'sab' | 'transfer';

// ---- Main → Host -----------------------------------------------------------------------------

export interface PauseMsg {
  readonly t: 'pause';
}
export interface ResumeMsg {
  readonly t: 'resume';
}
export interface SpeedMsg {
  readonly t: 'speed';
  /** Multiplier 0.25–3. */
  readonly speed: number;
}
export interface StepMsg {
  readonly t: 'step';
  /** Ticks to advance while paused (≥ 1). */
  readonly ticks: number;
}
export interface ViewerMsg {
  readonly t: 'viewer';
  /** −1 = all, else army 0..15. */
  readonly army: number;
}
export interface WatchMsg {
  readonly t: 'watch';
  /** ≤ 64 unit handles whose details go into the Watch section. */
  readonly handles: readonly number[];
}
export interface DebugMsg {
  readonly t: 'debug';
  /** Debug overlay / section bit set. */
  readonly flags: number;
}
export interface DevReloadMsg {
  readonly t: 'devReload';
}
export interface ExportLogMsg {
  readonly t: 'exportLog';
}

/** Control messages (ctl channel). */
export type CtlMessage =
  | PauseMsg
  | ResumeMsg
  | SpeedMsg
  | StepMsg
  | ViewerMsg
  | WatchMsg
  | DebugMsg
  | DevReloadMsg
  | ExportLogMsg;

/** A command batch (tick 0; the host stamps the application tick). `batch` is transferred. */
export interface CmdMessage {
  readonly t: 'cmd';
  readonly batch: ArrayBuffer;
}

/** First message to the sim host. */
export interface InitMessage {
  readonly t: 'init';
  /** Compiled blueprints (`sim.bin`). */
  readonly simBin: ArrayBuffer;
  readonly seed: number;
  readonly armyCount: number;
  readonly playerArmy: number;
  readonly transport: TransportKind;
  /** Frame triple buffer (transport 'sab' only). */
  readonly frameSab?: SharedArrayBuffer;
  /** Capacity of one frame slot in bytes. */
  readonly frameCapacity: number;
  readonly buildHash: string;
}

export type MainToHostMessage = InitMessage | CtlMessage | CmdMessage;

// ---- Host → Main -----------------------------------------------------------------------------

export interface ReadyMsg {
  readonly t: 'ready';
  readonly simId: number;
  readonly layoutHash: number;
  readonly transport: TransportKind;
}
export interface StatusMsg {
  readonly t: 'status';
  readonly tick: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly ticksBehind: number;
}
export interface PhaseStat {
  readonly id: number;
  readonly name: string;
  readonly p50Us: number;
  readonly p95Us: number;
}
export interface StatsMsg {
  readonly t: 'stats';
  readonly tickP50Us: number;
  readonly tickP95Us: number;
  readonly hashTickP95Us: number;
  readonly phases: readonly PhaseStat[];
}
export interface LogMsg {
  readonly t: 'log';
  /** Exported command log (replay bytes). */
  readonly bytes: ArrayBuffer;
}
export interface ErrorMsg {
  readonly t: 'error';
  readonly message: string;
}

export type HostMessage = ReadyMsg | StatusMsg | StatsMsg | LogMsg | ErrorMsg;

// ---- helpers ---------------------------------------------------------------------------------

/** Clamps a speed multiplier to [0.25, 3] and converts it to integer permille. */
export function speedToPermille(speed: number): number {
  if (!Number.isFinite(speed)) return 1000;
  const p = Math.floor(speed * 1000 + 1 / 2);
  return Math.min(SPEED_MAX_PERMILLE, Math.max(SPEED_MIN_PERMILLE, p));
}

/** Permille → multiplier. */
export function permilleToSpeed(permille: number): number {
  return permille / 1000;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isInt(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
}

/**
 * Validates an incoming main→host control message (untrusted structured-clone data).
 * Returns the message typed, or null if it is not a well-formed CtlMessage.
 */
export function parseCtlMessage(x: unknown): CtlMessage | null {
  if (!isObj(x)) return null;
  switch (x.t) {
    case 'pause':
    case 'resume':
    case 'devReload':
    case 'exportLog':
      return x as unknown as CtlMessage;
    case 'speed':
      return typeof x.speed === 'number' && Number.isFinite(x.speed) ? (x as unknown as SpeedMsg) : null;
    case 'step':
      return isInt(x.ticks, 1, 0x7fffffff) ? (x as unknown as StepMsg) : null;
    case 'viewer':
      return isInt(x.army, VIEWER_ALL, MAX_ARMIES - 1) ? (x as unknown as ViewerMsg) : null;
    case 'watch': {
      const h = x.handles;
      if (!Array.isArray(h) || h.length > MAX_WATCH) return null;
      for (const v of h) if (!isInt(v, 0, 0xffffffff)) return null;
      return x as unknown as WatchMsg;
    }
    case 'debug':
      return isInt(x.flags, 0, 0xffffffff) ? (x as unknown as DebugMsg) : null;
    default:
      return null;
  }
}

/** Validates an incoming `init` message; null if malformed. */
export function parseInitMessage(x: unknown): InitMessage | null {
  if (!isObj(x) || x.t !== 'init') return null;
  if (!(x.simBin instanceof ArrayBuffer)) return null;
  if (!isInt(x.seed, 0, 0xffffffff)) return null;
  if (!isInt(x.armyCount, 1, MAX_ARMIES) || !isInt(x.playerArmy, VIEWER_ALL, MAX_ARMIES - 1)) return null;
  if (x.transport !== 'sab' && x.transport !== 'transfer') return null;
  if (x.transport === 'sab' && (typeof SharedArrayBuffer === 'undefined' || !(x.frameSab instanceof SharedArrayBuffer))) {
    return null;
  }
  if (!isInt(x.frameCapacity, 16, 0x10000000) || typeof x.buildHash !== 'string') return null;
  return x as unknown as InitMessage;
}

/** Validates an incoming `cmd` message; null if malformed. */
export function parseCmdMessage(x: unknown): CmdMessage | null {
  if (!isObj(x) || x.t !== 'cmd' || !(x.batch instanceof ArrayBuffer)) return null;
  return x as unknown as CmdMessage;
}

/** Validates any main → host message (init, cmd or ctl); null if malformed or unknown. */
export function parseMainToHostMessage(x: unknown): MainToHostMessage | null {
  if (!isObj(x)) return null;
  if (x.t === 'init') return parseInitMessage(x);
  if (x.t === 'cmd') return parseCmdMessage(x);
  return parseCtlMessage(x);
}
