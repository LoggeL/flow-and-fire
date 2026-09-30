/**
 * HEAD, GAME, HASH and MARK chunks of .rtsreplay (PLAN §3.11). All integers little-endian, every
 * chunk starts with u16 chunkVersion (each chunk its own constant: HEAD_CHUNK_VERSION, …);
 * strings are u16 byte length + strict UTF-8. Readers are strict: out-of-range values, non-zero
 * reserved bytes, truncation and trailing bytes throw FormatError; a chunkVersion newer than this
 * build throws 'unsupported-version'.
 *
 * HEAD  u16 chunkVersion | u16 formatVersion | u16 protocolVersion | u16 hashInterval
 *       | u16 subHashInterval | u16 sourceLogVersion | u32 simId | u32 bpSimHash | u32 mapSimHash
 *       | u32 layoutHash | u32 flags | str simBuild | str buildHash
 *       FROZEN PREFIX: this layout up to and including buildHash is the same in every HEAD
 *       version; later versions may only append fields after buildHash. decodeHeadPrefix reads it
 *       for any version (tolerant reader, build redirect). A protocolVersion other than
 *       COMMAND_BATCH_VERSION (older or newer) is 'unsupported-version' for the strict reader: the
 *       CMDS batches of another protocol cannot be decoded by this build.
 * GAME  u16 chunkVersion | u32 seed | u16 mapSizeWu | u8 armyCount (≤ 16) | i8 playerArmy (−1 =
 *       observer, else one of the army indexes) | u8[32] alliances (bit a·16+b) | str mapName
 *       | armyCount × { u8 index (< 16, strictly ascending) | u8 kind (0 human, 1 AI, 2 observer)
 *       | u8 team | u16 aixPermille | str name | str aiProfile | str faction }
 * HASH  u16 chunkVersion | u16 interval | u32 firstTick | u32 count | u32[count] rule hashes (tick
 *       firstTick + i·interval) | u16 subInterval | u32 subFirstTick | u8 regionCount
 *       | regionCount × { u8 length | ASCII name (0x20..0x7e, unique) } | u32 subCount
 *       | u32[subCount · regionCount] sub-hashes (row k = tick subFirstTick + k·subInterval).
 *       count > 0 needs interval ≥ 1, subCount > 0 needs subInterval ≥ 1 and regions; an empty
 *       list stores first tick 0.
 * MARK  u16 chunkVersion | u32 count | count × { u32 tick | u8 kind (≥ 1) | u8[3] reserved (0)
 *       | u32 value }, ticks non-decreasing; unknown kinds are kept.
 */

import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import { FormatError } from '../errors.ts';
import { ByteReader, ByteWriter } from './bytes.ts';
import {
  GAME_CHUNK_VERSION,
  HASH_CHUNK_VERSION,
  HEAD_CHUNK_VERSION,
  MARK_CHUNK_VERSION,
  RTSREPLAY_FORMAT_VERSION,
  ReplayChunkId,
  type ReplayArmy,
  type ReplayGame,
  type ReplayHashes,
  type ReplayHead,
  type ReplayMark,
} from './types.ts';

export const REPLAY_MAX_ARMIES = 16;
export const ALLIANCE_BYTES = 32;
export const MAX_REGION_NAME_BYTES = 255;

function isU(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

function checkU(chunk: string, what: string, v: unknown, max: number): number {
  if (!isU(v, max)) throw new FormatError('bad-value', `${what} must be an integer 0..${max}, got ${String(v)}`, chunk);
  return v;
}

/** Reads the chunk version; newer than `max` → 'unsupported-version', 0 → 'bad-value'. */
export function readChunkVersion(r: ByteReader, max: number): number {
  const v = r.u16('chunk version');
  if (v > max) {
    throw new FormatError('unsupported-version', `${r.chunkId} chunk version ${v} is newer than ${max}`, r.chunkId, r.chunkOffset);
  }
  if (v === 0) r.fail('bad-value', 'chunk version 0');
  return v;
}

// ---- HEAD ------------------------------------------------------------------------------------

export function validateHead(h: ReplayHead): void {
  const C = ReplayChunkId.Head;
  if (h.formatVersion !== RTSREPLAY_FORMAT_VERSION) {
    throw new FormatError('bad-value', `head.formatVersion must be ${RTSREPLAY_FORMAT_VERSION}, got ${String(h.formatVersion)}`, C);
  }
  if (h.protocolVersion !== COMMAND_BATCH_VERSION) {
    throw new FormatError('bad-value', `head.protocolVersion must be ${COMMAND_BATCH_VERSION} (COMMAND_BATCH_VERSION), got ${String(h.protocolVersion)}`, C);
  }
  checkU(C, 'hashInterval', h.hashInterval, 0xffff);
  checkU(C, 'subHashInterval', h.subHashInterval, 0xffff);
  checkU(C, 'sourceLogVersion', h.sourceLogVersion, 0xffff);
  checkU(C, 'simId', h.simId, 0xffffffff);
  checkU(C, 'bpSimHash', h.bpSimHash, 0xffffffff);
  checkU(C, 'mapSimHash', h.mapSimHash, 0xffffffff);
  checkU(C, 'layoutHash', h.layoutHash, 0xffffffff);
  checkU(C, 'flags', h.flags, 0xffffffff);
}

export function encodeHead(h: ReplayHead): Uint8Array {
  validateHead(h);
  const C = ReplayChunkId.Head;
  const w = new ByteWriter(64);
  w.u16(HEAD_CHUNK_VERSION);
  w.u16(h.formatVersion);
  w.u16(h.protocolVersion);
  w.u16(h.hashInterval);
  w.u16(h.subHashInterval);
  w.u16(h.sourceLogVersion);
  w.u32(h.simId);
  w.u32(h.bpSimHash);
  w.u32(h.mapSimHash);
  w.u32(h.layoutHash);
  w.u32(h.flags);
  w.str16(h.simBuild, C, 'simBuild');
  w.str16(h.buildHash, C, 'buildHash');
  return w.finish();
}

/** The frozen HEAD prefix (all HEAD versions) plus the chunk version. */
export interface HeadPrefix extends ReplayHead {
  readonly chunkVersion: number;
}

/**
 * Reads the frozen HEAD prefix of any HEAD version (no version or value checks beyond the byte
 * layout; bytes after buildHash are ignored). `r` is left behind buildHash.
 */
function readHeadPrefix(r: ByteReader): HeadPrefix {
  const chunkVersion = r.u16('chunk version');
  if (chunkVersion === 0) r.fail('bad-value', 'chunk version 0');
  const formatVersion = r.u16('formatVersion');
  const protocolVersion = r.u16('protocolVersion');
  const hashInterval = r.u16('hashInterval');
  const subHashInterval = r.u16('subHashInterval');
  const sourceLogVersion = r.u16('sourceLogVersion');
  const simId = r.u32('simId');
  const bpSimHash = r.u32('bpSimHash');
  const mapSimHash = r.u32('mapSimHash');
  const layoutHash = r.u32('layoutHash');
  const flags = r.u32('flags');
  const simBuild = r.str16('simBuild');
  const buildHash = r.str16('buildHash');
  return { chunkVersion, formatVersion, simBuild, buildHash, simId, bpSimHash, mapSimHash, layoutHash, protocolVersion, hashInterval, subHashInterval, flags, sourceLogVersion };
}

/** Tolerant HEAD read (any chunk / format / protocol version): the frozen prefix. */
export function decodeHeadPrefix(data: Uint8Array, chunkOffset: number): HeadPrefix {
  return readHeadPrefix(new ByteReader(data, ReplayChunkId.Head, chunkOffset));
}

export function decodeHead(data: Uint8Array, chunkOffset: number, containerFormatVersion: number): ReplayHead {
  const r = new ByteReader(data, ReplayChunkId.Head, chunkOffset);
  const p = readHeadPrefix(r);
  if (p.chunkVersion > HEAD_CHUNK_VERSION) {
    throw new FormatError('unsupported-version', `HEAD chunk version ${p.chunkVersion} is newer than ${HEAD_CHUNK_VERSION}`, ReplayChunkId.Head, chunkOffset);
  }
  if (p.formatVersion !== containerFormatVersion) {
    r.fail('bad-value', `formatVersion ${p.formatVersion} differs from the container's ${containerFormatVersion}`);
  }
  if (p.protocolVersion !== COMMAND_BATCH_VERSION) {
    throw new FormatError(
      'unsupported-version',
      `command protocol version ${p.protocolVersion} is ${p.protocolVersion > COMMAND_BATCH_VERSION ? 'newer' : 'older'} than this build's ${COMMAND_BATCH_VERSION}`,
      ReplayChunkId.Head,
      chunkOffset,
    );
  }
  r.done('HEAD');
  return {
    formatVersion: p.formatVersion,
    simBuild: p.simBuild,
    buildHash: p.buildHash,
    simId: p.simId,
    bpSimHash: p.bpSimHash,
    mapSimHash: p.mapSimHash,
    layoutHash: p.layoutHash,
    protocolVersion: p.protocolVersion,
    hashInterval: p.hashInterval,
    subHashInterval: p.subHashInterval,
    flags: p.flags,
    sourceLogVersion: p.sourceLogVersion,
  };
}

// ---- GAME ------------------------------------------------------------------------------------

export function validateGame(g: ReplayGame): void {
  const C = ReplayChunkId.Game;
  checkU(C, 'seed', g.seed, 0xffffffff);
  checkU(C, 'mapSizeWu', g.mapSizeWu, 0xffff);
  if (!(g.alliances instanceof Uint8Array) || g.alliances.length !== ALLIANCE_BYTES) {
    throw new FormatError('bad-value', `alliances must be a Uint8Array of ${ALLIANCE_BYTES} bytes`, C);
  }
  if (!Array.isArray(g.armies) || g.armies.length > REPLAY_MAX_ARMIES) {
    throw new FormatError('bad-value', `armies must be an array of at most ${REPLAY_MAX_ARMIES}`, C);
  }
  let prev = -1;
  let playerFound = g.playerArmy === -1;
  for (const a of g.armies) {
    checkU(C, 'army.index', a.index, REPLAY_MAX_ARMIES - 1);
    if (a.index <= prev) throw new FormatError('bad-value', 'army indexes must be strictly ascending', C);
    prev = a.index;
    checkU(C, 'army.kind', a.kind, 2);
    checkU(C, 'army.team', a.team, 0xff);
    checkU(C, 'army.aixPermille', a.aixPermille, 0xffff);
    if (a.index === g.playerArmy) playerFound = true;
  }
  if (typeof g.playerArmy !== 'number' || !Number.isInteger(g.playerArmy) || !playerFound) {
    throw new FormatError('bad-value', `playerArmy ${String(g.playerArmy)} is neither −1 nor an army index`, C);
  }
}

export function encodeGame(g: ReplayGame): Uint8Array {
  validateGame(g);
  const C = ReplayChunkId.Game;
  const w = new ByteWriter(128);
  w.u16(GAME_CHUNK_VERSION);
  w.u32(g.seed);
  w.u16(g.mapSizeWu);
  w.u8(g.armies.length);
  w.i8(g.playerArmy);
  w.bytes(g.alliances);
  w.str16(g.mapName, C, 'mapName');
  for (const a of g.armies) {
    w.u8(a.index);
    w.u8(a.kind);
    w.u8(a.team);
    w.u16(a.aixPermille);
    w.str16(a.name, C, 'army.name');
    w.str16(a.aiProfile, C, 'army.aiProfile');
    w.str16(a.faction, C, 'army.faction');
  }
  return w.finish();
}

export function decodeGame(data: Uint8Array, chunkOffset: number): ReplayGame {
  const r = new ByteReader(data, ReplayChunkId.Game, chunkOffset);
  readChunkVersion(r, GAME_CHUNK_VERSION);
  const seed = r.u32('seed');
  const mapSizeWu = r.u16('mapSizeWu');
  const armyCount = r.u8('armyCount');
  if (armyCount > REPLAY_MAX_ARMIES) r.fail('bad-value', `army count ${armyCount} exceeds ${REPLAY_MAX_ARMIES}`);
  const playerArmy = r.i8('playerArmy');
  const alliances = r.take(ALLIANCE_BYTES, 'alliances').slice();
  const mapName = r.str16('mapName');
  const armies: ReplayArmy[] = [];
  let prev = -1;
  let playerFound = playerArmy === -1;
  for (let i = 0; i < armyCount; i++) {
    const index = r.u8('army index');
    if (index >= REPLAY_MAX_ARMIES || index <= prev) r.fail('bad-value', `army index ${index} out of range or not ascending`);
    prev = index;
    const kind = r.u8('army kind');
    if (kind > 2) r.fail('bad-value', `army kind ${kind} unknown`);
    const team = r.u8('army team');
    const aixPermille = r.u16('army aixPermille');
    const name = r.str16('army name');
    const aiProfile = r.str16('army aiProfile');
    const faction = r.str16('army faction');
    if (index === playerArmy) playerFound = true;
    armies.push({ index, kind, team, aixPermille, name, aiProfile, faction });
  }
  if (!playerFound) r.fail('bad-value', `playerArmy ${playerArmy} is neither −1 nor an army index`);
  r.done('GAME');
  return { seed, mapName, mapSizeWu, playerArmy, armies, alliances };
}

// ---- HASH ------------------------------------------------------------------------------------

function isRegionName(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_REGION_NAME_BYTES) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

export function validateHashes(h: ReplayHashes): void {
  const C = ReplayChunkId.Hash;
  checkU(C, 'hashes.interval', h.interval, 0xffff);
  checkU(C, 'hashes.firstTick', h.firstTick, 0xffffffff);
  checkU(C, 'hashes.subInterval', h.subInterval, 0xffff);
  checkU(C, 'hashes.subFirstTick', h.subFirstTick, 0xffffffff);
  if (!(h.hashes instanceof Uint32Array) || !(h.subHashes instanceof Uint32Array)) {
    throw new FormatError('bad-value', 'hashes and subHashes must be Uint32Arrays', C);
  }
  const n = h.hashes.length;
  if (n > 0 && h.interval === 0) throw new FormatError('bad-value', 'rule hashes need an interval ≥ 1', C);
  if (n === 0 && h.firstTick !== 0) throw new FormatError('bad-value', 'an empty rule hash list must have firstTick 0', C);
  if (n > 0 && h.firstTick + (n - 1) * h.interval > 0xffffffff) throw new FormatError('bad-value', 'rule hash ticks exceed u32', C);
  if (!Array.isArray(h.regionNames) || h.regionNames.length > 0xff) throw new FormatError('bad-value', 'regionNames must be an array of at most 255', C);
  for (let i = 0; i < h.regionNames.length; i++) {
    const name = h.regionNames[i];
    if (!isRegionName(name)) throw new FormatError('bad-value', `region name ${JSON.stringify(name)} must be 1..255 printable ASCII characters`, C);
    for (let j = 0; j < i; j++) if (h.regionNames[j] === name) throw new FormatError('bad-value', `duplicate region name '${name}'`, C);
  }
  const rc = h.regionNames.length;
  const sn = h.subHashes.length;
  if (rc === 0 ? sn !== 0 : sn % rc !== 0) throw new FormatError('bad-value', `${sn} sub-hashes do not fill rows of ${rc} regions`, C);
  const rows = rc === 0 ? 0 : Math.floor(sn / rc);
  if (rows > 0 && h.subInterval === 0) throw new FormatError('bad-value', 'sub-hashes need a subInterval ≥ 1', C);
  if (rows === 0 && h.subFirstTick !== 0) throw new FormatError('bad-value', 'an empty sub-hash list must have subFirstTick 0', C);
  if (rows > 0 && h.subFirstTick + (rows - 1) * h.subInterval > 0xffffffff) throw new FormatError('bad-value', 'sub-hash ticks exceed u32', C);
}

export function encodeHashes(h: ReplayHashes): Uint8Array {
  validateHashes(h);
  const rc = h.regionNames.length;
  const rows = rc === 0 ? 0 : (h.subHashes.length / rc) | 0;
  const w = new ByteWriter(32 + h.hashes.length * 4 + h.subHashes.length * 4);
  w.u16(HASH_CHUNK_VERSION);
  w.u16(h.interval);
  w.u32(h.firstTick);
  w.u32(h.hashes.length);
  for (let i = 0; i < h.hashes.length; i++) w.u32(h.hashes[i]!);
  w.u16(h.subInterval);
  w.u32(h.subFirstTick);
  w.u8(rc);
  for (const name of h.regionNames) {
    w.u8(name.length);
    for (let i = 0; i < name.length; i++) w.u8(name.charCodeAt(i));
  }
  w.u32(rows);
  for (let i = 0; i < h.subHashes.length; i++) w.u32(h.subHashes[i]!);
  return w.finish();
}

function readU32Array(r: ByteReader, n: number, what: string): Uint32Array {
  r.need(n * 4, what);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.u32(what);
  return out;
}

export function decodeHashes(data: Uint8Array, chunkOffset: number): ReplayHashes {
  const r = new ByteReader(data, ReplayChunkId.Hash, chunkOffset);
  readChunkVersion(r, HASH_CHUNK_VERSION);
  const interval = r.u16('interval');
  const firstTick = r.u32('firstTick');
  const count = r.u32('count');
  if (count > 0 && interval === 0) r.fail('bad-value', 'rule hashes need an interval ≥ 1');
  if (count === 0 && firstTick !== 0) r.fail('non-canonical', 'an empty rule hash list must have firstTick 0');
  if (count > 0 && firstTick + (count - 1) * interval > 0xffffffff) r.fail('bad-value', 'rule hash ticks exceed u32');
  const hashes = readU32Array(r, count, 'rule hashes');
  const subInterval = r.u16('subInterval');
  const subFirstTick = r.u32('subFirstTick');
  const rc = r.u8('regionCount');
  const regionNames: string[] = [];
  for (let i = 0; i < rc; i++) {
    const n = r.u8('region name length');
    const b = r.take(n, 'region name');
    let s = '';
    for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]!);
    if (!isRegionName(s)) r.fail('bad-value', 'region names must be 1..255 printable ASCII characters');
    for (const prev of regionNames) if (prev === s) r.fail('bad-value', `duplicate region name '${s}'`);
    regionNames.push(s);
  }
  const rows = r.u32('subCount');
  if (rows > 0 && rc === 0) r.fail('bad-value', 'sub-hash rows without regions');
  if (rows > 0 && subInterval === 0) r.fail('bad-value', 'sub-hashes need a subInterval ≥ 1');
  if (rows === 0 && subFirstTick !== 0) r.fail('non-canonical', 'an empty sub-hash list must have subFirstTick 0');
  if (rows > 0 && subFirstTick + (rows - 1) * subInterval > 0xffffffff) r.fail('bad-value', 'sub-hash ticks exceed u32');
  if (rows > Math.floor(r.remaining / 4)) r.fail('truncated', `${rows} sub-hash rows do not fit`);
  const subHashes = readU32Array(r, rows * rc, 'sub-hashes');
  r.done('HASH');
  return { interval, firstTick, hashes, subInterval, subFirstTick, regionNames, subHashes };
}

// ---- MARK ------------------------------------------------------------------------------------

export const MARK_RECORD_BYTES = 12;

export function validateMarks(marks: readonly ReplayMark[]): void {
  const C = ReplayChunkId.Mark;
  if (!Array.isArray(marks)) throw new FormatError('bad-value', 'marks must be an array', C);
  let prev = 0;
  for (const m of marks) {
    checkU(C, 'mark.tick', m.tick, 0xffffffff);
    checkU(C, 'mark.value', m.value, 0xffffffff);
    if (!isU(m.kind, 0xff) || m.kind === 0) throw new FormatError('bad-value', `mark kind must be 1..255, got ${String(m.kind)}`, C);
    if (m.tick < prev) throw new FormatError('bad-value', `mark ticks must not decrease (${m.tick} after ${prev})`, C);
    prev = m.tick;
  }
}

export function encodeMarks(marks: readonly ReplayMark[]): Uint8Array {
  validateMarks(marks);
  const w = new ByteWriter(6 + marks.length * MARK_RECORD_BYTES);
  w.u16(MARK_CHUNK_VERSION);
  w.u32(marks.length);
  for (const m of marks) {
    w.u32(m.tick);
    w.u8(m.kind);
    w.u8(0);
    w.u8(0);
    w.u8(0);
    w.u32(m.value);
  }
  return w.finish();
}

export function decodeMarks(data: Uint8Array, chunkOffset: number): ReplayMark[] {
  const r = new ByteReader(data, ReplayChunkId.Mark, chunkOffset);
  readChunkVersion(r, MARK_CHUNK_VERSION);
  const count = r.u32('count');
  if (count > Math.floor(r.remaining / MARK_RECORD_BYTES)) r.fail('truncated', `${count} marks do not fit`);
  const marks: ReplayMark[] = [];
  let prev = 0;
  for (let i = 0; i < count; i++) {
    const tick = r.u32('mark tick');
    const kind = r.u8('mark kind');
    if (kind === 0) r.fail('bad-value', 'mark kind 0');
    if (r.u8('reserved') !== 0 || r.u8('reserved') !== 0 || r.u8('reserved') !== 0) r.fail('bad-reserved', 'mark reserved bytes must be 0');
    const value = r.u32('mark value');
    if (tick < prev) r.fail('bad-value', `mark ticks must not decrease (${tick} after ${prev})`);
    prev = tick;
    marks.push({ tick, kind, value });
  }
  r.done('MARK');
  return marks;
}
