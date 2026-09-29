/**
 * SPK1 "Sim-Durchsatz" (PLAN §4): throw-away SoA prototype on @faf/fixed + @faf/heap that carries
 * the Big-Battle load of §3.4 — 1,000 ground units (movement + grid separation), staggered
 * targeting, 4,000 projectiles with swept-segment DDA in the 4-WU fine grid, row-span-delta vision
 * stamping (refcount grid, 2 teams), 300 kinematic aircraft and a rule hash every 10 ticks.
 *
 * It follows the determinism contract of the sim packages (Q20.12 integers, isqrt, LUT angles,
 * stateless rng32, all state in one arena, slot/dense order iteration), so its hash chain is
 * bit-identical in every engine; the headless tests pin that.
 *
 * World layout (arena registration order = hash order):
 *   hdr (tick, seed, counters) · ground (table) · air (table) · proj (dense)
 *   derived: ground/air fine footprint grids, ground center grid, coarse targeting grids,
 *            vision refcounts per team.
 */
import { FX_ONE, isqrt, rng32, XxHash32 } from '@faf/fixed';
import { ArenaBuilder, defineDense, defineRegion, defineTable, type Arena, type Dense, type RawRegion, type Table } from '@faf/heap';

// ---- scale ----------------------------------------------------------------------------------

export const MAP_WU = 512;
export const MAP_MAX = MAP_WU * FX_ONE;
export const TEAMS = 2;
export const GROUND_PER_TEAM = 500;
export const AIR_PER_TEAM = 150;
export const GROUND_CAP = 1024;
export const AIR_CAP = 512;
/** Live projectile budget (§3.4 Big Battle: 4,000 projectiles); weapons hold fire above it. */
export const PROJ_LIVE_TARGET = 4000;
export const PROJ_CAP = 4096;

// ---- grids ----------------------------------------------------------------------------------

/** Fine grid: 4 WU cells (raw >> 14). */
export const FINE_SHIFT = 14;
export const FINE_DIM = MAP_WU / 4;
export const FINE_CELLS = FINE_DIM * FINE_DIM;
/** Coarse targeting grid: 16 WU cells (raw >> 16). */
export const COARSE_SHIFT = 16;
export const COARSE_DIM = MAP_WU / 16;
export const COARSE_CELLS = COARSE_DIM * COARSE_DIM;
/** A footprint (radius ≤ 2 WU) overlaps at most 2×2 fine cells. */
export const FOOTPRINT_MAX_CELLS = 4;

// ---- units ----------------------------------------------------------------------------------

/** Ground unit categories (targeting priorities). */
export const Cat = { Light: 0, Heavy: 1, AntiAir: 2, Air: 3 } as const;

export const GROUND_RADIUS = (FX_ONE * 5) >> 3; // 0.625 WU
export const AIR_RADIUS = FX_ONE; // 1 WU
export const GROUND_SPEED = 1229; // 0.3 WU/tick (3 WU/s), rounded like the blueprint compiler
export const GROUND_ACCEL = 123; // 0.03 WU/tick²
export const GROUND_TURN = 3277; // 180°/s
export const AIR_CRUISE = FX_ONE + (FX_ONE >> 1); // 1.5 WU/tick
export const AIR_MIN_SPEED = (FX_ONE * 3) >> 2; // 0.75 WU/tick (never below: aircraft do not hover)
export const AIR_ACCEL = FX_ONE >> 4;
export const AIR_TURN = 1092; // 60°/s
export const GROUND_HP = [220, 400, 180] as const;
export const AIR_HP = 120;

/** Weapon ranges (raw Fx) and damage per category of the firing unit. */
export const RANGE = [30 * FX_ONE, 34 * FX_ONE, 40 * FX_ONE] as const;
export const DAMAGE = [3, 6, 4] as const;
/** Reload in ticks (+ 0..1 rng jitter). */
export const RELOAD = [1, 2, 1] as const;
export const PROJ_SPEED = FX_ONE; // 1 WU/tick (10 WU/s)
export const PROJ_TTL = 48;

/** Vision radius in fine cells (ground 20 WU, air 32 WU). */
export const VISION_R_GROUND = 5;
export const VISION_R_AIR = 8;

/** Battle band where ground units pick their move targets (x per team, z range). */
export const FRONT_X = [242 * FX_ONE, 270 * FX_ONE] as const;
export const FRONT_HALF_WIDTH = 14 * FX_ONE;
export const FRONT_Z_MIN = 128 * FX_ONE;
export const FRONT_Z_SPAN = 256 * FX_ONE;
/** Respawn lines of the two teams. */
export const SPAWN_X = [196 * FX_ONE, 316 * FX_ONE] as const;

// rng salts
export const SALT_TARGET = 0x53314d54; // 'S1MT'
export const SALT_SPAWN = 0x53315350;
export const SALT_AIR_WP = 0x53314157;
export const SALT_AIR_CIRCLE = 0x53314143;
export const SALT_RELOAD = 0x5331524c;
export const SALT_SPREAD = 0x53315352;
export const SALT_SEP = 0x53315345;

// ---- schema ---------------------------------------------------------------------------------

export const HDR_TICK = 0;
export const HDR_SEED = 1;
export const HDR_SHOTS = 2;
export const HDR_HITS = 3;
export const HDR_KILLS = 4;
export const HDR_LAST_HASH_TICK = 5;
export const HDR_LAST_HASH = 6;

export const GROUND_SCHEMA = {
  team: 'u8',
  cat: 'u8',
  dead: 'u8',
  tgtLayer: 'u8',
  yaw: 'u16',
  cooldown: 'u16',
  visX: 'i16',
  visZ: 'i16',
  x: 'i32',
  z: 'i32',
  px: 'i32',
  pz: 'i32',
  speed: 'i32',
  tx: 'i32',
  tz: 'i32',
  hp: 'i32',
  tgt: 'u32',
} as const;

export const AIR_SCHEMA = {
  team: 'u8',
  dead: 'u8',
  circle: 'u16',
  yaw: 'u16',
  visX: 'i16',
  visZ: 'i16',
  x: 'i32',
  z: 'i32',
  px: 'i32',
  pz: 'i32',
  speed: 'i32',
  wx: 'i32',
  wz: 'i32',
  hp: 'i32',
} as const;

export const PROJ_SCHEMA = {
  team: 'u8',
  layer: 'u8',
  ttl: 'u16',
  dmg: 'u16',
  x: 'i32',
  z: 'i32',
  vx: 'i32',
  vz: 'i32',
} as const;

/** Counting-sort grid over the arena: start (cells + 1), items, per-item scratch. */
export class Grid {
  readonly cells: number;
  readonly start: Int32Array;
  readonly items: Int32Array;
  constructor(cells: number, start: RawRegion, items: RawRegion) {
    this.cells = cells;
    this.start = start.i32.subarray(0, cells + 1);
    this.items = items.i32;
  }
}

export class Spk1World {
  readonly arena: Arena;
  readonly hdr: Int32Array;
  readonly hdrU32: Uint32Array;
  readonly ground: Table<typeof GROUND_SCHEMA>;
  readonly air: Table<typeof AIR_SCHEMA>;
  readonly proj: Dense<typeof PROJ_SCHEMA>;
  /** Ground footprint grid (projectile hits), ground center grid (separation), air footprint grid. */
  readonly gFine: Grid;
  readonly gCenter: Grid;
  readonly aFine: Grid;
  /** Coarse center grids for targeting. */
  readonly gCoarse: Grid;
  readonly aCoarse: Grid;
  /** Vision refcount per team (fine cells), u16. */
  readonly vision: Uint16Array;
  readonly hasher = new XxHash32();
  /** Stateless scratch (not state): counting-sort cursors. */
  readonly cursor = new Int32Array(FINE_CELLS + 1);

  constructor(seed: number) {
    const b = new ArenaBuilder();
    const hdr = b.addRegion(defineRegion('hdr', 64));
    this.ground = b.addTable(defineTable('ground', GROUND_CAP, GROUND_SCHEMA));
    this.air = b.addTable(defineTable('air', AIR_CAP, AIR_SCHEMA));
    this.proj = b.addDense(defineDense('proj', PROJ_CAP, PROJ_SCHEMA));
    // Derived state (full hash only): grids are rebuilt every tick, vision follows the units.
    const d = { derived: true } as const;
    const gFineStart = b.addRegion(defineRegion('gFine.start', (FINE_CELLS + 1) * 4, d));
    const gFineItems = b.addRegion(defineRegion('gFine.items', GROUND_CAP * FOOTPRINT_MAX_CELLS * 4, d));
    const gCenterStart = b.addRegion(defineRegion('gCenter.start', (FINE_CELLS + 1) * 4, d));
    const gCenterItems = b.addRegion(defineRegion('gCenter.items', GROUND_CAP * 4, d));
    const aFineStart = b.addRegion(defineRegion('aFine.start', (FINE_CELLS + 1) * 4, d));
    const aFineItems = b.addRegion(defineRegion('aFine.items', AIR_CAP * FOOTPRINT_MAX_CELLS * 4, d));
    const gCoarseStart = b.addRegion(defineRegion('gCoarse.start', (COARSE_CELLS + 1) * 4, d));
    const gCoarseItems = b.addRegion(defineRegion('gCoarse.items', GROUND_CAP * 4, d));
    const aCoarseStart = b.addRegion(defineRegion('aCoarse.start', (COARSE_CELLS + 1) * 4, d));
    const aCoarseItems = b.addRegion(defineRegion('aCoarse.items', AIR_CAP * 4, d));
    const vision = b.addRegion(defineRegion('vision', TEAMS * FINE_CELLS * 2, d));
    this.arena = b.build();
    this.hdr = hdr.i32;
    this.hdrU32 = hdr.u32;
    this.gFine = new Grid(FINE_CELLS, gFineStart, gFineItems);
    this.gCenter = new Grid(FINE_CELLS, gCenterStart, gCenterItems);
    this.aFine = new Grid(FINE_CELLS, aFineStart, aFineItems);
    this.gCoarse = new Grid(COARSE_CELLS, gCoarseStart, gCoarseItems);
    this.aCoarse = new Grid(COARSE_CELLS, aCoarseStart, aCoarseItems);
    this.vision = vision.u16.subarray(0, TEAMS * FINE_CELLS);
    this.hdr[HDR_SEED] = seed | 0;
  }

  get tick(): number {
    return this.hdr[HDR_TICK]!;
  }

  get seed(): number {
    return this.hdr[HDR_SEED]!;
  }
}

// ---- vision row spans -----------------------------------------------------------------------

/** Half-widths of a disc of radius r cells per row offset 0..r (isqrt, exact). */
function spans(r: number): Int32Array {
  const out = new Int32Array(r + 1);
  for (let dy = 0; dy <= r; dy++) out[dy] = isqrt(r * r - dy * dy);
  return out;
}

/** Constant disc tables (configuration, derived from integers only). */
export const SPAN_GROUND = spans(VISION_R_GROUND);
export const SPAN_AIR = spans(VISION_R_AIR);

// ---- setup ----------------------------------------------------------------------------------

/** Random point in the team's half of the battle band. */
export function frontTarget(seed: number, tick: number, idx: number, team: number, out: Int32Array): void {
  const r = rng32(seed, tick, idx, SALT_TARGET);
  // Whole-WU offsets: 28 WU across the team's half of the band, 256 WU along it.
  out[0] = FRONT_X[team]! - FRONT_HALF_WIDTH + ((r & 0xffff) % 28) * FX_ONE;
  out[1] = FRONT_Z_MIN + ((r >>> 16) % 256) * FX_ONE;
}

