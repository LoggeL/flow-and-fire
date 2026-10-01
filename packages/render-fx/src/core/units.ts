/** World-unit ↔ raw Q20.12 conversions (1 WU = 4096 raw), as used for all FX world positions. */
import { RAW_PER_WU } from '@faf/render';

export { RAW_PER_WU };

/** WU → raw Q20.12 integer (rounded to nearest). */
export function wuToRaw(x: number): number {
  return Math.round(x * RAW_PER_WU);
}

/** Raw Q20.12 → WU. */
export function rawToWu(raw: number): number {
  return raw / RAW_PER_WU;
}
