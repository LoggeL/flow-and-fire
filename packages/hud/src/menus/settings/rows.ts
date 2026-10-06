/**
 * Row layout of the settings (ui.md §5.15; markup after settings.html): groups and rows per tab, the
 * control of each row and how values map to controls/labels. Pure data + text functions.
 */
import { fmtInt, fmtNum, fmtPct } from '../../format/index.ts';
import { t, tDynamic } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { SETTING_SPECS } from '../../model/menus/settings.ts';
import type { SettingKey, SettingsTab } from '../../model/menus/settings.ts';

export type RowControl = 'seg' | 'select' | 'range' | 'switch';

export interface RowSpec {
  readonly key: SettingKey;
  readonly control: RowControl;
  /** Shown but not changeable (e.g. alert text is always on in the MVP). */
  readonly locked?: boolean;
  /** Options hidden from the control (still valid values, e.g. "custom" preset only when active). */
  readonly hideOptions?: readonly (string | number)[];
}

export interface GroupSpec {
  readonly title: MsgKey;
  readonly rows: readonly RowSpec[];
}

export const SETTINGS_LAYOUT: Readonly<Record<SettingsTab, readonly GroupSpec[]>> = {
  graphics: [
    {
      title: 'ui.settings.group.quality',
      rows: [
        { key: 'preset', control: 'seg' },
        { key: 'renderScale', control: 'range' },
        { key: 'shadows', control: 'select' },
        { key: 'splatLayers', control: 'seg' },
        { key: 'particleCap', control: 'select' },
        { key: 'bloom', control: 'switch' },
        { key: 'antialias', control: 'select' },
      ],
    },
    {
      title: 'ui.settings.group.display',
      rows: [
        { key: 'frameCap', control: 'select' },
        { key: 'cameraShake', control: 'switch' },
      ],
    },
  ],
  audio: [
    {
      title: 'ui.settings.group.mixer',
      rows: [
        { key: 'volMaster', control: 'range' },
        { key: 'volSfx', control: 'range' },
        { key: 'volVoice', control: 'range' },
        { key: 'volUi', control: 'range' },
        { key: 'volMusic', control: 'range' },
        { key: 'volAmbient', control: 'range' },
      ],
    },
    {
      title: 'ui.settings.group.behavior',
      rows: [
        { key: 'alertVoice', control: 'seg' },
        { key: 'audibleStall', control: 'switch' },
        { key: 'audioInBackground', control: 'switch' },
      ],
    },
  ],
  keys: [{ title: 'ui.settings.group.scheme', rows: [{ key: 'keyScheme', control: 'seg' }] }],
  access: [
    {
      title: 'ui.settings.group.colors',
      rows: [
        { key: 'teamColors', control: 'seg' },
        { key: 'statePatterns', control: 'switch' },
        { key: 'iconOutline', control: 'switch' },
      ],
    },
    {
      title: 'ui.settings.group.surface',
      rows: [
        { key: 'uiScale', control: 'select' },
        { key: 'reducedMotion', control: 'seg' },
        { key: 'alertFlash', control: 'switch' },
        { key: 'alertText', control: 'switch', locked: true },
      ],
    },
  ],
  game: [
    {
      title: 'ui.settings.group.general',
      rows: [
        { key: 'locale', control: 'seg' },
        { key: 'edgePan', control: 'switch' },
        { key: 'tooltips', control: 'seg' },
        { key: 'pauseInBackground', control: 'switch' },
        { key: 'autoSaveReplays', control: 'switch' },
      ],
    },
  ],
};

/** Every row of every tab (for tests and the key → tab lookup). */
export const ALL_ROWS: readonly (RowSpec & { readonly tab: SettingsTab })[] = (Object.keys(SETTINGS_LAYOUT) as SettingsTab[]).flatMap((tab) =>
  SETTINGS_LAYOUT[tab].flatMap((g) => g.rows.map((r) => ({ ...r, tab }))),
);

export function rowLabelKey(key: SettingKey): string {
  return `ui.settings.row.${key}.label`;
}

export function rowHintKey(key: SettingKey): string {
  return `ui.settings.row.${key}.hint`;
}

export function rowLabel(key: SettingKey): string {
  return tDynamic(rowLabelKey(key));
}

export function rowHint(key: SettingKey): string {
  return tDynamic(rowHintKey(key));
}

/** i18n key of a text option, or null for options shown as formatted numbers. */
export function optionKey(key: SettingKey, value: string | number): string | null {
  if (typeof value === 'number') return null;
  return `ui.settings.opt.${key}.${value}`;
}

/** Visible label of an option ("Mittel", "1 Kaskade", "16.000", "0,8", "Auto (1,25)"). */
export function optionLabel(key: SettingKey, value: string | number, autoScale = 1): string {
  if (key === 'uiScale' && value === 'auto') return t('ui.settings.opt.uiScale.auto', { scale: fmtNum(autoScale, 2) });
  const k = optionKey(key, value);
  if (k !== null) return tDynamic(k);
  if (key === 'uiScale') return fmtNum(value as number, 2);
  return fmtInt(value as number);
}

/** Options of an enum setting in spec order. */
export function enumOptions(key: SettingKey): readonly (string | number)[] {
  const spec = SETTING_SPECS[key];
  return spec.kind === 'enum' ? spec.options : [];
}

export interface RangeView {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Setting value → slider value. */
  toUi(v: number): number;
  /** Slider value → setting value. */
  fromUi(n: number): number;
  /** Visible value text ("80 %", "70"). */
  text(v: number): string;
}

/** Slider mapping: render scale as percent (50–100 in steps of 5), volumes 0–100. */
export function rangeView(key: SettingKey): RangeView {
  if (key === 'renderScale') {
    return {
      min: 50,
      max: 100,
      step: 5,
      toUi: (v) => Math.round(v * 100),
      fromUi: (n) => Math.round(n) / 100,
      text: (v) => fmtPct(v),
    };
  }
  const spec = SETTING_SPECS[key];
  const min = spec.kind === 'range' ? spec.min : 0;
  const max = spec.kind === 'range' ? spec.max : 100;
  return { min, max, step: 1, toUi: (v) => v, fromUi: (n) => Math.round(n), text: (v) => fmtInt(v) };
}
