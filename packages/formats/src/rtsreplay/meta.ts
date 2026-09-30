/**
 * META chunk of .rtsreplay: names, duration, result and a short statistics summary (PLAN §3.11).
 *
 *   u16 chunkVersion (1) | canonical JSON (UTF-8)
 *
 * Canonical JSON: object keys sorted by UTF-16 code units, no whitespace, integers only (safe
 * integers, no exponent/fraction, no −0), strings as JSON.stringify writes them, well-formed
 * Unicode only. The document has the keys
 *
 *   {"durationTicks":u32,"endTick":u32,"extra":{string:string},
 *    "players":[{"army":0..15,"name":string}],"result":{"reason":string,"winner":int ≥ −1},
 *    "stats":{string:safe integer}}
 *
 * plus any further top-level keys of newer builds (forward compatibility: additive extensions
 * need no new chunk version). They are kept verbatim as canonical JSON text in
 * `ReplayMeta.extensions` (values: any JSON, canonical = sorted keys, no whitespace, numbers as
 * JSON.stringify writes them) and written back in key order. The nested objects (players entries,
 * result) keep exactly their keys; new per-build information belongs into `extra` or a new
 * top-level key.
 *
 * The reader parses, checks every value (Number.isInteger / types / ranges) and re-serializes:
 * anything that does not reproduce the chunk bytes exactly (key order, whitespace, escapes,
 * duplicate keys, 1e3, 1.0 …) is FormatError 'non-canonical'.
 */

import { decodeUtf8 } from '@faf/protocol';
import { FormatError } from '../errors.ts';
import { ByteReader, ByteWriter, encodeText } from './bytes.ts';
import { readChunkVersion } from './chunks.ts';
import { META_CHUNK_VERSION, ReplayChunkId, type ReplayMeta, type ReplayMetaPlayer } from './types.ts';

const C = ReplayChunkId.Meta;
const MAX_ARMY = 15;

function bad(detail: string, offset = -1): never {
  throw new FormatError('bad-value', detail, C, offset);
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isSafeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function checkIntRange(what: string, v: unknown, lo: number, hi: number): number {
  if (!isSafeInt(v) || v < lo || v > hi) bad(`${what} must be an integer ${lo}..${hi}, got ${String(v)}`);
  return v;
}

function checkString(what: string, v: unknown): string {
  if (typeof v !== 'string') bad(`${what} must be a string`);
  encodeText(v, C, what); // rejects lone surrogates
  return v;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function checkKey(what: string, k: string): void {
  // '__proto__' would turn into a prototype assignment when the record is rebuilt.
  if (k === '__proto__') bad(`${what} key '__proto__' is not allowed`);
  checkString(`${what} key`, k);
}

function sortedKeys(o: object): string[] {
  return Object.keys(o).sort(compareKeys);
}

/** Top-level keys of the META document this build knows (sorted). */
const KNOWN_KEYS: readonly string[] = ['durationTicks', 'endTick', 'extra', 'players', 'result', 'stats'];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Canonical JSON of any parsed JSON value (sorted keys, no whitespace); throws for non-finite numbers. */
function canonicalJson(v: Json, what: string): string {
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad(`${what}: number ${String(v)} is not finite`);
    return JSON.stringify(v);
  }
  if (typeof v === 'string') {
    encodeText(v, C, what); // rejects lone surrogates
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, what)).join(',')}]`;
  let out = '';
  for (const k of sortedKeys(v)) {
    if (k === '__proto__') bad(`${what}: key '__proto__' is not allowed`);
    out += `${out.length > 0 ? ',' : ''}${JSON.stringify(k)}:${canonicalJson(v[k]!, what)}`;
  }
  return `{${out}}`;
}

function checkExtensions(ext: unknown): void {
  if (ext === undefined) return;
  if (!isPlainRecord(ext)) bad('meta.extensions must be an object');
  for (const k of Object.keys(ext)) {
    checkKey('meta.extensions', k);
    if (KNOWN_KEYS.includes(k)) bad(`meta.extensions key '${k}' is a known META key`);
    const text = ext[k];
    if (typeof text !== 'string') bad(`meta.extensions.${k} must be a JSON text`);
    let parsed: Json;
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      bad(`meta.extensions.${k} is not valid JSON`);
    }
    if (canonicalJson(parsed, `meta.extensions.${k}`) !== text) bad(`meta.extensions.${k} is not canonical JSON`);
  }
}

/** Validates a META record (FormatError 'bad-value'). */
export function validateMeta(m: ReplayMeta): void {
  if (!isPlainRecord(m)) bad('meta must be an object');
  checkIntRange('meta.durationTicks', m.durationTicks, 0, 0xffffffff);
  checkIntRange('meta.endTick', m.endTick, 0, 0xffffffff);
  if (!Array.isArray(m.players)) bad('meta.players must be an array');
  for (const p of m.players) {
    if (!isPlainRecord(p)) bad('meta.players entries must be objects');
    checkIntRange('meta.players.army', p.army, 0, MAX_ARMY);
    checkString('meta.players.name', p.name);
  }
  if (!isPlainRecord(m.result)) bad('meta.result must be an object');
  checkIntRange('meta.result.winner', m.result.winner, -1, Number.MAX_SAFE_INTEGER);
  checkString('meta.result.reason', m.result.reason);
  if (!isPlainRecord(m.stats)) bad('meta.stats must be an object');
  for (const k of Object.keys(m.stats)) {
    checkKey('meta.stats', k);
    checkIntRange(`meta.stats.${k}`, m.stats[k], Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  }
  if (!isPlainRecord(m.extra)) bad('meta.extra must be an object');
  for (const k of Object.keys(m.extra)) {
    checkKey('meta.extra', k);
    checkString(`meta.extra.${k}`, m.extra[k]);
  }
  checkExtensions(m.extensions);
}

function jsonInt(v: number): string {
  // −0 serializes as 0 (String(-0) === '0'), which the canonical form requires.
  return String(v);
}

/** Canonical JSON of a (validated) META record. */
export function metaToCanonicalJson(m: ReplayMeta): string {
  validateMeta(m);
  let players = '';
  for (let i = 0; i < m.players.length; i++) {
    const p = m.players[i]!;
    players += `${i > 0 ? ',' : ''}{"army":${jsonInt(p.army)},"name":${JSON.stringify(p.name)}}`;
  }
  let stats = '';
  for (const k of sortedKeys(m.stats)) stats += `${stats.length > 0 ? ',' : ''}${JSON.stringify(k)}:${jsonInt(m.stats[k]!)}`;
  let extra = '';
  for (const k of sortedKeys(m.extra)) extra += `${extra.length > 0 ? ',' : ''}${JSON.stringify(k)}:${JSON.stringify(m.extra[k]!)}`;
  const parts: Record<string, string> = {
    durationTicks: jsonInt(m.durationTicks),
    endTick: jsonInt(m.endTick),
    extra: `{${extra}}`,
    players: `[${players}]`,
    result: `{"reason":${JSON.stringify(m.result.reason)},"winner":${jsonInt(m.result.winner)}}`,
    stats: `{${stats}}`,
  };
  const ext = m.extensions ?? {};
  for (const k of Object.keys(ext)) parts[k] = ext[k]!;
  let out = '';
  for (const k of sortedKeys(parts)) out += `${out.length > 0 ? ',' : ''}${JSON.stringify(k)}:${parts[k]!}`;
  return `{${out}}`;
}

export function encodeMeta(m: ReplayMeta): Uint8Array {
  const json = encodeText(metaToCanonicalJson(m), C, 'META JSON');
  const w = new ByteWriter(2 + json.length);
  w.u16(META_CHUNK_VERSION);
  w.bytes(json);
  return w.finish();
}

function expectObject(v: Json | undefined, what: string, keys: readonly string[] | null, off: number): { [k: string]: Json } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`${what} must be an object`, off);
  if (keys !== null) {
    const have = sortedKeys(v);
    if (have.length !== keys.length || have.some((k, i) => k !== keys[i])) {
      bad(`${what} must have exactly the keys ${keys.join(', ')} (has ${have.join(', ')})`, off);
    }
  }
  return v;
}

function readInt(v: Json | undefined, what: string, lo: number, hi: number, off: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(`${what} must be an integer ${lo}..${hi}`, off);
  return v;
}

function readString(v: Json | undefined, what: string, off: number): string {
  if (typeof v !== 'string') bad(`${what} must be a string`, off);
  return v;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Parses and validates a META chunk; non-canonical JSON is FormatError 'non-canonical'. */
export function decodeMeta(data: Uint8Array, chunkOffset: number): ReplayMeta {
  const r = new ByteReader(data, C, chunkOffset);
  readChunkVersion(r, META_CHUNK_VERSION);
  const body = r.take(r.remaining, 'META JSON');
  const off = chunkOffset;
  let text: string;
  try {
    text = decodeUtf8(body);
  } catch (e) {
    throw new FormatError('bad-json', `META is not valid UTF-8 (${(e as Error).message})`, C, off);
  }
  let json: Json;
  try {
    json = JSON.parse(text) as Json;
  } catch (e) {
    throw new FormatError('bad-json', `META is not valid JSON (${(e as Error).message})`, C, off);
  }
  const o = expectObject(json, 'META', null, off);
  for (const k of KNOWN_KEYS) if (!Object.prototype.hasOwnProperty.call(o, k)) bad(`META misses the key '${k}'`, off);
  const durationTicks = readInt(o.durationTicks, 'durationTicks', 0, 0xffffffff, off);
  const endTick = readInt(o.endTick, 'endTick', 0, 0xffffffff, off);
  const pj = o.players;
  if (!Array.isArray(pj)) bad('players must be an array', off);
  const players: ReplayMetaPlayer[] = [];
  for (const pv of pj) {
    const p = expectObject(pv, 'players entry', ['army', 'name'], off);
    players.push({ army: readInt(p.army, 'players.army', 0, MAX_ARMY, off), name: readString(p.name, 'players.name', off) });
  }
  const rj = expectObject(o.result, 'result', ['reason', 'winner'], off);
  const result = { winner: readInt(rj.winner, 'result.winner', -1, Number.MAX_SAFE_INTEGER, off), reason: readString(rj.reason, 'result.reason', off) };
  const sj = expectObject(o.stats, 'stats', null, off);
  const stats: Record<string, number> = {};
  for (const k of Object.keys(sj)) {
    if (k === '__proto__') bad(`stats key '__proto__' is not allowed`, off);
    stats[k] = readInt(sj[k], `stats.${k}`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, off);
  }
  const ej = expectObject(o.extra, 'extra', null, off);
  const extra: Record<string, string> = {};
  for (const k of Object.keys(ej)) {
    if (k === '__proto__') bad(`extra key '__proto__' is not allowed`, off);
    extra[k] = readString(ej[k], `extra.${k}`, off);
  }
  const extensions: Record<string, string> = {};
  let extCount = 0;
  for (const k of sortedKeys(o)) {
    if (KNOWN_KEYS.includes(k)) continue;
    if (k === '__proto__') bad(`META key '__proto__' is not allowed`, off);
    try {
      extensions[k] = canonicalJson(o[k]!, `META.${k}`);
    } catch (e) {
      if (e instanceof FormatError) throw new FormatError(e.code, e.message, C, off);
      throw e;
    }
    extCount++;
  }
  const meta: ReplayMeta = extCount > 0 ? { durationTicks, endTick, players, result, stats, extra, extensions } : { durationTicks, endTick, players, result, stats, extra };
  // Re-serialize (validates Unicode too) and require the exact stored bytes.
  let again: Uint8Array;
  try {
    again = encodeText(metaToCanonicalJson(meta), C, 'META JSON');
  } catch (e) {
    if (e instanceof FormatError) throw new FormatError(e.code, e.message, C, off);
    throw e;
  }
  if (!bytesEqual(again, body)) {
    throw new FormatError('non-canonical', 'META JSON is not in canonical form (key order, whitespace, number or string escapes)', C, off);
  }
  return meta;
}
