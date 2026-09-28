/** Fractional bits of Fx (Q20.12). */
export const FX_SHIFT = 12;
/** Raw value of 1.0 in Fx. */
export const FX_ONE = 4096;
/** Raw value of 0.5 in Fx. */
export const FX_HALF = 2048;
/** Raw mask of the fractional part. */
export const FX_FRAC_MASK = 4095;
/** Operand bound for fxMul (|raw| ≤ 2^26 guarantees an exact product ≤ 2^52). */
export const FX_MUL_OPERAND_MAX = 67108864;
/** Largest raw int32 value. */
export const FX_RAW_MAX = 2147483647;
/** Smallest raw int32 value. */
export const FX_RAW_MIN = -2147483648;
/** Largest |raw| of an FxSmall (2^15 − 1, just under 8 WU): FxSmall·FxSmall < 2^30 fits into int32. */
export const FX_SMALL_MAX_RAW = 32767;
/** Full turn in Ang16 units. */
export const ANG_FULL = 65536;
/** Half turn (180°) in Ang16 units. */
export const ANG_HALF = 32768;
/** Quarter turn (90°) in Ang16 units. */
export const ANG_QUARTER = 16384;
/** Eighth turn (45°) in Ang16 units. */
export const ANG_EIGHTH = 8192;
/** Mask of a u16 binary angle. */
export const ANG_MASK = 0xffff;
