import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { TeamColorMode } from './skirmish.ts';

/** Settings (ui.md §5.15; P9, C11, P12, P16 parts). Stored locally, never part of replays. */

export type SettingsTab = 'graphics' | 'audio' | 'keys' | 'access' | 'game';
export const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'audio', 'keys', 'access', 'game'];

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type UiScaleSetting = 'auto' | 0.8 | 0.9 | 1 | 1.1 | 1.25 | 1.5;
export type MotionSetting = 'system' | 'on' | 'off';

export interface SettingsValues {
  // graphics
  readonly preset: GraphicsPreset;
  readonly renderScale: number;
  readonly shadowCascades: 0 | 1 | 2 | 3;
  readonly splatLayers: 2 | 4 | 8;
  readonly particleCap: number;
  readonly bloom: boolean;
  readonly antialias: 'off' | 'fxaa' | 'msaa4';
  readonly frameCap: 30 | 60 | 120 | 'monitor';
  readonly cameraShake: boolean;
  // audio (0..100)
  readonly volMaster: number;
  readonly volSfx: number;
  readonly volVoice: number;
  readonly volUi: number;
  readonly volMusic: number;
  readonly volAmbient: number;
  readonly alertVoice: 'voice' | 'gong' | 'off';
  readonly audibleStall: boolean;
  readonly audioInBackground: boolean;
  // keys
  readonly keyScheme: 'grid' | 'wasd';
  // accessibility
  readonly teamColors: TeamColorMode;
  readonly statePatterns: boolean;
  readonly iconOutline: boolean;
  readonly uiScale: UiScaleSetting;
  readonly reducedMotion: MotionSetting;
  readonly alertText: boolean;
  // game & language
  readonly locale: 'de' | 'en';
  readonly edgePan: boolean;
  readonly tooltips: 'short' | 'full' | 'off';
  readonly pauseInBackground: boolean;
  readonly autoSaveReplays: boolean;
}

export type SettingKey = keyof SettingsValues;

export const DEFAULT_SETTINGS: SettingsValues = {
  preset: 'medium',
  renderScale: 1,
  shadowCascades: 0,
  splatLayers: 4,
  particleCap: 16000,
  bloom: true,
  antialias: 'fxaa',
  frameCap: 'monitor',
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
  alertText: true,
  locale: 'de',
  edgePan: true,
  tooltips: 'full',
  pauseInBackground: true,
  autoSaveReplays: true,
};

/** Keys whose value differs from the defaults (changed values get an ember dot). */
export function changedSettings(values: SettingsValues, defaults: SettingsValues = DEFAULT_SETTINGS): readonly SettingKey[] {
  return (Object.keys(defaults) as SettingKey[]).filter((k) => values[k] !== defaults[k]);
}

export interface SettingsSection {
  readonly tab: Signal<SettingsTab>;
  readonly gpuName: Signal<string>;
  readonly detectState: Signal<'idle'|'running'|'done'>;
  /** The active runtime can play the sound sample (a running game session). */
  readonly previewAvailable: Signal<boolean>;
  readonly values: Signal<SettingsValues>;
  readonly dirty: Signal<readonly string[]>;
}

export function createSettingsSection(): SettingsSection {
  return {
    tab: signal<SettingsTab>('graphics'),
    gpuName: signal('Demo GPU'),
    detectState: signal<'idle'|'running'|'done'>('idle'),
    previewAvailable: signal(true),
    values: signal<SettingsValues>(DEFAULT_SETTINGS),
    dirty: signal<readonly string[]>([]),
  };
}

export const SETTING_RANGES: Readonly<Partial<Record<SettingKey, readonly [number,number,number]>>> = {
  // Only values the game runtime applies are offered (no MSAA, ≤ 2 shadow cascades, 4/8 splat layers).
  renderScale: [.5,1.5,.05], shadowCascades:[0,2,1], particleCap:[1000,64000,1000], volMaster:[0,100,1],volSfx:[0,100,1],volVoice:[0,100,1],volUi:[0,100,1],volMusic:[0,100,1],volAmbient:[0,100,1],
};
export const SETTING_CHOICES: Readonly<Partial<Record<SettingKey, readonly (string|number)[]>>> = {
  preset:['low','medium','high','ultra','custom'],splatLayers:[4,8],antialias:['off','fxaa'],frameCap:[30,60,120,'monitor'],alertVoice:['voice','gong','off'],keyScheme:['grid','wasd'],teamColors:['house','relation','cvd'],uiScale:['auto',.8,.9,1,1.1,1.25,1.5],reducedMotion:['system','on','off'],locale:['de','en'],tooltips:['full','off'],
};
/** Reject invalid values at the boundary; callers retain the previous settings on failure. */
export function validateSettings(values: SettingsValues): readonly SettingKey[] {
  return (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter((key)=>{
    const value=values[key], range=SETTING_RANGES[key], choices=SETTING_CHOICES[key];
    // Render presets can use continuous factors such as Low's 0.66; the slider step is not a domain restriction.
    if(range)return typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1]||(key!=='renderScale'&&Math.abs((value-range[0])/range[2]-Math.round((value-range[0])/range[2]))>1e-6);
    if(choices)return !choices.includes(value as string|number);
    return typeof value!=='boolean';
  });
}
export function applySettingsPreset(values: SettingsValues, preset: GraphicsPreset): SettingsValues {
  if(preset==='custom')return {...values,preset};
  const options={low:[.75,0,2,4000,false],medium:[1,0,4,16000,true],high:[1,2,4,32000,true],ultra:[1.25,3,8,64000,true]} as const;
  const [renderScale,shadowCascades,splatLayers,particleCap,bloom]=options[preset];
  return {...values,preset,renderScale,shadowCascades,splatLayers,particleCap,bloom};
}
