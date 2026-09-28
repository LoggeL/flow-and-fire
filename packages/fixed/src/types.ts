/**
 * Branded number types of the simulation (PLAN §2, §3.3).
 *
 * All brands are erased at runtime. Casts are only done through the narrow helpers below
 * (or the arithmetic in fx.ts/angle.ts), so a stray `*` on two `Fx` values is a type error.
 */

declare const brandKey: unique symbol;
declare const smallKey: unique symbol;

type Brand<B extends string> = number & { readonly [brandKey]: B };

/** Q20.12 fixed point in an int32 (raw = value * 4096). */
export type Fx = Brand<'Fx'>;
/** Fx whose raw magnitude is ≤ FX_SMALL_MAX_RAW (≤ 8 WU); products of two FxSmall fit into int32. */
export type FxSmall = Fx & { readonly [smallKey]: true };
/** Binary angle: u16, full turn = 65536. */
export type Ang16 = Brand<'Ang16'>;
/** Thousandths (e.g. ratios, percentages · 10), integer. */
export type Milli = Brand<'Milli'>;
/** Integer in [-(2^53-1), 2^53-1], never −0 (stored in Float64 columns of the arena). */
export type SafeInt = Brand<'SafeInt'>;
/** Simulation tick number (10 Hz), non-negative integer. */
export type Tick = Brand<'Tick'>;
/** Entity handle: index (20 bit) | generation (12 bit) << 20, as u32. */
export type Handle = Brand<'Handle'>;
/** Army slot 0..15. */
export type ArmyId = Brand<'ArmyId'>;

export const HANDLE_INDEX_BITS = 20;
export const HANDLE_GEN_BITS = 12;
export const HANDLE_INDEX_MASK = 0xfffff;
export const HANDLE_GEN_MASK = 0xfff;
export const MAX_ARMIES = 16;

/** Reinterprets a raw int32 as Fx (no scaling). */
export function asFx(raw: number): Fx {
  return (raw | 0) as Fx;
}

/** Reinterprets a raw int as Ang16 (wrapped into u16). */
export function asAng16(raw: number): Ang16 {
  return (raw & 0xffff) as Ang16;
}

/** Reinterprets an integer as Milli. */
export function asMilli(raw: number): Milli {
  return (raw | 0) as Milli;
}

/** Reinterprets a non-negative integer as Tick. */
export function asTick(n: number): Tick {
  return (n >>> 0) as Tick;
}

/** Reinterprets a u32 as Handle. */
export function asHandle(raw: number): Handle {
  return (raw >>> 0) as Handle;
}

/** Reinterprets an integer as ArmyId (0..15). */
export function asArmyId(n: number): ArmyId {
  return (n & 0xf) as ArmyId;
}

/** Packs index (20 bit) and generation (12 bit) into a Handle. */
export function makeHandle(index: number, gen: number): Handle {
  return ((((gen & HANDLE_GEN_MASK) << HANDLE_INDEX_BITS) | (index & HANDLE_INDEX_MASK)) >>> 0) as Handle;
}

/** Slot index of a handle. */
export function handleIndex(h: Handle): number {
  return h & HANDLE_INDEX_MASK;
}

/** Generation of a handle. */
export function handleGen(h: Handle): number {
  return (h >>> HANDLE_INDEX_BITS) & HANDLE_GEN_MASK;
}
