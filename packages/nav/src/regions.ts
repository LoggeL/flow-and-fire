/**
 * Arena regions of the navigation state (PLAN §3.1 "aller State inklusive Caches liegt in der
 * Arena", §3.5). The sim registers them in its own schema (`addNavRegions`); tests and benches use
 * `createStandaloneNav`, which builds an arena with exactly the same regions.
 *
 *   static  (never hashed, identity via mapSimHash):   nav.terrain
 *   rule    (rule hash + full hash + snapshot):          nav.foot, nav.paths, nav.blocks, nav.fifo, nav.ctr
 *   derived (full hash + snapshot, not rule hash):       nav.clear, nav.comp, nav.compmeta, nav.secinfo, nav.nodes,
 *                                                        nav.edges, nav.back
 */

import {
  defineRegion,
  defineSlab,
  defineTable,
  type ArenaBuilder,
  type RawRegion,
  type RawRegionDef,
  type Slab,
  type SlabDef,
  type Table,
  type TableDef,
} from '@faf/heap';
import {
  CTR_WORDS,
  NAV_BACK_WORDS,
  NAV_BLOCK_WORDS,
  NAV_CAP_BLOCKS,
  NAV_CAP_PATHS,
  NAV_CLASSES,
  NAV_EDGE_SLOTS,
  NAV_MAX_COMPONENTS,
  NAV_MAX_SIZE_WU,
  NAV_MIN_SIZE_WU,
  NAV_NODE_SLOTS,
  NAV_SECTOR_SHIFT,
} from './constants.ts';

/** Columns of the path table (one slot per path; slot index = pathId). */
export const PATH_SCHEMA = {
  state: 'u8',
  cls: 'u8',
  flags: 'u8',
  entity: 'i32',
  issueTick: 'i32',
  /** Start of the current search (Fx raw). */
  sx: 'i32',
  sz: 'i32',
  /** Requested goal (Fx raw). */
  tx: 'i32',
  tz: 'i32',
  /** Effective goal (Fx raw): the requested goal, or the centre of the retarget cell. */
  gx: 'i32',
  gz: 'i32',
  /** Effective start / goal cell of the last search (−1 before). */
  startCell: 'i32',
  goalCell: 'i32',
  /** Abstract node cells not yet refined (block chain, head/tail block, read position, count). */
  absHead: 'i32',
  absTail: 'i32',
  absPos: 'i32',
  absLeft: 'i32',
  /** Refined waypoints (Fx x/z pairs, block chain). */
  wpHead: 'i32',
  wpTail: 'i32',
  wpPos: 'i32',
  wpLeft: 'i32',
  /** Cell where the next refinement starts (end of the refined part). */
  refCell: 'i32',
  /** Previous waypoint / start of the current leg (Fx raw). */
  px: 'i32',
  pz: 'i32',
  /** Cost of the abstract route (or of the fine path for Direct/fallback). */
  cost: 'i32',
  /** Cost of the goal leg (last abstract node → goal inside the goal sector), −1 if none. */
  legCost: 'i32',
} as const;

export type PathSchema = typeof PATH_SCHEMA;

/** Region definitions for one map size. */
export interface NavRegionDefs {
  readonly sizeWu: number;
  readonly terrain: RawRegionDef;
  readonly foot: RawRegionDef;
  readonly paths: TableDef<PathSchema>;
  readonly blocks: SlabDef;
  readonly fifo: RawRegionDef;
  readonly ctr: RawRegionDef;
  readonly clear: RawRegionDef;
  readonly comp: RawRegionDef;
  readonly compMeta: RawRegionDef;
  readonly secInfo: RawRegionDef;
  readonly nodes: RawRegionDef;
  readonly edges: RawRegionDef;
  readonly back: RawRegionDef;
}

/** Bound regions (after the arena was built). */
export interface NavRegions {
  readonly sizeWu: number;
  readonly terrain: RawRegion;
  readonly foot: RawRegion;
  readonly paths: Table<PathSchema>;
  readonly blocks: Slab;
  readonly fifo: RawRegion;
  readonly ctr: RawRegion;
  readonly clear: RawRegion;
  readonly comp: RawRegion;
  readonly compMeta: RawRegion;
  readonly secInfo: RawRegion;
  readonly nodes: RawRegion;
  readonly edges: RawRegion;
  readonly back: RawRegion;
}

/** Words per class in `nav.compmeta`: [0] = component count, [label] = smallest cell of the label. */
export const COMP_META_WORDS = NAV_MAX_COMPONENTS + 1;

function checkSize(sizeWu: number): void {
  if (!Number.isInteger(sizeWu) || sizeWu < NAV_MIN_SIZE_WU || sizeWu > NAV_MAX_SIZE_WU || (sizeWu & (sizeWu - 1)) !== 0) {
    throw new RangeError(`nav: sizeWu must be a power of two in [${NAV_MIN_SIZE_WU}, ${NAV_MAX_SIZE_WU}], got ${String(sizeWu)}`);
  }
}

/** Number of sectors of a map. */
export function navSectorCount(sizeWu: number): number {
  const s = sizeWu >> NAV_SECTOR_SHIFT;
  return s * s;
}

/**
 * Declares the nav regions for a map of `sizeWu` WU (power of two, 64..4096). Region names start
 * with `nav.`; the caller registers them in the order of its choice (e.g. `addNavRegions`).
 */
export function defineNavRegions(sizeWu: number): NavRegionDefs {
  checkSize(sizeWu);
  const n = sizeWu * sizeWu;
  const sectors = navSectorCount(sizeWu);
  return {
    sizeWu,
    terrain: defineRegion('nav.terrain', n, { area: 'static' }),
    foot: defineRegion('nav.foot', n),
    paths: defineTable('nav.paths', NAV_CAP_PATHS, PATH_SCHEMA),
    blocks: defineSlab('nav.blocks', NAV_BLOCK_WORDS * 4, NAV_CAP_BLOCKS),
    fifo: defineRegion('nav.fifo', NAV_CAP_PATHS * 4),
    ctr: defineRegion('nav.ctr', CTR_WORDS * 4),
    clear: defineRegion('nav.clear', n, { derived: true }),
    comp: defineRegion('nav.comp', NAV_CLASSES * n * 2, { derived: true }),
    compMeta: defineRegion('nav.compmeta', NAV_CLASSES * COMP_META_WORDS * 4, { derived: true }),
    secInfo: defineRegion('nav.secinfo', sectors * NAV_CLASSES * 4, { derived: true }),
    nodes: defineRegion('nav.nodes', sectors * NAV_CLASSES * NAV_NODE_SLOTS * 4, { derived: true }),
    edges: defineRegion('nav.edges', sectors * NAV_CLASSES * NAV_EDGE_SLOTS * 2, { derived: true }),
    back: defineRegion('nav.back', sectors * NAV_BACK_WORDS * 4, { derived: true }),
  };
}

/** Registers all nav regions (in a fixed order) with an arena builder. */
export function addNavRegions(b: ArenaBuilder, defs: NavRegionDefs): NavRegions {
  return {
    sizeWu: defs.sizeWu,
    terrain: b.addRegion(defs.terrain),
    foot: b.addRegion(defs.foot),
    paths: b.addTable(defs.paths),
    blocks: b.addSlab(defs.blocks),
    fifo: b.addRegion(defs.fifo),
    ctr: b.addRegion(defs.ctr),
    clear: b.addRegion(defs.clear),
    comp: b.addRegion(defs.comp),
    compMeta: b.addRegion(defs.compMeta),
    secInfo: b.addRegion(defs.secInfo),
    nodes: b.addRegion(defs.nodes),
    edges: b.addRegion(defs.edges),
    back: b.addRegion(defs.back),
  };
}

/** Byte sizes of the nav regions (payload, without the 8-byte alignment of the arena). */
export interface NavMemory {
  readonly static: number;
  readonly rule: number;
  readonly derived: number;
  readonly total: number;
  readonly byRegion: Readonly<Record<string, number>>;
}

/** Memory of the nav regions for a map size (tables/slabs include their headers and freelists). */
export function navMemoryBytes(sizeWu: number): NavMemory {
  const d = defineNavRegions(sizeWu);
  let pathRow = 0;
  for (const t of Object.values(PATH_SCHEMA)) pathRow += t === 'u8' ? 1 : 4;
  const paths = 32 + NAV_CAP_PATHS * (4 + 2 + 1 + pathRow);
  const blocks = 32 + NAV_CAP_BLOCKS * (4 + 1 + NAV_BLOCK_WORDS * 4);
  const by: Record<string, number> = {
    'nav.terrain': d.terrain.bytes,
    'nav.foot': d.foot.bytes,
    'nav.paths': paths,
    'nav.blocks': blocks,
    'nav.fifo': d.fifo.bytes,
    'nav.ctr': d.ctr.bytes,
    'nav.clear': d.clear.bytes,
    'nav.comp': d.comp.bytes,
    'nav.compmeta': d.compMeta.bytes,
    'nav.secinfo': d.secInfo.bytes,
    'nav.nodes': d.nodes.bytes,
    'nav.edges': d.edges.bytes,
    'nav.back': d.back.bytes,
  };
  const stat = by['nav.terrain']!;
  const rule = by['nav.foot']! + paths + blocks + by['nav.fifo']! + by['nav.ctr']!;
  const derived =
    by['nav.clear']! + by['nav.comp']! + by['nav.compmeta']! + by['nav.secinfo']! + by['nav.nodes']! + by['nav.edges']! + by['nav.back']!;
  return { static: stat, rule, derived, total: stat + rule + derived, byRegion: by };
}
