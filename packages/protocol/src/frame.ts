/**
 * Frame layout (PLAN §3.6): what the sim sends to the renderer each tick, filtered for the
 * viewer. Versioned; the layout is only ever extended (new header fields go after the current
 * header, `headerBytes` tells readers where sections may start).
 *
 * All values little-endian. Sections are 4-byte aligned and packed in this order:
 *   header (128 B) | units | parts | projectiles | beams | events | watch | debug
 *
 * FrameHeader (v1 = the first 96 B; v2 (MS3) appends 32 B, `headerBytes` = 128):
 *    0 magic u32 'IFRM'        4 ver u16                 6 headerBytes u16
 *    8 seq u32                12 tick u32               16 tickTimeUs u32
 *   20 speedPermille u16      22 viewer i8              23 flags u8 (bit0 paused)
 *   24 ackSeq u32             28 hashTick u32           32 hash u32
 *   36 counts u32×5 (units, parts, projectiles, beams, events)
 *   56 offsets u32×5 (same order)
 *   76 fogRect u16×4 (x0, y0, x1, y1)
 *   84 footprintDeltaCount u32 88 debugOffset u32        92 debugBytes u32
 *   v2: 96 watchOffset u32    100 watchCount u32
 *       path statistics (sim-wide counters, PLAN §3.6 "Debug"):
 *      104 pathPending u32    108 requestsIssued u32    112 repathsTriggered u32
 *      116 expansionsLastTick u32                       120 stuckGiveUps u32   124 reserved u32
 *
 * WatchRecord (332 B, one per watched unit, `ctl.watch`, PLAN §3.6 "Watch"):
 *    0 handle u32 | 4 orderCount u16 | 6 flags u8 (WatchFlags) | 7 reserved u8 |
 *    8 targetCount u8 | 9 pointCount u8 | 10 reserved u16 |
 *   12 targets 16 × {type u8, reserved u8×3, x i32, z i32} (12 B; queued order targets, Fx) |
 *  204 points 16 × {x i32, z i32} (8 B; remaining path waypoints, Fx)
 *
 * UnitRecord (48 B):
 *    0 prevPos i32×3 | 12 curPos i32×3 | 24 prevYaw u16 | 26 curYaw u16 | 28 visual u16 |
 *   30 army u8 | 31 hp u8 | 32 build u8 | 33 bank i8 | 34 flags u16 | 36 handle u32 |
 *   40 partBase u32 | 44 partCount u8 | 45 mountAimMask u8 (MountAimParts only) | 46 reserved[2]
 * MountAimParts: channel index = weapon mount; yaw is world yaw, pitch elevation. Both endpoints
 * contain the current read-only observation. Unflagged parts retain direct mesh-part addressing.
 * PartRecord (8 B):       0 prevYaw u16 | 2 curYaw u16 | 4 prevPitch i16 | 6 curPitch i16
 * ProjectileRecord (28 B): 0 prevPos i32×3 | 12 curPos i32×3 | 24 visual u16 | 26 army u8 | 27 flags u8
 * BeamRecord (12 B):      0 srcHandle u32 | 4 dstHandle u32 | 8 visual u16 | 10 srcPart u8 | 11 flags u8
 * EventRecord (32 B):     0 type u16 | 2 visual u16 | 4 tick u32 | 8 subTick u8 | 9 flags u8 |
 *                         10 reserved u16 | 12 pos i32×3 | 24 aux u32 | 28 handle u32
 */

import { DataViewCache } from './bytes.ts';

/** 'IFRM' read as u32 little-endian. */
export const FRAME_MAGIC = 0x4d524649;
/** v3 (MS4): Eco and absolute footprint snapshot; v1/v2 frames remain readable. */
export const FRAME_VERSION = 5;
export const FRAME_HEADER_BYTES_V4 = 160;
export const FRAME_HEADER_BYTES = 192;
export const FH_FLOW_OFFSET = 160;
export const FH_FLOW_COUNT = 164;
export const FH_FOG_OFFSET = 168;
export const FH_FOG_BYTES = 172;
export const FH_FOG_DIM = 176;
export const FH_BUILD_INTENT_OFFSET = 180;
export const FH_BUILD_INTENT_COUNT = 184;
/** Last actual economy observation tick; -1 after restore until the next economy phase. */
export const FH_FLOW_TICK = 188;
/** Four safe-u64 rates in milli-resources/tick; powers in Q16/tick. */
export const FLOW_RECORD_BYTES = 64;
export const BUILD_INTENT_RECORD_BYTES = 24;
export const FlowFlags = { Paused: 1, Enabled: 2, Billed: 4, Contributing: 8, BuildSite: 16, Upgrading: 32 } as const;
export const FogState = { Unexplored: 0, Explored: 1, Visible: 2 } as const;
export const FRAME_HEADER_BYTES_V3 = 144;
export const FH_MATCH_END_TICK = 144;
export const FH_MATCH_WINNER_ARMY = 148;
export const FH_MATCH_WINNING_MASK = 152;
export const FH_MATCH_DEFEATED_MASK = 156;
export const FRAME_HEADER_BYTES_V2 = 128;
/** Header size of v1 frames (MS1/MS2); the reader accepts headers ≥ this size. */
export const FRAME_HEADER_BYTES_V1 = 96;

// ---- header offsets ----
export const FH_MAGIC = 0;
export const FH_VERSION = 4;
export const FH_HEADER_BYTES = 6;
export const FH_SEQ = 8;
export const FH_TICK = 12;
export const FH_TICK_TIME_US = 16;
export const FH_SPEED_PERMILLE = 20;
export const FH_VIEWER = 22;
export const FH_FLAGS = 23;
export const FH_ACK_SEQ = 24;
export const FH_HASH_TICK = 28;
export const FH_HASH = 32;
export const FH_COUNTS = 36;
export const FH_OFFSETS = 56;
export const FH_FOG_RECT = 76;
export const FH_FOOTPRINT_DELTA_COUNT = 84;
export const FH_DEBUG_OFFSET = 88;
export const FH_DEBUG_BYTES = 92;
// v2
export const FH_WATCH_OFFSET = 96;
export const FH_WATCH_COUNT = 100;
export const FH_PATH_PENDING = 104;
export const FH_PATH_REQUESTS = 108;
export const FH_PATH_REPATHS = 112;
export const FH_PATH_EXPANSIONS = 116;
export const FH_STUCK_GIVEUPS = 120;
export const FH_RESERVED_V2 = 124;
export const FH_ECO_OFFSET = 128;
export const FH_ECO_COUNT = 132;
export const FH_FOOTPRINT_OFFSET = 136;
export const FH_FOOTPRINT_COUNT = 140;
export const ECO_RECORD_BYTES = 112;
export const FOOTPRINT_RECORD_BYTES = 24;
export const EcoField = { massStored: 0, energyStored: 1, massCapacity: 2, energyCapacity: 3, massIncome: 4, energyIncome: 5, massDemand: 6, energyDemand: 7, massSpent: 8, energySpent: 9, massOverflow: 10, energyOverflow: 11 } as const;
export type EcoField = (typeof EcoField)[keyof typeof EcoField];

/** Header flag bits. */
export const FrameFlags = {
  Paused: 1 << 0,
  /** Footprint section contains absolute row runs, replace the client replica. */
  FootprintSnapshot: 1 << 1,
} as const;

/** Record sections of a frame (index into counts/offsets). */
export const FrameSection = {
  Units: 0,
  Parts: 1,
  Projectiles: 2,
  Beams: 3,
  Events: 4,
} as const;
export type FrameSection = (typeof FrameSection)[keyof typeof FrameSection];
export const FRAME_SECTION_COUNT = 5;

// ---- UnitRecord ----
export const UNIT_RECORD_BYTES = 48;
export const UNIT_OFF_PREV_POS = 0;
export const UNIT_OFF_CUR_POS = 12;
export const UNIT_OFF_PREV_YAW = 24;
export const UNIT_OFF_CUR_YAW = 26;
export const UNIT_OFF_VISUAL = 28;
export const UNIT_OFF_ARMY = 30;
export const UNIT_OFF_HP = 31;
export const UNIT_OFF_BUILD = 32;
export const UNIT_OFF_BANK = 33;
export const UNIT_OFF_FLAGS = 34;
export const UNIT_OFF_HANDLE = 36;
export const UNIT_OFF_PART_BASE = 40;
export const UNIT_OFF_PART_COUNT = 44;
export const UNIT_OFF_RESERVED = 45;

/** UnitRecord.flags bits. `vet` is a 2-bit field (value = (flags & VetMask) >> VetShift). */
export const UnitFlags = {
  Building: 1 << 0,
  Wreck: 1 << 1,
  Ghost: 1 << 2,
  Blip: 1 << 3,
  VetShift: 4,
  VetMask: 3 << 4,
  ShieldUp: 1 << 6,
  Stalled: 1 << 7,
  Damaged: 1 << 8,
  Idle: 1 << 9,
  NoInterp: 1 << 10,
  Paused: 1 << 11,
  /** Parts are mount observations (world yaw/elevation), not mesh-part poses. Byte 45 is their visible-target mask. */
  MountAimParts: 1 << 12,
} as const;

// ---- WatchRecord ----
/** Order targets and path points per watched unit. */
export const WATCH_MAX_TARGETS = 16;
export const WATCH_MAX_POINTS = 16;
export const WATCH_TARGET_BYTES = 12;
export const WATCH_POINT_BYTES = 8;
export const WATCH_OFF_HANDLE = 0;
export const WATCH_OFF_ORDER_COUNT = 4;
export const WATCH_OFF_FLAGS = 6;
export const WATCH_OFF_TARGET_COUNT = 8;
export const WATCH_OFF_POINT_COUNT = 9;
export const WATCH_OFF_TARGETS = 12;
export const WATCH_OFF_POINTS = WATCH_OFF_TARGETS + WATCH_MAX_TARGETS * WATCH_TARGET_BYTES;
export const WATCH_RECORD_BYTES_V3 = WATCH_OFF_POINTS + WATCH_MAX_POINTS * WATCH_POINT_BYTES;
export const WATCH_FACTORY_OFFSET = WATCH_RECORD_BYTES_V3;
export const WATCH_RECORD_BYTES = 420;

/** WatchRecord.flags bits. */
export const WatchFlags = {
  /** The unit is in its stuck handling (repath/sidestep) or made no progress for a while. */
  Stuck: 1 << 0,
  /** The unit's path goal was retargeted (unreachable/blocked target ⇒ nearest reachable point). */
  Retargeted: 1 << 1,
  /** The unit waits for its path request (it already drives towards the target). */
  PathPending: 1 << 2,
  /** The unit follows a group path (offset preservation). */
  Group: 1 << 3,
} as const;

/** Order types in WatchRecord targets (same numbering as the sim's order records). */
export const WatchOrderType = {
  Move: 1,
  Stop: 2,
  Build: 3,
  Attack:4, Assist:5, Patrol:6, AttackMove:7, AttackGround:8, Repair:9, Guard:10, Reclaim:11, Upgrade:12,
} as const;

/** Maximum parts per unit (PartStream). */
export const MAX_PARTS_PER_UNIT = 8;

// ---- PartRecord ----
export const PART_RECORD_BYTES = 8;
export const PART_OFF_PREV_YAW = 0;
export const PART_OFF_CUR_YAW = 2;
export const PART_OFF_PREV_PITCH = 4;
export const PART_OFF_CUR_PITCH = 6;

// ---- ProjectileRecord ----
export const PROJECTILE_RECORD_BYTES = 28;
export const PROJ_OFF_PREV_POS = 0;
export const PROJ_OFF_CUR_POS = 12;
export const PROJ_OFF_VISUAL = 24;
export const PROJ_OFF_ARMY = 26;
export const PROJ_OFF_FLAGS = 27;

// ---- BeamRecord ----
export const BEAM_RECORD_BYTES = 12;
export const BEAM_OFF_SRC_HANDLE = 0;
export const BEAM_OFF_DST_HANDLE = 4;
export const BEAM_OFF_VISUAL = 8;
export const BEAM_OFF_SRC_PART = 10;
export const BEAM_OFF_FLAGS = 11;

// ---- EventRecord ----
export const EVENT_RECORD_BYTES = 32;
export const EVENT_OFF_TYPE = 0;
export const EVENT_OFF_VISUAL = 2;
export const EVENT_OFF_TICK = 4;
export const EVENT_OFF_SUB_TICK = 8;
export const EVENT_OFF_FLAGS = 9;
export const EVENT_OFF_RESERVED = 10;
export const EVENT_OFF_POS = 12;
export const EVENT_OFF_AUX = 24;
export const EVENT_OFF_HANDLE = 28;

/** Record size per section, indexed by FrameSection. */
export const SECTION_RECORD_BYTES: readonly number[] = [
  UNIT_RECORD_BYTES,
  PART_RECORD_BYTES,
  PROJECTILE_RECORD_BYTES,
  BEAM_RECORD_BYTES,
  EVENT_RECORD_BYTES,
];

/** Per-frame capacities (upper bounds; the real frame is packed to its content). */
export interface FrameCaps {
  readonly units: number;
  readonly parts: number;
  readonly projectiles: number;
  readonly beams: number;
  readonly events: number;
  readonly debugBytes: number;
  /** Watched units (WatchRecords); missing = 0 (no watch section). */
  readonly watch?: number;
  readonly eco?: number;
  readonly footprints?: number;
  readonly flow?: number;
  /** Full 8WU-cell viewer fog snapshot, one FogState byte per cell. */
  readonly fogBytes?: number;
  readonly buildIntents?: number;
}

/** Capacities from PLAN §3.4: 8,192 units (≤ 8 parts each), 16,384 projectiles, 64 watched units. */
export const DEFAULT_FRAME_CAPS: FrameCaps = {
  units: 8192,
  parts: 8192 * MAX_PARTS_PER_UNIT,
  projectiles: 16384,
  beams: 2048,
  events: 4096,
  debugBytes: 65536,
  watch: 64,
  eco: 16,
  footprints: 8192,
  flow: 8192,
  fogBytes: 512 * 512,
  buildIntents: 32768,
};

function align4(n: number): number {
  return (n + 3) & ~3;
}

function capsArray(c: FrameCaps): number[] {
  return [c.units, c.parts, c.projectiles, c.beams, c.events];
}

function checkCaps(c: FrameCaps): void {
  for (const v of [...capsArray(c), c.debugBytes, c.watch ?? 0, c.eco ?? 0, c.footprints ?? 0, c.flow ?? 0, c.fogBytes ?? 0, c.buildIntents ?? 0]) {
    if (!Number.isInteger(v) || v < 0 || v > 0x1000000) throw new RangeError(`invalid frame cap ${v}`);
  }
}

/** Byte size of a frame buffer that can hold any frame within `caps`. */
export function frameCapacityBytes(caps: FrameCaps = DEFAULT_FRAME_CAPS): number {
  checkCaps(caps);
  const c = capsArray(caps);
  let n = FRAME_HEADER_BYTES;
  for (let s = 0; s < FRAME_SECTION_COUNT; s++) n += c[s]! * SECTION_RECORD_BYTES[s]!;
  return n + (caps.watch ?? 0) * WATCH_RECORD_BYTES + (caps.eco ?? 0)*ECO_RECORD_BYTES + (caps.footprints ?? 0)*FOOTPRINT_RECORD_BYTES + (caps.flow ?? 0)*FLOW_RECORD_BYTES + align4(caps.fogBytes ?? 0) + (caps.buildIntents ?? 0)*BUILD_INTENT_RECORD_BYTES + align4(caps.debugBytes);
}

/**
 * Writes frames into a caller-provided buffer without allocating (after the first use of a
 * given target buffer, whose DataView is cached).
 *
 * Records of every section can be written in any interleaving (e.g. a unit, then its parts):
 * while a frame is open each section is staged at its capacity offset; `endFrame()` packs the
 * sections behind each other (memmove) and fills counts/offsets. The target must hold at least
 * `capacityBytes`.
 */
export class FrameWriter {
  readonly caps: FrameCaps;
  readonly capacityBytes: number;
  private readonly capArr: Int32Array;
  private readonly stage: Int32Array;
  private readonly counts = new Int32Array(FRAME_SECTION_COUNT);
  private readonly dvCache = new DataViewCache(4);
  private readonly debugStage: number;
  private readonly watchStage: number;
  private readonly watchCap: number;
  private ecoN = 0;
  private footprintN = 0;
  private readonly ecoStage: number;
  private readonly footprintStage: number;
  private readonly flowStage: number;
  private readonly fogStage: number;
  private readonly buildIntentStage: number;
  private flowN = 0;
  private fogN = 0;
  private fogDimValue = 0;
  private buildIntentN = 0;
  private watchN = 0;
  /** Byte offset of the open watch record (−1 = none). */
  private watchOpen = -1;
  private target: Uint8Array = new Uint8Array(0);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private debugLen = 0;
  private open = false;
  /** Records rejected because a section was full (reset by beginFrame). */
  dropped = 0;

  constructor(caps: FrameCaps = DEFAULT_FRAME_CAPS) {
    this.caps = caps;
    this.capacityBytes = frameCapacityBytes(caps);
    this.capArr = Int32Array.from(capsArray(caps));
    this.stage = new Int32Array(FRAME_SECTION_COUNT);
    let off = FRAME_HEADER_BYTES;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      this.stage[s] = off;
      off += this.capArr[s]! * SECTION_RECORD_BYTES[s]!;
    }
    this.watchCap = caps.watch ?? 0;
    this.watchStage = off;
    off += this.watchCap * WATCH_RECORD_BYTES;
    this.ecoStage = off; off += (caps.eco ?? 0)*ECO_RECORD_BYTES;
    this.footprintStage = off; off += (caps.footprints ?? 0)*FOOTPRINT_RECORD_BYTES;
    this.flowStage = off; off += (caps.flow ?? 0) * FLOW_RECORD_BYTES;
    this.fogStage = off; off += align4(caps.fogBytes ?? 0);
    this.buildIntentStage = off; off += (caps.buildIntents ?? 0) * BUILD_INTENT_RECORD_BYTES;
    this.debugStage = off;
  }

  /** Starts a frame in `target` and writes the fixed header fields. */
  beginFrame(
    target: Uint8Array,
    seq: number,
    tick: number,
    tickTimeUs: number,
    speedPermille: number,
    viewer: number,
    flags: number,
    ackSeq: number,
    hashTick: number,
    hash: number,
  ): void {
    if (target.length < this.capacityBytes) {
      throw new RangeError(`frame target too small: ${target.length} < ${this.capacityBytes}`);
    }
    const dv = this.dvCache.get(target);
    this.target = target;
    this.dv = dv;
    this.open = true;
    this.dropped = 0;
    this.debugLen = 0;
    this.watchN = 0;
    this.ecoN = 0; this.footprintN = 0;
    this.flowN = 0; this.fogN = 0; this.fogDimValue = 0; this.buildIntentN = 0;
    this.watchOpen = -1;
    this.counts.fill(0);
    dv.setUint32(FH_MAGIC, FRAME_MAGIC, true);
    dv.setUint16(FH_VERSION, FRAME_VERSION, true);
    dv.setUint16(FH_HEADER_BYTES, FRAME_HEADER_BYTES, true);
    // u32 fields are written through setInt32(v | 0): the same bytes as setUint32(v >>> 0), but
    // values ≥ 2^31 (e.g. ackSeq 0xFFFFFFFF, hashes) never become boxed doubles (no allocation).
    dv.setInt32(FH_SEQ, seq | 0, true);
    dv.setInt32(FH_TICK, tick | 0, true);
    dv.setInt32(FH_TICK_TIME_US, tickTimeUs | 0, true);
    dv.setUint16(FH_SPEED_PERMILLE, speedPermille, true);
    dv.setInt8(FH_VIEWER, viewer);
    dv.setUint8(FH_FLAGS, flags);
    dv.setInt32(FH_ACK_SEQ, ackSeq | 0, true);
    dv.setInt32(FH_HASH_TICK, hashTick | 0, true);
    dv.setInt32(FH_HASH, hash | 0, true);
    dv.setUint16(FH_FOG_RECT, 0, true);
    dv.setUint16(FH_FOG_RECT + 2, 0, true);
    dv.setUint16(FH_FOG_RECT + 4, 0, true);
    dv.setUint16(FH_FOG_RECT + 6, 0, true);
    dv.setUint32(FH_FOOTPRINT_DELTA_COUNT, 0, true);
    for (let o = FH_WATCH_OFFSET; o < FRAME_HEADER_BYTES; o += 4) dv.setUint32(o, 0, true);
    dv.setInt32(FH_FLOW_TICK, -1, true);
  }

  /** Path statistics of the header (v2): sim-wide pathfinding counters. */
  setPathStats(pending: number, requestsIssued: number, repathsTriggered: number, expansionsLastTick: number, stuckGiveUps: number): void {
    const dv = this.dv;
    dv.setInt32(FH_PATH_PENDING, pending | 0, true);
    dv.setInt32(FH_PATH_REQUESTS, requestsIssued | 0, true);
    dv.setInt32(FH_PATH_REPATHS, repathsTriggered | 0, true);
    dv.setInt32(FH_PATH_EXPANSIONS, expansionsLastTick | 0, true);
    dv.setInt32(FH_STUCK_GIVEUPS, stuckGiveUps | 0, true);
  }

  /** Watch records written so far. */
  get watchCount(): number {
    return this.watchN;
  }

  /**
   * Starts a WatchRecord (handle, number of queued orders, WatchFlags); returns its index or −1
   * if the watch section is full. Targets and points follow with addWatchTarget/addWatchPoint.
   */
  beginWatch(handle: number, orderCount: number, flags: number): number {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    if (this.watchN >= this.watchCap) {
      this.dropped++;
      this.watchOpen = -1;
      return -1;
    }
    const o = this.watchStage + this.watchN * WATCH_RECORD_BYTES;
    const t = this.target;
    for (let i = 0; i < WATCH_RECORD_BYTES; i++) t[o + i] = 0;
    const dv = this.dv;
    dv.setInt32(o + WATCH_OFF_HANDLE, handle | 0, true);
    dv.setUint16(o + WATCH_OFF_ORDER_COUNT, orderCount > 0xffff ? 0xffff : orderCount, true);
    dv.setUint8(o + WATCH_OFF_FLAGS, flags);
    dv.setUint16(o+334,65535,true);dv.setUint32(o+348,0xffffffff,true);
    this.watchOpen = o;
    return this.watchN++;
  }

  /** Appends an order target (WatchOrderType, Fx x/z) to the open record; false if full/none open. */
  addWatchTarget(type: number, x: number, z: number): boolean {
    const o = this.watchOpen;
    if (o < 0) return false;
    const dv = this.dv;
    const n = dv.getUint8(o + WATCH_OFF_TARGET_COUNT);
    if (n >= WATCH_MAX_TARGETS) return false;
    const e = o + WATCH_OFF_TARGETS + n * WATCH_TARGET_BYTES;
    dv.setUint8(e, type);
    dv.setInt32(e + 4, x, true);
    dv.setInt32(e + 8, z, true);
    dv.setUint8(o + WATCH_OFF_TARGET_COUNT, n + 1);
    return true;
  }

  /** Appends a path point (Fx x/z) to the open record; false if full/none open. */
  addWatchPoint(x: number, z: number): boolean {
    const o = this.watchOpen;
    if (o < 0) return false;
    const dv = this.dv;
    const n = dv.getUint8(o + WATCH_OFF_POINT_COUNT);
    if (n >= WATCH_MAX_POINTS) return false;
    const e = o + WATCH_OFF_POINTS + n * WATCH_POINT_BYTES;
    dv.setInt32(e, x, true);
    dv.setInt32(e + 4, z, true);
    dv.setUint8(o + WATCH_OFF_POINT_COUNT, n + 1);
    return true;
  }

  setWatchFactory(repeat:boolean,bp:number,progress:number,rallyX:number,rallyZ:number,target:number,paused=false,fireState=2):void {
    const o=this.watchOpen;if(o<0)return;const d=this.dv;d.setUint8(o+333,repeat?1:0);d.setUint16(o+334,bp<0?65535:bp,true);d.setUint32(o+336,progress,true);d.setInt32(o+340,rallyX,true);d.setInt32(o+344,rallyZ,true);d.setUint32(o+348,target,true);d.setUint8(o+416,paused?1:0);d.setUint8(o+417,fireState);
  }
  addWatchFactoryQueue(bp:number):void {const o=this.watchOpen;if(o<0)return;const n=this.dv.getUint8(o+332);if(n>=32)return;this.dv.setUint16(o+352+n*2,bp,true);this.dv.setUint8(o+332,n+1);}
  beginEco(army:number,stallFlags:number,high:number,normal:number,low:number):number {
    if(this.ecoN >= (this.caps.eco ?? 0)){this.dropped++;return -1;}
    const index=this.ecoN++,o=this.ecoStage+index*ECO_RECORD_BYTES;
    this.target.fill(0,o,o+ECO_RECORD_BYTES);this.dv.setUint8(o,army);this.dv.setUint8(o+1,stallFlags);
    this.dv.setInt32(o+4,high,true);this.dv.setInt32(o+8,normal,true);this.dv.setInt32(o+12,low,true);return index;
  }
  setEcoValue(index:number,field:EcoField,value:number):void {
    if(index<0||index>=this.ecoN||!Number.isSafeInteger(value)||value<0)throw new RangeError('invalid economy field');
    const o=this.ecoStage+index*ECO_RECORD_BYTES+16+field*8;this.dv.setInt32(o,value|0,true);this.dv.setUint32(o+4,Math.floor(value/4294967296),true);
  }
  writeFootprint(x:number,z:number,w:number,h:number,delta:number,handle:number):boolean {
    if(this.footprintN >= (this.caps.footprints ?? 0)){this.dropped++;return false;}
    const o=this.footprintStage+this.footprintN++*FOOTPRINT_RECORD_BYTES,dv=this.dv;
    dv.setInt32(o,x,true);dv.setInt32(o+4,z,true);dv.setInt32(o+8,w,true);dv.setInt32(o+12,h,true);dv.setInt32(o+16,delta,true);dv.setInt32(o+20,handle|0,true);return true;
  }

  /** Billed rates belong to the actual site. Builder links carry zero rates, avoiding invented splits. */
  writeFlow(handle:number,bp:number,army:number,flags:number,priority:number,target:number,massDemand:number,energyDemand:number,massSpent:number,energySpent:number,effectivePower:number,ownPower:number):boolean {
    if(this.flowN >= (this.caps.flow ?? 0)){this.dropped++;return false;}
    const o=this.flowStage+this.flowN++*FLOW_RECORD_BYTES,d=this.dv;
    this.target.fill(0,o,o+FLOW_RECORD_BYTES);
    d.setInt32(o,handle|0,true);d.setUint16(o+4,bp,true);d.setUint8(o+6,army);d.setUint8(o+7,flags);d.setUint8(o+8,priority);d.setInt32(o+12,target|0,true);
    this.writeSafe(o+16,massDemand);this.writeSafe(o+24,energyDemand);this.writeSafe(o+32,massSpent);this.writeSafe(o+40,energySpent);this.writeSafe(o+48,effectivePower);this.writeSafe(o+56,ownPower);
    return true;
  }
  private writeSafe(offset:number,value:number):void {
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError('invalid safe frame value');
    this.dv.setInt32(offset,value|0,true);this.dv.setUint32(offset+4,Math.floor(value/4294967296),true);
  }
  setFlowTick(tick:number):void {this.dv.setInt32(FH_FLOW_TICK,tick,true);}
  setFogSnapshot(cells:Uint8Array,dim:number):boolean {
    if(!Number.isInteger(dim)||dim<1||dim>512||cells.length<dim*dim)throw new RangeError('invalid fog dimensions');
    const n=dim*dim;
    if(n>(this.caps.fogBytes??0)){this.dropped++;return false;}
    for(let i=0;i<n;i++)this.target[this.fogStage+i]=cells[i]!;this.fogN=n;this.fogDimValue=dim;
    this.setFogRect(0,0,dim,dim);return true;
  }
  /** Actual Build orders shared by own/allied builders, including orders beyond watched targets. */
  writeBuildIntent(builder:number,bp:number,yaw:number,x:number,z:number,queueIndex:number,army:number,target:number):boolean {
    if(this.buildIntentN >= (this.caps.buildIntents??0)){this.dropped++;return false;}
    const o=this.buildIntentStage+this.buildIntentN++*BUILD_INTENT_RECORD_BYTES,d=this.dv;
    d.setInt32(o,builder|0,true);d.setUint16(o+4,bp,true);d.setUint16(o+6,yaw,true);d.setInt32(o+8,x,true);d.setInt32(o+12,z,true);d.setUint16(o+16,queueIndex,true);d.setUint8(o+18,army);d.setUint8(o+19,0);d.setInt32(o+20,target|0,true);return true;
  }

  setMatchResult(endTick:number,winnerArmy:number,winningMask:number,defeatedMask:number):void {
    this.dv.setUint32(FH_MATCH_END_TICK,endTick,true);this.dv.setInt32(FH_MATCH_WINNER_ARMY,winnerArmy,true);
    this.dv.setUint32(FH_MATCH_WINNING_MASK,winningMask,true);this.dv.setUint32(FH_MATCH_DEFEATED_MASK,defeatedMask,true);
  }
  /** Fog dirty rectangle (cells). */
  setFogRect(x0: number, y0: number, x1: number, y1: number): void {
    const dv = this.dv;
    dv.setUint16(FH_FOG_RECT, x0, true);
    dv.setUint16(FH_FOG_RECT + 2, y0, true);
    dv.setUint16(FH_FOG_RECT + 4, x1, true);
    dv.setUint16(FH_FOG_RECT + 6, y1, true);
  }

  setFootprintDeltaCount(n: number): void {
    this.dv.setUint32(FH_FOOTPRINT_DELTA_COUNT, n >>> 0, true);
  }

  /** Records written so far per section. */
  count(section: FrameSection): number {
    return this.counts[section]!;
  }

  get unitCount(): number {
    return this.counts[FrameSection.Units]!;
  }

  get partCount(): number {
    return this.counts[FrameSection.Parts]!;
  }

  /** Reserves the next record of `section`; returns its staged byte offset or −1 if full. */
  private slot(section: number): number {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    const i = this.counts[section]!;
    if (i >= this.capArr[section]!) {
      this.dropped++;
      return -1;
    }
    this.counts[section] = i + 1;
    return this.stage[section]! + i * SECTION_RECORD_BYTES[section]!;
  }

  /** Appends a UnitRecord; returns its index or −1 if the unit section is full. */
  writeUnit(
    prevX: number,
    prevY: number,
    prevZ: number,
    curX: number,
    curY: number,
    curZ: number,
    prevYaw: number,
    curYaw: number,
    visual: number,
    army: number,
    hp: number,
    build: number,
    bank: number,
    flags: number,
    handle: number,
    partBase: number,
    partCount: number,
    mountAimMask = 0,
  ): number {
    const o = this.slot(FrameSection.Units);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setInt32(o + UNIT_OFF_PREV_POS, prevX, true);
    dv.setInt32(o + UNIT_OFF_PREV_POS + 4, prevY, true);
    dv.setInt32(o + UNIT_OFF_PREV_POS + 8, prevZ, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS, curX, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS + 4, curY, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS + 8, curZ, true);
    dv.setUint16(o + UNIT_OFF_PREV_YAW, prevYaw, true);
    dv.setUint16(o + UNIT_OFF_CUR_YAW, curYaw, true);
    dv.setUint16(o + UNIT_OFF_VISUAL, visual, true);
    dv.setUint8(o + UNIT_OFF_ARMY, army);
    dv.setUint8(o + UNIT_OFF_HP, hp);
    dv.setUint8(o + UNIT_OFF_BUILD, build);
    dv.setInt8(o + UNIT_OFF_BANK, bank);
    dv.setUint16(o + UNIT_OFF_FLAGS, flags, true);
    dv.setInt32(o + UNIT_OFF_HANDLE, handle | 0, true);
    dv.setInt32(o + UNIT_OFF_PART_BASE, partBase | 0, true);
    dv.setUint8(o + UNIT_OFF_PART_COUNT, partCount);
    dv.setUint8(o + UNIT_OFF_RESERVED, (flags & UnitFlags.MountAimParts) !== 0 ? mountAimMask & ((1 << Math.min(partCount, MAX_PARTS_PER_UNIT)) - 1) : 0);
    dv.setUint16(o + UNIT_OFF_RESERVED + 1, 0, true);
    return this.counts[FrameSection.Units]! - 1;
  }

  /** Appends a PartRecord; returns its index or −1. */
  writePart(prevYaw: number, curYaw: number, prevPitch: number, curPitch: number): number {
    const o = this.slot(FrameSection.Parts);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint16(o + PART_OFF_PREV_YAW, prevYaw, true);
    dv.setUint16(o + PART_OFF_CUR_YAW, curYaw, true);
    dv.setInt16(o + PART_OFF_PREV_PITCH, prevPitch, true);
    dv.setInt16(o + PART_OFF_CUR_PITCH, curPitch, true);
    return this.counts[FrameSection.Parts]! - 1;
  }

  /** Appends a ProjectileRecord; returns its index or −1. */
  writeProjectile(
    prevX: number,
    prevY: number,
    prevZ: number,
    curX: number,
    curY: number,
    curZ: number,
    visual: number,
    army: number,
    flags: number,
  ): number {
    const o = this.slot(FrameSection.Projectiles);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setInt32(o + PROJ_OFF_PREV_POS, prevX, true);
    dv.setInt32(o + PROJ_OFF_PREV_POS + 4, prevY, true);
    dv.setInt32(o + PROJ_OFF_PREV_POS + 8, prevZ, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS, curX, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS + 4, curY, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS + 8, curZ, true);
    dv.setUint16(o + PROJ_OFF_VISUAL, visual, true);
    dv.setUint8(o + PROJ_OFF_ARMY, army);
    dv.setUint8(o + PROJ_OFF_FLAGS, flags);
    return this.counts[FrameSection.Projectiles]! - 1;
  }

  /** Appends a BeamRecord; returns its index or −1. */
  writeBeam(srcHandle: number, dstHandle: number, visual: number, srcPart: number, flags: number): number {
    const o = this.slot(FrameSection.Beams);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint32(o + BEAM_OFF_SRC_HANDLE, srcHandle >>> 0, true);
    dv.setUint32(o + BEAM_OFF_DST_HANDLE, dstHandle >>> 0, true);
    dv.setUint16(o + BEAM_OFF_VISUAL, visual, true);
    dv.setUint8(o + BEAM_OFF_SRC_PART, srcPart);
    dv.setUint8(o + BEAM_OFF_FLAGS, flags);
    return this.counts[FrameSection.Beams]! - 1;
  }

  /** Appends an EventRecord; returns its index or −1. */
  writeEvent(
    type: number,
    visual: number,
    tick: number,
    subTick: number,
    flags: number,
    x: number,
    y: number,
    z: number,
    aux: number,
    handle: number,
  ): number {
    const o = this.slot(FrameSection.Events);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint16(o + EVENT_OFF_TYPE, type, true);
    dv.setUint16(o + EVENT_OFF_VISUAL, visual, true);
    dv.setUint32(o + EVENT_OFF_TICK, tick >>> 0, true);
    dv.setUint8(o + EVENT_OFF_SUB_TICK, subTick);
    dv.setUint8(o + EVENT_OFF_FLAGS, flags);
    dv.setUint16(o + EVENT_OFF_RESERVED, 0, true);
    dv.setInt32(o + EVENT_OFF_POS, x, true);
    dv.setInt32(o + EVENT_OFF_POS + 4, y, true);
    dv.setInt32(o + EVENT_OFF_POS + 8, z, true);
    dv.setUint32(o + EVENT_OFF_AUX, aux >>> 0, true);
    dv.setUint32(o + EVENT_OFF_HANDLE, handle >>> 0, true);
    return this.counts[FrameSection.Events]! - 1;
  }

  /** Copies `len` bytes from `src[off…]` into the debug section (replaces earlier content). */
  setDebugSection(src: Uint8Array, off = 0, len = src.length - off): void {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    if (len < 0 || off < 0 || off + len > src.length) throw new RangeError('debug range out of bounds');
    if (len > this.caps.debugBytes) throw new RangeError(`debug section too large: ${len} > ${this.caps.debugBytes}`);
    const t = this.target;
    for (let i = 0; i < len; i++) t[this.debugStage + i] = src[off + i]!;
    this.debugLen = len;
  }

  /** Packs the sections, writes counts/offsets and returns the frame's byte length. */
  endFrame(): number {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    this.open = false;
    const t = this.target;
    const dv = this.dv;
    let off = FRAME_HEADER_BYTES;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      const n = this.counts[s]!;
      const bytes = n * SECTION_RECORD_BYTES[s]!;
      const from = this.stage[s]!;
      if (bytes > 0 && from !== off) t.copyWithin(off, from, from + bytes);
      dv.setUint32(FH_COUNTS + s * 4, n, true);
      dv.setUint32(FH_OFFSETS + s * 4, off, true);
      off += bytes;
    }
    const wn = this.watchN;
    const wBytes = wn * WATCH_RECORD_BYTES;
    if (wBytes > 0 && this.watchStage !== off) t.copyWithin(off, this.watchStage, this.watchStage + wBytes);
    dv.setUint32(FH_WATCH_OFFSET, off, true);
    dv.setUint32(FH_WATCH_COUNT, wn, true);
    off += wBytes;
    this.watchOpen = -1;
    let bytes=this.ecoN*ECO_RECORD_BYTES;
    if(bytes>0&&this.ecoStage!==off)t.copyWithin(off,this.ecoStage,this.ecoStage+bytes);
    dv.setUint32(FH_ECO_OFFSET,off,true);dv.setUint32(FH_ECO_COUNT,this.ecoN,true);off+=bytes;
    bytes=this.footprintN*FOOTPRINT_RECORD_BYTES;
    if(bytes>0&&this.footprintStage!==off)t.copyWithin(off,this.footprintStage,this.footprintStage+bytes);
    dv.setUint32(FH_FOOTPRINT_OFFSET,off,true);dv.setUint32(FH_FOOTPRINT_COUNT,this.footprintN,true);off+=bytes;
    dv.setUint32(FH_FOOTPRINT_DELTA_COUNT,this.footprintN,true);
    bytes=this.flowN*FLOW_RECORD_BYTES;
    if(bytes>0&&this.flowStage!==off)t.copyWithin(off,this.flowStage,this.flowStage+bytes);
    dv.setUint32(FH_FLOW_OFFSET,off,true);dv.setUint32(FH_FLOW_COUNT,this.flowN,true);off+=bytes;
    if(this.fogN>0&&this.fogStage!==off)t.copyWithin(off,this.fogStage,this.fogStage+this.fogN);
    dv.setUint32(FH_FOG_OFFSET,off,true);dv.setUint32(FH_FOG_BYTES,this.fogN,true);dv.setUint32(FH_FOG_DIM,this.fogDimValue,true);
    const fogEnd=off+this.fogN;off=align4(fogEnd);for(let i=fogEnd;i<off;i++)t[i]=0;
    bytes=this.buildIntentN*BUILD_INTENT_RECORD_BYTES;
    if(bytes>0&&this.buildIntentStage!==off)t.copyWithin(off,this.buildIntentStage,this.buildIntentStage+bytes);
    dv.setUint32(FH_BUILD_INTENT_OFFSET,off,true);dv.setUint32(FH_BUILD_INTENT_COUNT,this.buildIntentN,true);off+=bytes;
    const dbg = this.debugLen;
    if (dbg > 0 && this.debugStage !== off) t.copyWithin(off, this.debugStage, this.debugStage + dbg);
    dv.setUint32(FH_DEBUG_OFFSET, off, true);
    dv.setUint32(FH_DEBUG_BYTES, dbg, true);
    // Zero the alignment padding so equal content always yields equal bytes.
    const end = off + dbg;
    const padded = align4(end);
    for (let i = end; i < padded; i++) t[i] = 0;
    return padded;
  }
}

/**
 * Zero-copy reader over a frame. `reset(bytes)` validates header and section bounds; accessors
 * read through a cached DataView (no allocation for recurring buffers).
 */
export class FrameReader {
  private readonly dvCache = new DataViewCache(4);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private u8: Uint8Array = new Uint8Array(0);
  private uo = 0;
  private po = 0;
  private jo = 0;
  private bo = 0;
  private eo = 0;
  private wo = 0;
  private wn = 0;
  private v2 = false;private watchStride=WATCH_RECORD_BYTES;
  private ecoO=0; private ecoN=0; private footO=0; private footN=0;
  private flowO=0;private flowN=0;private fogO=0;private fogN=0;private fogDimValue=0;private intentO=0;private intentN=0;

  /** Binds to a frame; returns false if magic/version/bounds are invalid. */
  reset(bytes: Uint8Array): boolean {
    if (bytes.length < FRAME_HEADER_BYTES_V1) return false;
    const dv = this.dvCache.get(bytes);
    if (dv.getUint32(FH_MAGIC, true) !== FRAME_MAGIC) return false;
    if (dv.getUint16(FH_VERSION, true) < 1) return false;
    const hb = dv.getUint16(FH_HEADER_BYTES, true);
    if (hb < FRAME_HEADER_BYTES_V1 || hb > bytes.length) return false;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      const n = dv.getUint32(FH_COUNTS + s * 4, true);
      const o = dv.getUint32(FH_OFFSETS + s * 4, true);
      if ((o & 3) !== 0 || o < hb || o + n * SECTION_RECORD_BYTES[s]! > bytes.length) return false;
    }
    const dOff = dv.getUint32(FH_DEBUG_OFFSET, true);
    const dLen = dv.getUint32(FH_DEBUG_BYTES, true);
    if (dOff + dLen > bytes.length) return false;
    const v2 = hb >= FRAME_HEADER_BYTES_V2;
    let wo = 0;
    let wn = 0;
    if (v2) {
      wo = dv.getUint32(FH_WATCH_OFFSET, true);
      wn = dv.getUint32(FH_WATCH_COUNT, true);
      if (wn > 0 && ((wo & 3) !== 0 || wo < hb || wo + wn * (hb>=160?WATCH_RECORD_BYTES:WATCH_RECORD_BYTES_V3) > bytes.length)) return false;
    }
    let ecoO=0,ecoN=0,footO=0,footN=0;
    if(hb>=FRAME_HEADER_BYTES_V3){
      ecoO=dv.getUint32(FH_ECO_OFFSET,true);ecoN=dv.getUint32(FH_ECO_COUNT,true);
      footO=dv.getUint32(FH_FOOTPRINT_OFFSET,true);footN=dv.getUint32(FH_FOOTPRINT_COUNT,true);
      if(ecoN>16|| (ecoN>0&&((ecoO&3)!==0||ecoO<hb||ecoO+ecoN*ECO_RECORD_BYTES>bytes.length)))return false;
      if(footN>8192||(footN>0&&((footO&3)!==0||footO<hb||footO+footN*FOOTPRINT_RECORD_BYTES>bytes.length)))return false;
      for(let i=0;i<ecoN;i++)for(let f=0;f<12;f++){const v=dv.getUint32(ecoO+i*ECO_RECORD_BYTES+16+f*8,true)+dv.getUint32(ecoO+i*ECO_RECORD_BYTES+20+f*8,true)*4294967296;if(!Number.isSafeInteger(v)||v<0)return false;}
    }
    let flowO=0,flowN=0,fogO=0,fogN=0,fogDim=0,intentO=0,intentN=0;
    if(hb>=FRAME_HEADER_BYTES){
      flowO=dv.getUint32(FH_FLOW_OFFSET,true);flowN=dv.getUint32(FH_FLOW_COUNT,true);
      fogO=dv.getUint32(FH_FOG_OFFSET,true);fogN=dv.getUint32(FH_FOG_BYTES,true);fogDim=dv.getUint32(FH_FOG_DIM,true);
      intentO=dv.getUint32(FH_BUILD_INTENT_OFFSET,true);intentN=dv.getUint32(FH_BUILD_INTENT_COUNT,true);
      if(flowN>8192||(flowN>0&&((flowO&3)!==0||flowO<hb||flowO+flowN*FLOW_RECORD_BYTES>bytes.length)))return false;
      if(fogDim>512||fogN!==fogDim*fogDim||(fogN>0&&((fogO&3)!==0||fogO<hb||fogO+fogN>bytes.length)))return false;
      if(intentN>32768||(intentN>0&&((intentO&3)!==0||intentO<hb||intentO+intentN*BUILD_INTENT_RECORD_BYTES>bytes.length)))return false;
      for(let i=0;i<flowN;i++)for(let f=0;f<6;f++){const o=flowO+i*FLOW_RECORD_BYTES+16+f*8;const v=dv.getUint32(o,true)+dv.getUint32(o+4,true)*4294967296;if(!Number.isSafeInteger(v))return false;}
      for(let i=0;i<fogN;i++)if(bytes[fogO+i]!>FogState.Visible)return false;
    }
    this.flowO=flowO;this.flowN=flowN;this.fogO=fogO;this.fogN=fogN;this.fogDimValue=fogDim;this.intentO=intentO;this.intentN=intentN;
    this.ecoO=ecoO;this.ecoN=ecoN;this.footO=footO;this.footN=footN;
    this.v2 = v2;this.watchStride=hb>=160?WATCH_RECORD_BYTES:WATCH_RECORD_BYTES_V3;
    this.wo = wo;
    this.wn = wn;
    this.dv = dv;
    this.u8 = bytes;
    this.uo = dv.getUint32(FH_OFFSETS + FrameSection.Units * 4, true);
    this.po = dv.getUint32(FH_OFFSETS + FrameSection.Parts * 4, true);
    this.jo = dv.getUint32(FH_OFFSETS + FrameSection.Projectiles * 4, true);
    this.bo = dv.getUint32(FH_OFFSETS + FrameSection.Beams * 4, true);
    this.eo = dv.getUint32(FH_OFFSETS + FrameSection.Events * 4, true);
    return true;
  }

  /** The bound frame bytes. */
  get bytes(): Uint8Array {
    return this.u8;
  }
  get dataView(): DataView {
    return this.dv;
  }

  // ---- header ----
  get version(): number {
    return this.dv.getUint16(FH_VERSION, true);
  }
  get headerBytes(): number {
    return this.dv.getUint16(FH_HEADER_BYTES, true);
  }
  get seq(): number {
    return this.dv.getUint32(FH_SEQ, true);
  }
  get matchEndTick():number{return this.headerBytes>=160?this.dv.getUint32(FH_MATCH_END_TICK,true):0;}
  get matchWinnerArmy():number{return this.headerBytes>=160?this.dv.getInt32(FH_MATCH_WINNER_ARMY,true):-1;}
  get matchWinningMask():number{return this.headerBytes>=160?this.dv.getUint32(FH_MATCH_WINNING_MASK,true):0;}
  get matchDefeatedMask():number{return this.headerBytes>=160?this.dv.getUint32(FH_MATCH_DEFEATED_MASK,true):0;}
  get tick(): number {
    return this.dv.getUint32(FH_TICK, true);
  }
  get tickTimeUs(): number {
    return this.dv.getUint32(FH_TICK_TIME_US, true);
  }
  get speedPermille(): number {
    return this.dv.getUint16(FH_SPEED_PERMILLE, true);
  }
  get viewer(): number {
    return this.dv.getInt8(FH_VIEWER);
  }
  get flags(): number {
    return this.dv.getUint8(FH_FLAGS);
  }
  get paused(): boolean {
    return (this.flags & FrameFlags.Paused) !== 0;
  }
  get ackSeq(): number {
    return this.dv.getUint32(FH_ACK_SEQ, true);
  }
  get hashTick(): number {
    return this.dv.getUint32(FH_HASH_TICK, true);
  }
  get hash(): number {
    return this.dv.getUint32(FH_HASH, true);
  }
  count(section: FrameSection): number {
    return this.dv.getUint32(FH_COUNTS + section * 4, true);
  }
  offset(section: FrameSection): number {
    return this.dv.getUint32(FH_OFFSETS + section * 4, true);
  }
  get unitCount(): number {
    return this.count(FrameSection.Units);
  }
  get partCount(): number {
    return this.count(FrameSection.Parts);
  }
  get projectileCount(): number {
    return this.count(FrameSection.Projectiles);
  }
  get beamCount(): number {
    return this.count(FrameSection.Beams);
  }
  get eventCount(): number {
    return this.count(FrameSection.Events);
  }
  get unitsOffset(): number {
    return this.uo;
  }
  /** Fog rect component 0..3 = x0, y0, x1, y1. */
  fogRect(i: number): number {
    return this.dv.getUint16(FH_FOG_RECT + i * 2, true);
  }
  get footprintDeltaCount(): number {
    return this.dv.getUint32(FH_FOOTPRINT_DELTA_COUNT, true);
  }
  get debugOffset(): number {
    return this.dv.getUint32(FH_DEBUG_OFFSET, true);
  }
  get debugBytes(): number {
    return this.dv.getUint32(FH_DEBUG_BYTES, true);
  }

  // ---- v2: path statistics (0 in v1 frames) ----
  private hdr32(off: number): number {
    return this.v2 ? this.dv.getUint32(off, true) : 0;
  }
  /** Path requests waiting in the PathService FIFO. */
  get pathPending(): number {
    return this.hdr32(FH_PATH_PENDING);
  }
  /** Path requests issued since the start (incl. repaths). */
  get requestsIssued(): number {
    return this.hdr32(FH_PATH_REQUESTS);
  }
  /** Paths marked for a repath by new footprints (corridor rule) since the start. */
  get repathsTriggered(): number {
    return this.hdr32(FH_PATH_REPATHS);
  }
  /** Search expansions of the last PathService phase. */
  get expansionsLastTick(): number {
    return this.hdr32(FH_PATH_EXPANSIONS);
  }
  /** Move orders given up by the stuck handling since the start. */
  get stuckGiveUps(): number {
    return this.hdr32(FH_STUCK_GIVEUPS);
  }

  get flowCount():number{return this.flowN;}
  get flowTick():number{return this.headerBytes>=FRAME_HEADER_BYTES?this.dv.getInt32(FH_FLOW_TICK,true):-1;}
  flowHandle(i:number):number{return this.dv.getUint32(this.flowO+i*FLOW_RECORD_BYTES,true);}
  flowBp(i:number):number{return this.dv.getUint16(this.flowO+i*FLOW_RECORD_BYTES+4,true);}
  flowArmy(i:number):number{return this.dv.getUint8(this.flowO+i*FLOW_RECORD_BYTES+6);}
  flowFlags(i:number):number{return this.dv.getUint8(this.flowO+i*FLOW_RECORD_BYTES+7);}
  flowPriority(i:number):number{return this.dv.getUint8(this.flowO+i*FLOW_RECORD_BYTES+8);}
  flowTarget(i:number):number{return this.dv.getUint32(this.flowO+i*FLOW_RECORD_BYTES+12,true);}
  private flowSafe(i:number,offset:number):number{const o=this.flowO+i*FLOW_RECORD_BYTES+offset;return this.dv.getUint32(o,true)+this.dv.getUint32(o+4,true)*4294967296;}
  flowMassDemand(i:number):number{return this.flowSafe(i,16);}
  flowEnergyDemand(i:number):number{return this.flowSafe(i,24);}
  flowMassSpent(i:number):number{return this.flowSafe(i,32);}
  flowEnergySpent(i:number):number{return this.flowSafe(i,40);}
  flowEffectivePower(i:number):number{return this.flowSafe(i,48);}
  flowOwnPower(i:number):number{return this.flowSafe(i,56);}
  /** Full authoritative snapshot; each cell covers 8×8 WU, sampled at its centre. */
  get fogDim():number{return this.fogDimValue;}
  get fogBytes():number{return this.fogN;}
  fogCell(i:number):number{return this.u8[this.fogO+i]??FogState.Unexplored;}
  copyFog(target:Uint8Array):void{if(target.length<this.fogN)throw new RangeError('fog target too small');for(let i=0;i<this.fogN;i++)target[i]=this.u8[this.fogO+i]!;}
  get buildIntentCount():number{return this.intentN;}
  buildIntentBuilder(i:number):number{return this.dv.getUint32(this.intentO+i*BUILD_INTENT_RECORD_BYTES,true);}
  buildIntentBp(i:number):number{return this.dv.getUint16(this.intentO+i*BUILD_INTENT_RECORD_BYTES+4,true);}
  buildIntentYaw(i:number):number{return this.dv.getUint16(this.intentO+i*BUILD_INTENT_RECORD_BYTES+6,true);}
  buildIntentX(i:number):number{return this.dv.getInt32(this.intentO+i*BUILD_INTENT_RECORD_BYTES+8,true);}
  buildIntentZ(i:number):number{return this.dv.getInt32(this.intentO+i*BUILD_INTENT_RECORD_BYTES+12,true);}
  buildIntentQueueIndex(i:number):number{return this.dv.getUint16(this.intentO+i*BUILD_INTENT_RECORD_BYTES+16,true);}
  buildIntentArmy(i:number):number{return this.dv.getUint8(this.intentO+i*BUILD_INTENT_RECORD_BYTES+18);}
  buildIntentTarget(i:number):number{return this.dv.getUint32(this.intentO+i*BUILD_INTENT_RECORD_BYTES+20,true);}

  get ecoCount():number{return this.ecoN;}
  ecoArmy(i:number):number{return this.dv.getUint8(this.ecoO+i*ECO_RECORD_BYTES);}
  ecoStallFlags(i:number):number{return this.dv.getUint8(this.ecoO+i*ECO_RECORD_BYTES+1);}
  ecoRatio(i:number,tier:number):number{return this.dv.getInt32(this.ecoO+i*ECO_RECORD_BYTES+4+tier*4,true);}
  ecoValue(i:number,field:EcoField):number{return this.dv.getUint32(this.ecoO+i*ECO_RECORD_BYTES+16+field*8,true)+this.dv.getUint32(this.ecoO+i*ECO_RECORD_BYTES+20+field*8,true)*4294967296;}
  get footprintCount():number{return this.footN;}
  footprintX(i:number):number{return this.dv.getInt32(this.footO+i*FOOTPRINT_RECORD_BYTES,true);}
  footprintZ(i:number):number{return this.dv.getInt32(this.footO+i*FOOTPRINT_RECORD_BYTES+4,true);}
  footprintW(i:number):number{return this.dv.getInt32(this.footO+i*FOOTPRINT_RECORD_BYTES+8,true);}
  footprintH(i:number):number{return this.dv.getInt32(this.footO+i*FOOTPRINT_RECORD_BYTES+12,true);}
  footprintDelta(i:number):number{return this.dv.getInt32(this.footO+i*FOOTPRINT_RECORD_BYTES+16,true);}
  footprintHandle(i:number):number{return this.dv.getUint32(this.footO+i*FOOTPRINT_RECORD_BYTES+20,true);}

  // ---- v2: watch section ----
  /** Number of WatchRecords (0 in v1 frames). */
  get watchCount(): number {
    return this.wn;
  }
  get watchOffset(): number {
    return this.wo;
  }
  watchHandle(i: number): number {
    return this.dv.getUint32(this.wo + i * this.watchStride + WATCH_OFF_HANDLE, true);
  }
  /** Number of queued orders of the unit (may exceed the transmitted targets). */
  watchOrderCount(i: number): number {
    return this.dv.getUint16(this.wo + i * this.watchStride + WATCH_OFF_ORDER_COUNT, true);
  }
  /** WatchFlags. */
  watchFlags(i: number): number {
    return this.dv.getUint8(this.wo + i * this.watchStride + WATCH_OFF_FLAGS);
  }
  watchTargetCount(i: number): number {
    return this.dv.getUint8(this.wo + i * this.watchStride + WATCH_OFF_TARGET_COUNT);
  }
  /** WatchOrderType of target k. */
  watchTargetType(i: number, k: number): number {
    return this.dv.getUint8(this.wo + i * this.watchStride + WATCH_OFF_TARGETS + k * WATCH_TARGET_BYTES);
  }
  watchTargetX(i: number, k: number): number {
    return this.dv.getInt32(this.wo + i * this.watchStride + WATCH_OFF_TARGETS + k * WATCH_TARGET_BYTES + 4, true);
  }
  watchTargetZ(i: number, k: number): number {
    return this.dv.getInt32(this.wo + i * this.watchStride + WATCH_OFF_TARGETS + k * WATCH_TARGET_BYTES + 8, true);
  }
  watchPointCount(i: number): number {
    return this.dv.getUint8(this.wo + i * this.watchStride + WATCH_OFF_POINT_COUNT);
  }
  watchPointX(i: number, k: number): number {
    return this.dv.getInt32(this.wo + i * this.watchStride + WATCH_OFF_POINTS + k * WATCH_POINT_BYTES, true);
  }
  watchPointZ(i: number, k: number): number {
    return this.dv.getInt32(this.wo + i * this.watchStride + WATCH_OFF_POINTS + k * WATCH_POINT_BYTES + 4, true);
  }

  watchPaused(i:number):boolean{return this.headerBytes>=160&&this.dv.getUint8(this.wo+i*this.watchStride+416)===1;}
  watchFireState(i:number):number{return this.headerBytes>=160?this.dv.getUint8(this.wo+i*this.watchStride+417):2;}
  watchFactoryQueueCount(i:number):number{return this.headerBytes>=160?this.dv.getUint8(this.wo+i*this.watchStride+332):0;}
  watchFactoryQueueBp(i:number,k:number):number{return this.headerBytes>=160&&k<this.watchFactoryQueueCount(i)?this.dv.getUint16(this.wo+i*this.watchStride+352+k*2,true):-1;}
  watchFactoryRepeat(i:number):boolean{return this.headerBytes>=160&&this.dv.getUint8(this.wo+i*this.watchStride+333)===1;}
  watchFactoryBp(i:number):number{const bp=this.headerBytes>=160?this.dv.getUint16(this.wo+i*this.watchStride+334,true):65535;return bp===65535?-1:bp;}
  watchFactoryProgress(i:number):number{return this.headerBytes>=160?this.dv.getUint32(this.wo+i*this.watchStride+336,true):0;}
  watchRallyX(i:number):number{return this.headerBytes>=160?this.dv.getInt32(this.wo+i*this.watchStride+340,true):0;}
  watchRallyZ(i:number):number{return this.headerBytes>=160?this.dv.getInt32(this.wo+i*this.watchStride+344,true):0;}
  watchBuildTarget(i:number):number{return this.headerBytes>=160?this.dv.getUint32(this.wo+i*this.watchStride+348,true):0xffffffff;}
  /** View of a whole record section (e.g. for a GPU upload). Allocates a view object. */
  section(section: FrameSection): Uint8Array {
    const o = this.offset(section);
    return this.u8.subarray(o, o + this.count(section) * SECTION_RECORD_BYTES[section]!);
  }

  /** View of the debug section. Allocates a view object. */
  debugSection(): Uint8Array {
    const o = this.debugOffset;
    return this.u8.subarray(o, o + this.debugBytes);
  }

  // ---- units ----
  /** Byte offset of unit record `i` in the frame. */
  unitOffset(i: number): number {
    return this.uo + i * UNIT_RECORD_BYTES;
  }
  /** prevPos component c (0 = x, 1 = y, 2 = z), Fx raw. */
  unitPrev(i: number, c: number): number {
    return this.dv.getInt32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_POS + c * 4, true);
  }
  /** curPos component c (0 = x, 1 = y, 2 = z), Fx raw. */
  unitCur(i: number, c: number): number {
    return this.dv.getInt32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_POS + c * 4, true);
  }
  unitPrevYaw(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_YAW, true);
  }
  unitCurYaw(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_YAW, true);
  }
  unitVisual(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_VISUAL, true);
  }
  unitArmy(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_ARMY);
  }
  unitHp(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_HP);
  }
  unitBuild(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_BUILD);
  }
  unitBank(i: number): number {
    return this.dv.getInt8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_BANK);
  }
  unitFlags(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_FLAGS, true);
  }
  unitHandle(i: number): number {
    return this.dv.getUint32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_HANDLE, true);
  }
  unitPartBase(i: number): number {
    return this.dv.getUint32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PART_BASE, true);
  }
  unitPartCount(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PART_COUNT);
  }

  /** Valid visible-target channels for MountAimParts; zero for legacy mesh-part streams. */
  unitMountAimMask(i: number): number {
    return (this.unitFlags(i) & UnitFlags.MountAimParts) !== 0
      ? this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_RESERVED) : 0;
  }

  // ---- parts ----
  partPrevYaw(i: number): number {
    return this.dv.getUint16(this.po + i * PART_RECORD_BYTES + PART_OFF_PREV_YAW, true);
  }
  partCurYaw(i: number): number {
    return this.dv.getUint16(this.po + i * PART_RECORD_BYTES + PART_OFF_CUR_YAW, true);
  }
  partPrevPitch(i: number): number {
    return this.dv.getInt16(this.po + i * PART_RECORD_BYTES + PART_OFF_PREV_PITCH, true);
  }
  partCurPitch(i: number): number {
    return this.dv.getInt16(this.po + i * PART_RECORD_BYTES + PART_OFF_CUR_PITCH, true);
  }

  // ---- projectiles ----
  projectilePrev(i: number, c: number): number {
    return this.dv.getInt32(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_PREV_POS + c * 4, true);
  }
  projectileCur(i: number, c: number): number {
    return this.dv.getInt32(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_CUR_POS + c * 4, true);
  }
  projectileVisual(i: number): number {
    return this.dv.getUint16(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_VISUAL, true);
  }
  projectileArmy(i: number): number {
    return this.dv.getUint8(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_ARMY);
  }
  projectileFlags(i: number): number {
    return this.dv.getUint8(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_FLAGS);
  }

  // ---- beams ----
  beamSrcHandle(i: number): number {
    return this.dv.getUint32(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_SRC_HANDLE, true);
  }
  beamDstHandle(i: number): number {
    return this.dv.getUint32(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_DST_HANDLE, true);
  }
  beamVisual(i: number): number {
    return this.dv.getUint16(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_VISUAL, true);
  }
  beamSrcPart(i: number): number {
    return this.dv.getUint8(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_SRC_PART);
  }
  beamFlags(i: number): number {
    return this.dv.getUint8(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_FLAGS);
  }

  // ---- events ----
  eventType(i: number): number {
    return this.dv.getUint16(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_TYPE, true);
  }
  eventVisual(i: number): number {
    return this.dv.getUint16(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_VISUAL, true);
  }
  eventTick(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_TICK, true);
  }
  eventSubTick(i: number): number {
    return this.dv.getUint8(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_SUB_TICK);
  }
  eventFlags(i: number): number {
    return this.dv.getUint8(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_FLAGS);
  }
  eventPos(i: number, c: number): number {
    return this.dv.getInt32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_POS + c * 4, true);
  }
  eventAux(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_AUX, true);
  }
  eventHandle(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_HANDLE, true);
  }
}
