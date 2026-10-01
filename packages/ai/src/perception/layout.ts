/**
 * Versioned binary layout of a perception snapshot (little-endian). The same bytes come from the
 * synchronous arena, a worker transfer and — from MS9 — the sim's FrameWriter profile of the own
 * army, so byte comparisons (AI-PERC-01/03) work across hosts.
 *
 * Header (HEADER_BYTES = 120):
 *   0  u32 magic 'AIPS' (0x53504941)   4 u16 version   6 u8 army   7 u8 reserved
 *   8  u32 tick   12 u32 ownCount   16 u32 knownCount   20 u32 eventCount   24 u32 totalBytes
 *   28 u32 reserved
 *   32 f64 × 11 eco: massIncome, energyIncome, energyUpkeep, massStored, energyStored, massCapacity,
 *      energyCapacity, massRatio, energyRatio, massDemand, energyDemand
 * Own unit (OWN_BYTES = 80):
 *   0 u32 handle | 4 u16 bp | 6 u8 order | 7 u8 flags (1 complete, 2 factoryRepeat)
 *   8 f64 x | 16 f64 z | 24 f64 hpFrac | 32 f64 buildFrac | 40 u32 orderTarget | 44 i32 lastDamagedTick
 *   48 f64 orderX | 56 f64 orderZ | 64 f64 factoryProgress | 72 i16 factoryBp | 74 i16 upgradingTo
 *   76 u16 queueLength | 78 i16 orderBp
 * Known enemy (KNOWN_BYTES = 40):
 *   0 u32 id | 4 u8 army | 5 u8 kind (0 visible, 1 ghost, 2 blip) | 6 i16 bp | 8 f64 x | 16 f64 z
 *   24 f64 hpFrac (1 unless visible) | 32 i32 lastSeenTick | 36 u32 reserved
 * Event (EVENT_BYTES = 32):
 *   0 u8 kind | 1 u8 reason | 2 u16 seq | 4 u32 tick | 8 u32 a (unit/id) | 12 u32 b (attacker)
 *   16 i16 bp | 18 u8 army | 19 u8 reserved | 20 u32 reserved | 24 f64 amount
 */

export const PERCEPTION_MAGIC = 0x53504941;
export const PERCEPTION_VERSION = 1;
export const HEADER_BYTES = 120;
export const OWN_BYTES = 80;
export const KNOWN_BYTES = 40;
export const EVENT_BYTES = 32;

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
export const O_Z = 16;
export const O_HP = 24;
export const O_BUILD = 32;
export const O_TARGET = 40;
export const O_DAMAGED = 44;
export const O_OX = 48;
export const O_OZ = 56;
export const O_FPROG = 64;
export const O_FBP = 72;
export const O_UPG = 74;
export const O_QUEUE = 76;
export const O_OBP = 78;

export const FLAG_COMPLETE = 1;
export const FLAG_REPEAT = 2;

export const K_ID = 0;
export const K_ARMY = 4;
export const K_KIND = 5;
export const K_BP = 6;
export const K_X = 8;
export const K_Z = 16;
export const K_HP = 24;
export const K_SEEN = 32;

export const KNOWN_KINDS = ['visible', 'ghost', 'blip'] as const;

export const E_KIND = 0;
export const E_REASON = 1;
export const E_SEQ = 2;
export const E_TICK = 4;
export const E_A = 8;
export const E_B = 12;
export const E_BP = 16;
export const E_ARMY = 18;
export const E_AMOUNT = 24;

/** Event kind codes (append-only). */
export const EVENT_KINDS = ['ownDamaged', 'ownDestroyed', 'ownCompleted', 'enemySighted', 'enemyDestroyed', 'commandRejected'] as const;
