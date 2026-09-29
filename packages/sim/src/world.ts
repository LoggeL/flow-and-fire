/**
 * The simulation world: one arena (PLAN §3.5) plus read-only configuration (blueprint table)
 * and transient, stateless scratch buffers. All simulation state lives in the arena, so
 * snapshot/restore are single memcpys and the hashes cover everything.
 */
import { FX_ONE, MAX_ARMIES, XxHash32, type Tick } from '@faf/fixed';
import { ArenaBuilder, type Arena, type Dense, type RawRegion, type Table } from '@faf/heap';
import { CommandBatchView } from '@faf/protocol';
import { createTestPlaneMap, mapSimData, type MapSimData } from '@faf/formats';
import type { Heightfield } from '@faf/rules';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import {
  CAP_UNITS,
  COARSE_CELL_SHIFT,
  DEFAULT_MAP_SIZE_WU,
  FINE_CELL_SHIFT,
  MAX_MAP_SIZE_WU,
  MIN_MAP_SIZE_WU,
  NO_ACK,
  SpotKind,
} from './constants.ts';
import {
  Alliance,
  Armies,
  gridDims,
  gridRegions,
  HashLog,
  MAP_POINT_WORDS,
  mapHeightsRegion,
  MapStarts,
  mapSpotsRegion,
  MapTerrain,
  MT_DIM,
  MT_HEIGHT_SCALE_RAW,
  MT_SIZE_WU,
  MT_SPOT_COUNT,
  MT_START_COUNT,
  MT_WATER_FLAG,
  MT_WATER_LEVEL_RAW,
  Movers,
  MOVERS_SCHEMA,
  Units,
  UNITS_SCHEMA,
  WH_ARMY_COUNT,
  WH_MAP_SIZE_WU,
  WH_SEED,
  WH_TICK,
  WorldHeader,
} from './schema.ts';
import { CommandStage } from './stage.ts';

/** Views of one spatial grid (fine or coarse). */
export class SpatialGrid {
  /** Cells per side. */
  readonly dim: number;
  /** Raw Fx → cell coordinate shift. */
  readonly shift: number;
  readonly start: Int32Array;
  readonly cursor: Int32Array;
  readonly items: Int32Array;
  readonly cellOf: Int32Array;

  constructor(dim: number, shift: number, start: RawRegion, cursor: RawRegion, items: RawRegion, cellOf: RawRegion) {
    this.dim = dim;
    this.shift = shift;
    this.start = start.i32.subarray(0, dim * dim + 1);
    this.cursor = cursor.i32.subarray(0, dim * dim);
    this.items = items.i32.subarray(0, CAP_UNITS);
    this.cellOf = cellOf.i32.subarray(0, CAP_UNITS);
  }
}

export interface CreateWorldOptions {
  /** Compiled blueprints: raw sim.bin bytes or an already decoded table. */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  /** Match seed (u32). */
  readonly seed: number;
  /** Active armies 1..16 (MVP: 2). */
  readonly armyCount: number;
  /**
   * The map (from @faf/formats `mapSimData(readRtsMap(bytes))`). Its data is copied into the
   * static arena area; the map size comes from the map. Omitted = the generated flat test plane
   * map (formats `createTestPlaneMap(mapSizeWu)`), which takes the same path as any other map.
   */
  readonly map?: MapSimData;
  /**
   * Without `map`: edge length of the generated test plane map (power of two in 64..4096,
   * default 512). With `map` it may be omitted; if given it must equal the map's size.
   */
  readonly mapSizeWu?: number;
  /** Unit cap per army (default: CAP_UNITS, i.e. only the table capacity limits). */
  readonly unitCapPerArmy?: number;
}

export class World {
  readonly arena: Arena;
  /** Blueprint table (configuration, not state; part of simId via simHash). */
  readonly bp: SimBpTable;
  readonly header: RawRegion;
  /** Derived: last rule hash + tick (observation, not rule state). */
  readonly hashLog: RawRegion;
  readonly armies: Table<typeof Armies.schema>;
  readonly alliance: RawRegion;
  readonly units: Table<typeof UNITS_SCHEMA>;
  readonly movers: Dense<typeof MOVERS_SCHEMA>;
  readonly fine: SpatialGrid;
  readonly coarse: SpatialGrid;
  /** Map side in WU and as raw Fx (positions are clamped to [0, mapMax]). */
  readonly mapSizeWu: number;
  readonly mapMax: number;
  /** Largest per-tick speed of any blueprint (grid staleness margin of the separation query). */
  readonly maxSpeedPerTick: number;
  /** Largest collision radius of any blueprint (Fx). */
  readonly maxRadius: number;
  /** Static map area (PLAN §3.5): terrain parameters, heights, starts, spots. */
  readonly mapTerrain: RawRegion;
  readonly mapHeights: RawRegion;
  readonly mapStarts: RawRegion;
  readonly mapSpots: RawRegion;
  /** Heightfield over the static `map.heights` region (input of rules.sampleHeightRaw). */
  readonly terrain: Heightfield;
  /** True if the map has a water surface. */
  readonly hasWater: boolean;
  /** Water surface (Fx raw); 0 without water (then never read, see hasWater). */
  readonly waterLevel: number;

  /** @internal Reused hasher (allocation-free hashing). */
  readonly hasher = new XxHash32(0);
  /** @internal Transient command staging (no state between steps). */
  readonly stage = new CommandStage();
  /** @internal Cursor for Uint8Array batches. */
  readonly batchView = new CommandBatchView();

  /** @internal Use createWorld(). */
  constructor(bp: SimBpTable, map: MapSimData) {
    const mapSizeWu = map.sizeWu;
    this.bp = bp;
    this.mapSizeWu = mapSizeWu;
    this.mapMax = mapSizeWu * FX_ONE;
    const dim = mapSizeWu + 1;
    let maxV = 0;
    let maxR = 0;
    for (let i = 0; i < bp.count; i++) {
      if (bp.speed[i]! > maxV) maxV = bp.speed[i]!;
      if (bp.radiusCol[i]! > maxR) maxR = bp.radiusCol[i]!;
    }
    this.maxSpeedPerTick = maxV;
    this.maxRadius = maxR;

    const dims = gridDims(mapSizeWu);
    const fineDefs = gridRegions('grid.fine', dims.fine * dims.fine);
    const coarseDefs = gridRegions('grid.coarse', dims.coarse * dims.coarse);
    const b = new ArenaBuilder();
    this.header = b.addRegion(WorldHeader);
    this.armies = b.addTable(Armies);
    this.alliance = b.addRegion(Alliance);
    this.units = b.addTable(Units);
    this.movers = b.addDense(Movers);
    const fs = b.addRegion(fineDefs.start);
    const fc = b.addRegion(fineDefs.cursor);
    const fi = b.addRegion(fineDefs.items);
    const fo = b.addRegion(fineDefs.cellOf);
    const cs = b.addRegion(coarseDefs.start);
    const cc = b.addRegion(coarseDefs.cursor);
    const ci = b.addRegion(coarseDefs.items);
    const co = b.addRegion(coarseDefs.cellOf);
    this.hashLog = b.addRegion(HashLog);
    // Static area (placed after the dynamic one by the builder; not hashed, not snapshotted).
    this.mapTerrain = b.addRegion(MapTerrain);
    this.mapHeights = b.addRegion(mapHeightsRegion(dim));
    this.mapStarts = b.addRegion(MapStarts);
    this.mapSpots = b.addRegion(mapSpotsRegion(map.spots.length));
    this.arena = b.build();
    this.fine = new SpatialGrid(dims.fine, FINE_CELL_SHIFT, fs, fc, fi, fo);
    this.coarse = new SpatialGrid(dims.coarse, COARSE_CELL_SHIFT, cs, cc, ci, co);
    this.terrain = { sizeWu: mapSizeWu, dim, heights: this.mapHeights.u16.subarray(0, dim * dim), heightScaleRaw: map.heightScaleRaw };
    this.hasWater = map.waterLevelRaw !== null;
    this.waterLevel = map.waterLevelRaw ?? 0;
    writeStaticMap(this, map);
  }

  /** Current tick (number of completed steps). */
  get tick(): Tick {
    return this.header.i32[WH_TICK]! as Tick;
  }
  get seed(): number {
    return this.header.u32[WH_SEED]!;
  }
  get armyCount(): number {
    return this.header.i32[WH_ARMY_COUNT]!;
  }
  /** xxHash32 of the arena layout (equal ⇒ snapshots are interchangeable). */
  get layoutHash(): number {
    return this.arena.layoutHash;
  }
  /** Byte length of a snapshot. */
  get snapshotByteLength(): number {
    return this.arena.snapshotByteLength;
  }
}

/** Copies the map into the static arena area (setup time, before tick 0). */
function writeStaticMap(w: World, map: MapSimData): void {
  const t = w.mapTerrain.i32;
  t[MT_SIZE_WU] = w.mapSizeWu;
  t[MT_DIM] = w.terrain.dim;
  t[MT_HEIGHT_SCALE_RAW] = map.heightScaleRaw;
  t[MT_WATER_FLAG] = w.hasWater ? 1 : 0;
  t[MT_WATER_LEVEL_RAW] = w.waterLevel;
  w.terrain.heights.set(map.heights);
  const st = w.mapStarts.i32;
  t[MT_START_COUNT] = map.starts.length;
  for (let i = 0; i < map.starts.length; i++) {
    const s = map.starts[i]!;
    st[i * MAP_POINT_WORDS] = s.army;
    st[i * MAP_POINT_WORDS + 1] = s.x;
    st[i * MAP_POINT_WORDS + 2] = s.z;
  }
  const sp = w.mapSpots.i32;
  t[MT_SPOT_COUNT] = map.spots.length;
  for (let i = 0; i < map.spots.length; i++) {
    const s = map.spots[i]!;
    sp[i * MAP_POINT_WORDS] = s.kind === 'mass' ? SpotKind.Mass : SpotKind.Hydro;
    sp[i * MAP_POINT_WORDS + 1] = s.x;
    sp[i * MAP_POINT_WORDS + 2] = s.z;
  }
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Validates the simulation view of a map (untrusted input: it comes from a file). */
function checkMap(map: MapSimData): void {
  const size = map.sizeWu;
  if (!isMapSize(size)) {
    throw new RangeError(`createWorld: map sizeWu must be a power of two in [${MIN_MAP_SIZE_WU}, ${MAX_MAP_SIZE_WU}], got ${String(size)}`);
  }
  if (map.dim !== size + 1) throw new RangeError(`createWorld: map dim ${String(map.dim)} ≠ sizeWu + 1`);
  if (!(map.heights instanceof Uint16Array) || map.heights.length !== map.dim * map.dim) {
    throw new RangeError(`createWorld: map heights must be a Uint16Array of dim² = ${map.dim * map.dim} samples`);
  }
  if (!isInt(map.heightScaleRaw) || map.heightScaleRaw < 1 || map.heightScaleRaw > 32) {
    throw new RangeError(`createWorld: map heightScaleRaw must be 1..32, got ${String(map.heightScaleRaw)}`);
  }
  if (map.waterLevelRaw !== null && (!isInt(map.waterLevelRaw) || map.waterLevelRaw < 0 || map.waterLevelRaw > 0x7fffffff)) {
    throw new RangeError(`createWorld: map waterLevelRaw must be null or a non-negative integer`);
  }
  const max = size * FX_ONE;
  const inMap = (x: number, z: number): boolean => isInt(x) && isInt(z) && x >= 0 && z >= 0 && x <= max && z <= max;
  if (map.starts.length > MAX_ARMIES) throw new RangeError(`createWorld: at most ${MAX_ARMIES} starts`);
  for (const s of map.starts) {
    if (!isInt(s.army) || s.army < 0 || s.army >= MAX_ARMIES || !inMap(s.x, s.z)) throw new RangeError(`createWorld: invalid map start ${JSON.stringify(s)}`);
  }
  for (const s of map.spots) {
    if ((s.kind !== 'mass' && s.kind !== 'hydro') || !inMap(s.x, s.z)) throw new RangeError(`createWorld: invalid map spot ${JSON.stringify(s)}`);
  }
}

/** Map edge rule shared with formats and render: a power of two in [MIN_MAP_SIZE_WU, MAX_MAP_SIZE_WU]. */
export function isMapSize(size: unknown): size is number {
  return isInt(size) && size >= MIN_MAP_SIZE_WU && size <= MAX_MAP_SIZE_WU && (size & (size - 1)) === 0;
}

/**
 * Creates a world at tick 0: empty unit table, `armyCount` active armies, FFA alliances, the map
 * (default: the generated flat test plane map) in the static arena area.
 */
export function createWorld(options: CreateWorldOptions): World {
  const bp = options.bpTable ?? (options.simBin !== undefined ? decodeSimBin(options.simBin) : undefined);
  if (bp === undefined) throw new RangeError('createWorld: simBin or bpTable is required');
  const armyCount = options.armyCount;
  if (!Number.isInteger(armyCount) || armyCount < 1 || armyCount > MAX_ARMIES) {
    throw new RangeError(`createWorld: armyCount must be 1..${MAX_ARMIES}, got ${armyCount}`);
  }
  const sizeOpt = options.mapSizeWu;
  if (sizeOpt !== undefined && !isMapSize(sizeOpt)) {
    throw new RangeError(`createWorld: mapSizeWu must be a power of two in [${MIN_MAP_SIZE_WU}, ${MAX_MAP_SIZE_WU}], got ${String(sizeOpt)}`);
  }
  const map = options.map ?? mapSimData(createTestPlaneMap(sizeOpt ?? DEFAULT_MAP_SIZE_WU));
  checkMap(map);
  if (sizeOpt !== undefined && sizeOpt !== map.sizeWu) {
    throw new RangeError(`createWorld: mapSizeWu ${sizeOpt} ≠ map size ${map.sizeWu}`);
  }
  const mapSizeWu = map.sizeWu;
  const cap = options.unitCapPerArmy ?? CAP_UNITS;
  if (!Number.isInteger(cap) || cap < 0 || cap > CAP_UNITS) {
    throw new RangeError(`createWorld: unitCapPerArmy must be 0..${CAP_UNITS}`);
  }
  if (!Number.isInteger(options.seed)) throw new RangeError('createWorld: seed must be an integer');

  const w = new World(bp, map);
  const h = w.header;
  h.i32[WH_TICK] = 0;
  h.u32[WH_SEED] = options.seed >>> 0;
  h.i32[WH_ARMY_COUNT] = armyCount;
  h.i32[WH_MAP_SIZE_WU] = mapSizeWu;

  const a = w.armies;
  for (let i = 0; i < MAX_ARMIES; i++) {
    const row = a.alloc();
    a.col.active[row] = i < armyCount ? 1 : 0;
    a.col.unitCount[row] = 0;
    a.col.unitCap[row] = cap;
    a.col.lastAckSeq[row] = NO_ACK;
  }
  const m = w.alliance.u8;
  for (let i = 0; i < MAX_ARMIES; i++) m[i * MAX_ARMIES + i] = 1;
  // Empty grids: every bucket is empty and no slot is registered.
  w.fine.cellOf.fill(-1);
  w.coarse.cellOf.fill(-1);
  return w;
}
