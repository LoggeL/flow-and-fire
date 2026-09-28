/**
 * Layout primitives of the arena: column element types, alignment and the canonical
 * layout description that feeds the layout hash (PLAN §3.5).
 */

import type { SafeIntColumn } from './safeint.ts';

/** Column element types of the Table-DSL. `f64s` = SafeInt stored in a Float64Array. */
export type ColType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f64s';

/** Schema of a table / dense component: column name → element type (insertion order = layout order). */
export type Schema = Readonly<Record<string, ColType>>;

/** Typed view bound for each column type. */
export interface ColViewMap {
  u8: Uint8Array;
  i8: Int8Array;
  u16: Uint16Array;
  i16: Int16Array;
  u32: Uint32Array;
  i32: Int32Array;
  f64s: SafeIntColumn;
}

/** Column views of a schema, e.g. `{ x: Int32Array, hp: Int32Array, buildDone: SafeIntColumn }`. */
export type Columns<S extends Schema> = { readonly [K in keyof S]: ColViewMap[S[K]] };

/** Bytes per element of a column type. */
export function colTypeBytes(t: ColType): number {
  switch (t) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
      return 2;
    case 'u32':
    case 'i32':
      return 4;
    case 'f64s':
      return 8;
  }
}

const COL_TYPES: readonly ColType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f64s'];

/** True if `t` is a valid column type (runtime check for untyped callers). */
export function isColType(t: unknown): t is ColType {
  return typeof t === 'string' && COL_TYPES.indexOf(t as ColType) >= 0;
}

/** Alignment of every column / section start inside the arena. */
export const ARENA_ALIGN = 8;

/** WebAssembly page size (64 KiB). */
export const WASM_PAGE_BYTES = 65536;

/** Maximum capacity of a handle-addressed table: index 0xFFFFF is reserved so HANDLE_NONE never resolves. */
export const MAX_TABLE_CAP = 0xfffff;

/** Rounds `n` up to a multiple of ARENA_ALIGN. */
export function align8(n: number): number {
  return (n + 7) & ~7;
}

/** Area of a region: `dynamic` = simulation state (snapshot/restore), `static` = map data (not hashed). */
export type Area = 'dynamic' | 'static';

/** Placement options of a region. `derived` only applies to dynamic regions (full hash, not rule hash). */
export interface RegionOptions {
  readonly area?: Area;
  readonly derived?: boolean;
}

/** Resolved region options. */
export interface ResolvedRegionOptions {
  readonly area: Area;
  readonly derived: boolean;
}

/** Normalizes region options (defaults: dynamic, not derived). */
export function resolveRegionOptions(o: RegionOptions | undefined): ResolvedRegionOptions {
  const area: Area = o?.area ?? 'dynamic';
  if (area !== 'dynamic' && area !== 'static') throw new RangeError(`invalid area ${String(area)}`);
  const derived = o?.derived ?? false;
  if (derived && area !== 'dynamic') throw new RangeError('derived regions must be dynamic');
  return { area, derived };
}

/** Name rule for regions and columns: ASCII identifier-like, stable in the canonical layout text. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;

/** Throws if `name` is not a valid region/column name. */
export function checkName(kind: string, name: string): void {
  if (!NAME_RE.test(name)) throw new RangeError(`invalid ${kind} name '${name}'`);
}

/** Throws unless `n` is an integer in [min, max]. */
export function checkInt(what: string, n: number, min: number, max: number): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`${what} must be an integer in [${min}, ${max}], got ${n}`);
  }
}

/** One placed part of a region (column or internal section), absolute byte offset in the arena. */
export interface LayoutPart {
  readonly name: string;
  /** Column type, or 'raw' for internal sections (header, freelist ring, …). */
  readonly type: ColType | 'raw';
  readonly byteOffset: number;
  readonly byteLength: number;
}

/** Layout description of a region, used for the layout hash and by tools such as desync-diff. */
export interface RegionLayout {
  readonly kind: 'table' | 'dense' | 'slab' | 'raw';
  readonly name: string;
  readonly area: Area;
  readonly derived: boolean;
  readonly cap: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly parts: readonly LayoutPart[];
}

/** Encodes ASCII text into bytes (layout names are validated ASCII). */
export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) throw new RangeError('asciiBytes: non-ASCII character');
    out[i] = c;
  }
  return out;
}

/** Canonical, line-based text of an arena layout (input of the layout hash). */
export function canonicalLayoutText(
  version: number,
  totalBytes: number,
  dynamicStart: number,
  dynamicEnd: number,
  regions: readonly RegionLayout[],
): string {
  let s = `faf-arena v${version} bytes=${totalBytes} dyn=${dynamicStart}..${dynamicEnd}\n`;
  for (const r of regions) {
    s += `${r.kind} ${r.name} area=${r.area} derived=${r.derived ? 1 : 0} cap=${r.cap} off=${r.byteOffset} len=${r.byteLength}\n`;
    for (const p of r.parts) s += ` ${p.name} ${p.type} off=${p.byteOffset} len=${p.byteLength}\n`;
  }
  return s;
}
