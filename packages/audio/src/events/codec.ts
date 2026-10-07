/**
 * How the router reads the kind-specific Event-32-B fields (flags bits, aux enums, death class).
 *
 * The binding encoding of these fields belongs to @faf/protocol (append-only, MS5), shared by
 * the sim, @faf/audio and @faf/render-fx. Until then the constants in kinds.ts are the
 * PROVISIONAL audio encoding (demo, tests) and serve only as defaults: the client injects an
 * `EventCodec` that translates the protocol's encoding into the audio categories, so neither the
 * sim nor render-fx has to follow the audio package (docs/status/track-audioeng.md §9/§11).
 *
 * Presentation classifications (how big a death sounds, whether a unit crashes like an aircraft)
 * are NOT sim data: they come from the client-side view data through `visualDeathProfile`
 * (visual id = blueprint sim id), so re-tuning them never touches sim.bin, bpSimHash or replays
 * (PLAN §3.1). The aux/flags fallback exists only for the provisional demo encoding.
 *
 * Hot path: every callback returns a number/boolean (no allocation); `visualDeathProfile` is
 * called once per visual id and cached by the router.
 */

import { DEATH_SIZE_CLASSES, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE, EVENT_FLAG_UNLOCATED, IMPACT_SURFACES } from './kinds.ts';

/** Death classification of one unit blueprint (client-side view data). */
export interface DeathProfile {
  /** Index into DEATH_SIZE_CLASSES (0 small … 3 huge). */
  readonly sizeClass: number;
  /** Crashes like an aircraft (air-crash sound instead of the size class). */
  readonly air: boolean;
  /** A structure: the structure collapse follows (from `minSizeClass`). */
  readonly structure: boolean;
}

/** Decoders for the kind-specific event fields; every member is optional (defaults: kinds.ts). */
export interface EventCodec {
  /** Bit mask of Event.flags meaning "no position" (default EVENT_FLAG_UNLOCATED = 0x80). */
  readonly unlocatedMask?: number | undefined;
  /**
   * projectileImpact: surface as an IMPACT_SURFACES index, −1 = silent. Called per impact event.
   * Default: aux is the index (out of range → ground).
   */
  readonly impactSurface?: ((aux: number, flags: number) => number) | undefined;
  /**
   * unitDeath: death profile of the unit's visual id from the view data; called once per visual
   * id (cached). undefined (or no callback) → provisional fallback: aux = size class, flags
   * EVENT_FLAG_STRUCTURE / EVENT_FLAG_AIR.
   */
  readonly visualDeathProfile?: ((visual: number) => DeathProfile | undefined) | undefined;
  /** alert: index into ALERT_KINDS, −1 = unknown. Called per alert event. Default: aux. */
  readonly alertIndex?: ((aux: number) => number) | undefined;
}

// Packed death code (Smi): bits 0..1 size class, bit 2 air, bit 3 structure.
/** Air bit of a packed death code. */
export const DEATH_CODE_AIR = 4;
/** Structure bit of a packed death code. */
export const DEATH_CODE_STRUCTURE = 8;

/** Packs a death profile into a small integer (router tables). Size classes are clamped. */
export function packDeathProfile(p: DeathProfile): number {
  const max = DEATH_SIZE_CLASSES.length - 1;
  const s = Number.isFinite(p.sizeClass) ? Math.min(max, Math.max(0, Math.trunc(p.sizeClass))) : 0;
  return s | (p.air ? DEATH_CODE_AIR : 0) | (p.structure ? DEATH_CODE_STRUCTURE : 0);
}

/** Provisional fallback: packed death code from aux (size class) and flags (STRUCTURE / AIR). */
export function provisionalDeathCode(aux: number, flags: number): number {
  const max = DEATH_SIZE_CLASSES.length - 1;
  const s = aux >= 0 && aux <= max ? aux : aux < 0 ? 0 : max;
  return s | ((flags & EVENT_FLAG_AIR) !== 0 ? DEATH_CODE_AIR : 0) | ((flags & EVENT_FLAG_STRUCTURE) !== 0 ? DEATH_CODE_STRUCTURE : 0);
}

/** Provisional default of `impactSurface`: aux is the IMPACT_SURFACES index (else ground). */
export function provisionalImpactSurface(aux: number): number {
  return aux >= 0 && aux < IMPACT_SURFACES.length ? aux : 0;
}

/** The provisional encoding of kinds.ts as an explicit codec (what the defaults do). */
export const PROVISIONAL_EVENT_CODEC: EventCodec = Object.freeze({
  unlocatedMask: EVENT_FLAG_UNLOCATED,
  impactSurface: (aux: number): number => provisionalImpactSurface(aux),
  visualDeathProfile: undefined,
  alertIndex: (aux: number): number => aux,
});
