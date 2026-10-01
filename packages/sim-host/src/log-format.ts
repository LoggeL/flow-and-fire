/**
 * Command log format (PLAN §3.11 "Aufnahme"): an append-only binary stream written from tick 0,
 * persisted block by block (OPFS) so it survives a crash. It is the raw material of replays
 * (the `.rtsreplay` chunk container of PLAN §3.11 is built from it in MS11).
 *
 * Little-endian. Header (4-byte aligned, `headerBytes` long), version 2 (MS2):
 *
 *   0  u32 magic 'FAFL'            20 u32 bpSimHash
 *   4  u16 version (2)             24 u16 mapSizeWu
 *   6  u16 headerBytes             26 u8  armyCount
 *   8  u32 simId                   27 i8  playerArmy (−1 = none/observer)
 *  12  u32 layoutHash              28 u16 hashInterval (ticks)
 *  16  u32 seed                    30 u16 buildHash length n
 *  32  u32 mapSimHash (formats mapSimHash of the map the log was recorded on)
 *  36  u8[n] buildHash (UTF-8), zero padded to 4 bytes
 *
 * Version 1 (MS1) had no mapSimHash (buildHash at 32) and always ran on the flat test plane;
 * the reader still accepts it and reports the MS1 plane identity
 * {@link legacyTestPlaneMapSimHash}(mapSizeWu) (such a log never replays under MS2: its simId
 * carries the MS1 SIM_BUILD).
 *
 * Entries follow, each a 16-byte entry header plus `dataLength` bytes zero padded to 4:
 *
 *   0 u8 kind | 1 u8 sub | 2 u16 aux | 4 u32 tick | 8 u32 dataLength | 12 u32 check
 *
 * `check` = xxHash32(data, seed = tick ^ (kind << 24 | sub << 16 | aux)); a torn or corrupt tail
 * (crash while appending) is detected and cut off by the parser.
 *
 * Kinds: CMDS (data = command batch as applied, envelope ticks = application tick),
 *        MARK (sub = MarkKind, data = u32 value), HASH (data = u32 rule hash of that tick),
 *        END  (no data; tick = last simulated tick, written on export/close).
 * Entries are appended in tick order.
 */

import { xxHash32 } from '@faf/fixed';
import { decodeSkirmishInitialization, encodeSkirmishInitialization, validateSkirmishInitialization, decodeUtf8, encodeUtf8, type SkirmishInitialization } from '@faf/protocol';

/**
 * mapSimHash that MS1 used for its flat test plane (no map file): xxHash32 of a canonical
 * description string. Only for reading version-1 log headers; since MS2 the test plane is a
 * generated map with a regular formats mapSimHash.
 */
export function legacyTestPlaneMapSimHash(mapSizeWu: number): number {
  const b = encodeUtf8(`faf-map:testplane:v1:size=${mapSizeWu}`);
  return xxHash32(b, 0, b.length, 0) >>> 0;
}

export const LOG_MAGIC = 0x4c464146; // 'FAFL' little-endian
/** Version 4 records complete deterministic skirmish slots and rules. */
export const LOG_VERSION = 4;
/** Oldest version the reader accepts (1: MS1, test plane only). */
export const LOG_MIN_VERSION = 1;
/** Fixed header size of the current version (buildHash follows). */
export const LOG_FIXED_HEADER_BYTES = 40;
/** Fixed header size of version 2 (mapSimHash, no initialization). */
export const LOG_V2_FIXED_HEADER_BYTES = 36;
/** Fixed header size of version 1. */
export const LOG_V1_FIXED_HEADER_BYTES = 32;
export const LOG_ENTRY_HEADER_BYTES = 16;

export const LogEntryKind = {
  Cmds: 1,
  Mark: 2,
  Hash: 3,
  End: 4,
} as const;
export type LogEntryKind = (typeof LogEntryKind)[keyof typeof LogEntryKind];

/** MARK sub-kinds (append-only). Cheat, DevReload and Restore taint the log. */
export const MarkKind = {
  Pause: 1,
  Resume: 2,
  /** value = speed in ‰ */
  Speed: 3,
  /** A command batch of this tick contained Op.Cheat. */
  Cheat: 4,
  DevReload: 5,
  /** value = number of ticks requested */
  Step: 6,
  /** The arena was restored from a snapshot at this tick (history before it is not in the log). */
  Restore: 7,
  /** AI exceeded its committed-manager time budget; value = army. */
  AiTimeout: 8,
} as const;
export type MarkKind = (typeof MarkKind)[keyof typeof MarkKind];

export const MARK_NAMES: readonly string[] = ['', 'pause', 'resume', 'speed', 'cheat', 'devReload', 'step', 'restore', 'aiTimeout'];

/** True for marks that taint a log (not valid for ranked/verification purposes). */
export function isTaintMark(kind: number): boolean {
  return kind === MarkKind.Cheat || kind === MarkKind.DevReload || kind === MarkKind.Restore;
}

export type LogInitialization = SkirmishInitialization;

export interface LogHeader {
  readonly simId: number;
  readonly layoutHash: number;
  readonly seed: number;
  readonly bpSimHash: number;
  readonly mapSizeWu: number;
  readonly armyCount: number;
  readonly playerArmy: number;
  readonly hashInterval: number;
  readonly buildHash: string;
  /** formats mapSimHash of the map the log was recorded on (u32; v1 logs: legacyTestPlaneMapSimHash). */
  readonly mapSimHash: number;
  /** Absent means the historical empty world; skirmish setup runs before tick 0. */
  readonly initialization?: LogInitialization;
}

export function align4(n: number): number {
  return (n + 3) & ~3;
}

/** Encodes the log header. */
export function encodeLogHeader(h: LogHeader): Uint8Array {
  if (h.initialization !== undefined) validateSkirmishInitialization(h.initialization, h.armyCount);
  const setup = h.initialization === undefined ? new Uint8Array(0) : encodeSkirmishInitialization(h.initialization);
  const bh = encodeUtf8(h.buildHash);
  if (bh.length > 0xffff) throw new RangeError('buildHash too long');
  const total = align4(LOG_FIXED_HEADER_BYTES + bh.length + setup.length);
  if (total > 0xffff) throw new RangeError('log header too long');
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, LOG_MAGIC, true);
  dv.setUint16(4, LOG_VERSION, true);
  dv.setUint16(6, total, true);
  dv.setUint32(8, h.simId >>> 0, true);
  dv.setUint32(12, h.layoutHash >>> 0, true);
  dv.setUint32(16, h.seed >>> 0, true);
  dv.setUint32(20, h.bpSimHash >>> 0, true);
  dv.setUint16(24, h.mapSizeWu, true);
  dv.setUint8(26, h.armyCount);
  dv.setInt8(27, h.playerArmy);
  dv.setUint16(28, h.hashInterval, true);
  dv.setUint16(30, bh.length, true);
  dv.setUint32(32, h.mapSimHash >>> 0, true);
  dv.setUint32(36, setup.length, true);
  out.set(bh, LOG_FIXED_HEADER_BYTES);
  out.set(setup, LOG_FIXED_HEADER_BYTES + bh.length);
  return out;
}

/** Seed of an entry's check hash. */
export function entryCheckSeed(kind: number, sub: number, aux: number, tick: number): number {
  return (tick ^ ((kind << 24) | (sub << 16) | aux)) | 0;
}

/** Check value of an entry. */
export function entryCheck(kind: number, sub: number, aux: number, tick: number, data: Uint8Array, off: number, len: number): number {
  return xxHash32(data, off, len, entryCheckSeed(kind, sub, aux, tick));
}

// ---- parsing ---------------------------------------------------------------------------------

export interface LogCmdEntry {
  readonly tick: number;
  /** Byte offset of the batch inside `ParsedCommandLog.bytes`. */
  readonly offset: number;
  readonly length: number;
}
export interface LogMarkEntry {
  readonly tick: number;
  readonly kind: number;
  readonly value: number;
}
export interface LogHashEntry {
  readonly tick: number;
  readonly hash: number;
}

export interface ParsedCommandLog {
  readonly header: LogHeader;
  /** Header version of the file (1 = MS1, 2 = map, 3 = basic setup, 4 = full setup). */
  readonly version: number;
  readonly bytes: Uint8Array;
  readonly commands: readonly LogCmdEntry[];
  readonly marks: readonly LogMarkEntry[];
  readonly hashes: readonly LogHashEntry[];
  /** Tick of the END entry, or −1 if the log was not closed (crash / live log). */
  readonly endTick: number;
  /** Last simulated tick: END tick, else the largest tick of any entry (0 if none). */
  readonly lastTick: number;
  /** True if a cheat/devReload/restore mark exists. */
  readonly tainted: boolean;
  /** True if a torn/corrupt tail was cut off. */
  readonly truncated: boolean;
  /** Bytes of valid entries (header included). */
  readonly validBytes: number;
}

export class CommandLogError extends Error {
  override readonly name = 'CommandLogError';
}

/** Header text field (strict UTF-8); malformed bytes mean a corrupt header. */
function decodeHeaderText(bytes: Uint8Array, offset: number, length: number): string {
  try {
    return decodeUtf8(bytes, offset, length);
  } catch {
    throw new CommandLogError('corrupt command log header (buildHash is not UTF-8)');
  }
}

/**
 * Parses only the header (versions 1 to 4). Throws CommandLogError if it is not a command log.
 * A version-1 header (MS1) gets mapSimHash = legacyTestPlaneMapSimHash(mapSizeWu): MS1 only knew
 * the flat test plane.
 */
export function parseLogHeader(bytes: Uint8Array): { header: LogHeader; headerBytes: number; version: number } {
  if (bytes.length < LOG_V1_FIXED_HEADER_BYTES) throw new CommandLogError('command log too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== LOG_MAGIC) throw new CommandLogError('not a command log (magic)');
  const ver = dv.getUint16(4, true);
  if (ver < LOG_MIN_VERSION || ver > LOG_VERSION) throw new CommandLogError(`unsupported command log version ${ver}`);
  const fixed = ver === 1 ? LOG_V1_FIXED_HEADER_BYTES : ver === 2 ? LOG_V2_FIXED_HEADER_BYTES : LOG_FIXED_HEADER_BYTES;
  const headerBytes = dv.getUint16(6, true);
  const bhLen = dv.getUint16(30, true);
  if (bytes.length < fixed) throw new CommandLogError('command log header too short');
  const setupLength = ver === 4 ? dv.getUint32(36, true) : 0;
  if (headerBytes !== align4(fixed + bhLen + setupLength) || headerBytes > bytes.length || headerBytes < fixed) {
    throw new CommandLogError('corrupt command log header');
  }
  const mapSizeWu = dv.getUint16(24, true);
  let initialization: LogInitialization | undefined;
  if (ver === 3) {
    const kind = dv.getUint8(36), faction = dv.getUint8(37);
    if (dv.getUint16(38, true) !== 0 || kind > 1 || (kind === 0 && faction !== 0)) {
      throw new CommandLogError('corrupt command log initialization');
    }
    if (kind === 1) initialization = { kind: 'skirmish', faction };
  }
  if (ver === 4 && setupLength !== 0) {
    try { initialization = decodeSkirmishInitialization(bytes.subarray(fixed + bhLen, fixed + bhLen + setupLength)); validateSkirmishInitialization(initialization, dv.getUint8(26)); }
    catch { throw new CommandLogError('corrupt command log initialization'); }
  }
  const header: LogHeader = {
    simId: dv.getUint32(8, true),
    layoutHash: dv.getUint32(12, true),
    seed: dv.getUint32(16, true),
    bpSimHash: dv.getUint32(20, true),
    mapSizeWu,
    armyCount: dv.getUint8(26),
    playerArmy: dv.getInt8(27),
    hashInterval: dv.getUint16(28, true),
    buildHash: decodeHeaderText(bytes, fixed, bhLen),
    mapSimHash: ver === 1 ? legacyTestPlaneMapSimHash(mapSizeWu) : dv.getUint32(32, true),
    ...(initialization !== undefined ? { initialization } : {}),
  };
  return { header, headerBytes, version: ver };
}

/**
 * Parses a command log. A torn or corrupt tail (incomplete entry, bad check value, unknown kind,
 * tick going backwards) ends parsing with `truncated = true`; everything before stays usable.
 */
export function parseCommandLog(input: Uint8Array | ArrayBuffer): ParsedCommandLog {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { header, headerBytes, version } = parseLogHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commands: LogCmdEntry[] = [];
  const marks: LogMarkEntry[] = [];
  const hashes: LogHashEntry[] = [];
  let endTick = -1;
  let lastTick = 0;
  let tainted = false;
  let truncated = false;
  let p = headerBytes;
  while (p < bytes.length) {
    if (p + LOG_ENTRY_HEADER_BYTES > bytes.length) {
      truncated = true;
      break;
    }
    const kind = dv.getUint8(p);
    const sub = dv.getUint8(p + 1);
    const aux = dv.getUint16(p + 2, true);
    const tick = dv.getUint32(p + 4, true);
    const len = dv.getUint32(p + 8, true);
    const check = dv.getUint32(p + 12, true);
    const data = p + LOG_ENTRY_HEADER_BYTES;
    const next = data + align4(len);
    if (next > bytes.length || data + len > bytes.length || tick < lastTick || endTick >= 0) {
      truncated = true;
      break;
    }
    if (entryCheck(kind, sub, aux, tick, bytes, data, len) !== check) {
      truncated = true;
      break;
    }
    let ok = true;
    switch (kind) {
      case LogEntryKind.Cmds:
        commands.push({ tick, offset: data, length: len });
        break;
      case LogEntryKind.Mark:
        if (len !== 4) ok = false;
        else {
          marks.push({ tick, kind: sub, value: dv.getUint32(data, true) });
          if (isTaintMark(sub)) tainted = true;
        }
        break;
      case LogEntryKind.Hash:
        if (len !== 4) ok = false;
        else hashes.push({ tick, hash: dv.getUint32(data, true) });
        break;
      case LogEntryKind.End:
        endTick = tick;
        break;
      default:
        ok = false;
    }
    if (!ok) {
      truncated = true;
      break;
    }
    lastTick = tick;
    p = next;
  }
  return {
    header,
    version,
    bytes,
    commands,
    marks,
    hashes,
    endTick,
    lastTick: endTick >= 0 ? endTick : lastTick,
    tainted,
    truncated,
    validBytes: p,
  };
}
