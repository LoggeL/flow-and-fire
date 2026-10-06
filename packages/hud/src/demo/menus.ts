/**
 * Demo/fake data of the menus (hud-p6): maps, houses, loading phases, a victory after 23:41 with 30-s
 * series, a defeat, the minimal end screen and settings (defaults + changed values). Deterministic (seeded
 * PRNG from core.ts, no Math.random); exported through the menu barrels.
 */
import { batch } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import type { LastMatch } from '../model/menus/main.ts';
import { initialPhases } from '../model/menus/loading.ts';
import type { LoadingHouse, LoadingPhase } from '../model/menus/loading.ts';
import { seriesSampleCount } from '../model/menus/score.ts';
import type { ScoreEvent, ScoreRow, ScoreSeries, ScoreTab, ScoreUnitRow, Verdict } from '../model/menus/score.ts';
import { DEFAULT_SETTINGS, applySetting } from '../model/menus/settings.ts';
import type { GraphicsDetect, SettingsTab, SettingsValues } from '../model/menus/settings.ts';
import { DEFAULT_SKIRMISH_RULES } from '../model/menus/skirmish.ts';
import type { SkirmishMap, SkirmishRules, SkirmishSlot, SkirmishValidation } from '../model/menus/skirmish.ts';
import { resourceSpots } from '../menus/shared/terrain.ts';
import { createDemoRng, range } from './core.ts';

// ---------- maps ----------

const SETONS_STARTS: readonly (readonly [number, number])[] = [
  [0.14, 0.86],
  [0.1, 0.62],
  [0.38, 0.9],
  [0.24, 0.7],
  [0.86, 0.14],
  [0.9, 0.38],
  [0.62, 0.1],
  [0.76, 0.3],
];

function demoMap(m: Omit<SkirmishMap, 'resources'> & { readonly spots: number }): SkirmishMap {
  const { spots, ...rest } = m;
  return { ...rest, resources: resourceSpots(m.preview, spots) };
}

/** Lobby maps (fake metadata; previews are procedural placeholder terrain). */
export const DEMO_MAPS: readonly SkirmishMap[] = [
  demoMap({
    id: 'setons',
    name: 'Setons',
    sizeWu: 1024,
    starts: 8,
    massSpots: 108,
    hydroSpots: 8,
    available: true,
    description: 'ui.skirmish.desc.setons',
    startPositions: SETONS_STARTS,
    preview: { seed: 41, water: true },
    spots: 30,
  }),
  demoMap({
    id: 'hollow-ridge',
    name: 'Hollow Ridge',
    sizeWu: 512,
    starts: 2,
    massSpots: 24,
    hydroSpots: 2,
    available: true,
    description: 'ui.skirmish.desc.hollowRidge',
    startPositions: [
      [0.2, 0.8],
      [0.8, 0.2],
    ],
    preview: { seed: 7, water: false },
    spots: 20,
  }),
  demoMap({
    id: 'tessera',
    name: 'Tessera',
    sizeWu: 768,
    starts: 4,
    massSpots: 52,
    hydroSpots: 4,
    available: true,
    description: 'ui.skirmish.desc.tessera',
    startPositions: [
      [0.18, 0.82],
      [0.18, 0.18],
      [0.82, 0.18],
      [0.82, 0.82],
    ],
    preview: { seed: 63, water: false },
    spots: 26,
  }),
  demoMap({
    id: 'braidwater',
    name: 'Braidwater',
    sizeWu: 512,
    starts: 2,
    massSpots: 28,
    hydroSpots: 2,
    available: false,
    note: 'ui.skirmish.mapNote.m8',
    description: 'ui.skirmish.desc.braidwater',
    startPositions: [
      [0.15, 0.85],
      [0.85, 0.15],
    ],
    preview: { seed: 90, water: true },
    spots: 18,
  }),
];

export const DEMO_SIM_ID = '0x7b21e04c';
export const DEMO_BUILD = '3f9a1c2';
export const DEMO_SEED_VALUE = 48213;

export const DEMO_SLOTS: readonly SkirmishSlot[] = [
  { index: 1, name: 'Ambrecht', controller: 'human', faction: 'varkan', color: 'team-blau', team: 1, start: 0, ai: null },
  {
    index: 2,
    name: 'Dorne',
    controller: 'ai',
    faction: 'varkan',
    color: 'team-rot',
    team: 2,
    start: 4,
    ai: { difficulty: 'normal', aix: true, aixFactor: 1.3 },
  },
];

export type SkirmishDemoPreset = 'standard' | 'hardAix' | 'invalid' | 'cvd' | 'checking';

/** Fills the lobby: Setons, Ambrecht (you, start 1) vs. Dorne (AI, start 5). */
export function applySkirmishDemo(model: HudModel, preset: SkirmishDemoPreset = 'standard'): void {
  const s = model.menus.skirmish;
  let slots = DEMO_SLOTS;
  let rules: SkirmishRules = { ...DEFAULT_SKIRMISH_RULES, seed: DEMO_SEED_VALUE };
  let validation: SkirmishValidation = { state: 'ok', simId: DEMO_SIM_ID, message: null };
  if (preset === 'hardAix') {
    slots = slots.map((sl) => (sl.ai ? { ...sl, ai: { difficulty: 'hard' as const, aix: true, aixFactor: 1.5 } } : sl));
    rules = { ...rules, victory: 'supremacy', unitCap: 750 };
  } else if (preset === 'invalid') {
    // Same colour and the same team: both block the start.
    slots = slots.map((sl) => (sl.controller === 'ai' ? { ...sl, color: 'team-blau', team: 1 } : sl));
  } else if (preset === 'cvd') {
    rules = { ...rules, teamColors: 'cvd' };
  } else if (preset === 'checking') {
    validation = { state: 'checking', simId: '', message: null };
  }
  batch(() => {
    s.maps.value = DEMO_MAPS;
    s.selectedMap.value = 'setons';
    s.slots.value = slots;
    s.rules.value = rules;
    s.validation.value = validation;
    if (preset === 'cvd') model.teams.value = 'cvd';
  });
}

// ---------- main menu ----------

export const DEMO_LAST_MATCH: LastMatch = {
  mapName: 'Setons',
  verdict: 'victory',
  durationS: 23 * 60 + 41,
  opponent: 'Dorne',
  opponentAi: 'normal',
  agoS: 2 * 3600 + 11 * 60,
  replayBytes: 118_400,
};

export type MainMenuDemoPreset = 'standard' | 'empty';

export function applyMainMenuDemo(model: HudModel, preset: MainMenuDemoPreset = 'standard'): void {
  const m = model.menus.main;
  batch(() => {
    m.build.value = DEMO_BUILD;
    m.simId.value = DEMO_SIM_ID;
    m.renderer.value = 'WebGL2';
    m.transport.value = 'SAB';
    m.preset.value = 'medium';
    m.replaysAvailable.value = false;
    m.lastMatch.value = preset === 'empty' ? null : DEMO_LAST_MATCH;
  });
}

// ---------- loading ----------

export type LoadingDemoPreset = 'running' | 'aiWorker' | 'error' | 'ready';

const DEMO_LOADING_HOUSES: readonly LoadingHouse[] = [
  { name: 'Ambrecht', controller: 'human', color: 'team-blau', start: 0, ai: null, readiness: 'ready' },
  { name: 'Dorne', controller: 'ai', color: 'team-rot', start: 4, ai: { difficulty: 'normal', aix: true, aixFactor: 1.3 }, readiness: 'waiting' },
];

function phases(done: number, activeProgress: number, error = false): readonly LoadingPhase[] {
  return initialPhases().map((p, i) => {
    if (i < done) return { ...p, progress: 1, state: 'done' as const };
    if (i === done) return { ...p, progress: activeProgress, state: error ? ('error' as const) : ('active' as const) };
    return p;
  });
}

export function applyLoadingDemo(model: HudModel, preset: LoadingDemoPreset = 'running'): void {
  const l = model.menus.loading;
  const setons = DEMO_MAPS[0] as SkirmishMap;
  batch(() => {
    l.mapName.value = setons.name;
    l.mapDescription.value = setons.description;
    l.mapSizeWu.value = setons.sizeWu;
    l.preview.value = setons.preview;
    l.startPositions.value = setons.startPositions;
    l.rules.value = { victory: 'assassination', unitCap: 500, seed: DEMO_SEED_VALUE };
    l.build.value = DEMO_BUILD;
    l.hintIndex.value = 0;
    l.error.value = null;
    if (preset === 'running' || preset === 'error') {
      l.phases.value = phases(1, 0.71, preset === 'error');
      l.currentFile.value = { path: 'tex/terrain_splat_rock.ktx2', source: 'cache' };
      l.bytes.value = { loaded: 38_200_000, total: 52_600_000 };
      l.counts.value = { cache: 212, network: 31 };
      l.houses.value = DEMO_LOADING_HOUSES;
      if (preset === 'error') {
        l.error.value = 'tex/terrain_splat_rock.ktx2: HTTP 404';
        l.houses.value = DEMO_LOADING_HOUSES.map((h) => (h.controller === 'ai' ? { ...h, readiness: 'waiting' as const } : h));
      }
    } else if (preset === 'aiWorker') {
      l.phases.value = phases(4, 0.4);
      l.currentFile.value = null;
      l.bytes.value = { loaded: 52_600_000, total: 52_600_000 };
      l.counts.value = { cache: 243, network: 0 };
      l.houses.value = DEMO_LOADING_HOUSES.map((h) => (h.controller === 'ai' ? { ...h, readiness: 'starting' as const } : h));
      l.hintIndex.value = 2;
    } else {
      l.phases.value = phases(5, 1);
      l.currentFile.value = null;
      l.bytes.value = { loaded: 52_600_000, total: 52_600_000 };
      l.counts.value = { cache: 243, network: 0 };
      l.houses.value = DEMO_LOADING_HOUSES.map((h) => ({ ...h, readiness: 'ready' as const }));
    }
  });
}

// ---------- in-game menu ----------

export function applyGameMenuDemo(model: HudModel, confirm = false): void {
  batch(() => {
    model.menus.gameMenu.open.value = true;
    model.menus.gameMenu.confirmSurrender.value = confirm;
    model.menus.gameMenu.singlePlayer.value = true;
  });
}

// ---------- settings ----------

export const DEMO_DETECT: GraphicsDetect = {
  state: 'done',
  gpu: 'Intel Iris Xe',
  api: 'WebGL2',
  extensions: ['EXT_color_buffer_float'],
  fps: 64,
  recommended: 'medium',
};

/** Defaults with a handful of own changes (ember dots): render scale, music, key scheme, team colours, UI scale. */
export const DEMO_SETTINGS_CHANGED: SettingsValues = [
  ['renderScale', 0.9],
  ['volMusic', 25],
  ['keyScheme', 'wasd'],
  ['teamColors', 'cvd'],
  ['uiScale', 1.25],
  ['tooltips', 'short'],
].reduce<SettingsValues>((v, [k, value]) => applySetting(v, k as keyof SettingsValues, value), DEFAULT_SETTINGS);

export function applySettingsDemo(model: HudModel, tab: SettingsTab = 'graphics', changed = false): void {
  const s = model.menus.settings;
  const values = changed ? DEMO_SETTINGS_CHANGED : DEFAULT_SETTINGS;
  batch(() => {
    s.tab.value = tab;
    s.values.value = values;
    s.defaults.value = DEFAULT_SETTINGS;
    s.detect.value = DEMO_DETECT;
    s.autoScale.value = 1;
    model.teams.value = values.teamColors;
    model.reducedMotion.value = values.reducedMotion;
  });
}

// ---------- score ----------

export const DEMO_DURATION_S = 23 * 60 + 41;
export const DEMO_STEP_S = 30;

/** Rising curve with noise and optional dips (deterministic). */
function curve(seed: number, count: number, peak: number, shape: (f: number, i: number) => number): number[] {
  const rng = createDemoRng(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const v = shape(f, i) * peak * range(rng, 0.93, 1.07);
    out.push(Math.max(0, Math.round(v * 10) / 10));
  }
  return out;
}

function demoSeries(verdict: Verdict): readonly ScoreSeries[] {
  const n = seriesSampleCount(DEMO_DURATION_S, DEMO_STEP_S);
  const win = verdict === 'victory';
  const eco = (f: number): number => 0.05 + 0.95 * Math.min(1, f * 1.25);
  const collapse = (f: number): number => (f > 0.78 ? Math.max(0.05, 1 - (f - 0.78) * 4) : 1);
  const armyUp = (f: number): number => Math.min(1, f * 1.1) * (0.85 + 0.15 * Math.sin(f * 9));
  const massSelf = curve(11, n, 58, (f) => eco(f) * (win ? 1 : collapse(f)));
  const massEnemy = curve(12, n, 52, (f) => eco(f) * (win ? collapse(f) : 1.1));
  const energySelf = curve(13, n, 410, (f) => eco(f));
  const energyEnemy = curve(14, n, 385, (f) => eco(f) * (win ? collapse(f) : 1.05));
  const armySelf = curve(15, n, 4200, (f) => armyUp(f) * (win ? 1 : collapse(f)));
  const armyEnemy = curve(16, n, 3900, (f) => armyUp(f) * (win ? collapse(f) : 1.08));
  const aliveSelf = curve(17, n, 92, (f) => armyUp(f) * (win ? 1 : collapse(f))).map(Math.round);
  const aliveEnemy = curve(18, n, 88, (f) => armyUp(f) * (win ? collapse(f) : 1.1)).map(Math.round);
  return [
    { id: 'massIncome', stepS: DEMO_STEP_S, self: massSelf, enemy: massEnemy },
    { id: 'energyIncome', stepS: DEMO_STEP_S, self: energySelf, enemy: energyEnemy },
    { id: 'armyValue', stepS: DEMO_STEP_S, self: armySelf, enemy: armyEnemy },
    { id: 'unitsAlive', stepS: DEMO_STEP_S, self: aliveSelf, enemy: aliveEnemy },
  ];
}

const DEMO_ROWS_VICTORY: readonly ScoreRow[] = [
  { id: 'massProduced', group: 'economy', self: 18_412, enemy: 16_905 },
  { id: 'energyProduced', group: 'economy', self: 412_300, enemy: 388_100 },
  { id: 'massReclaimed', group: 'economy', self: 2_140, enemy: 860 },
  { id: 'stallTime', group: 'economy', self: 48, enemy: 132, isTime: true, lowerIsBetter: true },
  { id: 'mexPeak', group: 'economy', self: 14, enemy: 11 },
  { id: 'unitsBuilt', group: 'army', self: 162, enemy: 171 },
  { id: 'unitsLost', group: 'army', self: 88, enemy: 131, lowerIsBetter: true },
  { id: 'enemiesKilled', group: 'army', self: 131, enemy: 88 },
  { id: 'massValueKilled', group: 'army', self: 9_820, enemy: 6_410 },
  { id: 'vetPeak', group: 'army', self: 3, enemy: 2 },
];

/** The defeat mirrors the victory from the other side. */
const DEMO_ROWS_DEFEAT: readonly ScoreRow[] = DEMO_ROWS_VICTORY.map((r) => ({ ...r, self: r.enemy, enemy: r.self }));

const DEMO_EVENTS_VICTORY: readonly ScoreEvent[] = [
  { timeS: 4 * 60 + 12, kind: 'firstFactory', side: 'both' },
  { timeS: 9 * 60 + 40, kind: 'techUp', side: 'self', typeId: 'core:str_t2_fac_land' },
  { timeS: 12 * 60 + 5, kind: 'techUp', side: 'enemy', typeId: 'core:str_t2_fac_land' },
  { timeS: 18 * 60 + 31, kind: 'objective', side: 'self', note: 'ui.score.objective.bridgeHeld' },
  { timeS: DEMO_DURATION_S, kind: 'commanderLost', side: 'enemy' },
];

const DEMO_UNITS: readonly ScoreUnitRow[] = [
  { typeId: 'core:lnd_t1_tank', self: { built: 64, lost: 31, kills: 48 }, enemy: { built: 71, lost: 52, kills: 29 } },
  { typeId: 'core:lnd_t1_arty', self: { built: 28, lost: 12, kills: 31 }, enemy: { built: 22, lost: 19, kills: 14 } },
  { typeId: 'core:str_t1_pd', self: { built: 6, lost: 2, kills: 22 }, enemy: { built: 4, lost: 4, kills: 11 } },
  { typeId: 'core:cmd_commander', self: { built: 0, lost: 0, kills: 17 }, enemy: { built: 0, lost: 1, kills: 9 } },
  { typeId: 'core:lnd_t1_aa', self: { built: 12, lost: 7, kills: 6 }, enemy: { built: 16, lost: 11, kills: 8 } },
  { typeId: 'core:lnd_t1_engineer', self: { built: 24, lost: 9, kills: 0 }, enemy: { built: 31, lost: 18, kills: 0 } },
  { typeId: 'core:lnd_t2_tank', self: { built: 18, lost: 10, kills: 7 }, enemy: { built: 14, lost: 14, kills: 12 } },
  { typeId: 'core:air_t1_fighter', self: { built: 10, lost: 17, kills: 0 }, enemy: { built: 13, lost: 12, kills: 5 } },
];

export type ScoreDemoPreset = 'victory' | 'defeat' | 'minimal';

export function applyScoreDemo(model: HudModel, preset: ScoreDemoPreset = 'victory', tab: ScoreTab = 'overview'): void {
  const s = model.menus.score;
  const verdict: Verdict = preset === 'defeat' ? 'defeat' : 'victory';
  const win = verdict === 'victory';
  batch(() => {
    s.verdict.value = verdict;
    s.minimal.value = preset === 'minimal';
    s.durationS.value = DEMO_DURATION_S;
    s.tab.value = tab;
    s.mapName.value = 'Setons';
    s.victory.value = 'assassination';
    s.houses.value = {
      self: { name: 'Ambrecht', color: 'team-blau', controller: 'human', ai: null },
      enemy: { name: 'Dorne', color: 'team-rot', controller: 'ai', ai: 'normal' },
    };
    s.points.value = win ? 18_240 : 11_930;
    s.efficiency.value = win ? 0.91 : 0.74;
    s.replayBytes.value = 118_400;
    s.replaySaved.value = false;
    s.rows.value = win ? DEMO_ROWS_VICTORY : DEMO_ROWS_DEFEAT;
    s.series.value = demoSeries(verdict);
    s.events.value = win
      ? DEMO_EVENTS_VICTORY
      : DEMO_EVENTS_VICTORY.map((e) =>
          e.kind === 'commanderLost' ? { ...e, side: 'self' as const } : e.kind === 'objective' ? { ...e, side: 'enemy' as const } : e,
        );
    s.units.value = win ? DEMO_UNITS : DEMO_UNITS.map((u) => ({ ...u, self: u.enemy, enemy: u.self }));
    s.bestUnits.value = (win ? DEMO_UNITS : DEMO_UNITS.map((u) => ({ ...u, self: u.enemy })))
      .map((u) => ({ typeId: u.typeId, kills: u.self.kills }))
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 4);
  });
}
