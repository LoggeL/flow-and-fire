/**
 * Versioned binary layout of a perception snapshot (little-endian). The same bytes come from the
 * synchronous arena, a worker transfer and — from MS9 — the sim's FrameWriter profile of the own
 * army, so byte comparisons (AI-PERC-01/03) work across hosts.
 *
 * Version 2 follows the conventions of the frame records (protocol frame.ts) so that the sim can
 * write it without floats (lint rule `sim/determinism`: no setFloat64, no untruncated division):
 * positions are i32 Fx raw (1 WU = FX_ONE = 4096), fractions u16 Q15 (1.0 = FRAC_ONE = 32768),
 * economy values and damage amounts i32 in thousandths (ECO_ONE = 1000). The conversion to floats
 * happens only on the AI side (`SnapshotPerception`). PLAN §3.2 places perception layouts in
 * @faf/protocol: this module moves there unchanged as `perception.ts` in MS9 (TRACK-AI §4) — until
 * then protocol stays untouched.
 *
 * Header (HEADER_BYTES = 80):
 *   0  u32 magic 'AIPS' (0x53504941)   4 u16 version   6 u8 army   7 u8 reserved
 *   8  u32 tick   12 u32 ownCount   16 u32 knownCount   20 u32 eventCount   24 u32 totalBytes
 *   28 u32 reserved
 *   32 i32 × 11 eco (thousandths): massIncome, energyIncome, energyUpkeep, massStored,
 *      energyStored, massCapacity, energyCapacity, massRatio, energyRatio, massDemand, energyDemand
 *   76 u32 reserved
 * Own unit (OWN_BYTES = 48):
 *   0 u32 handle | 4 u16 bp | 6 u8 order | 7 u8 flags (1 complete, 2 factoryRepeat)
 *   8 i32 x (Fx) | 12 i32 z (Fx) | 16 u16 hpFrac (Q15) | 18 u16 buildFrac (Q15) | 20 u32 orderTarget
 *   24 i32 lastDamagedTick | 28 i32 orderX (Fx) | 32 i32 orderZ (Fx) | 36 u16 factoryProgress (Q15)
 *   38 i16 factoryBp | 40 i16 upgradingTo | 42 u16 queueLength | 44 i16 orderBp | 46 u16 reserved
 * Known enemy (KNOWN_BYTES = 24):
 *   0 u32 id | 4 u8 army | 5 u8 kind (0 visible, 1 ghost, 2 blip) | 6 i16 bp | 8 i32 x (Fx)
 *   12 i32 z (Fx) | 16 u16 hpFrac (Q15; FRAC_ONE unless visible) | 18 u16 reserved | 20 i32 lastSeenTick
 * Event (EVENT_BYTES = 24):
 *   0 u8 kind | 1 u8 reason | 2 u16 seq | 4 u32 tick | 8 u32 a (unit/id) | 12 u32 b (attacker)
 *   16 i16 bp | 18 u8 army | 19 u8 reserved | 20 i32 amount (thousandths)
 */
import { FX_ONE } from '@faf/fixed';

export const PERCEPTION_MAGIC = 0x53504941;
export const PERCEPTION_VERSION = 2;
export const HEADER_BYTES = 80;
export const OWN_BYTES = 48;
export const KNOWN_BYTES = 24;
export const EVENT_BYTES = 24;

/** Position scale: Fx raw (1 WU = 4096, @faf/fixed). */
export const POS_ONE = FX_ONE;
/** Fraction scale: Q15 (1.0 = 32768). */
export const FRAC_ONE = 32768;
/** Economy/amount scale: thousandths. */
export const ECO_ONE = 1000;

export const H_MAGIC = 0;
export const H_VERSION = 4;
export const H_ARMY = 6;
export const H_TICK = 8;
export const H_OWN = 12;
export const H_KNOWN = 16;
export const H_EVENTS = 20;
export const H_TOTAL = 24;
export const H_ECO = 32;

/** Eco field order in the header. */
export const ECO_FIELDS = [
  'massIncome',
  'energyIncome',
  'energyUpkeep',
  'massStored',
  'energyStored',
  'massCapacity',
  'energyCapacity',
  'massRatio',
  'energyRatio',
  'massDemand',
  'energyDemand',
] as const;

export const O_HANDLE = 0;
export const O_BP = 4;
export const O_ORDER = 6;
export const O_FLAGS = 7;
export const O_X = 8;
export const O_Z = 12;
export const O_HP = 16;
export const O_BUILD = 18;
export const O_TARGET = 20;
export const O_DAMAGED = 24;
export const O_OX = 28;
export const O_OZ = 32;
export const O_FPROG = 36;
export const O_FBP = 38;
export const O_UPG = 40;
export const O_QUEUE = 42;
export const O_OBP = 44;

export const FLAG_COMPLETE = 1;
export const FLAG_REPEAT = 2;

export const K_ID = 0;
export const K_ARMY = 4;
export const K_KIND = 5;
export const K_BP = 6;
export const K_X = 8;
export const K_Z = 12;
export const K_HP = 16;
export const K_SEEN = 20;

export const KNOWN_KINDS = ['visible', 'ghost', 'blip'] as const;

export const E_KIND = 0;
export const E_REASON = 1;
export const E_SEQ = 2;
export const E_TICK = 4;
export const E_A = 8;
export const E_B = 12;
export const E_BP = 16;
export const E_ARMY = 18;
export const E_AMOUNT = 20;

/** Event kind codes (append-only). */
export const EVENT_KINDS = ['ownDamaged', 'ownDestroyed', 'ownCompleted', 'enemySighted', 'enemyDestroyed', 'commandRejected'] as const;

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

function checkI32(what: string, v: number): number {
  if (!Number.isInteger(v) || v < I32_MIN || v > I32_MAX) throw new RangeError(`perception: ${what} out of i32 range: ${v}`);
  return v;
}

// ---- quantization of float producers (arena, tests); the sim writes the raw values directly ----

/** WU → Fx raw (Math.round of the exact product: the scale is a power of two). */
export function posRaw(what: string, wu: number): number {
  return checkI32(what, Math.round(wu * POS_ONE));
}

/** Fraction → Q15, clamped to [0, 1] and floored (a unit below full HP never reads as 1.0). */
export function fracRaw(what: string, f: number): number {
  if (Number.isNaN(f)) throw new RangeError(`perception: ${what} is NaN`);
  const c = f < 0 ? 0 : f > 1 ? 1 : f;
  return Math.floor(c * FRAC_ONE);
}

/** Eco value / amount → thousandths (rounded). */
export function ecoRaw(what: string, v: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`perception: ${what} not finite: ${v}`);
  return checkI32(what, Math.round(v * ECO_ONE));
}

// ---- decoding (AI side) ------------------------------------------------------------------------

/** Fx raw → WU (exact: division by a power of two). */
export function posOf(raw: number): number {
  return raw / POS_ONE;
}

/** Q15 → fraction (exact). */
export function fracOf(raw: number): number {
  return raw / FRAC_ONE;
}

/** Thousandths → value. */
export function ecoOf(raw: number): number {
  return raw / ECO_ONE;
}
