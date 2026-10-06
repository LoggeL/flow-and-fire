/**
 * `sim.bin`: the compiled, sim-relevant blueprint tables (PLAN §3.9 step 7) and their decoder.
 * This module is the contract between the blueprint compiler and the sim: it depends only on
 * @faf/fixed and @faf/rules (no TypeBox) and is exported separately as `@faf/blueprints/simbin`.
 *
 * Version 2 (MS3), little-endian, every section 4-byte aligned. The first 32 header bytes and the
 * 64-byte unit record keep the version-1 layout (v1 fields at the same offsets); v2 fills the
 * formerly reserved unit bytes and appends typed sections listed in a section directory.
 *
 * Header (48 B)
 *    0 magic u32 'IFBP' (0x50424649)     4 version u16 (2)       6 headerBytes u16 (48)
 *    8 unitCount u16                     10 unitRecordBytes u16 (64)
 *   12 categoryCount u16                 14 categoryWords u16 (4)
 *   16 unitsOffset u32                   20 categoryNamesOffset u32
 *   24 unitIdsOffset u32                 28 totalBytes u32
 *   32 sectionDirOffset u32              36 sectionCount u16     38 reserved u16 (0)
 *   40 reserved u32 × 2 (0)
 *
 * UnitRecord (64 B), index = blueprint sim id (u16, order of the sorted string ids)
 *    0 speedPerTick i32 (Fx, WU/tick)    4 accelPerTick i32 (Fx, WU/tick²)
 *    8 turnRatePerTick u16 (Ang16/tick) 10 layer u8 (MotionLayer)   11 sizeClass u8
 *   12 maxHp i32                        16 radius i32 (Fx)           20 vision i32 (Fx)
 *   24 maxSlope i32 (Fx)                28 footprintW u8             29 footprintH u8
 *   30 flags u16 (bit 0 turnInPlace)    32 categories u32×4
 *   48 mass u16 (collision mass ≥ 1)    50 upgradesTo u16 (unit sim id, 0xFFFF = none)
 *   52 brakePerTick i32 (Fx, WU/tick²)  56 buildableBy u16 (expression index, 0xFFFF = none)
 *   58 deathWeapon u16 (weapon index, 0xFFFF = none)
 *   60 firstMount u16                   62 mountCount u8             63 veterancy u8 (0 none, 1 default)
 *
 * Section directory (sectionCount × 16 B): tag u32 (4CC, little-endian ASCII), offset u32,
 * byteLength u32, count u16, stride u16 (record bytes; 0 for string/list sections).
 * Unknown tags are skipped (forward compatible), a missing section means count 0.
 *
 *   UEXT  unit extension, one per unit (32 B): 0 massCost i32, 4 energyCost i32, 8 buildTime i32
 *         (build points), 12 wreckMass i32 (Fx fraction), 16 wreckHp i32 (Fx fraction),
 *         20 hitboxX i32 (Fx), 24 hitboxY i32, 28 hitboxZ i32
 *   WPNR  weapon records (32 B): 0 range i32 (Fx), 4 minRange i32 (Fx), 8 damage i32,
 *         12 damageRadius i32 (Fx), 16 reloadTicks u16, 18 salvo u16, 20 muzzleVelocity i32 (Fx/tick),
 *         24 projectile u16, 26 salvoIntervalTicks u16, 28 reserved u32
 *   WPNI  weapon ids (string table, weapon index order = sorted ids)
 *   PRJR  projectile records (16 B): 0 kind u8 (0 linear, 1 ballistic, 2 homing), 1 reserved u8,
 *         2 turnRatePerTick u16 (Ang16), 4 speedPerTick i32 (Fx), 8 gravityPerTick2 i32 (Fx),
 *         12 lifetimeTicks i32
 *   PRJI  projectile ids
 *   MNTR  weapon mounts (16 B), grouped by unit: 0 unit u16, 2 weapon u16, 4 halfArc u16 (Ang16,
 *         32768 = all around), 6 yawRatePerTick u16 (Ang16), 8 layerMask u8 (bit = MotionLayer),
 *         9 part u8 (0 hull, 1 turret), 10 priorityFirst u16, 12 priorityCount u16, 14 reserved u16
 *   PRIO  target priority list: u16 expression indices (count entries)
 *   CEXT  category expressions (8 B): 0 codeOffset u32 (words into CEXC), 4 codeLength u16,
 *         6 maxDepth u8, 7 reserved u8 — index = position of the source in code-unit order
 *   CEXC  expression bytecode pool (i32 words, @faf/rules ExprOp postfix code)
 *   CEXS  expression sources (u16 length + ASCII each, for diagnostics)
 *   PRPR  prop records (24 B): 0 maxHp i32 (0 = indestructible), 4 reclaimMass i32,
 *         8 reclaimEnergy i32, 12 reclaimTicks i32, 16 footprintW u8, 17 footprintH u8,
 *         18 flags u16 (bit 0 blocksShots), 20 reserved u32
 *   PRPI  prop ids
 *   FACR  faction records (8 B): 0 startUnit u16, 2 unitCount u16, 4 unitFirst u32 (into FACU)
 *   FACU  faction unit list (u16 unit sim ids)
 *   FACI  faction ids
 *
 * String tables (category names, ids): per entry u8 length + printable ASCII; zero-padded to 4 B.
 *
 * Version 1 (MS1/MS2) stays readable: its unit records carry zeros in the v2 bytes, the decoder
 * fills the v2 defaults (mass from sizeClass, turnInPlace for land, brake = accel, nothing
 * referenced) and reports `version === 1`.
 */
import { asAng16, asFx, xxHash32, type Ang16, type Fx } from '@faf/fixed';
import { matchesMaskCode, MotionLayer, validateCategoryCode } from '@faf/rules';

/** 'IFBP' read as u32 little-endian. */
export const SIM_BIN_MAGIC = 0x50424649;
/** Current (written) version. */
export const SIM_BIN_VERSION = 2;
/** Oldest version the decoder still reads. */
export const SIM_BIN_MIN_VERSION = 1;
export const SIM_BIN_HEADER_BYTES = 48;
export const SIM_BIN_V1_HEADER_BYTES = 32;
export const SIM_BIN_UNIT_RECORD_BYTES = 64;
export const SIM_BIN_CATEGORY_WORDS = 4;
/** Maximum number of blueprints per table (u16 indices; 0xFFFF means "none"). */
export const SIM_BIN_MAX_UNITS = 0xfffe;
/** "No reference" in u16 index fields. */
export const SIM_BIN_NONE = 0xffff;

// Unit record field offsets.
export const SBU_SPEED = 0;
export const SBU_ACCEL = 4;
export const SBU_TURN_RATE = 8;
export const SBU_LAYER = 10;
export const SBU_SIZE_CLASS = 11;
export const SBU_MAX_HP = 12;
export const SBU_RADIUS = 16;
export const SBU_VISION = 20;
export const SBU_MAX_SLOPE = 24;
export const SBU_FOOTPRINT_W = 28;
export const SBU_FOOTPRINT_H = 29;
export const SBU_FLAGS = 30;
export const SBU_CATEGORIES = 32;
export const SBU_MASS = 48;
export const SBU_UPGRADES_TO = 50;
export const SBU_BRAKE = 52;
export const SBU_BUILDABLE_BY = 56;
export const SBU_DEATH_WEAPON = 58;
export const SBU_FIRST_MOUNT = 60;
export const SBU_MOUNT_COUNT = 62;
export const SBU_VETERANCY = 63;

/** Unit record flag bits. */
export const SimBinUnitFlag = {
  TurnInPlace: 1,
} as const;

/** Projectile kinds (sim.bin value). */
export const ProjectileKind = { Linear: 0, Ballistic: 1, Homing: 2 } as const;
export type ProjectileKind = (typeof ProjectileKind)[keyof typeof ProjectileKind];
/** Weapon mount parts (sim.bin value). */
export const WeaponPartId = { Hull: 0, Turret: 1 } as const;
/** Veterancy profiles (sim.bin value). */
export const VeterancyId = { None: 0, Default: 1 } as const;

/** Default collision mass by size class (index = sizeClass; SPK2, DECISIONS 23). */
export const DEFAULT_MASS_BY_SIZE_CLASS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128];

/** Section record sizes. */
export const SIM_BIN_RECORD_BYTES = {
  UEXT: 32,
  WPNR: 32,
  PRJR: 16,
  MNTR: 16,
  CEXT: 8,
  PRPR: 24,
  FACR: 8,
} as const;

function tag(s: string): number {
  return (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
}

/** Section tags (4CC as little-endian u32). */
export const SimBinSection = {
  UEXT: tag('UEXT'),
  WPNR: tag('WPNR'),
  WPNI: tag('WPNI'),
  PRJR: tag('PRJR'),
  PRJI: tag('PRJI'),
  MNTR: tag('MNTR'),
  PRIO: tag('PRIO'),
  CEXT: tag('CEXT'),
  CEXC: tag('CEXC'),
  CEXS: tag('CEXS'),
  PRPR: tag('PRPR'),
  PRPI: tag('PRPI'),
  FACR: tag('FACR'),
  FACU: tag('FACU'),
  FACI: tag('FACI'),
} as const;

/** One unit entry in sim units (already converted: Fx, Ang16, per tick). */
export interface SimBinUnit {
  readonly id: string;
  readonly speedPerTick: number;
  readonly accelPerTick: number;
  readonly turnRatePerTick: number;
  readonly layer: number;
  readonly sizeClass: number;
  readonly maxHp: number;
  readonly radius: number;
  readonly vision: number;
  readonly maxSlope: number;
  readonly footprintW: number;
  readonly footprintH: number;
  /** 4 × u32 category mask. */
  readonly categories: readonly [number, number, number, number];
  // ---- v2 -----------------------------------------------------------------------------------
  /** Collision mass (integer ≥ 1). */
  readonly mass: number;
  readonly turnInPlace: boolean;
  /** Braking deceleration, Fx per tick². */
  readonly brakePerTick: number;
  /** Unit sim id or −1. */
  readonly upgradesTo: number;
  /** Expression index or −1. */
  readonly buildableBy: number;
  /** Weapon index or −1. */
  readonly deathWeapon: number;
  readonly veterancy: number;
  readonly firstMount: number;
  readonly mountCount: number;
  readonly massCost: number;
  readonly energyCost: number;
  readonly buildTime: number;
  /** Fx fraction (4096 = 1). */
  readonly wreckMass: number;
  /** Fx fraction (4096 = 1). */
  readonly wreckHp: number;
  /** Hit box extent (Fx). */
  readonly hitbox: readonly [number, number, number];
}

export interface SimBinWeapon {
  readonly id: string;
  readonly range: number;
  readonly minRange: number;
  readonly damage: number;
  readonly damageRadius: number;
  readonly reloadTicks: number;
  readonly salvo: number;
  readonly muzzleVelocityPerTick: number;
  readonly projectile: number;
  readonly salvoIntervalTicks: number;
}

export interface SimBinProjectile {
  readonly id: string;
  readonly kind: number;
  readonly turnRatePerTick: number;
  readonly speedPerTick: number;
  readonly gravityPerTick2: number;
  readonly lifetimeTicks: number;
}

export interface SimBinMount {
  readonly unit: number;
  readonly weapon: number;
  readonly halfArc: number;
  readonly yawRatePerTick: number;
  readonly layerMask: number;
  readonly part: number;
  readonly priorityFirst: number;
  readonly priorityCount: number;
}

export interface SimBinExpr {
  readonly source: string;
  readonly code: ArrayLike<number>;
  readonly maxDepth: number;
}

export interface SimBinProp {
  readonly id: string;
  readonly maxHp: number;
  readonly reclaimMass: number;
  readonly reclaimEnergy: number;
  readonly reclaimTicks: number;
  readonly footprintW: number;
  readonly footprintH: number;
  readonly blocksShots: boolean;
}

export interface SimBinFaction {
  readonly id: string;
  readonly startUnit: number;
  readonly units: readonly number[];
}

/** Everything sim.bin v2 carries. Every list is in its index order (ids strictly sorted). */
export interface SimBinData {
  readonly units: readonly SimBinUnit[];
  readonly categoryNames: readonly string[];
  readonly weapons?: readonly SimBinWeapon[];
  readonly projectiles?: readonly SimBinProjectile[];
  readonly mounts?: readonly SimBinMount[];
  /** Target priority list (expression indices), referenced by mounts. */
  readonly priorities?: readonly number[];
  readonly exprs?: readonly SimBinExpr[];
  readonly props?: readonly SimBinProp[];
  readonly factions?: readonly SimBinFaction[];
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function checkInt(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`sim.bin: ${what} out of range: ${v}`);
}

function checkAscii(what: string, s: string, maxLen: number): void {
  if (s.length === 0 || s.length > maxLen) throw new RangeError(`sim.bin: ${what} '${s}' must have 1..${maxLen} characters`);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new RangeError(`sim.bin: ${what} '${s}' must be printable ASCII`);
  }
}

function checkSortedIds(what: string, list: readonly { readonly id: string }[]): void {
  for (let i = 0; i < list.length; i++) {
    checkAscii(`${what} id`, list[i]!.id, 255);
    if (i > 0 && !(list[i - 1]!.id < list[i]!.id)) {
      throw new RangeError(`sim.bin: ${what} ids must be strictly sorted ('${list[i - 1]!.id}' ≥ '${list[i]!.id}')`);
    }
  }
}

function stringTableBytes(list: readonly string[]): number {
  let n = 0;
  for (const s of list) n += 1 + s.length;
  return align4(n);
}

function longStringTableBytes(list: readonly string[]): number {
  let n = 0;
  for (const s of list) n += 2 + s.length;
  return align4(n);
}

function writeStrings(u8: Uint8Array, off: number, list: readonly string[]): number {
  let p = off;
  for (const s of list) {
    u8[p++] = s.length;
    for (let i = 0; i < s.length; i++) u8[p++] = s.charCodeAt(i);
  }
  return align4(p);
}

function writeLongStrings(u8: Uint8Array, off: number, list: readonly string[]): number {
  let p = off;
  for (const s of list) {
    u8[p++] = s.length & 0xff;
    u8[p++] = s.length >>> 8;
    for (let i = 0; i < s.length; i++) u8[p++] = s.charCodeAt(i);
  }
  return align4(p);
}

const I32 = 0x7fffffff;

/** u16 index field: −1 → 0xFFFF. */
function ref16(what: string, v: number, count: number): number {
  if (v === -1) return SIM_BIN_NONE;
  checkInt(what, v, 0, count - 1);
  return v;
}

interface PlannedSection {
  readonly tag: number;
  readonly byteLength: number;
  readonly count: number;
  readonly stride: number;
  readonly write: (u8: Uint8Array, dv: DataView, off: number) => void;
}

/**
 * Encodes a sim.bin (version 2). `units` must be sorted by id (code units) — the index is the
 * sim id; `categoryNames` are in bit order. All other tables are optional and follow the same
 * rule (index = position; ids strictly sorted).
 */
export function encodeSimBin(data: SimBinData): Uint8Array {
  const units = data.units;
  const categoryNames = data.categoryNames;
  const weapons = data.weapons ?? [];
  const projectiles = data.projectiles ?? [];
  const mounts = data.mounts ?? [];
  const priorities = data.priorities ?? [];
  const exprs = data.exprs ?? [];
  const props = data.props ?? [];
  const factions = data.factions ?? [];
  if (units.length > SIM_BIN_MAX_UNITS) throw new RangeError(`sim.bin: too many units (${units.length})`);
  for (const [what, n] of [
    ['weapons', weapons.length],
    ['projectiles', projectiles.length],
    ['mounts', mounts.length],
    ['priorities', priorities.length],
    ['expressions', exprs.length],
    ['props', props.length],
    ['factions', factions.length],
  ] as const) {
    if (n > SIM_BIN_MAX_UNITS) throw new RangeError(`sim.bin: too many ${what} (${n})`);
  }
  if (categoryNames.length > SIM_BIN_CATEGORY_WORDS * 32) throw new RangeError('sim.bin: too many categories');
  checkSortedIds('unit', units);
  checkSortedIds('weapon', weapons);
  checkSortedIds('projectile', projectiles);
  checkSortedIds('prop', props);
  checkSortedIds('faction', factions);
  for (const c of categoryNames) checkAscii('category', c, 255);

  // ---- validate references and values ----------------------------------------------------------
  for (const u of units) {
    checkInt(`${u.id}.speedPerTick`, u.speedPerTick, 0, I32);
    checkInt(`${u.id}.accelPerTick`, u.accelPerTick, 0, I32);
    checkInt(`${u.id}.turnRatePerTick`, u.turnRatePerTick, 0, 32768);
    checkInt(`${u.id}.layer`, u.layer, 0, 255);
    checkInt(`${u.id}.sizeClass`, u.sizeClass, 0, 255);
    checkInt(`${u.id}.maxHp`, u.maxHp, 1, I32);
    checkInt(`${u.id}.radius`, u.radius, 1, I32);
    checkInt(`${u.id}.vision`, u.vision, 0, I32);
    checkInt(`${u.id}.maxSlope`, u.maxSlope, 0, I32);
    checkInt(`${u.id}.footprintW`, u.footprintW, 1, 255);
    checkInt(`${u.id}.footprintH`, u.footprintH, 1, 255);
    checkInt(`${u.id}.mass`, u.mass, 1, 0xffff);
    checkInt(`${u.id}.brakePerTick`, u.brakePerTick, 0, I32);
    checkInt(`${u.id}.veterancy`, u.veterancy, 0, 255);
    checkInt(`${u.id}.mountCount`, u.mountCount, 0, 255);
    checkInt(`${u.id}.firstMount`, u.firstMount, 0, 0xffff);
    if (u.mountCount > 0 && u.firstMount + u.mountCount > mounts.length) throw new RangeError(`sim.bin: ${u.id} mounts out of range`);
    for (let m = u.firstMount; m < u.firstMount + u.mountCount; m++) {
      if (mounts[m]!.unit !== units.indexOf(u)) throw new RangeError(`sim.bin: mount ${m} does not belong to ${u.id}`);
    }
    ref16(`${u.id}.upgradesTo`, u.upgradesTo, units.length);
    ref16(`${u.id}.buildableBy`, u.buildableBy, exprs.length);
    ref16(`${u.id}.deathWeapon`, u.deathWeapon, weapons.length);
    checkInt(`${u.id}.massCost`, u.massCost, 0, I32);
    checkInt(`${u.id}.energyCost`, u.energyCost, 0, I32);
    checkInt(`${u.id}.buildTime`, u.buildTime, 0, I32);
    checkInt(`${u.id}.wreckMass`, u.wreckMass, 0, 4096);
    checkInt(`${u.id}.wreckHp`, u.wreckHp, 0, 4096);
    for (let k = 0; k < 3; k++) checkInt(`${u.id}.hitbox`, u.hitbox[k]!, 1, I32);
  }
  for (const w of weapons) {
    checkInt(`${w.id}.range`, w.range, 1, I32);
    checkInt(`${w.id}.minRange`, w.minRange, 0, w.range);
    checkInt(`${w.id}.damage`, w.damage, 0, I32);
    checkInt(`${w.id}.damageRadius`, w.damageRadius, 0, I32);
    checkInt(`${w.id}.reloadTicks`, w.reloadTicks, 1, 0xffff);
    checkInt(`${w.id}.salvo`, w.salvo, 1, 0xffff);
    checkInt(`${w.id}.muzzleVelocityPerTick`, w.muzzleVelocityPerTick, 1, I32);
    checkInt(`${w.id}.projectile`, w.projectile, 0, projectiles.length - 1);
    checkInt(`${w.id}.salvoIntervalTicks`, w.salvoIntervalTicks, 0, 0xffff);
  }
  for (const p of projectiles) {
    checkInt(`${p.id}.kind`, p.kind, 0, 2);
    checkInt(`${p.id}.turnRatePerTick`, p.turnRatePerTick, 0, 32768);
    checkInt(`${p.id}.speedPerTick`, p.speedPerTick, 1, I32);
    checkInt(`${p.id}.gravityPerTick2`, p.gravityPerTick2, 0, I32);
    checkInt(`${p.id}.lifetimeTicks`, p.lifetimeTicks, 1, I32);
  }
  mounts.forEach((m, i) => {
    checkInt(`mount ${i}.unit`, m.unit, 0, units.length - 1);
    checkInt(`mount ${i}.weapon`, m.weapon, 0, weapons.length - 1);
    checkInt(`mount ${i}.halfArc`, m.halfArc, 1, 32768);
    checkInt(`mount ${i}.yawRatePerTick`, m.yawRatePerTick, 1, 32768);
    checkInt(`mount ${i}.layerMask`, m.layerMask, 1, 255);
    checkInt(`mount ${i}.part`, m.part, 0, 1);
    checkInt(`mount ${i}.priorityCount`, m.priorityCount, 0, 0xffff);
    checkInt(`mount ${i}.priorityFirst`, m.priorityFirst, 0, 0xffff);
    if (m.priorityFirst + m.priorityCount > priorities.length) throw new RangeError(`sim.bin: mount ${i} priorities out of range`);
  });
  for (const p of priorities) checkInt('priority', p, 0, exprs.length - 1);
  const exprWords: number[] = [];
  const exprOffsets: number[] = [];
  exprs.forEach((e, i) => {
    checkAscii(`expression ${i}`, e.source, 0xffff);
    if (i > 0 && !(exprs[i - 1]!.source < e.source)) throw new RangeError('sim.bin: expression sources must be strictly sorted');
    const code = Int32Array.from(e.code);
    if (validateCategoryCode(code, 0, code.length, categoryNames.length) !== e.maxDepth) {
      throw new RangeError(`sim.bin: invalid bytecode for expression '${e.source}'`);
    }
    exprOffsets.push(exprWords.length);
    for (let k = 0; k < code.length; k++) exprWords.push(code[k]!);
  });
  for (const p of props) {
    checkInt(`${p.id}.maxHp`, p.maxHp, 0, I32);
    checkInt(`${p.id}.reclaimMass`, p.reclaimMass, 0, I32);
    checkInt(`${p.id}.reclaimEnergy`, p.reclaimEnergy, 0, I32);
    checkInt(`${p.id}.reclaimTicks`, p.reclaimTicks, 0, I32);
    checkInt(`${p.id}.footprintW`, p.footprintW, 0, 255);
    checkInt(`${p.id}.footprintH`, p.footprintH, 0, 255);
  }
  const factionUnits: number[] = [];
  for (const f of factions) {
    checkInt(`${f.id}.startUnit`, f.startUnit, 0, units.length - 1);
    if (f.units.length > 0xffff) throw new RangeError(`sim.bin: ${f.id} has too many units`);
    for (const u of f.units) checkInt(`${f.id}.units`, u, 0, units.length - 1);
  }

  // ---- plan sections ---------------------------------------------------------------------------
  const R = SIM_BIN_RECORD_BYTES;
  const sections: PlannedSection[] = [];
  const records = (t: number, list: readonly unknown[], stride: number, write: (dv: DataView, o: number, i: number) => void): void => {
    sections.push({
      tag: t,
      byteLength: list.length * stride,
      count: list.length,
      stride,
      write: (_u8, dv, off) => {
        for (let i = 0; i < list.length; i++) write(dv, off + i * stride, i);
      },
    });
  };
  const strings = (t: number, list: readonly string[]): void => {
    sections.push({ tag: t, byteLength: stringTableBytes(list), count: list.length, stride: 0, write: (u8, _dv, off) => void writeStrings(u8, off, list) });
  };
  const u16List = (t: number, list: readonly number[]): void => {
    sections.push({
      tag: t,
      byteLength: align4(list.length * 2),
      count: list.length,
      stride: 0,
      write: (_u8, dv, off) => {
        for (let i = 0; i < list.length; i++) dv.setUint16(off + i * 2, list[i]!, true);
      },
    });
  };

  records(SimBinSection.UEXT, units, R.UEXT, (dv, o, i) => {
    const u = units[i]!;
    dv.setInt32(o, u.massCost, true);
    dv.setInt32(o + 4, u.energyCost, true);
    dv.setInt32(o + 8, u.buildTime, true);
    dv.setInt32(o + 12, u.wreckMass, true);
    dv.setInt32(o + 16, u.wreckHp, true);
    dv.setInt32(o + 20, u.hitbox[0], true);
    dv.setInt32(o + 24, u.hitbox[1], true);
    dv.setInt32(o + 28, u.hitbox[2], true);
  });
  records(SimBinSection.WPNR, weapons, R.WPNR, (dv, o, i) => {
    const w = weapons[i]!;
    dv.setInt32(o, w.range, true);
    dv.setInt32(o + 4, w.minRange, true);
    dv.setInt32(o + 8, w.damage, true);
    dv.setInt32(o + 12, w.damageRadius, true);
    dv.setUint16(o + 16, w.reloadTicks, true);
    dv.setUint16(o + 18, w.salvo, true);
    dv.setInt32(o + 20, w.muzzleVelocityPerTick, true);
    dv.setUint16(o + 24, w.projectile, true);
    dv.setUint16(o + 26, w.salvoIntervalTicks, true);
    dv.setUint32(o + 28, 0, true);
  });
  strings(
    SimBinSection.WPNI,
    weapons.map((w) => w.id),
  );
  records(SimBinSection.PRJR, projectiles, R.PRJR, (dv, o, i) => {
    const p = projectiles[i]!;
    dv.setUint8(o, p.kind);
    dv.setUint8(o + 1, 0);
    dv.setUint16(o + 2, p.turnRatePerTick, true);
    dv.setInt32(o + 4, p.speedPerTick, true);
    dv.setInt32(o + 8, p.gravityPerTick2, true);
    dv.setInt32(o + 12, p.lifetimeTicks, true);
  });
  strings(
    SimBinSection.PRJI,
    projectiles.map((p) => p.id),
  );
  records(SimBinSection.MNTR, mounts, R.MNTR, (dv, o, i) => {
    const m = mounts[i]!;
    dv.setUint16(o, m.unit, true);
    dv.setUint16(o + 2, m.weapon, true);
    dv.setUint16(o + 4, m.halfArc, true);
    dv.setUint16(o + 6, m.yawRatePerTick, true);
    dv.setUint8(o + 8, m.layerMask);
    dv.setUint8(o + 9, m.part);
    dv.setUint16(o + 10, m.priorityFirst, true);
    dv.setUint16(o + 12, m.priorityCount, true);
    dv.setUint16(o + 14, 0, true);
  });
  u16List(SimBinSection.PRIO, priorities);
  records(SimBinSection.CEXT, exprs, R.CEXT, (dv, o, i) => {
    dv.setUint32(o, exprOffsets[i]!, true);
    dv.setUint16(o + 4, exprs[i]!.code.length, true);
    dv.setUint8(o + 6, exprs[i]!.maxDepth);
    dv.setUint8(o + 7, 0);
  });
  sections.push({
    tag: SimBinSection.CEXC,
    byteLength: exprWords.length * 4,
    count: Math.min(exprWords.length, 0xffff),
    stride: 4,
    write: (_u8, dv, off) => {
      for (let i = 0; i < exprWords.length; i++) dv.setInt32(off + i * 4, exprWords[i]!, true);
    },
  });
  const exprSources = exprs.map((e) => e.source);
  sections.push({
    tag: SimBinSection.CEXS,
    byteLength: longStringTableBytes(exprSources),
    count: exprSources.length,
    stride: 0,
    write: (u8, _dv, off) => void writeLongStrings(u8, off, exprSources),
  });
  records(SimBinSection.PRPR, props, R.PRPR, (dv, o, i) => {
    const p = props[i]!;
    dv.setInt32(o, p.maxHp, true);
    dv.setInt32(o + 4, p.reclaimMass, true);
    dv.setInt32(o + 8, p.reclaimEnergy, true);
    dv.setInt32(o + 12, p.reclaimTicks, true);
    dv.setUint8(o + 16, p.footprintW);
    dv.setUint8(o + 17, p.footprintH);
    dv.setUint16(o + 18, p.blocksShots ? 1 : 0, true);
    dv.setUint32(o + 20, 0, true);
  });
  strings(
    SimBinSection.PRPI,
    props.map((p) => p.id),
  );
  const factionFirst: number[] = [];
  for (const f of factions) {
    factionFirst.push(factionUnits.length);
    factionUnits.push(...f.units);
  }
  records(SimBinSection.FACR, factions, R.FACR, (dv, o, i) => {
    const f = factions[i]!;
    dv.setUint16(o, f.startUnit, true);
    dv.setUint16(o + 2, f.units.length, true);
    dv.setUint32(o + 4, factionFirst[i]!, true);
  });
  if (factionUnits.length > 0xffff) throw new RangeError('sim.bin: faction unit list too long');
  u16List(SimBinSection.FACU, factionUnits);
  strings(
    SimBinSection.FACI,
    factions.map((f) => f.id),
  );

  // ---- layout ------------------------------------------------------------------------------------
  const dirOffset = SIM_BIN_HEADER_BYTES;
  const unitsOffset = dirOffset + sections.length * 16;
  const catOffset = unitsOffset + units.length * SIM_BIN_UNIT_RECORD_BYTES;
  const idsOffset = catOffset + stringTableBytes(categoryNames);
  let p = idsOffset + stringTableBytes(units.map((u) => u.id));
  const sectionOffsets: number[] = [];
  for (const s of sections) {
    sectionOffsets.push(p);
    p = align4(p + s.byteLength);
  }
  const total = p;
  const u8 = new Uint8Array(total);
  const dv = new DataView(u8.buffer);
  dv.setUint32(0, SIM_BIN_MAGIC, true);
  dv.setUint16(4, SIM_BIN_VERSION, true);
  dv.setUint16(6, SIM_BIN_HEADER_BYTES, true);
  dv.setUint16(8, units.length, true);
  dv.setUint16(10, SIM_BIN_UNIT_RECORD_BYTES, true);
  dv.setUint16(12, categoryNames.length, true);
  dv.setUint16(14, SIM_BIN_CATEGORY_WORDS, true);
  dv.setUint32(16, unitsOffset, true);
  dv.setUint32(20, catOffset, true);
  dv.setUint32(24, idsOffset, true);
  dv.setUint32(28, total, true);
  dv.setUint32(32, dirOffset, true);
  dv.setUint16(36, sections.length, true);
  sections.forEach((s, i) => {
    const o = dirOffset + i * 16;
    dv.setUint32(o, s.tag, true);
    dv.setUint32(o + 4, sectionOffsets[i]!, true);
    dv.setUint32(o + 8, s.byteLength, true);
    dv.setUint16(o + 12, s.count, true);
    dv.setUint16(o + 14, s.stride, true);
    s.write(u8, dv, sectionOffsets[i]!);
  });
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const o = unitsOffset + i * SIM_BIN_UNIT_RECORD_BYTES;
    dv.setInt32(o + SBU_SPEED, u.speedPerTick, true);
    dv.setInt32(o + SBU_ACCEL, u.accelPerTick, true);
    dv.setUint16(o + SBU_TURN_RATE, u.turnRatePerTick, true);
    dv.setUint8(o + SBU_LAYER, u.layer);
    dv.setUint8(o + SBU_SIZE_CLASS, u.sizeClass);
    dv.setInt32(o + SBU_MAX_HP, u.maxHp, true);
    dv.setInt32(o + SBU_RADIUS, u.radius, true);
    dv.setInt32(o + SBU_VISION, u.vision, true);
    dv.setInt32(o + SBU_MAX_SLOPE, u.maxSlope, true);
    dv.setUint8(o + SBU_FOOTPRINT_W, u.footprintW);
    dv.setUint8(o + SBU_FOOTPRINT_H, u.footprintH);
    dv.setUint16(o + SBU_FLAGS, u.turnInPlace ? SimBinUnitFlag.TurnInPlace : 0, true);
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) {
      dv.setUint32(o + SBU_CATEGORIES + w * 4, u.categories[w]! >>> 0, true);
    }
    dv.setUint16(o + SBU_MASS, u.mass, true);
    dv.setUint16(o + SBU_UPGRADES_TO, ref16('upgradesTo', u.upgradesTo, units.length), true);
    dv.setInt32(o + SBU_BRAKE, u.brakePerTick, true);
    dv.setUint16(o + SBU_BUILDABLE_BY, ref16('buildableBy', u.buildableBy, exprs.length), true);
    dv.setUint16(o + SBU_DEATH_WEAPON, ref16('deathWeapon', u.deathWeapon, weapons.length), true);
    dv.setUint16(o + SBU_FIRST_MOUNT, u.firstMount, true);
    dv.setUint8(o + SBU_MOUNT_COUNT, u.mountCount);
    dv.setUint8(o + SBU_VETERANCY, u.veterancy);
  }
  writeStrings(u8, catOffset, categoryNames);
  writeStrings(
    u8,
    idsOffset,
    units.map((u) => u.id),
  );
  return u8;
}

/** Table sizes of a decoded sim.bin. */
export interface SimBpCounts {
  readonly units: number;
  readonly weapons: number;
  readonly projectiles: number;
  readonly mounts: number;
  readonly priorities: number;
  readonly exprs: number;
  readonly exprWords: number;
  readonly props: number;
  readonly factions: number;
  readonly factionUnits: number;
}

const NO_COUNTS: SimBpCounts = { units: 0, weapons: 0, projectiles: 0, mounts: 0, priorities: 0, exprs: 0, exprWords: 0, props: 0, factions: 0, factionUnits: 0 };

/** Id lists of a decoded sim.bin. */
export interface SimBpIds {
  readonly units: readonly string[];
  readonly categoryNames: readonly string[];
  readonly weapons?: readonly string[];
  readonly projectiles?: readonly string[];
  readonly exprSources?: readonly string[];
  readonly props?: readonly string[];
  readonly factions?: readonly string[];
}

function binarySearch(ids: readonly string[], id: string): number {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = ids[mid]!;
    if (m === id) return mid;
    if (m < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Decoded blueprint tables: flat typed columns indexed by sim id (units) or table index
 * (weapons, projectiles, mounts, expressions, props, factions). Built once by `decodeSimBin`;
 * all accessors are allocation-free. Index fields use −1 for "none".
 */
export class SimBpTable {
  /** sim.bin version that was decoded (1 or 2). */
  readonly version: number;
  /** Number of unit blueprints. */
  readonly count: number;
  /** xxHash32 (seed 0) of the sim.bin bytes = bpSimHash (PLAN §3.1 simId). */
  readonly simHash: number;
  /** String ids in sim-id order (sorted). */
  readonly ids: readonly string[];
  /** Category names in bit order. */
  readonly categoryNames: readonly string[];
  readonly speed: Int32Array;
  readonly accel: Int32Array;
  readonly turnRate: Int32Array;
  readonly maxHpCol: Int32Array;
  readonly radiusCol: Int32Array;
  readonly visionCol: Int32Array;
  readonly maxSlopeCol: Int32Array;
  readonly layerCol: Uint8Array;
  readonly sizeClassCol: Uint8Array;
  readonly footprintWCol: Uint8Array;
  readonly footprintHCol: Uint8Array;
  /** Category masks, 4 words per blueprint. */
  readonly categoryMasks: Uint32Array;
  // ---- v2 unit columns ------------------------------------------------------------------------
  /** Collision mass (≥ 1). */
  readonly massCol: Uint16Array;
  /** 1 = tracks turn in place. */
  readonly turnInPlaceCol: Uint8Array;
  /** Braking deceleration (Fx per tick²). */
  readonly brakeCol: Int32Array;
  /** Unit sim id or −1. */
  readonly upgradesToCol: Int32Array;
  /** Expression index or −1. */
  readonly buildableByCol: Int32Array;
  /** Weapon index or −1. */
  readonly deathWeaponCol: Int32Array;
  readonly veterancyCol: Uint8Array;
  readonly firstMountCol: Uint16Array;
  readonly mountCountCol: Uint8Array;
  readonly massCostCol: Int32Array;
  readonly energyCostCol: Int32Array;
  readonly buildTimeCol: Int32Array;
  /** Fx fraction (4096 = 1). */
  readonly wreckMassCol: Int32Array;
  /** Fx fraction (4096 = 1). */
  readonly wreckHpCol: Int32Array;
  /** Hit box extents (Fx), 3 per unit (x, y, z). */
  readonly hitboxCol: Int32Array;
  // ---- weapons ----------------------------------------------------------------------------------
  readonly weaponCount: number;
  readonly weaponIds: readonly string[];
  readonly weaponRangeCol: Int32Array;
  readonly weaponMinRangeCol: Int32Array;
  readonly weaponDamageCol: Int32Array;
  readonly weaponDamageRadiusCol: Int32Array;
  readonly weaponReloadTicksCol: Uint16Array;
  readonly weaponSalvoCol: Uint16Array;
  readonly weaponMuzzleVelocityCol: Int32Array;
  readonly weaponProjectileCol: Uint16Array;
  readonly weaponSalvoIntervalCol: Uint16Array;
  // ---- projectiles ------------------------------------------------------------------------------
  readonly projectileCount: number;
  readonly projectileIds: readonly string[];
  readonly projectileKindCol: Uint8Array;
  readonly projectileTurnRateCol: Uint16Array;
  readonly projectileSpeedCol: Int32Array;
  readonly projectileGravityCol: Int32Array;
  readonly projectileLifetimeCol: Int32Array;
  // ---- mounts / priorities ----------------------------------------------------------------------
  readonly mountTotal: number;
  readonly mountUnitCol: Uint16Array;
  readonly mountWeaponCol: Uint16Array;
  readonly mountHalfArcCol: Uint16Array;
  readonly mountYawRateCol: Uint16Array;
  readonly mountLayerMaskCol: Uint8Array;
  readonly mountPartCol: Uint8Array;
  readonly mountPriorityFirstCol: Uint16Array;
  readonly mountPriorityCountCol: Uint16Array;
  /** Target priority list: expression indices. */
  readonly priorityList: Uint16Array;
  // ---- category expressions ---------------------------------------------------------------------
  readonly exprCount: number;
  readonly exprSources: readonly string[];
  /** Bytecode pool (@faf/rules ExprOp). */
  readonly exprCode: Int32Array;
  readonly exprStartCol: Uint32Array;
  readonly exprLengthCol: Uint16Array;
  readonly exprMaxDepthCol: Uint8Array;
  // ---- props -----------------------------------------------------------------------------------
  readonly propCount: number;
  readonly propIds: readonly string[];
  readonly propMaxHpCol: Int32Array;
  readonly propReclaimMassCol: Int32Array;
  readonly propReclaimEnergyCol: Int32Array;
  readonly propReclaimTicksCol: Int32Array;
  readonly propFootprintWCol: Uint8Array;
  readonly propFootprintHCol: Uint8Array;
  readonly propBlocksShotsCol: Uint8Array;
  // ---- factions --------------------------------------------------------------------------------
  readonly factionCount: number;
  readonly factionIds: readonly string[];
  readonly factionStartUnitCol: Uint16Array;
  readonly factionUnitFirstCol: Uint32Array;
  readonly factionUnitCountCol: Uint16Array;
  /** Faction unit lists (unit sim ids). */
  readonly factionUnitList: Uint16Array;

  /** @internal Use decodeSimBin. */
  constructor(version: number, simHash: number, ids: SimBpIds, counts: SimBpCounts = { ...NO_COUNTS, units: ids.units.length }) {
    const count = ids.units.length;
    this.version = version;
    this.count = count;
    this.simHash = simHash;
    this.ids = ids.units;
    this.categoryNames = ids.categoryNames;
    this.speed = new Int32Array(count);
    this.accel = new Int32Array(count);
    this.turnRate = new Int32Array(count);
    this.maxHpCol = new Int32Array(count);
    this.radiusCol = new Int32Array(count);
    this.visionCol = new Int32Array(count);
    this.maxSlopeCol = new Int32Array(count);
    this.layerCol = new Uint8Array(count);
    this.sizeClassCol = new Uint8Array(count);
    this.footprintWCol = new Uint8Array(count);
    this.footprintHCol = new Uint8Array(count);
    this.categoryMasks = new Uint32Array(count * SIM_BIN_CATEGORY_WORDS);
    this.massCol = new Uint16Array(count);
    this.turnInPlaceCol = new Uint8Array(count);
    this.brakeCol = new Int32Array(count);
    this.upgradesToCol = new Int32Array(count).fill(-1);
    this.buildableByCol = new Int32Array(count).fill(-1);
    this.deathWeaponCol = new Int32Array(count).fill(-1);
    this.veterancyCol = new Uint8Array(count);
    this.firstMountCol = new Uint16Array(count);
    this.mountCountCol = new Uint8Array(count);
    this.massCostCol = new Int32Array(count);
    this.energyCostCol = new Int32Array(count);
    this.buildTimeCol = new Int32Array(count);
    this.wreckMassCol = new Int32Array(count);
    this.wreckHpCol = new Int32Array(count);
    this.hitboxCol = new Int32Array(count * 3);
    const nw = counts.weapons;
    this.weaponCount = nw;
    this.weaponIds = ids.weapons ?? [];
    this.weaponRangeCol = new Int32Array(nw);
    this.weaponMinRangeCol = new Int32Array(nw);
    this.weaponDamageCol = new Int32Array(nw);
    this.weaponDamageRadiusCol = new Int32Array(nw);
    this.weaponReloadTicksCol = new Uint16Array(nw);
    this.weaponSalvoCol = new Uint16Array(nw);
    this.weaponMuzzleVelocityCol = new Int32Array(nw);
    this.weaponProjectileCol = new Uint16Array(nw);
    this.weaponSalvoIntervalCol = new Uint16Array(nw);
    const np = counts.projectiles;
    this.projectileCount = np;
    this.projectileIds = ids.projectiles ?? [];
    this.projectileKindCol = new Uint8Array(np);
    this.projectileTurnRateCol = new Uint16Array(np);
    this.projectileSpeedCol = new Int32Array(np);
    this.projectileGravityCol = new Int32Array(np);
    this.projectileLifetimeCol = new Int32Array(np);
    const nm = counts.mounts;
    this.mountTotal = nm;
    this.mountUnitCol = new Uint16Array(nm);
    this.mountWeaponCol = new Uint16Array(nm);
    this.mountHalfArcCol = new Uint16Array(nm);
    this.mountYawRateCol = new Uint16Array(nm);
    this.mountLayerMaskCol = new Uint8Array(nm);
    this.mountPartCol = new Uint8Array(nm);
    this.mountPriorityFirstCol = new Uint16Array(nm);
    this.mountPriorityCountCol = new Uint16Array(nm);
    this.priorityList = new Uint16Array(counts.priorities);
    const ne = counts.exprs;
    this.exprCount = ne;
    this.exprSources = ids.exprSources ?? [];
    this.exprCode = new Int32Array(counts.exprWords);
    this.exprStartCol = new Uint32Array(ne);
    this.exprLengthCol = new Uint16Array(ne);
    this.exprMaxDepthCol = new Uint8Array(ne);
    const nr = counts.props;
    this.propCount = nr;
    this.propIds = ids.props ?? [];
    this.propMaxHpCol = new Int32Array(nr);
    this.propReclaimMassCol = new Int32Array(nr);
    this.propReclaimEnergyCol = new Int32Array(nr);
    this.propReclaimTicksCol = new Int32Array(nr);
    this.propFootprintWCol = new Uint8Array(nr);
    this.propFootprintHCol = new Uint8Array(nr);
    this.propBlocksShotsCol = new Uint8Array(nr);
    const nf = counts.factions;
    this.factionCount = nf;
    this.factionIds = ids.factions ?? [];
    this.factionStartUnitCol = new Uint16Array(nf);
    this.factionUnitFirstCol = new Uint32Array(nf);
    this.factionUnitCountCol = new Uint16Array(nf);
    this.factionUnitList = new Uint16Array(counts.factionUnits);
  }

  /** True if `bp` is a valid sim id. */
  has(bp: number): boolean {
    return bp >= 0 && bp < this.count && (bp | 0) === bp;
  }
  speedPerTick(bp: number): Fx {
    return asFx(this.speed[bp]!);
  }
  accelPerTick(bp: number): Fx {
    return asFx(this.accel[bp]!);
  }
  turnRatePerTick(bp: number): Ang16 {
    return asAng16(this.turnRate[bp]!);
  }
  maxHp(bp: number): number {
    return this.maxHpCol[bp]!;
  }
  radius(bp: number): Fx {
    return asFx(this.radiusCol[bp]!);
  }
  vision(bp: number): Fx {
    return asFx(this.visionCol[bp]!);
  }
  maxSlope(bp: number): Fx {
    return asFx(this.maxSlopeCol[bp]!);
  }
  layer(bp: number): number {
    return this.layerCol[bp]!;
  }
  sizeClass(bp: number): number {
    return this.sizeClassCol[bp]!;
  }
  footprintW(bp: number): number {
    return this.footprintWCol[bp]!;
  }
  footprintH(bp: number): number {
    return this.footprintHCol[bp]!;
  }
  /** Collision mass/priority (integer ≥ 1). */
  mass(bp: number): number {
    return this.massCol[bp]!;
  }
  /** True if the unit turns in place (tracks) instead of driving arcs. */
  turnInPlace(bp: number): boolean {
    return this.turnInPlaceCol[bp] === 1;
  }
  /** Braking deceleration in Fx per tick². */
  brakePerTick(bp: number): Fx {
    return asFx(this.brakeCol[bp]!);
  }
  /** Unit sim id this unit upgrades into, or −1. */
  upgradesTo(bp: number): number {
    return this.upgradesToCol[bp]!;
  }
  /** Expression index of `economy.buildableBy`, or −1. */
  buildableByExpr(bp: number): number {
    return this.buildableByCol[bp]!;
  }
  /** Weapon index of the death weapon, or −1. */
  deathWeapon(bp: number): number {
    return this.deathWeaponCol[bp]!;
  }
  veterancy(bp: number): number {
    return this.veterancyCol[bp]!;
  }
  /** First mount index of `bp` (mounts of a unit are consecutive). */
  firstMount(bp: number): number {
    return this.firstMountCol[bp]!;
  }
  mountCount(bp: number): number {
    return this.mountCountCol[bp]!;
  }
  massCost(bp: number): number {
    return this.massCostCol[bp]!;
  }
  energyCost(bp: number): number {
    return this.energyCostCol[bp]!;
  }
  buildTime(bp: number): number {
    return this.buildTimeCol[bp]!;
  }
  wreckMassFraction(bp: number): Fx {
    return asFx(this.wreckMassCol[bp]!);
  }
  wreckHpFraction(bp: number): Fx {
    return asFx(this.wreckHpCol[bp]!);
  }
  /** Hit box extent along axis 0 (x), 1 (y) or 2 (z), Fx. */
  hitbox(bp: number, axis: number): Fx {
    return asFx(this.hitboxCol[bp * 3 + axis]!);
  }
  /** Word `w` (0..3) of the category mask of `bp`. */
  categoryWord(bp: number, w: number): number {
    return this.categoryMasks[bp * SIM_BIN_CATEGORY_WORDS + w]!;
  }
  /** Copies the category mask of `bp` into `out` at `off` and returns `out`. */
  categories(bp: number, out: Uint32Array, off = 0): Uint32Array {
    const b = bp * SIM_BIN_CATEGORY_WORDS;
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) out[off + w] = this.categoryMasks[b + w]!;
    return out;
  }
  /** Offset of the mask of `bp` in `categoryMasks` (for `matchesMask(table.categoryMasks, expr, off)`). */
  categoryOffset(bp: number): number {
    return bp * SIM_BIN_CATEGORY_WORDS;
  }
  /** True if the mask at `off` matches expression `expr` (allocation-free). */
  matchesExpr(expr: number, mask: Uint32Array, off = 0): boolean {
    return matchesMaskCode(mask, off, this.exprCode, this.exprStartCol[expr]!, this.exprLengthCol[expr]!);
  }
  /** True if unit blueprint `bp` matches expression `expr`. */
  unitMatchesExpr(bp: number, expr: number): boolean {
    return matchesMaskCode(this.categoryMasks, bp * SIM_BIN_CATEGORY_WORDS, this.exprCode, this.exprStartCol[expr]!, this.exprLengthCol[expr]!);
  }
  /** True if `builder` may build `bp` (its `buildableBy` matches the builder's categories). */
  canBuild(builder: number, bp: number): boolean {
    const e = this.buildableByCol[bp]!;
    return e >= 0 && this.unitMatchesExpr(builder, e);
  }
  /** Expression index of a source string (binary search), or −1. */
  exprIndexOf(source: string): number {
    return binarySearch(this.exprSources, source);
  }
  /** String id of `bp`. */
  idOf(bp: number): string {
    const id = this.ids[bp];
    if (id === undefined) throw new RangeError(`unknown blueprint sim id ${bp}`);
    return id;
  }
  /** Sim id of a string id (binary search), or −1. */
  indexOf(id: string): number {
    return binarySearch(this.ids, id);
  }
  // ---- weapons -------------------------------------------------------------------------------------
  weaponIndexOf(id: string): number {
    return binarySearch(this.weaponIds, id);
  }
  weaponRange(w: number): Fx {
    return asFx(this.weaponRangeCol[w]!);
  }
  weaponMinRange(w: number): Fx {
    return asFx(this.weaponMinRangeCol[w]!);
  }
  weaponDamage(w: number): number {
    return this.weaponDamageCol[w]!;
  }
  weaponDamageRadius(w: number): Fx {
    return asFx(this.weaponDamageRadiusCol[w]!);
  }
  weaponReloadTicks(w: number): number {
    return this.weaponReloadTicksCol[w]!;
  }
  weaponSalvo(w: number): number {
    return this.weaponSalvoCol[w]!;
  }
  weaponSalvoIntervalTicks(w: number): number {
    return this.weaponSalvoIntervalCol[w]!;
  }
  weaponMuzzleVelocityPerTick(w: number): Fx {
    return asFx(this.weaponMuzzleVelocityCol[w]!);
  }
  weaponProjectile(w: number): number {
    return this.weaponProjectileCol[w]!;
  }
  // ---- projectiles ---------------------------------------------------------------------------------
  projectileIndexOf(id: string): number {
    return binarySearch(this.projectileIds, id);
  }
  projectileKind(p: number): number {
    return this.projectileKindCol[p]!;
  }
  projectileSpeedPerTick(p: number): Fx {
    return asFx(this.projectileSpeedCol[p]!);
  }
  projectileGravityPerTick2(p: number): Fx {
    return asFx(this.projectileGravityCol[p]!);
  }
  projectileLifetimeTicks(p: number): number {
    return this.projectileLifetimeCol[p]!;
  }
  projectileTurnRatePerTick(p: number): Ang16 {
    return asAng16(this.projectileTurnRateCol[p]!);
  }
  // ---- mounts --------------------------------------------------------------------------------------
  mountUnit(m: number): number {
    return this.mountUnitCol[m]!;
  }
  mountWeapon(m: number): number {
    return this.mountWeaponCol[m]!;
  }
  /** Half firing arc (Ang16; 32768 = all around). */
  mountHalfArc(m: number): Ang16 {
    return asAng16(this.mountHalfArcCol[m]!);
  }
  mountYawRatePerTick(m: number): Ang16 {
    return asAng16(this.mountYawRateCol[m]!);
  }
  /** Bit mask of target layers (bit = MotionLayer). */
  mountLayerMask(m: number): number {
    return this.mountLayerMaskCol[m]!;
  }
  mountPart(m: number): number {
    return this.mountPartCol[m]!;
  }
  mountPriorityFirst(m: number): number {
    return this.mountPriorityFirstCol[m]!;
  }
  mountPriorityCount(m: number): number {
    return this.mountPriorityCountCol[m]!;
  }
  /** Expression index of entry `i` of the priority list. */
  priority(i: number): number {
    return this.priorityList[i]!;
  }
  // ---- props / factions ----------------------------------------------------------------------------
  propIndexOf(id: string): number {
    return binarySearch(this.propIds, id);
  }
  factionIndexOf(id: string): number {
    return binarySearch(this.factionIds, id);
  }
  factionStartUnit(f: number): number {
    return this.factionStartUnitCol[f]!;
  }
}

function readStrings(u8: Uint8Array, off: number, count: number, end: number, what: string): { list: string[]; end: number } {
  const list: string[] = [];
  let p = off;
  for (let i = 0; i < count; i++) {
    if (p >= end) throw new RangeError(`sim.bin: ${what} table truncated`);
    const len = u8[p++]!;
    if (len === 0 || p + len > end) throw new RangeError(`sim.bin: ${what} table corrupt`);
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(u8[p + k]!);
    list.push(s);
    p += len;
  }
  return { list, end: align4(p) };
}

function readLongStrings(u8: Uint8Array, off: number, count: number, end: number, what: string): string[] {
  const list: string[] = [];
  let p = off;
  for (let i = 0; i < count; i++) {
    if (p + 2 > end) throw new RangeError(`sim.bin: ${what} table truncated`);
    const len = u8[p]! | (u8[p + 1]! << 8);
    p += 2;
    if (len === 0 || p + len > end) throw new RangeError(`sim.bin: ${what} table corrupt`);
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(u8[p + k]!);
    list.push(s);
    p += len;
  }
  return list;
}

function checkSorted(list: readonly string[], what: string): void {
  for (let i = 1; i < list.length; i++) {
    if (!(list[i - 1]! < list[i]!)) throw new RangeError(`sim.bin: ${what} not sorted`);
  }
}

interface SectionEntry {
  readonly offset: number;
  readonly byteLength: number;
  readonly count: number;
  readonly stride: number;
}

const NO_SECTION: SectionEntry = { offset: 0, byteLength: 0, count: 0, stride: 0 };

/**
 * Decodes and validates a sim.bin of version 1 or 2 (throws RangeError on malformed input or an
 * unsupported version). Version-1 files get the v2 defaults (see module docs).
 */
export function decodeSimBin(bytes: Uint8Array): SimBpTable {
  if (bytes.length < SIM_BIN_V1_HEADER_BYTES) throw new RangeError('sim.bin: truncated header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== SIM_BIN_MAGIC) throw new RangeError("sim.bin: bad magic (expected 'IFBP')");
  const version = dv.getUint16(4, true);
  if (version < SIM_BIN_MIN_VERSION || version > SIM_BIN_VERSION) {
    throw new RangeError(`sim.bin: unsupported version ${version} (this build reads ${SIM_BIN_MIN_VERSION}..${SIM_BIN_VERSION})`);
  }
  const headerBytes = dv.getUint16(6, true);
  const count = dv.getUint16(8, true);
  const recBytes = dv.getUint16(10, true);
  const catCount = dv.getUint16(12, true);
  const catWords = dv.getUint16(14, true);
  const unitsOff = dv.getUint32(16, true);
  const catOff = dv.getUint32(20, true);
  const idsOff = dv.getUint32(24, true);
  const total = dv.getUint32(28, true);
  const minHeader = version === 1 ? SIM_BIN_V1_HEADER_BYTES : SIM_BIN_HEADER_BYTES;
  if (headerBytes < minHeader || bytes.length < headerBytes || recBytes < SIM_BIN_UNIT_RECORD_BYTES || catWords !== SIM_BIN_CATEGORY_WORDS) {
    throw new RangeError('sim.bin: unsupported header geometry');
  }
  if (total !== bytes.length) throw new RangeError(`sim.bin: length ${bytes.length} ≠ header total ${total}`);
  if (catCount > SIM_BIN_CATEGORY_WORDS * 32) throw new RangeError('sim.bin: too many categories');
  if (unitsOff < headerBytes || unitsOff + count * recBytes > catOff || catOff > idsOff || idsOff > total) {
    throw new RangeError('sim.bin: section offsets out of order');
  }
  const cats = readStrings(bytes, catOff, catCount, idsOff, 'category');
  const ids = readStrings(bytes, idsOff, count, total, 'unit id');
  checkSorted(ids.list, 'unit ids');

  // ---- v2 section directory ----------------------------------------------------------------------
  const sec = new Array<SectionEntry>(15).fill(NO_SECTION);
  const known = [
    SimBinSection.UEXT,
    SimBinSection.WPNR,
    SimBinSection.WPNI,
    SimBinSection.PRJR,
    SimBinSection.PRJI,
    SimBinSection.MNTR,
    SimBinSection.PRIO,
    SimBinSection.CEXT,
    SimBinSection.CEXC,
    SimBinSection.CEXS,
    SimBinSection.PRPR,
    SimBinSection.PRPI,
    SimBinSection.FACR,
    SimBinSection.FACU,
    SimBinSection.FACI,
  ];
  let dataEnd = ids.end;
  if (version === 1) {
    if (ids.end !== total) throw new RangeError('sim.bin: trailing bytes');
  } else {
    const dirOff = dv.getUint32(32, true);
    const n = dv.getUint16(36, true);
    if (dirOff < headerBytes || dirOff + n * 16 > unitsOff) throw new RangeError('sim.bin: section directory out of range');
    for (let i = 0; i < n; i++) {
      const o = dirOff + i * 16;
      const e: SectionEntry = {
        offset: dv.getUint32(o + 4, true),
        byteLength: dv.getUint32(o + 8, true),
        count: dv.getUint16(o + 12, true),
        stride: dv.getUint16(o + 14, true),
      };
      if ((e.offset & 3) !== 0 || e.offset < ids.end || e.offset + e.byteLength > total) {
        throw new RangeError(`sim.bin: section ${i} out of range`);
      }
      if (e.offset + e.byteLength > dataEnd) dataEnd = e.offset + e.byteLength;
      const k = known.indexOf(dv.getUint32(o, true));
      if (k < 0) continue; // unknown section: skipped
      if (sec[k] !== NO_SECTION) throw new RangeError(`sim.bin: duplicate section ${i}`);
      sec[k] = e;
    }
    if (align4(dataEnd) !== total) throw new RangeError('sim.bin: trailing bytes');
  }
  const [UEXT, WPNR, WPNI, PRJR, PRJI, MNTR, PRIO, CEXT, CEXC, CEXS, PRPR, PRPI, FACR, FACU, FACI] = sec as [
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
    SectionEntry,
  ];
  const R = SIM_BIN_RECORD_BYTES;
  const recs = (e: SectionEntry, min: number, what: string): void => {
    if (e.count > 0 && (e.stride < min || e.count * e.stride > e.byteLength)) throw new RangeError(`sim.bin: ${what} section corrupt`);
  };
  recs(UEXT, R.UEXT, 'UEXT');
  recs(WPNR, R.WPNR, 'WPNR');
  recs(PRJR, R.PRJR, 'PRJR');
  recs(MNTR, R.MNTR, 'MNTR');
  recs(CEXT, R.CEXT, 'CEXT');
  recs(PRPR, R.PRPR, 'PRPR');
  recs(FACR, R.FACR, 'FACR');
  if (version === 2 && count > 0 && UEXT.count !== count) throw new RangeError('sim.bin: UEXT count ≠ unit count');
  const words = CEXC.byteLength >>> 2;
  if ((CEXC.byteLength & 3) !== 0) throw new RangeError('sim.bin: CEXC section corrupt');
  if (PRIO.count * 2 > PRIO.byteLength || FACU.count * 2 > FACU.byteLength) throw new RangeError('sim.bin: list section corrupt');
  const idList = (e: SectionEntry, c: number, what: string): string[] => {
    if (c === 0) return [];
    const l = readStrings(bytes, e.offset, e.count, e.offset + e.byteLength, what).list;
    if (l.length !== c) throw new RangeError(`sim.bin: ${what} count mismatch`);
    checkSorted(l, what);
    return l;
  };
  const weaponIds = idList(WPNI, WPNR.count, 'weapon ids');
  const projectileIds = idList(PRJI, PRJR.count, 'projectile ids');
  const propIds = idList(PRPI, PRPR.count, 'prop ids');
  const factionIds = idList(FACI, FACR.count, 'faction ids');
  const exprSources = CEXT.count === 0 ? [] : readLongStrings(bytes, CEXS.offset, CEXT.count, CEXS.offset + CEXS.byteLength, 'expression source');
  checkSorted(exprSources, 'expression sources');

  const t = new SimBpTable(
    version,
    xxHash32(bytes, 0, bytes.length, 0),
    { units: ids.list, categoryNames: cats.list, weapons: weaponIds, projectiles: projectileIds, exprSources, props: propIds, factions: factionIds },
    {
      units: count,
      weapons: WPNR.count,
      projectiles: PRJR.count,
      mounts: MNTR.count,
      priorities: PRIO.count,
      exprs: CEXT.count,
      exprWords: words,
      props: PRPR.count,
      factions: FACR.count,
      factionUnits: FACU.count,
    },
  );
  const bad = (what: string, i: number): never => {
    throw new RangeError(`sim.bin: invalid values in ${what} record ${i}`);
  };

  // ---- expressions (before units: buildableBy is validated against them) -------------------------
  for (let i = 0; i < words; i++) t.exprCode[i] = dv.getInt32(CEXC.offset + i * 4, true);
  for (let i = 0; i < t.exprCount; i++) {
    const o = CEXT.offset + i * CEXT.stride;
    const start = dv.getUint32(o, true);
    const len = dv.getUint16(o + 4, true);
    const depth = dv.getUint8(o + 6);
    t.exprStartCol[i] = start;
    t.exprLengthCol[i] = len;
    t.exprMaxDepthCol[i] = depth;
    if (validateCategoryCode(t.exprCode, start, len, catCount) !== depth) bad('expression', i);
  }

  // ---- units -----------------------------------------------------------------------------------------
  for (let i = 0; i < count; i++) {
    const o = unitsOff + i * recBytes;
    t.speed[i] = dv.getInt32(o + SBU_SPEED, true);
    t.accel[i] = dv.getInt32(o + SBU_ACCEL, true);
    t.turnRate[i] = dv.getUint16(o + SBU_TURN_RATE, true);
    t.layerCol[i] = dv.getUint8(o + SBU_LAYER);
    t.sizeClassCol[i] = dv.getUint8(o + SBU_SIZE_CLASS);
    t.maxHpCol[i] = dv.getInt32(o + SBU_MAX_HP, true);
    t.radiusCol[i] = dv.getInt32(o + SBU_RADIUS, true);
    t.visionCol[i] = dv.getInt32(o + SBU_VISION, true);
    t.maxSlopeCol[i] = dv.getInt32(o + SBU_MAX_SLOPE, true);
    t.footprintWCol[i] = dv.getUint8(o + SBU_FOOTPRINT_W);
    t.footprintHCol[i] = dv.getUint8(o + SBU_FOOTPRINT_H);
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) {
      t.categoryMasks[i * SIM_BIN_CATEGORY_WORDS + w] = dv.getUint32(o + SBU_CATEGORIES + w * 4, true);
    }
    if (t.maxHpCol[i]! < 1 || t.radiusCol[i]! < 1 || t.speed[i]! < 0 || t.accel[i]! < 0) bad('unit', i);
    const sc = t.sizeClassCol[i]!;
    if (version === 1) {
      // v1 defaults (the formerly reserved bytes are zero).
      t.massCol[i] = DEFAULT_MASS_BY_SIZE_CLASS[sc < 8 ? sc : 7]!;
      t.turnInPlaceCol[i] = t.layerCol[i] === MotionLayer.Land ? 1 : 0;
      t.brakeCol[i] = t.accel[i]!;
      t.veterancyCol[i] = VeterancyId.Default;
      continue;
    }
    t.turnInPlaceCol[i] = dv.getUint16(o + SBU_FLAGS, true) & SimBinUnitFlag.TurnInPlace;
    t.massCol[i] = dv.getUint16(o + SBU_MASS, true);
    const up = dv.getUint16(o + SBU_UPGRADES_TO, true);
    t.upgradesToCol[i] = up === SIM_BIN_NONE ? -1 : up;
    t.brakeCol[i] = dv.getInt32(o + SBU_BRAKE, true);
    const bb = dv.getUint16(o + SBU_BUILDABLE_BY, true);
    t.buildableByCol[i] = bb === SIM_BIN_NONE ? -1 : bb;
    const dw = dv.getUint16(o + SBU_DEATH_WEAPON, true);
    t.deathWeaponCol[i] = dw === SIM_BIN_NONE ? -1 : dw;
    t.firstMountCol[i] = dv.getUint16(o + SBU_FIRST_MOUNT, true);
    t.mountCountCol[i] = dv.getUint8(o + SBU_MOUNT_COUNT);
    t.veterancyCol[i] = dv.getUint8(o + SBU_VETERANCY);
    if (
      t.massCol[i]! < 1 ||
      t.brakeCol[i]! < 0 ||
      t.upgradesToCol[i]! >= count ||
      t.buildableByCol[i]! >= t.exprCount ||
      t.deathWeaponCol[i]! >= t.weaponCount ||
      (t.mountCountCol[i]! > 0 && t.firstMountCol[i]! + t.mountCountCol[i]! > t.mountTotal)
    ) {
      bad('unit', i);
    }
    const x = UEXT.offset + i * UEXT.stride;
    t.massCostCol[i] = dv.getInt32(x, true);
    t.energyCostCol[i] = dv.getInt32(x + 4, true);
    t.buildTimeCol[i] = dv.getInt32(x + 8, true);
    t.wreckMassCol[i] = dv.getInt32(x + 12, true);
    t.wreckHpCol[i] = dv.getInt32(x + 16, true);
    for (let k = 0; k < 3; k++) t.hitboxCol[i * 3 + k] = dv.getInt32(x + 20 + k * 4, true);
    if (t.massCostCol[i]! < 0 || t.energyCostCol[i]! < 0 || t.buildTimeCol[i]! < 0 || t.wreckMassCol[i]! < 0 || t.wreckHpCol[i]! < 0) bad('unit', i);
  }
  if (version === 1) {
    // v1 hit box default: the collision diameter.
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) t.hitboxCol[i * 3 + k] = t.radiusCol[i]! * 2;
  }

  // ---- projectiles, weapons, mounts, priorities -----------------------------------------------------
  for (let i = 0; i < t.projectileCount; i++) {
    const o = PRJR.offset + i * PRJR.stride;
    t.projectileKindCol[i] = dv.getUint8(o);
    t.projectileTurnRateCol[i] = dv.getUint16(o + 2, true);
    t.projectileSpeedCol[i] = dv.getInt32(o + 4, true);
    t.projectileGravityCol[i] = dv.getInt32(o + 8, true);
    t.projectileLifetimeCol[i] = dv.getInt32(o + 12, true);
    if (t.projectileKindCol[i]! > 2 || t.projectileSpeedCol[i]! < 1 || t.projectileGravityCol[i]! < 0 || t.projectileLifetimeCol[i]! < 1) {
      bad('projectile', i);
    }
  }
  for (let i = 0; i < t.weaponCount; i++) {
    const o = WPNR.offset + i * WPNR.stride;
    t.weaponRangeCol[i] = dv.getInt32(o, true);
    t.weaponMinRangeCol[i] = dv.getInt32(o + 4, true);
    t.weaponDamageCol[i] = dv.getInt32(o + 8, true);
    t.weaponDamageRadiusCol[i] = dv.getInt32(o + 12, true);
    t.weaponReloadTicksCol[i] = dv.getUint16(o + 16, true);
    t.weaponSalvoCol[i] = dv.getUint16(o + 18, true);
    t.weaponMuzzleVelocityCol[i] = dv.getInt32(o + 20, true);
    t.weaponProjectileCol[i] = dv.getUint16(o + 24, true);
    t.weaponSalvoIntervalCol[i] = dv.getUint16(o + 26, true);
    if (
      t.weaponRangeCol[i]! < 1 ||
      t.weaponMinRangeCol[i]! < 0 ||
      t.weaponMinRangeCol[i]! > t.weaponRangeCol[i]! ||
      t.weaponDamageCol[i]! < 0 ||
      t.weaponDamageRadiusCol[i]! < 0 ||
      t.weaponReloadTicksCol[i]! < 1 ||
      t.weaponSalvoCol[i]! < 1 ||
      t.weaponMuzzleVelocityCol[i]! < 1 ||
      t.weaponProjectileCol[i]! >= t.projectileCount
    ) {
      bad('weapon', i);
    }
  }
  for (let i = 0; i < PRIO.count; i++) {
    t.priorityList[i] = dv.getUint16(PRIO.offset + i * 2, true);
    if (t.priorityList[i]! >= t.exprCount) bad('priority', i);
  }
  for (let i = 0; i < t.mountTotal; i++) {
    const o = MNTR.offset + i * MNTR.stride;
    t.mountUnitCol[i] = dv.getUint16(o, true);
    t.mountWeaponCol[i] = dv.getUint16(o + 2, true);
    t.mountHalfArcCol[i] = dv.getUint16(o + 4, true);
    t.mountYawRateCol[i] = dv.getUint16(o + 6, true);
    t.mountLayerMaskCol[i] = dv.getUint8(o + 8);
    t.mountPartCol[i] = dv.getUint8(o + 9);
    t.mountPriorityFirstCol[i] = dv.getUint16(o + 10, true);
    t.mountPriorityCountCol[i] = dv.getUint16(o + 12, true);
    const u = t.mountUnitCol[i]!;
    if (
      u >= count ||
      i < t.firstMountCol[u]! ||
      i >= t.firstMountCol[u]! + t.mountCountCol[u]! ||
      t.mountWeaponCol[i]! >= t.weaponCount ||
      t.mountHalfArcCol[i]! < 1 ||
      t.mountHalfArcCol[i]! > 32768 ||
      t.mountYawRateCol[i]! < 1 ||
      t.mountYawRateCol[i]! > 32768 ||
      t.mountLayerMaskCol[i] === 0 ||
      t.mountPartCol[i]! > 1 ||
      t.mountPriorityFirstCol[i]! + t.mountPriorityCountCol[i]! > PRIO.count
    ) {
      bad('mount', i);
    }
  }

  // ---- props, factions -----------------------------------------------------------------------------
  for (let i = 0; i < t.propCount; i++) {
    const o = PRPR.offset + i * PRPR.stride;
    t.propMaxHpCol[i] = dv.getInt32(o, true);
    t.propReclaimMassCol[i] = dv.getInt32(o + 4, true);
    t.propReclaimEnergyCol[i] = dv.getInt32(o + 8, true);
    t.propReclaimTicksCol[i] = dv.getInt32(o + 12, true);
    t.propFootprintWCol[i] = dv.getUint8(o + 16);
    t.propFootprintHCol[i] = dv.getUint8(o + 17);
    t.propBlocksShotsCol[i] = dv.getUint16(o + 18, true) & 1;
    if (t.propMaxHpCol[i]! < 0 || t.propReclaimMassCol[i]! < 0 || t.propReclaimEnergyCol[i]! < 0 || t.propReclaimTicksCol[i]! < 0) bad('prop', i);
  }
  for (let i = 0; i < FACU.count; i++) {
    t.factionUnitList[i] = dv.getUint16(FACU.offset + i * 2, true);
    if (t.factionUnitList[i]! >= count) bad('faction unit', i);
  }
  for (let i = 0; i < t.factionCount; i++) {
    const o = FACR.offset + i * FACR.stride;
    t.factionStartUnitCol[i] = dv.getUint16(o, true);
    t.factionUnitCountCol[i] = dv.getUint16(o + 2, true);
    t.factionUnitFirstCol[i] = dv.getUint32(o + 4, true);
    if (t.factionStartUnitCol[i]! >= count || t.factionUnitFirstCol[i]! + t.factionUnitCountCol[i]! > FACU.count) bad('faction', i);
  }
  return t;
}
