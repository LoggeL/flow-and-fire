import { computed, signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { TeamColorMode } from './teams.ts';

/**
 * Settings (ui.md §5.15; P9, C11, P12, P16 parts). Stored locally (localStorage), never part of replays.
 * Values are typed; every key has a spec (enum / range / bool) and all changes go through the pure
 * functions below (validation, presets, reset), so the game and the gallery apply them identically.
 */

export type SettingsTab = 'graphics' | 'audio' | 'keys' | 'access' | 'game';
export const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'audio', 'keys', 'access', 'game'];

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type FixedPreset = Exclude<GraphicsPreset, 'custom'>;
export const GRAPHICS_PRESETS_ORDER: readonly FixedPreset[] = ['low', 'medium', 'high', 'ultra'];
export type ShadowSetting = 'off' | 'blob' | 'csm1' | 'csm2' | 'csm3';
export type AntialiasSetting = 'off' | 'fxaa' | 'msaa4';
export type FrameCapSetting = 30 | 60 | 120 | 'monitor';
export type UiScaleSetting = 'auto' | 0.8 | 0.9 | 1 | 1.1 | 1.25 | 1.5;
export type MotionSetting = 'system' | 'on' | 'off';
export type AlertVoiceSetting = 'voice' | 'gong' | 'off';
export type TooltipSetting = 'short' | 'full' | 'off';
export type KeySchemeSetting = 'grid' | 'wasd';

export interface SettingsValues {
  // graphics
  readonly preset: GraphicsPreset;
  /** Inner resolution 0.5–1.0 (HUD stays sharp). */
  readonly renderScale: number;
  readonly shadows: ShadowSetting;
  readonly splatLayers: 2 | 4 | 8;
  readonly particleCap: 8000 | 16000 | 32000 | 64000;
  readonly bloom: boolean;
  readonly antialias: AntialiasSetting;
  readonly frameCap: FrameCapSetting;
  readonly cameraShake: boolean;
  // audio (0..100)
  readonly volMaster: number;
  readonly volSfx: number;
  readonly volVoice: number;
  readonly volUi: number;
  readonly volMusic: number;
  readonly volAmbient: number;
  readonly alertVoice: AlertVoiceSetting;
  readonly audibleStall: boolean;
  readonly audioInBackground: boolean;
  // keys
  readonly keyScheme: KeySchemeSetting;
  // accessibility
  readonly teamColors: TeamColorMode;
  readonly statePatterns: boolean;
  readonly iconOutline: boolean;
  readonly uiScale: UiScaleSetting;
  readonly reducedMotion: MotionSetting;
  /** Critical alerts flash when they appear (off = static double frame). */
  readonly alertFlash: boolean;
  /** Voice lines also as text in the alert feed (always on in the MVP). */
  readonly alertText: boolean;
  // game & language
  readonly locale: 'de' | 'en';
  readonly edgePan: boolean;
  readonly tooltips: TooltipSetting;
  readonly pauseInBackground: boolean;
  readonly autoSaveReplays: boolean;
}

export type SettingKey = keyof SettingsValues;

export type SettingSpec =
  | { readonly kind: 'enum'; readonly options: readonly (string | number)[] }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly step: number }
  | { readonly kind: 'bool' };

const VOLUME: SettingSpec = { kind: 'range', min: 0, max: 100, step: 1 };
const BOOL: SettingSpec = { kind: 'bool' };

/** Spec per key (validation, controls, sanitising stored values). */
export const SETTING_SPECS: { readonly [K in SettingKey]: SettingSpec } = {
  preset: { kind: 'enum', options: ['low', 'medium', 'high', 'ultra', 'custom'] },
  renderScale: { kind: 'range', min: 0.5, max: 1, step: 0.05 },
  shadows: { kind: 'enum', options: ['off', 'blob', 'csm1', 'csm2', 'csm3'] },
  splatLayers: { kind: 'enum', options: [2, 4, 8] },
  particleCap: { kind: 'enum', options: [8000, 16000, 32000, 64000] },
  bloom: BOOL,
  antialias: { kind: 'enum', options: ['off', 'fxaa', 'msaa4'] },
  frameCap: { kind: 'enum', options: [30, 60, 120, 'monitor'] },
  cameraShake: BOOL,
  volMaster: VOLUME,
  volSfx: VOLUME,
  volVoice: VOLUME,
  volUi: VOLUME,
  volMusic: VOLUME,
  volAmbient: VOLUME,
  alertVoice: { kind: 'enum', options: ['voice', 'gong', 'off'] },
  audibleStall: BOOL,
  audioInBackground: BOOL,
  keyScheme: { kind: 'enum', options: ['grid', 'wasd'] },
  teamColors: { kind: 'enum', options: ['house', 'relation', 'cvd'] },
  statePatterns: BOOL,
  iconOutline: BOOL,
  uiScale: { kind: 'enum', options: ['auto', 0.8, 0.9, 1, 1.1, 1.25, 1.5] },
  reducedMotion: { kind: 'enum', options: ['system', 'on', 'off'] },
  alertFlash: BOOL,
  alertText: BOOL,
  locale: { kind: 'enum', options: ['de', 'en'] },
  edgePan: BOOL,
  tooltips: { kind: 'enum', options: ['short', 'full', 'off'] },
  pauseInBackground: BOOL,
  autoSaveReplays: BOOL,
};

/** Graphics keys that a preset sets (display keys like the frame cap stay untouched). */
export const PRESET_KEYS = ['renderScale', 'shadows', 'splatLayers', 'particleCap', 'bloom', 'antialias'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export type PresetValues = Pick<SettingsValues, PresetKey>;

/**
 * Preset table (DECISIONS 17, with DECISIONS 25: Medium uses 8 splat layers). Low: no shadows, 4 layers, no
 * bloom; Medium: blob shadows, HDR + bloom + FXAA, render scale 0.8; High: CSM 2 cascades, MSAA 4; Ultra: like
 * High with LOD bias 1.25 (render package) and the highest particle cap.
 */
export const GRAPHICS_PRESETS: Readonly<Record<FixedPreset, PresetValues>> = {
  low: { renderScale: 0.7, shadows: 'off', splatLayers: 4, particleCap: 8000, bloom: false, antialias: 'off' },
  medium: { renderScale: 0.8, shadows: 'blob', splatLayers: 8, particleCap: 16000, bloom: true, antialias: 'fxaa' },
  high: { renderScale: 1, shadows: 'csm2', splatLayers: 8, particleCap: 32000, bloom: true, antialias: 'msaa4' },
  ultra: { renderScale: 1, shadows: 'csm2', splatLayers: 8, particleCap: 64000, bloom: true, antialias: 'msaa4' },
};

export const DEFAULT_SETTINGS: SettingsValues = {
  preset: 'medium',
  ...GRAPHICS_PRESETS.medium,
  frameCap: 60,
  cameraShake: true,
  volMaster: 80,
  volSfx: 70,
  volVoice: 90,
  volUi: 55,
  volMusic: 40,
  volAmbient: 50,
  alertVoice: 'voice',
  audibleStall: true,
  audioInBackground: false,
  keyScheme: 'grid',
  teamColors: 'house',
  statePatterns: true,
  iconOutline: false,
  uiScale: 'auto',
  reducedMotion: 'system',
  alertFlash: true,
  alertText: true,
  locale: 'de',
  edgePan: true,
  tooltips: 'full',
  pauseInBackground: true,
  autoSaveReplays: true,
};

export const SETTING_KEYS: readonly SettingKey[] = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

/** Keys whose value differs from the defaults (changed values get an ember dot). */
export function changedSettings(values: SettingsValues, defaults: SettingsValues = DEFAULT_SETTINGS): readonly SettingKey[] {
  return (Object.keys(defaults) as SettingKey[]).filter((k) => values[k] !== defaults[k]);
}

function onStep(v: number, min: number, step: number): boolean {
  const n = (v - min) / step;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

/** True if `value` is a valid value of `key` (type, enum member, range and step). */
export function isValidSetting<K extends SettingKey>(key: K, value: unknown): value is SettingsValues[K] {
  const spec = SETTING_SPECS[key];
  if (spec.kind === 'bool') return typeof value === 'boolean';
  if (spec.kind === 'enum') return spec.options.includes(value as string | number);
  return typeof value === 'number' && Number.isFinite(value) && value >= spec.min - 1e-9 && value <= spec.max + 1e-9 && onStep(value, spec.min, spec.step);
}

/**
 * Normalises an input value: ranges are clamped and snapped to their step (slider noise like 0.8000001),
 * enum/bool values must match exactly. Returns null for values that cannot be used.
 */
export function coerceSetting<K extends SettingKey>(key: K, value: unknown): SettingsValues[K] | null {
  const spec = SETTING_SPECS[key];
  if (spec.kind === 'range') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const snapped = spec.min + Math.round((Math.min(spec.max, Math.max(spec.min, value)) - spec.min) / spec.step) * spec.step;
    return (Math.round(snapped * 1000) / 1000) as SettingsValues[K];
  }
  return isValidSetting(key, value) ? value : null;
}

/** Preset the graphics values correspond to ("custom" when no preset matches). */
export function detectPreset(values: PresetValues): GraphicsPreset {
  for (const p of GRAPHICS_PRESETS_ORDER) {
    const ref = GRAPHICS_PRESETS[p];
    if (PRESET_KEYS.every((k) => values[k] === ref[k])) return p;
  }
  return 'custom';
}

function isPresetKey(key: SettingKey): key is PresetKey {
  return (PRESET_KEYS as readonly string[]).includes(key);
}

/**
 * Applies one change (what the game does on setSetting): invalid values leave `values` unchanged,
 * choosing a preset sets its graphics values, changing a graphics value re-derives the preset.
 */
export function applySetting<K extends SettingKey>(values: SettingsValues, key: K, value: unknown): SettingsValues {
  const v = coerceSetting(key, value);
  if (v === null || values[key] === v) return values;
  if (key === 'preset') {
    const p = v as GraphicsPreset;
    return p === 'custom' ? { ...values, preset: 'custom' } : { ...values, ...GRAPHICS_PRESETS[p], preset: p };
  }
  const next = { ...values, [key]: v } as SettingsValues;
  return isPresetKey(key) ? { ...next, preset: detectPreset(next) } : next;
}

/** "Standard wiederherstellen": defaults, but the language stays (resetting it would lock readers out). */
export function resetSettingsValues(values: SettingsValues, defaults: SettingsValues = DEFAULT_SETTINGS): SettingsValues {
  return { ...defaults, locale: values.locale };
}

/** "Standard wiederherstellen" would change something (a different language alone does not count). */
export function canResetSettings(values: SettingsValues, defaults: SettingsValues = DEFAULT_SETTINGS): boolean {
  return changedSettings(values, defaults).some((k) => k !== 'locale');
}

/** Reads stored settings (e.g. parsed localStorage JSON): unknown keys dropped, invalid values → defaults. */
export function sanitizeSettings(raw: unknown, defaults: SettingsValues = DEFAULT_SETTINGS): SettingsValues {
  if (typeof raw !== 'object' || raw === null) return defaults;
  const src = raw as Readonly<Record<string, unknown>>;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of SETTING_KEYS) {
    if (!(key in src)) continue;
    const v = coerceSetting(key, src[key]);
    if (v !== null) out[key] = v;
  }
  const values = out as unknown as SettingsValues;
  return values.preset === detectPreset(values) || values.preset === 'custom' ? values : { ...values, preset: detectPreset(values) };
}

/** Result of the graphics autodetect (P9): GPU name + 3-s benchmark of the big-battle scene. */
export interface GraphicsDetect {
  readonly state: 'idle' | 'running' | 'done';
  readonly gpu: string;
  /** Graphics API line, e.g. "WebGL2". */
  readonly api: string;
  /** Relevant extensions (e.g. EXT_color_buffer_float). */
  readonly extensions: readonly string[];
  /** Benchmark result in frames per second (null before the first run). */
  readonly fps: number | null;
  readonly recommended: FixedPreset;
}

export interface SettingsSection {
  readonly tab: Signal<SettingsTab>;
  readonly values: Signal<SettingsValues>;
  /** Reference for the ember dot and "Standard wiederherstellen". */
  readonly defaults: Signal<SettingsValues>;
  /** Changed keys (value ≠ default), derived. */
  readonly dirty: ReadonlySignal<readonly SettingKey[]>;
  readonly detect: Signal<GraphicsDetect>;
  /** Current auto UI scale (shown as "Auto (1,25)"). */
  readonly autoScale: Signal<number>;
}

export function createSettingsSection(): SettingsSection {
  const values = signal<SettingsValues>(DEFAULT_SETTINGS);
  const defaults = signal<SettingsValues>(DEFAULT_SETTINGS);
  return {
    tab: signal<SettingsTab>('graphics'),
    values,
    defaults,
    dirty: computed(() => changedSettings(values.value, defaults.value)),
    detect: signal<GraphicsDetect>({ state: 'idle', gpu: '', api: 'WebGL2', extensions: [], fps: null, recommended: 'medium' }),
    autoScale: signal(1),
  };
}

// ---------- load estimate (settings context card) ----------

export interface LoadEstimate {
  /** GPU ms per frame on the reference laptop (Iris Xe, 1080p). */
  readonly gpuMs: number;
  readonly mainMs: number;
  readonly draws: number;
  /** Particles in thousands at the cap. */
  readonly particlesK: number;
}

/** Budgets the bars are drawn against (PLAN §3.4: GPU ≤ 12 ms, Main-JS ≤ 4 ms, ≤ 250 draws). */
export const LOAD_BUDGET: LoadEstimate = { gpuMs: 12, mainMs: 4, draws: 250, particlesK: 64 };

const SHADOW_GPU: Readonly<Record<ShadowSetting, number>> = { off: 0, blob: 0.4, csm1: 1.9, csm2: 3.1, csm3: 4.4 };
const SHADOW_DRAWS: Readonly<Record<ShadowSetting, number>> = { off: 0, blob: 2, csm1: 30, csm2: 58, csm3: 86 };
const AA_GPU: Readonly<Record<AntialiasSetting, number>> = { off: 0, fxaa: 0.3, msaa4: 1.2 };

/**
 * Rough estimate of the frame cost on the reference laptop, extrapolated from the SPK4 measurement
 * (DECISIONS 17: fallback ≈ ½ of full; Iris Xe ≈ 4–5 × M5 Pro – an assumption, not a measurement).
 */
export function estimateLoad(v: PresetValues): LoadEstimate {
  const pixels = v.renderScale * v.renderScale;
  const gpu = 5.5 + 1.9 * pixels + SHADOW_GPU[v.shadows] + (v.splatLayers === 8 ? 0.6 : v.splatLayers === 4 ? 0.2 : 0) + (v.bloom ? 1.1 : 0) + AA_GPU[v.antialias];
  const draws = 196 + SHADOW_DRAWS[v.shadows] + (v.splatLayers === 8 ? 8 : 4) + (v.bloom ? 6 : 0);
  const particlesK = (v.particleCap / 1000) * 0.59;
  const mainMs = 2.87 + particlesK * 0.035 + (v.shadows.startsWith('csm') ? 0.3 : 0);
  return {
    gpuMs: Math.round(gpu * 10) / 10,
    mainMs: Math.round(mainMs * 10) / 10,
    draws: Math.round(draws),
    particlesK: Math.round(particlesK * 10) / 10,
  };
}
