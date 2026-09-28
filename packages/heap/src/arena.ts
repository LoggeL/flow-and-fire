/**
 * The simulation arena (PLAN §2 "Sim-Speicher", §3.5): one non-shared `WebAssembly.Memory` of
 * fixed size holding every table, dense component, slab and raw region.
 *
 * Layout (deterministic, depends only on the registered definitions):
 *   [dynamic regions in registration order][static regions in registration order][padding to page]
 * Every part (header, freelist, column, …) starts 8-byte aligned. Snapshot/restore copy the
 * dynamic range [dynamicStart, dynamicEnd) with a single memcpy.
 */

import { xxHash32 } from '@faf/fixed';
import { Dense, type DenseDef } from './dense.ts';
import {
  align8,
  asciiBytes,
  canonicalLayoutText,
  WASM_PAGE_BYTES,
  type RegionLayout,
  type Schema,
} from './layout.ts';
import { RawRegion, type RawRegionDef } from './raw.ts';
import { toLayoutParts, type ArenaRegion } from './region.ts';
import { Slab, type SlabDef } from './slab.ts';
import { Table, type TableDef } from './table.ts';
import { createFixedMemory, MAX_ARENA_PAGES, type WasmMemory } from './wasm.ts';

/** Version of the arena layout scheme (part of the layout hash). */
export const ARENA_LAYOUT_VERSION = 1;

/** Options of `ArenaBuilder.build`. */
export interface ArenaBuildOptions {
  /** Minimum total size in bytes (e.g. headroom for a WASM module's own data). Default: exact fit. */
  readonly minBytes?: number;
}

export class Arena {
  /** The backing memory (initial == maximum pages; never grown). */
  readonly memory: WasmMemory;
  /** Byte view over the whole memory. */
  readonly bytes: Uint8Array;
  readonly pages: number;
  readonly byteLength: number;
  readonly dynamicStart: number;
  readonly dynamicEnd: number;
  readonly staticStart: number;
  readonly staticEnd: number;
  /** xxHash32 of the canonical layout text. Equal hashes ⇒ identical layout. */
  readonly layoutHash: number;
  /** Canonical layout text (input of layoutHash; useful for diffs). */
  readonly layoutText: string;
  /** Placement of all regions in registration order. */
  readonly regions: readonly RegionLayout[];
  /** @internal Dynamic, non-derived regions (rule hash), registration order. */
  readonly ruleRegions: readonly ArenaRegion[];
  /** @internal All dynamic regions (full hash), registration order. */
  readonly fullRegions: readonly ArenaRegion[];
  private readonly dynView: Uint8Array;
  private readonly all: readonly ArenaRegion[];

  /** @internal Use ArenaBuilder.build(). */
  constructor(
    memory: WasmMemory,
    pages: number,
    dyn: readonly [number, number],
    stat: readonly [number, number],
    regions: readonly ArenaRegion[],
    layouts: readonly RegionLayout[],
  ) {
    this.memory = memory;
    this.pages = pages;
    this.bytes = new Uint8Array(memory.buffer);
    this.byteLength = this.bytes.length;
    this.dynamicStart = dyn[0];
    this.dynamicEnd = dyn[1];
    this.staticStart = stat[0];
    this.staticEnd = stat[1];
    this.regions = layouts;
    this.layoutText = canonicalLayoutText(
      ARENA_LAYOUT_VERSION,
      this.byteLength,
      this.dynamicStart,
      this.dynamicEnd,
      layouts,
    );
    const text = asciiBytes(this.layoutText);
    this.layoutHash = xxHash32(text, 0, text.length, 0);
    const rule: ArenaRegion[] = [];
    const full: ArenaRegion[] = [];
    for (const r of regions) {
      if (r.area !== 'dynamic') continue;
      full.push(r);
      if (!r.derived) rule.push(r);
    }
    this.ruleRegions = rule;
    this.fullRegions = full;
    this.all = regions.slice();
    this.dynView = this.bytes.subarray(this.dynamicStart, this.dynamicEnd);
  }

  /** Size of a snapshot (the dynamic range) in bytes. */
  get snapshotByteLength(): number {
    return this.dynamicEnd - this.dynamicStart;
  }

  /**
   * Copies the dynamic range. With `target` (length ≥ snapshotByteLength) nothing is allocated
   * and `target` is returned; without, a new Uint8Array of exactly snapshotByteLength is returned.
   */
  snapshot(target?: Uint8Array): Uint8Array {
    if (target === undefined) return this.dynView.slice();
    if (target.length < this.dynView.length) {
      throw new RangeError(`snapshot target too small: ${target.length} < ${this.dynView.length}`);
    }
    target.set(this.dynView, 0);
    return target;
  }

  /**
   * Restores the dynamic range from a snapshot. `src` must hold exactly snapshotByteLength bytes
   * (a longer buffer is accepted; its first snapshotByteLength bytes are used). Views stay valid.
   */
  restore(src: Uint8Array): void {
    const n = this.dynView.length;
    if (src.length === n) this.bytes.set(src, this.dynamicStart);
    else if (src.length > n) this.bytes.set(src.subarray(0, n), this.dynamicStart);
    else throw new RangeError(`restore source too small: ${src.length} < ${n}`);
  }

  /** Zeroes the dynamic range: every table/dense/slab becomes empty (all generations 0). */
  resetDynamic(): void {
    this.bytes.fill(0, this.dynamicStart, this.dynamicEnd);
  }

  /** Region by name (tools, desync-diff). */
  region(name: string): ArenaRegion | undefined {
    for (const r of this.all) if (r.name === name) return r;
    return undefined;
  }
}

/**
 * Registers regions and builds the arena.
 *
 * ```ts
 * const b = new ArenaBuilder();
 * const units = b.addTable(Units);
 * const movers = b.addDense(Movers);
 * const arena = b.build();         // views of `units`/`movers` are bound now
 * ```
 */
export class ArenaBuilder {
  private readonly list: ArenaRegion[] = [];
  private built = false;

  addTable<S extends Schema>(def: TableDef<S>): Table<S> {
    return this.push(new Table(def));
  }

  addDense<S extends Schema>(def: DenseDef<S>): Dense<S> {
    return this.push(new Dense(def));
  }

  addSlab(def: SlabDef): Slab {
    return this.push(new Slab(def));
  }

  addRegion(def: RawRegionDef): RawRegion {
    return this.push(new RawRegion(def));
  }

  private push<R extends ArenaRegion>(r: R): R {
    if (this.built) throw new Error('ArenaBuilder: already built');
    for (const o of this.list) {
      if (o.name === r.name) throw new RangeError(`ArenaBuilder: duplicate region name '${r.name}'`);
    }
    this.list.push(r);
    return r;
  }

  /** Computes the layout, allocates the memory and binds all views. One-shot. */
  build(options: ArenaBuildOptions = {}): Arena {
    if (this.built) throw new Error('ArenaBuilder: already built');
    this.built = true;
    const dynamic = this.list.filter((r) => r.area === 'dynamic');
    const statics = this.list.filter((r) => r.area === 'static');
    const placed: { region: ArenaRegion; layout: RegionLayout }[] = [];

    let cursor = 0;
    const place = (r: ArenaRegion): void => {
      const specs = r.partSpecs();
      const offsets: number[] = [];
      const start = cursor;
      for (const s of specs) {
        cursor = align8(cursor);
        offsets.push(cursor);
        cursor += s.bytes;
      }
      cursor = align8(cursor);
      placed.push({
        region: r,
        layout: {
          kind: r.kind,
          name: r.name,
          area: r.area,
          derived: r.derived,
          cap: r.cap,
          byteOffset: start,
          byteLength: cursor - start,
          parts: toLayoutParts(specs, offsets),
        },
      });
    };

    const dynamicStart = 0;
    for (const r of dynamic) place(r);
    const dynamicEnd = cursor;
    const staticStart = cursor;
    for (const r of statics) place(r);
    const staticEnd = cursor;

    const need = Math.max(staticEnd, options.minBytes ?? 0, 1);
    const pages = Math.floor((need + WASM_PAGE_BYTES - 1) / WASM_PAGE_BYTES);
    if (pages > MAX_ARENA_PAGES) {
      throw new RangeError(`arena too large: ${need} bytes > ${MAX_ARENA_PAGES} pages`);
    }
    const memory = createFixedMemory(pages);
    const buffer = memory.buffer;
    // Registration order in the layout list (not area order) keeps `regions` readable;
    // offsets already encode the dynamic/static split.
    const layoutsByReg: RegionLayout[] = [];
    for (const r of this.list) {
      const p = placed.find((q) => q.region === r)!;
      r.bind(buffer, p.layout);
      layoutsByReg.push(p.layout);
    }
    return new Arena(memory, pages, [dynamicStart, dynamicEnd], [staticStart, staticEnd], this.list, layoutsByReg);
  }
}
