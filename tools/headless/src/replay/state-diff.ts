/**
 * Diff of two full state dumps (PLAN §3.12 desync-diff: "Tabelle, Spalte und Entity").
 *
 * Every dynamic region is split along its RegionLayout parts (heap layout.ts: table columns,
 * dense columns, `$header`, `$free`, `$gen`, `$alive`, `owner`, raw `$data` …). Column values are
 * decoded by ColType (u8…i32; f64s as Float64 — SafeInt), the index is the element of the column
 * — for tables the entity slot, for dense components the dense row. Raw parts (headers, freelist
 * rings, raw regions) are compared as u32 words (a trailing partial word is zero-extended).
 * Values are compared by their bytes, so even differing NaN payloads are found.
 *
 * Unequal layouts (another SIM_BUILD/schema) cannot be compared value by value: the diff then
 * only lists the differing layout text lines.
 *
 * Environment-neutral (Node and browser worker): no node: imports.
 */

import type { ColType, LayoutPart, RegionLayout } from '@faf/heap';
import type { StateDump } from './dump.ts';

export interface StateDiffEntry {
  readonly region: string;
  readonly regionKind: RegionLayout['kind'];
  /** True for derived regions (full hash only, e.g. spatial grids). */
  readonly derived: boolean;
  /** Part name: column or internal section (`$header`, `$free`, `$gen`, `$alive`, `owner`, `$data`). */
  readonly part: string;
  /** Element type; 'raw' parts are compared as u32 words. */
  readonly type: ColType | 'raw';
  /** Element index in the part: entity slot (tables), dense row, or word index (raw). */
  readonly index: number;
  /** Absolute arena byte offset of the element. */
  readonly byteOffset: number;
  readonly a: number;
  readonly b: number;
  /**
   * Entity reference: tables `slot 17 (17:3)` (handle index:gen from `$gen`, both sides if they
   * differ), dense `row 5 → slot 12` (owner back-pointer), raw `word 3`.
   */
  readonly entity: string;
}

export interface StateDiff {
  /** True if layouts and all compared values are equal. */
  readonly equal: boolean;
  readonly layoutEqual: boolean;
  /** Differing values, region/part/index order, at most `limit`. */
  readonly entries: readonly StateDiffEntry[];
  /** Names of the regions with at least one differing value (or a differing layout line). */
  readonly regionsDiffering: readonly string[];
  /** All differing values (also those beyond `limit`). */
  readonly totalDifferingValues: number;
  /** Differing layout text lines (only when the layouts differ): `-` = only in A, `+` = only in B. */
  readonly layoutDiff: readonly string[];
  readonly tickA: number;
  readonly tickB: number;
  readonly labelA: string;
  readonly labelB: string;
  readonly layoutHashA: number;
  readonly layoutHashB: number;
  /** Options the diff was made with. */
  readonly limit: number;
  readonly includeDerived: boolean;
}

export interface StateDiffOptions {
  /** Maximum entries kept (default 200). */
  readonly limit?: number;
  /** Compare derived regions too (default true). */
  readonly includeDerived?: boolean;
}

function elemBytes(t: ColType | 'raw'): number {
  switch (t) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
      return 2;
    case 'u32':
    case 'i32':
    case 'raw':
      return 4;
    case 'f64s':
      return 8;
  }
}

/** Decodes one element at `off` (relative to the dump bytes). Raw: u32, zero-extended at the part end. */
function readElem(dv: DataView, off: number, t: ColType | 'raw', avail: number): number {
  switch (t) {
    case 'u8':
      return dv.getUint8(off);
    case 'i8':
      return dv.getInt8(off);
    case 'u16':
      return dv.getUint16(off, true);
    case 'i16':
      return dv.getInt16(off, true);
    case 'u32':
      return dv.getUint32(off, true);
    case 'i32':
      return dv.getInt32(off, true);
    case 'f64s':
      return dv.getFloat64(off, true);
    case 'raw': {
      if (avail >= 4) return dv.getUint32(off, true);
      let v = 0;
      for (let k = 0; k < avail; k++) v |= dv.getUint8(off + k) << (8 * k);
      return v >>> 0;
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array, from: number, len: number): boolean {
  for (let i = from, e = from + len; i < e; i++) if (a[i] !== b[i]) return false;
  return true;
}

function dvOf(u8: Uint8Array): DataView {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

/** Entity label of element `index` of `part` in region `r`. */
function entityLabel(r: RegionLayout, part: LayoutPart, index: number, dynamicStart: number, da: DataView, db: DataView): string {
  if (part.type === 'raw') return `word ${index}`;
  if (r.kind === 'table') {
    const gen = r.parts.find((p) => p.name === '$gen');
    if (gen === undefined || index >= r.cap) return `slot ${index}`;
    const off = gen.byteOffset - dynamicStart + index * 2;
    const ga = da.getUint16(off, true) & 0xfff;
    const gb = db.getUint16(off, true) & 0xfff;
    return ga === gb ? `slot ${index} (${index}:${ga})` : `slot ${index} (${index}:${ga} / ${index}:${gb})`;
  }
  if (r.kind === 'dense') {
    const owner = r.parts.find((p) => p.name === 'owner');
    if (owner === undefined || part.name === 'owner' || index >= r.cap) return `row ${index}`;
    const off = owner.byteOffset - dynamicStart + index * 4;
    const oa = da.getInt32(off, true);
    const ob = db.getInt32(off, true);
    return oa === ob ? `row ${index} → slot ${oa}` : `row ${index} → slot ${oa} / ${ob}`;
  }
  return `#${index}`;
}

/** Line diff of two layout texts (order preserving, set semantics per line — layouts are small). */
function layoutLineDiff(ta: string, tb: string): { lines: string[]; regions: string[] } {
  const la = ta.split('\n');
  const lb = tb.split('\n');
  const inB = new Set(lb);
  const inA = new Set(la);
  const lines: string[] = [];
  const regions: string[] = [];
  const regionOf = (lines: readonly string[], i: number): string | null => {
    for (let k = i; k >= 0; k--) {
      const l = lines[k]!;
      if (l.startsWith(' ') || l.startsWith('faf-arena')) continue;
      return l.split(' ')[1] ?? null;
    }
    return null;
  };
  const note = (r: string | null): void => {
    if (r !== null && !regions.includes(r)) regions.push(r);
  };
  la.forEach((l, i) => {
    if (l !== '' && !inB.has(l)) {
      lines.push(`- ${l}`);
      note(regionOf(la, i));
    }
  });
  lb.forEach((l, i) => {
    if (l !== '' && !inA.has(l)) {
      lines.push(`+ ${l}`);
      note(regionOf(lb, i));
    }
  });
  return { lines, regions };
}

/** Compares two dumps (see module doc). */
export function diffStateDumps(a: StateDump, b: StateDump, opts: StateDiffOptions = {}): StateDiff {
  const limit = opts.limit ?? 200;
  const includeDerived = opts.includeDerived ?? true;
  const base = {
    tickA: a.tick,
    tickB: b.tick,
    labelA: a.label,
    labelB: b.label,
    layoutHashA: a.layoutHash >>> 0,
    layoutHashB: b.layoutHash >>> 0,
    limit,
    includeDerived,
  };
  const layoutEqual =
    a.layoutHash >>> 0 === b.layoutHash >>> 0 &&
    a.layoutText === b.layoutText &&
    a.dynamicStart === b.dynamicStart &&
    a.dynamicEnd === b.dynamicEnd &&
    a.bytes.length === b.bytes.length;
  if (!layoutEqual) {
    const d = layoutLineDiff(a.layoutText, b.layoutText);
    return { ...base, equal: false, layoutEqual: false, entries: [], regionsDiffering: d.regions, totalDifferingValues: 0, layoutDiff: d.lines };
  }

  const da = dvOf(a.bytes);
  const db = dvOf(b.bytes);
  const entries: StateDiffEntry[] = [];
  const regionsDiffering: string[] = [];
  let total = 0;
  const ds = a.dynamicStart;
  for (const r of a.regions) {
    if (r.area !== 'dynamic' || (r.derived && !includeDerived)) continue;
    if (sameBytes(a.bytes, b.bytes, r.byteOffset - ds, r.byteLength)) continue;
    let regionCount = 0;
    for (const p of r.parts) {
      const rel = p.byteOffset - ds;
      if (sameBytes(a.bytes, b.bytes, rel, p.byteLength)) continue;
      const size = elemBytes(p.type);
      const n = Math.ceil(p.byteLength / size);
      for (let i = 0; i < n; i++) {
        const off = rel + i * size;
        const len = Math.min(size, rel + p.byteLength - off);
        if (sameBytes(a.bytes, b.bytes, off, len)) continue;
        total++;
        regionCount++;
        if (entries.length < limit) {
          entries.push({
            region: r.name,
            regionKind: r.kind,
            derived: r.derived,
            part: p.name,
            type: p.type,
            index: i,
            byteOffset: p.byteOffset + i * size,
            a: readElem(da, off, p.type, len),
            b: readElem(db, off, p.type, len),
            entity: entityLabel(r, p, i, ds, da, db),
          });
        }
      }
    }
    // Bytes of the region outside every part (alignment padding) are not state; ignore them.
    if (regionCount > 0) regionsDiffering.push(r.name);
  }
  return { ...base, equal: total === 0, layoutEqual: true, entries, regionsDiffering, totalDifferingValues: total, layoutDiff: [] };
}

function fmtValue(v: number, t: ColType | 'raw'): string {
  if (t === 'raw') return `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
  return String(v);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/**
 * Human readable diff (German): summary line, then a table Region | Spalte | Entity/Index | A | B
 * (derived regions marked with *), or the layout line diff.
 */
export function formatStateDiff(diff: StateDiff): string {
  const who = (label: string, tick: number): string => `${label !== '' ? label + ', ' : ''}Tick ${tick}`;
  const head = `Zustandsvergleich A (${who(diff.labelA, diff.tickA)}) ↔ B (${who(diff.labelB, diff.tickB)})`;
  if (!diff.layoutEqual) {
    const hex = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
    const lines = [
      head,
      `Arena-Layout unterschiedlich (layoutHash A ${hex(diff.layoutHashA)} ≠ B ${hex(diff.layoutHashB)}) – kein Wertevergleich möglich.`,
      `Betroffene Regionen: ${diff.regionsDiffering.length > 0 ? diff.regionsDiffering.join(', ') : '(nur Kopfzeile)'}`,
      'Layout-Diff (- nur A, + nur B):',
      ...diff.layoutDiff.map((l) => `  ${l}`),
    ];
    return lines.join('\n') + '\n';
  }
  if (diff.equal) {
    return `${head}\nKeine Abweichung (${diff.includeDerived ? 'alle dynamischen Regionen' : 'nur Regel-Regionen'} verglichen).\n`;
  }
  const rows: string[][] = [['Region', 'Spalte', 'Entity/Index', 'A', 'B']];
  for (const e of diff.entries) {
    rows.push([`${e.region}${e.derived ? '*' : ''}`, `${e.part} (${e.type})`, e.entity, fmtValue(e.a, e.type), fmtValue(e.b, e.type)]);
  }
  const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  const line = (r: readonly string[]): string => r.map((c, i) => pad(c, w[i]!)).join(' | ').trimEnd();
  const out = [
    head,
    `${diff.totalDifferingValues} abweichende Werte in ${diff.regionsDiffering.length} Region(en): ${diff.regionsDiffering.join(', ')}`,
    line(rows[0]!),
    w.map((n) => '-'.repeat(n)).join('-|-'),
    ...rows.slice(1).map(line),
  ];
  if (diff.totalDifferingValues > diff.entries.length) out.push(`… ${diff.totalDifferingValues - diff.entries.length} weitere Abweichungen nicht angezeigt (limit ${diff.limit})`);
  if (diff.entries.some((e) => e.derived)) out.push('* abgeleitete Region (nur Voll-Hash)');
  return out.join('\n') + '\n';
}
