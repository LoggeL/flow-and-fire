/**
 * Pure parse/format helpers of the panels (TRACK-EDITOR P6): WU <-> Fx raw, milli units, percent
 * <-> per mille, prop field entry lists, integer ranges, field names. Parsers never throw; they
 * return a ParseResult with a German error text (strings.ts) for the input's tooltip.
 *
 * Integer values (Fx raw, milli, per mille) are built with integer arithmetic from the digits, so
 * "0.001" is exactly 1 milli and "12.5" WU exactly 51200 raw.
 */
import { rng32 } from '@faf/fixed';
import { MAP_FX_ONE, MAP_MAX_FIELD_ENTRIES, MAP_MAX_FIELD_NAME_BYTES, MAP_MAX_PROP_ID_BYTES, type PropFieldEntry } from '@faf/formats';
import { E } from './strings.ts';

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function err<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

/**
 * Namespace id of a prop blueprint, identical to PROP_ID_RE in packages/formats/src/mapprop.ts
 * (not re-exported by @faf/formats; the store's validatePropFields stays the final check).
 */
export const PROP_ID_RE = /^[a-z0-9_]+:[a-z0-9_./-]+$/;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const utf8 = new TextEncoder();

/** Splits "12,5" / " 12.50 " into integer and fraction digits (null = not a plain decimal). */
function decimalParts(text: string): { readonly int: string; readonly frac: string; readonly neg: boolean } | null {
  const m = /^\s*([+-]?)(\d*)(?:[.,](\d*))?\s*$/.exec(text);
  if (m === null) return null;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return null;
  return { int: int === '' ? '0' : int, frac, neg: m[1] === '-' };
}

// -------------------------------------------------------------------------------------------
// WU <-> Fx raw

/** Fx raw -> WU text with at most `decimals` decimals, trailing zeros removed (2048 -> "0.5"). */
export function formatWu(raw: number, decimals = 3): string {
  const s = (raw / MAP_FX_ONE).toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** WU text ("12.5", "12,5", "12.5 WU") -> Fx raw (rounded to the nearest raw unit) in [0, maxRaw]. */
export function parseWuToRaw(text: string, maxRaw: number): ParseResult<number> {
  const t = text.replace(/\s*wu\s*$/i, '');
  if (t.trim() === '') return err(E.empty);
  const p = decimalParts(t);
  if (p === null) return err(E.notNumber);
  const wu = Number(`${p.neg ? '-' : ''}${p.int}.${p.frac === '' ? '0' : p.frac}`);
  if (!Number.isFinite(wu)) return err(E.notNumber);
  const raw = Math.round(wu * MAP_FX_ONE);
  if (raw < 0 || raw > maxRaw) return err(E.range('0', formatWu(maxRaw)));
  return ok(raw);
}

// -------------------------------------------------------------------------------------------
// Fixed-point decimals (milli, per mille)

/** Integer value with `scale` implied decimals -> text with exactly `scale` decimals (25000, 3 -> "25.000"). */
export function formatScaled(value: number, scale: number): string {
  const div = 10 ** scale;
  const neg = value < 0;
  const a = Math.abs(value);
  const int = Math.floor(a / div);
  const frac = a - int * div;
  const s = scale > 0 ? `${int}.${String(frac).padStart(scale, '0')}` : String(int);
  return neg ? `-${s}` : s;
}

/**
 * Decimal text -> integer with `scale` implied decimals (at most `scale` decimals given), within
 * [lo, hi] (in scaled units). "25", "25.5", "25,500" -> 25500 for scale 3.
 */
export function parseScaled(text: string, scale: number, lo: number, hi: number): ParseResult<number> {
  if (text.trim() === '') return err(E.empty);
  const p = decimalParts(text);
  if (p === null) return err(E.notNumber);
  if (p.frac.length > scale) return err(scale === 0 ? E.notInteger : E.decimals(scale));
  const digits = `${p.int}${p.frac.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '');
  if (digits.length > 15) return err(E.range(formatScaled(lo, scale), formatScaled(hi, scale)));
  const v = (p.neg ? -1 : 1) * Number(digits);
  if (v < lo || v > hi) return err(E.range(formatScaled(lo, scale), formatScaled(hi, scale)));
  return ok(v === 0 ? 0 : v);
}

/** Milli units -> "12.345". */
export function formatMilli(milli: number): string {
  return formatScaled(milli, 3);
}

/** "12.345" -> 12345 milli (u32). */
export function parseMilli(text: string): ParseResult<number> {
  return parseScaled(text, 3, 0, U32_MAX);
}

/** Per mille -> percent text with at most one decimal (800 -> "80", 805 -> "80.5"). */
export function formatPercent(permille: number): string {
  const s = formatScaled(permille, 1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Percent text (one decimal at most) -> per mille in [lo, hi]. */
export function parsePercent(text: string, lo = 1, hi = U16_MAX): ParseResult<number> {
  return parseScaled(text.replace(/\s*%\s*$/, ''), 1, lo, hi);
}

/** Integer text in [lo, hi]; `allowHex` accepts 0x… (seeds). */
export function parseIntRange(text: string, lo: number, hi: number, allowHex = false): ParseResult<number> {
  const t = text.trim();
  if (t === '') return err(E.empty);
  let v: number;
  if (allowHex && /^0x[0-9a-f]+$/i.test(t)) {
    v = t.length > 18 ? Infinity : Number.parseInt(t.slice(2), 16);
  } else if (/^[+-]?\d+$/.test(t)) {
    v = t.replace(/^[+-]?0+(?=\d)/, '').length > 15 ? Infinity : Number(t);
  } else {
    return err(/^[+-]?\d*[.,]\d*$/.test(t) ? E.notInteger : E.notNumber);
  }
  if (!(v >= lo && v <= hi)) return err(E.range(String(lo), String(hi)));
  return ok(v === 0 ? 0 : v);
}

// -------------------------------------------------------------------------------------------
// Prop field values

/** Entry list -> "core:tree_01:3, core:tree_02:1". */
export function formatEntries(entries: readonly PropFieldEntry[]): string {
  return entries.map((e) => `${e.id}:${e.weight}`).join(', ');
}

/**
 * "id:gewicht, id:gewicht; …" -> entries. The weight is the part after the last ':' when the rest
 * is itself a valid id ("core:tree_01:3"); a token that is a bare id ("core:tree_01") gets weight 1.
 * Separators: ',', ';' or line breaks. 1..16 entries, ids unique and valid (PROP_ID_RE,
 * <= 128 bytes), weights 1..65535.
 */
export function parseEntries(text: string): ParseResult<readonly PropFieldEntry[]> {
  const tokens = text
    .split(/[,;\n\r]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (tokens.length < 1 || tokens.length > MAP_MAX_FIELD_ENTRIES) return err(E.entriesCount(MAP_MAX_FIELD_ENTRIES));
  const out: PropFieldEntry[] = [];
  for (const token of tokens) {
    const compact = token.replace(/\s+/g, '');
    let id = compact;
    let weight = 1;
    const cut = compact.lastIndexOf(':');
    const head = compact.slice(0, cut);
    const tail = compact.slice(cut + 1);
    if (cut > 0 && PROP_ID_RE.test(head) && /^\d+$/.test(tail)) {
      id = head;
      weight = tail.length > 6 ? Infinity : Number(tail);
      if (!(weight >= 1 && weight <= U16_MAX)) return err(E.entryWeight(token));
    } else if (cut > 0 && PROP_ID_RE.test(head) && /^[+-]?[\d.,]+$/.test(tail)) {
      return err(E.entryWeight(token));
    }
    if (!PROP_ID_RE.test(id)) return err(E.entryId(id));
    if (utf8.encode(id).length > MAP_MAX_PROP_ID_BYTES) return err(E.entryIdLength(id, MAP_MAX_PROP_ID_BYTES));
    if (out.some((e) => e.id === id)) return err(E.entryDuplicate(id));
    out.push({ id, weight });
  }
  return ok(out);
}

/** Field name: trimmed, 1..64 UTF-8 bytes, no control characters. */
export function parseFieldName(text: string): ParseResult<string> {
  const t = text.trim();
  if (t === '') return err(E.empty);
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return err(E.nameControl);
  }
  if (utf8.encode(t).length > MAP_MAX_FIELD_NAME_BYTES) return err(E.nameLength(MAP_MAX_FIELD_NAME_BYTES));
  return ok(t);
}

/** Salt of the "Neu würfeln" seed. */
const RESEED_SALT = 0x72736564;

/**
 * Next seed for "Neu würfeln": deterministic from the current seed, the document revision and the
 * field index (never equal to the current seed).
 */
export function nextSeed(seed: number, revision: number, fieldIndex: number): number {
  let s = rng32(seed >>> 0, revision, fieldIndex, RESEED_SALT);
  if (s === seed >>> 0) s = (s + 1) >>> 0;
  return s;
}

/** Seed as shown in the input (decimal u32). */
export function formatSeed(seed: number): string {
  return String(seed >>> 0);
}

/** Seed input: decimal or 0x… hex, u32. */
export function parseSeed(text: string): ParseResult<number> {
  return parseIntRange(text, 0, U32_MAX, true);
}

/** Thousands-grouped integer ("12 345"). */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** count × per-prop milli as units with three decimals (exact for count·milli < 2^53). */
export function formatReclaimTotal(count: number, perPropMilli: number): string {
  return formatMilli(count * perPropMilli);
}
