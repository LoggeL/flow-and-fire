// Barrel of the HUD group "root" (hud-p5-root): the HUD root with dock layout and scaling, the tooltip
// layer, the UI-scale rule (ui.md §4.1) and the token-based HUD geometry (§4.2).
import './root.css';

export { Hud, parseTipAttr } from './Hud.tsx';
export type { HudProps } from './Hud.tsx';
export { TooltipContent, TooltipLayer } from './TooltipLayer.tsx';
export type { TooltipLayerProps } from './TooltipLayer.tsx';
export {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_MIN_HEIGHT,
  UI_SCALE_MIN_WIDTH,
  UI_SCALE_REF_HEIGHT,
  computeUiScale,
  resolveUiScale,
} from './scale.ts';
export type { HudScaleSetting } from './scale.ts';
export { HUD_METRICS, computeHudLayout, layoutPanels, placeTooltip, rectsOverlap } from './layout.ts';
export type { HudLayout, Rect } from './layout.ts';
