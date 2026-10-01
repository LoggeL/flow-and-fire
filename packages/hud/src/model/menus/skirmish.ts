import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Skirmish setup (ui.md §5.15; A3, A4, A6, A10, A11, A12, U7, M8). */

export interface SkirmishMap {
  readonly id: string;
  readonly name: string;
  readonly sizeWu: number;
  readonly starts: number;
  readonly massSpots: number;
  readonly hydroSpots: number;
  /** Not selectable yet (e.g. third 1v1 layout in progress). */
  readonly available: boolean;
  /** Start positions as fractions of the map (0..1). */
  readonly startPositions: readonly (readonly [number, number])[];
  /** Resource spots as fractions of the map (0..1), from the map file. */
  readonly spotPositions?: readonly { readonly x: number; readonly z: number; readonly kind: 'mass' | 'hydro' }[];
  /** Relief image (data URL) rendered from the actual heightfield; absent = no preview. */
  readonly previewUrl?: string;
}
/** Colour options of a house; the stored value is the option id. */
export const SKIRMISH_COLORS = ['blue', 'red', 'green', 'orange'] as const;

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type SlotController = 'human' | 'ai';

export interface SkirmishSlot {
  readonly index: number;
  readonly name: string;
  readonly controller: SlotController;
  readonly faction: 'varkan';
  /** Colour option id (one of SKIRMISH_COLORS). */
  readonly color: string;
  /** Internal 0-based team; the setup shows it as team + 1. */
  readonly team: number;
  /** Start position index on the map. */
  readonly start: number;
  readonly ai: { readonly difficulty: AiDifficulty; readonly aix: boolean; readonly aixFactor: number } | null;
}

export type VictoryCondition = 'assassination' | 'supremacy' | 'annihilation';
export type FogMode = 'explore' | 'revealed';
export type TeamColorMode = 'house' | 'relation' | 'cvd';

export interface SkirmishRules {
  readonly victory: VictoryCondition;
  readonly unitCap: number;
  readonly startSpeed: number;
  readonly fog: FogMode;
  readonly teamColors: TeamColorMode;
  readonly seed: number;
}

export interface SkirmishValidation {
  readonly state: 'checking' | 'ok' | 'error';
  readonly simId: string;
  /** i18n key of the problem when state is "error". */
  readonly message: string | null;
}

export interface SkirmishConfig {
  readonly mapId: string;
  readonly slots: readonly SkirmishSlot[];
  readonly rules: SkirmishRules;
}

export interface SkirmishSection {
  readonly maps: Signal<readonly SkirmishMap[]>;
  readonly selectedMap: Signal<string>;
  readonly slots: Signal<readonly SkirmishSlot[]>;
  readonly rules: Signal<SkirmishRules>;
  readonly validation: Signal<SkirmishValidation>;
}

export const DEFAULT_SKIRMISH_RULES: SkirmishRules = {
  victory: 'assassination',
  unitCap: 500,
  startSpeed: 1,
  fog: 'explore',
  teamColors: 'house',
  seed: 1,
};

export function createSkirmishSection(): SkirmishSection {
  return {
    maps: signal<readonly SkirmishMap[]>([]),
    selectedMap: signal(''),
    slots: signal<readonly SkirmishSlot[]>([]),
    rules: signal<SkirmishRules>(DEFAULT_SKIRMISH_RULES),
    validation: signal<SkirmishValidation>({ state: 'checking', simId: '', message: null }),
  };
}

export function validateSkirmish(config: SkirmishConfig, maps: readonly SkirmishMap[]): string | null {
  const map=maps.find(m=>m.id===config.mapId && m.available);
  if(!map)return 'ui.skirmish.missingMap';
  if(config.slots.length<2 || new Set(config.slots.map(s=>s.team)).size<2)return 'ui.skirmish.missingSlots';
  if(new Set(config.slots.map(s=>s.color)).size!==config.slots.length)return 'ui.skirmish.duplicateColor';
  if(new Set(config.slots.map(s=>s.start)).size!==config.slots.length || config.slots.some(s=>!Number.isInteger(s.start)||s.start<0 || s.start>=map.starts))return 'ui.skirmish.duplicateStart';
  if(!Number.isInteger(config.rules.unitCap)||!Number.isFinite(config.rules.startSpeed)||!Number.isInteger(config.rules.seed)||config.rules.unitCap<50||config.rules.unitCap>5000||config.rules.startSpeed<.25||config.rules.startSpeed>3||!Number.isFinite(config.rules.unitCap)||config.slots.some(s=>s.ai && (!Number.isFinite(s.ai.aixFactor)||s.ai.aixFactor<1||s.ai.aixFactor>2)))return 'ui.skirmish.badRules';
  return null;
}
export function swapStart(slots: readonly SkirmishSlot[], slotIndex: number, start: number): readonly SkirmishSlot[] {
  const own=slots.find(s=>s.index===slotIndex);if(!own)return slots;
  return slots.map(s=>s.index===slotIndex?{...s,start}:s.start===start?{...s,start:own.start}:s);
}
