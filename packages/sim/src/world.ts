/**
 * The simulation world: one arena (PLAN §3.5) plus read-only configuration (blueprint table)
 * and transient, stateless scratch buffers. All simulation state lives in the arena, so
 * snapshot/restore are single memcpys and the hashes cover everything.
 */
import { FX_ONE, MAX_ARMIES, XxHash32, type Tick } from '@faf/fixed';
import { ArenaBuilder, type Arena, type Dense, type RawRegion, type Table } from '@faf/heap';
import { CommandBatchView } from '@faf/protocol';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import {
  CAP_UNITS,
  COARSE_CELL_SHIFT,
  COARSE_CELL_WU,
  DEFAULT_MAP_SIZE_WU,
  FINE_CELL_SHIFT,
  MAX_MAP_SIZE_WU,
  MIN_MAP_SIZE_WU,
  NO_ACK,
} from './constants.ts';
import {
  Alliance,
  Armies,
  gridDims,
  gridRegions,
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
  /** Side length of the square test plane in WU (multiple of 32, default 512). */
  readonly mapSizeWu?: number;
  /** Unit cap per army (default: CAP_UNITS, i.e. only the table capacity limits). */
  readonly unitCapPerArmy?: number;
}

export class World {
  readonly arena: Arena;
  /** Blueprint table (configuration, not state; part of simId via simHash). */
  readonly bp: SimBpTable;
  readonly header: RawRegion;
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

  /** @internal Reused hasher (allocation-free hashing). */
  readonly hasher = new XxHash32(0);
  /** @internal Transient command staging (no state between steps). */
  readonly stage = new CommandStage();
  /** @internal Cursor for Uint8Array batches. */
  readonly batchView = new CommandBatchView();

  /** @internal Use createWorld(). */
  constructor(bp: SimBpTable, mapSizeWu: number) {
    this.bp = bp;
    this.mapSizeWu = mapSizeWu;
    this.mapMax = mapSizeWu * FX_ONE;
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
    this.arena = b.build();
    this.fine = new SpatialGrid(dims.fine, FINE_CELL_SHIFT, fs, fc, fi, fo);
    this.coarse = new SpatialGrid(dims.coarse, COARSE_CELL_SHIFT, cs, cc, ci, co);
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

/** Creates a world at tick 0: empty unit table, `armyCount` active armies, FFA alliances. */
export function createWorld(options: CreateWorldOptions): World {
  const bp = options.bpTable ?? (options.simBin !== undefined ? decodeSimBin(options.simBin) : undefined);
  if (bp === undefined) throw new RangeError('createWorld: simBin or bpTable is required');
  const armyCount = options.armyCount;
  if (!Number.isInteger(armyCount) || armyCount < 1 || armyCount > MAX_ARMIES) {
    throw new RangeError(`createWorld: armyCount must be 1..${MAX_ARMIES}, got ${armyCount}`);
  }
  const mapSizeWu = options.mapSizeWu ?? DEFAULT_MAP_SIZE_WU;
  if (
    !Number.isInteger(mapSizeWu) ||
    mapSizeWu < MIN_MAP_SIZE_WU ||
    mapSizeWu > MAX_MAP_SIZE_WU ||
    mapSizeWu % COARSE_CELL_WU !== 0
  ) {
    throw new RangeError(`createWorld: mapSizeWu must be a multiple of ${COARSE_CELL_WU} in [${MIN_MAP_SIZE_WU}, ${MAX_MAP_SIZE_WU}]`);
  }
  const cap = options.unitCapPerArmy ?? CAP_UNITS;
  if (!Number.isInteger(cap) || cap < 0 || cap > CAP_UNITS) {
    throw new RangeError(`createWorld: unitCapPerArmy must be 0..${CAP_UNITS}`);
  }
  if (!Number.isInteger(options.seed)) throw new RangeError('createWorld: seed must be an integer');

  const w = new World(bp, mapSizeWu);
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
