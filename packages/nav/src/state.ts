/**
 * NavState: dimensions plus the typed views of the bound nav regions. Every algorithm of the
 * package reads and writes only these views (arena memory) and the module scratch (scratch.ts).
 * Views stay valid across snapshot/restore (the arena never grows).
 */

import type { Table } from '@faf/heap';
import { NAV_BACK_WORDS, NAV_CLASSES, NAV_SECTOR_SHIFT } from './constants.ts';
import type { NavRegions, PathSchema } from './regions.ts';
import { ensureScratch } from './scratch.ts';

export class NavState {
  readonly size: number;
  readonly shift: number;
  readonly mask: number;
  /** Cells (size²). */
  readonly n: number;
  /** Sectors per edge. */
  readonly secPerEdge: number;
  readonly secShift: number;
  readonly numSectors: number;

  /** Static: 0 = blocked, else 1 + cost level (1..4). */
  readonly terrain: Uint8Array;
  /** Rule: footprint refcount per cell. */
  readonly foot: Uint8Array;
  /** Derived: clearance per cell (0..15). */
  readonly clear: Uint8Array;
  /** Derived: component labels, class c at offset (c − 1)·n. */
  readonly comp: Uint16Array;
  /** Derived: per class COMP_META_WORDS words: [0] = count, [label] = smallest cell. */
  readonly compMeta: Int32Array;
  /**
   * Derived: per (sector, class) the common cost level if the sector is fully passable for the
   * class with one cost level (legs inside it are exact weighted octile distances), else −1.
   */
  readonly secInfo: Int32Array;
  /** Derived: node cells, index ((sector·3 + c − 1)·16 + slot), −1 = empty slot. */
  readonly nodes: Int32Array;
  /** Derived: intra-sector costs (upper triangle), index ((sector·3 + c − 1)·120 + pair). */
  readonly edges: Uint16Array;
  /** Derived: sector → path bitset, NAV_BACK_WORDS u32 per sector. */
  readonly back: Uint32Array;
  /** Rule: request FIFO (path ids, ring). */
  readonly fifo: Int32Array;
  /** Rule: counters. */
  readonly ctr: Int32Array;
  readonly paths: Table<PathSchema>;
  readonly blocks: NavRegions['blocks'];
  readonly regions: NavRegions;

  constructor(r: NavRegions) {
    if (!r.terrain.isBound) throw new Error('nav: regions are not bound (build the arena first)');
    const size = r.sizeWu;
    this.size = size;
    this.shift = 31 - Math.clz32(size);
    this.mask = size - 1;
    this.n = size * size;
    this.secPerEdge = size >> NAV_SECTOR_SHIFT;
    this.secShift = this.shift - NAV_SECTOR_SHIFT;
    this.numSectors = this.secPerEdge * this.secPerEdge;
    const n = this.n;
    this.terrain = r.terrain.u8.subarray(0, n);
    this.foot = r.foot.u8.subarray(0, n);
    this.clear = r.clear.u8.subarray(0, n);
    this.comp = r.comp.u16.subarray(0, NAV_CLASSES * n);
    this.compMeta = r.compMeta.i32;
    this.secInfo = r.secInfo.i32;
    this.nodes = r.nodes.i32;
    this.edges = r.edges.u16;
    this.back = r.back.u32.subarray(0, this.numSectors * NAV_BACK_WORDS);
    this.fifo = r.fifo.i32;
    this.ctr = r.ctr.i32;
    this.paths = r.paths;
    this.blocks = r.blocks;
    this.regions = r;
    ensureScratch(n, this.numSectors);
  }

  /** Sector index of a cell. */
  sectorOf(cell: number): number {
    const x = cell & this.mask;
    const z = cell >> this.shift;
    return ((z >> NAV_SECTOR_SHIFT) << this.secShift) | (x >> NAV_SECTOR_SHIFT);
  }

  /** Cell of a Fx position (clamped to the map). */
  cellOfFx(xRaw: number, zRaw: number): number {
    let x = xRaw >> 12;
    let z = zRaw >> 12;
    const m = this.size - 1;
    x = x < 0 ? 0 : x > m ? m : x;
    z = z < 0 ? 0 : z > m ? m : z;
    return (z << this.shift) | x;
  }

  /** Top-left cell coordinate of a sector. */
  sectorX0(sec: number): number {
    return (sec & (this.secPerEdge - 1)) << NAV_SECTOR_SHIFT;
  }

  sectorZ0(sec: number): number {
    return (sec >> this.secShift) << NAV_SECTOR_SHIFT;
  }
}
