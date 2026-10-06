// Barrel of the menu "settings" (hud-p6-menus): five tabs, keyboard view, context cards, row layout.
import '../../styles/menus.css';
import './settings.css';

export { Settings, settingsTabLabel } from './Settings.tsx';
export { SettingsAside, CVD_MEASURE } from './SettingsAside.tsx';
export { KEYBOARD_ROWS, KeyboardView, capLabel, gridCaptions, keyKind } from './KeyboardView.tsx';
export type { KeyCap, KeyKind, KeyboardViewProps } from './KeyboardView.tsx';
export { ALL_ROWS, SETTINGS_LAYOUT, enumOptions, optionKey, optionLabel, rangeView, rowHint, rowHintKey, rowLabel, rowLabelKey } from './rows.ts';
export type { GroupSpec, RangeView, RowControl, RowSpec } from './rows.ts';
export type { SoundSample } from '../../commands/menus.ts';
