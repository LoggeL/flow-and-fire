/**
 * Sim event kinds that produce sound, with the binding meaning of the Event-32-B fields
 * (PLAN §3.6: type u16, visual u16, tick, subTick u8, flags u8, pos i32×3 Q20.12, aux u32, handle u32).
 *
 * PROVISIONAL: the numeric `type` values in {@link DEFAULT_EVENT_TYPE_TABLE}, the flag bits and
 * the aux enums below are the audio package's own working encoding (demo, tests). The binding
 * encoding is defined append-only in @faf/protocol in MS5 (shared with the sim and render-fx);
 * the client then passes its type table (`CreateAudioEngineOptions.eventTypes`) and an
 * `EventCodec` (codec.ts: impact surface, alert index, unlocated bit, death profile from the view
 * data) that translate it into the audio categories. Nothing here is a contract the sim must
 * follow.
 */

/** Every sim event kind the audio router understands. */
export type SimEventKind =
  | 'weaponFire'
  | 'projectileImpact'
  | 'unitDeath'
  | 'commanderDeath'
  | 'wreckDestroyed'
  | 'buildStart'
  | 'buildComplete'
  | 'upgradeComplete'
  | 'reclaimStart'
  | 'reclaimComplete'
  | 'factoryRollOff'
  | 'unitRollOff'
  | 'shieldHit'
  | 'shieldCollapse'
  | 'shieldRestore'
  | 'overchargeFire'
  | 'tapshot'
  | 'radarContact'
  | 'massStall'
  | 'energyStall'
  | 'alert';

/** All kinds in fixed order; position + 1 is the provisional numeric event type. */
export const SIM_EVENT_KINDS: readonly SimEventKind[] = [
  'weaponFire',
  'projectileImpact',
  'unitDeath',
  'commanderDeath',
  'wreckDestroyed',
  'buildStart',
  'buildComplete',
  'upgradeComplete',
  'reclaimStart',
  'reclaimComplete',
  'factoryRollOff',
  'unitRollOff',
  'shieldHit',
  'shieldCollapse',
  'shieldRestore',
  'overchargeFire',
  'tapshot',
  'radarContact',
  'massStall',
  'energyStall',
  'alert',
];

const KIND_SET: ReadonlySet<string> = new Set(SIM_EVENT_KINDS);

/** Type guard for untrusted strings (event map parsing, custom type tables). */
export function isSimEventKind(s: string): s is SimEventKind {
  return KIND_SET.has(s);
}

/**
 * Provisional numeric event types 1..n → kind (demo and tests). MS5 replaces it with the
 * protocol's IDs via `CreateAudioEngineOptions.eventTypes`. Type 0 is deliberately unused.
 */
export const DEFAULT_EVENT_TYPE_TABLE: Readonly<Record<number, SimEventKind>> = Object.freeze(
  Object.fromEntries(SIM_EVENT_KINDS.map((k, i) => [i + 1, k])) as Record<number, SimEventKind>,
);

/** Inverse of {@link DEFAULT_EVENT_TYPE_TABLE}: kind → provisional numeric type. */
export const DEFAULT_EVENT_TYPES: Readonly<Record<SimEventKind, number>> = Object.freeze(
  Object.fromEntries(SIM_EVENT_KINDS.map((k, i) => [k, i + 1])) as Record<SimEventKind, number>,
);

// ---- flags (Event.flags u8) ----

/** unitDeath / projectileImpact: the unit concerned is a structure. */
export const EVENT_FLAG_STRUCTURE = 1;
/** unitDeath: the unit was airborne (plays the air-crash sound instead of the size class). */
export const EVENT_FLAG_AIR = 2;
/** Any kind: the event has no meaningful position (pos is ignored, sound plays non-spatial). */
export const EVENT_FLAG_UNLOCATED = 0x80;

// ---- aux enums ----

/** Impact surfaces of the audio map (EventCodec.impactSurface → index; provisional: index = aux). */
export const IMPACT_SURFACES = ['ground', 'metal', 'water', 'shield', 'structure'] as const;
export type ImpactSurface = (typeof IMPACT_SURFACES)[number];

/** unitDeath size classes (view-data death profile; provisional fallback: index = aux). */
export const DEATH_SIZE_CLASSES = ['small', 'medium', 'large', 'huge'] as const;
export type DeathSizeClass = (typeof DEATH_SIZE_CLASSES)[number];

/** One alert type: `index` is the `aux` of an `alert` event, `name` the alt_* sound name. */
export interface AlertKindInfo {
  readonly index: number;
  readonly name: string;
  /** Whether the alert usually carries a position (jump-to-location target). */
  readonly located: boolean;
  readonly meaning: string;
}

/** The 11 alert types (SOUNDLIST §3.13) in fixed order; index = `alert` event aux. */
export const ALERT_KINDS: readonly AlertKindInfo[] = [
  { index: 0, name: 'alt_gong', located: false, meaning: 'generic notice: the shared two-tone gong (prefix of future voice lines)' },
  { index: 1, name: 'alt_commander_danger', located: true, meaning: 'own commander in danger / under fire' },
  { index: 2, name: 'alt_unit_attacked', located: true, meaning: 'unit under attack' },
  { index: 3, name: 'alt_base_attacked', located: true, meaning: 'base / structure under attack' },
  { index: 4, name: 'alt_mass_stall', located: false, meaning: 'mass stall' },
  { index: 5, name: 'alt_energy_stall', located: false, meaning: 'energy stall' },
  { index: 6, name: 'alt_build_complete', located: true, meaning: 'construction finished (queue / structure)' },
  { index: 7, name: 'alt_factory_upgraded', located: true, meaning: 'factory upgrade finished' },
  { index: 8, name: 'alt_enemy_commander_spotted', located: true, meaning: 'enemy commander spotted' },
  { index: 9, name: 'alt_enemy_air', located: true, meaning: 'enemy air spotted' },
  { index: 10, name: 'alt_storage_full', located: false, meaning: 'storage full (mass is wasted)' },
];

/** alt_* name → alert index, or −1. */
export function alertKindIndex(name: string): number {
  for (let i = 0; i < ALERT_KINDS.length; i++) if (ALERT_KINDS[i]!.name === name) return i;
  return -1;
}

/** Documentation of one kind's field semantics (also rendered into docs/status/audioeng-a1.md). */
export interface SimEventKindInfo {
  readonly meaning: string;
  /** Meaning of `visual` (u16). */
  readonly visual: string;
  /** Meaning of `aux` (u32). */
  readonly aux: string;
  /** Meaning of `flags` (u8). */
  readonly flags: string;
  /** Meaning of `pos` (Q20.12 world units). */
  readonly pos: string;
  /** Meaning of `handle` (u32). */
  readonly handle: string;
  /** Milestone in which the sim starts emitting the kind (PLAN §5.2). */
  readonly milestone: string;
}

const NONE = '0 (unused)';

/**
 * Field semantics per kind as the audio router reads them with the provisional encoding
 * (documentation; the binding encoding comes from @faf/protocol in MS5, see the module comment).
 */
export const SIM_EVENT_KIND_INFO: Readonly<Record<SimEventKind, SimEventKindInfo>> = {
  weaponFire: {
    meaning: 'a weapon fired one shot/salvo (muzzle flash)',
    visual: "weapon visual ID → visualName(visual) = weapon ref 'core:wpn_*' → weapons[ref]",
    aux: NONE,
    flags: NONE,
    pos: 'muzzle position',
    handle: 'firing unit',
    milestone: 'MS5',
  },
  projectileImpact: {
    meaning: 'a projectile hit (or missed into the ground)',
    visual: 'visual ID of the weapon that fired it → weapons[ref].impact (impact family)',
    aux: 'surface, decoded by EventCodec.impactSurface (default: aux = index 0 ground, 1 metal (unit), 2 water, 3 shield (silent, shieldHit carries the sound), 4 structure)',
    flags: `bit0 (${EVENT_FLAG_STRUCTURE}) target is a structure (same as surface 4)`,
    pos: 'impact point',
    handle: 'unit hit, 0 = none',
    milestone: 'MS5',
  },
  unitDeath: {
    meaning: 'a unit or structure was destroyed (not the commander)',
    visual:
      'unit visual ID (= blueprint sim id) → EventCodec.visualDeathProfile(visual) from the client view data: size class, air, structure (presentation data, never in sim.bin)',
    aux:
      'provisional fallback only (demo/tests, no visualDeathProfile): size class 0 small (T1 mobile, walls, small structures), 1 medium (T2 mobile, T1/T2 defence, factory I), 2 large (T3 mobile, power, factory II/III), 3 huge (experimentals); the sim need not fill it',
    flags: `provisional fallback only: bit0 (${EVENT_FLAG_STRUCTURE}) structure → structure collapse follows; bit1 (${EVENT_FLAG_AIR}) airborne → air crash`,
    pos: 'unit position',
    handle: 'dead unit',
    milestone: 'MS5',
  },
  commanderDeath: {
    meaning: 'commander destroyed (Lotbruch); camera shake and match end come from elsewhere',
    visual: 'commander visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'commander position',
    handle: 'commander',
    milestone: 'MS5',
  },
  wreckDestroyed: {
    meaning: 'a wreck was destroyed by damage (not by reclaim)',
    visual: 'wreck visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'wreck position',
    handle: 'wreck',
    milestone: 'MS14',
  },
  buildStart: {
    meaning: 'construction site placed / construction begins',
    visual: 'visual ID of the unit being built (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'construction site',
    handle: 'unit under construction',
    milestone: 'MS9',
  },
  buildComplete: {
    meaning: 'a unit or structure was completed (crackle, then the small bell)',
    visual: 'visual ID of the finished unit (informational)',
    aux: NONE,
    flags: `bit0 (${EVENT_FLAG_STRUCTURE}) structure`,
    pos: 'finished unit',
    handle: 'finished unit',
    milestone: 'MS5',
  },
  upgradeComplete: {
    meaning: 'factory upgrade finished (Freisprechung): middle bell + alert',
    visual: 'visual ID of the upgraded structure (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'structure',
    handle: 'upgraded structure',
    milestone: 'MS9',
  },
  reclaimStart: {
    meaning: 'reclaim beam starts (sound is the per-army rcl_loop from the client, event is silent)',
    visual: 'visual ID of the reclaimed object (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'reclaimed object',
    handle: 'reclaiming unit',
    milestone: 'MS5',
  },
  reclaimComplete: {
    meaning: 'a reclaim target was used up',
    visual: 'visual ID of the reclaimed object (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'reclaimed object',
    handle: 'reclaiming unit',
    milestone: 'MS9',
  },
  factoryRollOff: {
    meaning: 'factory gate opens and a new unit rolls off (G10)',
    visual: 'factory visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'factory exit',
    handle: 'factory',
    milestone: 'MS6',
  },
  unitRollOff: {
    meaning: 'the rolled-off unit is released (silent; movement loops start client-side)',
    visual: 'unit visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'unit position',
    handle: 'new unit',
    milestone: 'MS6',
  },
  shieldHit: {
    meaning: 'a shield absorbed a hit (render ripple + sound)',
    visual: 'shield visual ID (informational)',
    aux: 'damage absorbed (informational)',
    flags: NONE,
    pos: 'hit point on the shield',
    handle: 'shield owner',
    milestone: 'MS13',
  },
  shieldCollapse: {
    meaning: 'a shield collapsed',
    visual: 'shield visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'shield centre',
    handle: 'shield owner',
    milestone: 'MS13',
  },
  shieldRestore: {
    meaning: 'a shield came (back) up',
    visual: 'shield visual ID (informational)',
    aux: NONE,
    flags: NONE,
    pos: 'shield centre',
    handle: 'shield owner',
    milestone: 'MS13',
  },
  overchargeFire: {
    meaning: 'commander fired the tapshot (overcharge, U8); emitted instead of weaponFire',
    visual: 'tapshot weapon visual ID',
    aux: 'energy drained (informational)',
    flags: NONE,
    pos: 'muzzle position',
    handle: 'commander',
    milestone: 'MS6',
  },
  tapshot: {
    meaning: 'tapshot projectile detonated (splash 2.5 WU); emitted instead of projectileImpact',
    visual: 'tapshot weapon visual ID',
    aux: 'damage dealt (informational)',
    flags: NONE,
    pos: 'detonation point',
    handle: 'unit hit, 0 = none',
    milestone: 'MS6',
  },
  radarContact: {
    meaning: 'new radar/sight contact (throttled by the sim)',
    visual: 'contact visual ID, 0 for blips',
    aux: NONE,
    flags: NONE,
    pos: 'contact position',
    handle: 'contact',
    milestone: 'MS9',
  },
  massStall: {
    meaning: 'the viewer army started stalling on mass',
    visual: NONE,
    aux: NONE,
    flags: `bit7 (${EVENT_FLAG_UNLOCATED}) set (not located)`,
    pos: 'ignored',
    handle: 'army index',
    milestone: 'MS9',
  },
  energyStall: {
    meaning: 'the viewer army started stalling on energy (E3): flow tone tilts + alert',
    visual: NONE,
    aux: NONE,
    flags: `bit7 (${EVENT_FLAG_UNLOCATED}) set (not located)`,
    pos: 'ignored',
    handle: 'army index',
    milestone: 'MS9',
  },
  alert: {
    meaning: 'generic alert (P8) raised by the sim for the viewer',
    visual: NONE,
    aux: 'alert index into ALERT_KINDS (0 alt_gong … 10 alt_storage_full)',
    flags: `bit7 (${EVENT_FLAG_UNLOCATED}) no location (pos ignored, no jump target)`,
    pos: 'alert location (jump-to target)',
    handle: 'unit concerned, 0 = none',
    milestone: 'MS9',
  },
};
