/** Canonical, bounded META JSON. No floating-point values enter the replay contract. */
import { decodeUtf8, encodeUtf8 } from '@faf/protocol';
import { FormatError } from '../errors.ts';
import { ByteReader, ByteWriter } from './bytes.ts';
import { readChunkVersion } from './chunks.ts';
import type { ReplayMeta } from './types.ts';

function fail(message: string): never { throw new FormatError('bad-value', message, 'META'); }
function object(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('expected an object');
  return v as Record<string, unknown>;
}
function integer(v: unknown, min = 0, max = 0xffffffff): void {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail('integer out of range');
}
function string(v: unknown): void { if (typeof v !== 'string') fail('expected a string'); }
/** Stable key order; rejects unsafe values and excessive nesting before recursion. */
export function canonicalMetaJson(v: unknown, depth = 0): string {
  if (depth > 32) fail('metadata nesting exceeds 32');
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { integer(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map((x: unknown) => canonicalMetaJson(x, depth + 1)).join(',') + ']';
  const o = object(v);
  return '{' + Object.keys(o).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    .map((k) => JSON.stringify(k) + ':' + canonicalMetaJson(o[k], depth + 1)).join(',') + '}';
}
export function validateMeta(v: unknown): asserts v is ReplayMeta {
  const o = object(v); integer(o['durationTicks']); integer(o['endTick']);
  if (!Array.isArray(o['players']) || o['players'].length > 16) fail('invalid players');
  const used: number[] = [];
  for (const p of o['players']) {
    const player = object(p); integer(player['army'], 0, 15); string(player['name']);
    const army = player['army'] as number;
    if (used.includes(army)) fail('duplicate player'); used.push(army);
  }
  const result = object(o['result']); integer(result['winner'], -1, 15); string(result['reason']);
  const stats = object(o['stats']); for (const n of Object.values(stats)) integer(n, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const extra = object(o['extra']); for (const s of Object.values(extra)) string(s);
}
export function encodeMeta(meta: ReplayMeta): Uint8Array {
  validateMeta(meta); const text = canonicalMetaJson(meta);
  const bytes = encodeUtf8(text);
  if (bytes.length > 1024 * 1024) throw new FormatError('too-large', 'META exceeds 1 MiB', 'META');
  const w = new ByteWriter(bytes.length + 2); w.u16(1); w.bytes(bytes); return w.finish();
}
export function decodeMeta(data: Uint8Array, offset: number): ReplayMeta {
  if (data.length > 1024 * 1024 + 2) throw new FormatError('too-large', 'META exceeds 1 MiB', 'META', offset);
  const r = new ByteReader(data, 'META', offset); readChunkVersion(r);
  let text: string; let meta: unknown;
  try { text = decodeUtf8(r.take(r.remaining, 'JSON')); meta = JSON.parse(text) as unknown; }
  catch (e) { throw new FormatError('bad-json', e instanceof Error ? e.message : String(e), 'META', offset); }
  validateMeta(meta);
  if (canonicalMetaJson(meta) !== text) throw new FormatError('non-canonical', 'META is not canonical JSON', 'META', offset);
  return meta;
}
