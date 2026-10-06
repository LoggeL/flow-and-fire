/**
 * Target post settings per render preset (MS14). @faf/render's RENDER_PRESETS still carry
 * `hdr: false`/`bloom: false` from MS2; this table is the intended assignment from DECISIONS 17
 * (Low: LDR without bloom; Medium: HDR + bloom 5 + FXAA; High/Ultra like Medium). MSAA is not
 * available in the RHI, so FXAA runs on every preset.
 */
import { resolvePreset } from '@faf/render';
import type { RenderPreset, RenderPresetName } from '@faf/render';
import { DEFAULT_POST_OPTIONS } from './post-chain.ts';
import type { PostOptions } from './post-chain.ts';

export const POST_PRESET_TABLE: { readonly [K in RenderPresetName]: PostOptions } = {
  low: { ...DEFAULT_POST_OPTIONS, hdr: false, bloom: false, fxaa: true },
  medium: { ...DEFAULT_POST_OPTIONS, hdr: true, bloom: true, bloomLevels: 5, fxaa: true },
  high: { ...DEFAULT_POST_OPTIONS, hdr: true, bloom: true, bloomLevels: 5, fxaa: true },
  ultra: { ...DEFAULT_POST_OPTIONS, hdr: true, bloom: true, bloomLevels: 5, fxaa: true },
};

/** Post options for a preset (target assignment for MS14, see {@link POST_PRESET_TABLE}). */
export function postOptionsForPreset(preset: RenderPreset | RenderPresetName): PostOptions {
  return { ...POST_PRESET_TABLE[resolvePreset(preset).name] };
}
