import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { TeamColorMode } from './teams.ts';

export type { TeamColorMode } from './teams.ts';

/** Skirmish setup (ui.md §5.15; A3, A4, A6, A10, A11, A12, U7, M8). */

export interface SkirmishResource {
  /** Position as fraction of the map (0..1, y grows southwards). */
  readonly x: number;
  readonly y: number;
  readonly kind: 'mass' | 'hydro';
}

/** Procedural preview of the placeholder terrain (the real game passes its own preview later). */
export interface MapPreviewSpec {
  readonly seed: number;
  /** Two lakes and a land bridge (Setons-like layout). */
  readonly water: boolean;
}

export interface SkirmishMap {
  readonly id: string;
  /** Map name (proper noun, not translated). */
  readonly name: string;
  readonly sizeWu: number;
  readonly starts: number;
  readonly massSpots: number;
  readonly hydroSpots: number;
  /** Not selectable yet (e.g. third 1v1 layout in progress, M8). */
  readonly available: boolean;
  /** Short note for unavailable maps: i18n key or literal text (shown via tDynamic). */
  readonly note?: string | undefined;
  /** Description: i18n key or literal text (tDynamic falls back to the string itself). */
  readonly description: string;
  /** Start positions as fractions of the map (0..1). */
  readonly startPositions: readonly (readonly [number, number])[];
  readonly resources: readonly SkirmishResource[];
  readonly preview: MapPreviewSpec;
}

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'normal', 'hard'];
export type SlotController = 'human' | 'ai';

export interface SlotAi {
  readonly difficulty: AiDifficulty;
  readonly aix: boolean;
  /** AIx multiplier 1.0–2.0 in 0.1 steps (ai.md §6, A11). */
  readonly aixFactor: number;
}

export interface SkirmishSlot {
  /** Slot number (1-based, shown in the lobby). */
  readonly index: number;
  /** House name without the word "Haus" (proper noun). */
  readonly name: string;
  readonly controller: SlotController;
  readonly faction: 'varkan';
  /** House colour token (e.g. "team-blau", see HOUSE_COLORS). */
  readonly color: string;
  readonly team: number;
  /** Start position index on the map (0-based; shown 1-based). */
  readonly start: number;
  readonly ai: SlotAi | null;
}

export type VictoryCondition = 'assassination' | 'supremacy' | 'annihilation';
export const VICTORY_CONDITIONS: readonly VictoryCondition[] = ['assassination', 'supremacy', 'annihilation'];
export type FogMode = 'explore' | 'revealed';
export const FOG_MODES: readonly FogMode[] = ['explore', 'revealed'];

export const UNIT_CAPS: readonly number[] = [250, 500, 750, 1000];
export const START_SPEEDS: readonly number[] = [0.5, 1, 1.5, 2];
export const SKIRMISH_TEAMS: readonly number[] = [1, 2];
export const AIX_MIN = 1;
export const AIX_MAX = 2;
export const AIX_STEP = 0.1;
/** Seeds are unsigned 31-bit integers (fits the sim's seed field). */
export const SEED_MAX = 0x7fff_ffff;

export interface SkirmishRules {
  readonly victory: VictoryCondition;
  readonly unitCap: number;
  readonly startSpeed: number;
  readonly fog: FogMode;
  readonly teamColors: TeamColorMode;
  readonly seed: number;
}

/** Map/blueprint check done by the game (content hash, simId). */
export interface SkirmishValidation {
  readonly state: 'checking' | 'ok' | 'error';
  readonly simId: string;
  /** Problem (i18n key or literal text) when state is "error". */
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
  /** External map/blueprint check (Prüfstatus). */
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

// ---------- pure helpers ----------

/** Current configuration of the section (what "Gefecht starten" sends). */
export function skirmishConfig(s: SkirmishSection): SkirmishConfig {
  return { mapId: s.selectedMap.value, slots: s.slots.value, rules: s.rules.value };
}

/** Map edge in km (1.024 WU ≈ 20 km, ui.md/faction scale). */
export function mapKm(sizeWu: number): number {
  return Math.round((sizeWu * 20) / 1024);
}

export type Compass = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest' | 'center';

/** Compass region of a map position (y grows southwards). */
export function compassOf(x: number, y: number): Compass {
  const dx = x - 0.5;
  const dy = 0.5 - y;
  if (Math.hypot(dx, dy) < 0.12) return 'center';
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const names: readonly Compass[] = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return names[Math.round(deg / 45) % 8] as Compass;
}

/** Default 1v1 starts on a map: first and the opposite position (Setons 1 ↔ 5). */
export function defaultStarts(map: Pick<SkirmishMap, 'starts'>): readonly [number, number] {
  return [0, Math.max(1, Math.floor(map.starts / 2)) % Math.max(1, map.starts)];
}

/** Rounds an AIx factor to the 0.1 grid inside 1.0–2.0. */
export function clampAix(v: number): number {
  if (!Number.isFinite(v)) return AIX_MIN;
  return Math.min(AIX_MAX, Math.max(AIX_MIN, Math.round(v * 10) / 10));
}

/**
 * Start swap by click on the preview (ui.md §5.15 "Klick tauscht Start"): a free start moves the active
 * slot there; a start held by another slot swaps both slots' starts. Returns the same array when nothing
 * changes.
 */
export function swapStart(slots: readonly SkirmishSlot[], start: number, activeSlot = 0): readonly SkirmishSlot[] {
  const active = slots[activeSlot];
  if (!active || active.start === start) return slots;
  const holder = slots.findIndex((s) => s.start === start);
  return slots.map((s, i) => {
    if (i === activeSlot) return { ...s, start };
    if (i === holder) return { ...s, start: active.start };
    return s;
  });
}

/** Keeps starts valid when the map changes (out-of-range or duplicate starts fall back to the defaults). */
export function slotsForMap(slots: readonly SkirmishSlot[], map: Pick<SkirmishMap, 'starts'>): readonly SkirmishSlot[] {
  const valid = slots.every((s) => s.start >= 0 && s.start < map.starts) && new Set(slots.map((s) => s.start)).size === slots.length;
  if (valid) return slots;
  const defs = defaultStarts(map);
  return slots.map((s, i) => ({ ...s, start: i < 2 ? defs[i as 0 | 1] : Math.min(map.starts - 1, i) }));
}

export type SkirmishProblemCode =
  | 'mapMissing'
  | 'mapUnavailable'
  | 'noHuman'
  | 'sameColor'
  | 'sameStart'
  | 'startOutOfRange'
  | 'sameTeam'
  | 'aixRange'
  | 'unitCap'
  | 'seed';

export interface SkirmishProblem {
  readonly code: SkirmishProblemCode;
  /** Slot positions (0-based array indices) involved, for marking rows. */
  readonly slots: readonly number[];
}

/** Lobby validation (pure). An empty list means the configuration can start. */
export function validateSkirmish(config: SkirmishConfig, maps: readonly SkirmishMap[]): readonly SkirmishProblem[] {
  const out: SkirmishProblem[] = [];
  const map = maps.find((m) => m.id === config.mapId);
  if (!map) out.push({ code: 'mapMissing', slots: [] });
  else if (!map.available) out.push({ code: 'mapUnavailable', slots: [] });
  const { slots } = config;
  if (!slots.some((s) => s.controller === 'human')) out.push({ code: 'noHuman', slots: [] });
  const pairs = (same: (a: SkirmishSlot, b: SkirmishSlot) => boolean): number[] => {
    const hit = new Set<number>();
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (same(slots[i] as SkirmishSlot, slots[j] as SkirmishSlot)) {
          hit.add(i);
          hit.add(j);
        }
      }
    }
    return [...hit].sort((a, b) => a - b);
  };
  const sameColor = pairs((a, b) => a.color === b.color);
  if (sameColor.length > 0 && config.rules.teamColors === 'house') out.push({ code: 'sameColor', slots: sameColor });
  const sameStart = pairs((a, b) => a.start === b.start);
  if (sameStart.length > 0) out.push({ code: 'sameStart', slots: sameStart });
  if (map) {
    const outOfRange = slots.flatMap((s, i) => (s.start < 0 || s.start >= map.starts ? [i] : []));
    if (outOfRange.length > 0) out.push({ code: 'startOutOfRange', slots: outOfRange });
  }
  if (slots.length >= 2 && new Set(slots.map((s) => s.team)).size === 1) out.push({ code: 'sameTeam', slots: slots.map((_, i) => i) });
  const badAix = slots.flatMap((s, i) =>
    s.ai !== null && (s.ai.aixFactor < AIX_MIN || s.ai.aixFactor > AIX_MAX || clampAix(s.ai.aixFactor) !== s.ai.aixFactor) ? [i] : [],
  );
  if (badAix.length > 0) out.push({ code: 'aixRange', slots: badAix });
  if (!UNIT_CAPS.includes(config.rules.unitCap)) out.push({ code: 'unitCap', slots: [] });
  if (!Number.isInteger(config.rules.seed) || config.rules.seed < 0 || config.rules.seed > SEED_MAX) out.push({ code: 'seed', slots: [] });
  return out;
}

/** Start button state: local problems block, and the external check must be ok. */
export function canStartSkirmish(problems: readonly SkirmishProblem[], check: SkirmishValidation): boolean {
  return problems.length === 0 && check.state === 'ok';
}

/** Parses the seed field; null for anything that is not an unsigned integer ≤ SEED_MAX. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= SEED_MAX ? n : null;
}

/** Applies a lobby patch (map change keeps the starts valid). */
export function patchSkirmish(config: SkirmishConfig, patch: Partial<SkirmishConfig>, maps: readonly SkirmishMap[]): SkirmishConfig {
  const next: SkirmishConfig = { ...config, ...patch };
  if (patch.mapId !== undefined && patch.mapId !== config.mapId) {
    const map = maps.find((m) => m.id === patch.mapId);
    if (map) return { ...next, slots: slotsForMap(next.slots, map) };
  }
  return next;
}
