/**
 * UI scale of the HUD (ui.md §4.1): html font-size = 16 px × scale, all HUD sizes in rem.
 *   Auto: round₀.₀₅((height / 1080)^0.78), clamped to 0.8–1.5 → 1.0 at 1080p, 1.25 at 1440p, 1.5 at 2160p.
 *   Below 1280 × 720, or when scale · 1080 exceeds the window height, 0.8 applies.
 *   Manual: 0.8 / 0.9 / 1.0 / 1.1 / 1.25 / 1.5 (settings → accessibility); "compact" = 1.0 at 1440p.
 */
import { autoScale } from '../../ui/uiSettings.ts';

/** 'auto' or a manual scale; wider than the settings' UiScaleSetting (model/menus/settings.ts), which is assignable to it. */
export type HudScaleSetting = 'auto' | number;

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
/** Smallest window that still gets the auto formula (below: UI_SCALE_MIN). */
export const UI_SCALE_MIN_WIDTH = 1280;
export const UI_SCALE_MIN_HEIGHT = 720;
/** Reference height of scale 1.0. */
export const UI_SCALE_REF_HEIGHT = 1080;

/** Automatic UI scale for a window of `width` × `height` CSS px (ui.md §4.1). */
export function computeUiScale(width: number, height: number): number {
  if (!(width >= UI_SCALE_MIN_WIDTH) || !(height >= UI_SCALE_MIN_HEIGHT)) return UI_SCALE_MIN;
  const s = autoScale(height);
  // "scale · 1080 > Fensterhöhe → 0,8": the HUD would claim more than its reference share of the height.
  if (s * UI_SCALE_REF_HEIGHT > height + 1e-9) return UI_SCALE_MIN;
  return s;
}

/** Effective scale of a setting: 'auto' → computeUiScale, manual values are used as they are. */
export function resolveUiScale(setting: HudScaleSetting, width: number, height: number): number {
  return setting === 'auto' ? computeUiScale(width, height) : setting;
}
