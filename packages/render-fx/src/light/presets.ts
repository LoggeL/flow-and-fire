/**
 * Target shadow settings per render preset (MS14, DECISIONS 17): Low none, Medium blob shadows
 * (no CSM; receivers bind a NullShadowReceiver), High/Ultra CSM with 2 cascades at 2048².
 * @faf/render's RENDER_PRESETS still carry `shadows: 'none'` from MS2.
 */
import { resolvePreset } from '@faf/render';
import type { RenderPreset, RenderPresetName, ShadowMode } from '@faf/render';
import type { CascadedShadowsOptions } from './cascaded-shadows.ts';

export interface ShadowPresetTarget {
  readonly mode: ShadowMode;
  /** CSM options, null when the preset uses no CSM. */
  readonly csm: CascadedShadowsOptions | null;
}

export const SHADOW_PRESET_TABLE: { readonly [K in RenderPresetName]: ShadowPresetTarget } = {
  low: { mode: 'none', csm: null },
  medium: { mode: 'blob', csm: null },
  high: { mode: 'csm', csm: { size: 2048, cascades: 2 } },
  ultra: { mode: 'csm', csm: { size: 2048, cascades: 2 } },
};

export function shadowOptionsForPreset(preset: RenderPreset | RenderPresetName): ShadowPresetTarget {
  return SHADOW_PRESET_TABLE[resolvePreset(preset).name];
}
