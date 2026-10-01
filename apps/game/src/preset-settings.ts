import { RENDER_PRESETS, type RenderPresetName } from '@faf/render';
import { postOptionsForPreset } from '@faf/render-fx';
import type { SettingsValues } from '@faf/hud';

/** The settings values a render preset implies; shared by the menu and the running Game. */
export function presetSettings(name: RenderPresetName): Pick<SettingsValues, 'preset' | 'renderScale' | 'splatLayers' | 'shadowCascades' | 'bloom'> {
  const preset = RENDER_PRESETS[name];
  return { preset: name, renderScale: preset.renderScale, splatLayers: preset.splatLayers,
    shadowCascades: name === 'high' || name === 'ultra' ? 2 : 0, bloom: postOptionsForPreset(name).bloom };
}
