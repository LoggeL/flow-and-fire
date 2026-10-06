/**
 * Menu stories (hud-p6): MainMenu, SkirmishSetup, LoadingScreen, GameMenu, Settings and ScoreScreen in all
 * states of required-states.ts, full screen at 1920×1080 (plus 2560×1440 at scale 1.25 where required).
 * The stories are interactive: every command is recorded (command log) and the state-only ones are applied
 * to the model by createMenuController, exactly as the game will do it (tabs, settings, lobby changes,
 * language). Compare with docs/design/ui-mockups/{menu,skirmish,loading,settings,score}.html.
 */
import {
  COMMAND_NAMES,
  GameMenu,
  HudProvider,
  LoadingScreen,
  MainMenu,
  ScoreScreen,
  Settings,
  SkirmishSetup,
  applyGameMenuDemo,
  applyLoadingDemo,
  applyMainMenuDemo,
  applyScoreDemo,
  applySettingsDemo,
  applySkirmishDemo,
  createMenuController,
  setLocale,
} from '@faf/hud';
import type { HudCommands, HudModel, LoadingDemoPreset, ScoreDemoPreset, ScoreTab, SettingsTab, SkirmishDemoPreset } from '@faf/hud';
import type { ComponentChildren, JSX } from 'preact';
import { defineStories } from '../story.ts';
import type { Story, StoryContext } from '../story.ts';

const QHD = { width: 2560, height: 1440 } as const;

const composed = new WeakMap<HudModel, HudCommands>();

/** Recording commands of the story + the reference controller (state-only commands change the model). */
function menuCommands(ctx: StoryContext): HudCommands {
  let c = composed.get(ctx.model);
  if (!c) {
    const ctrl = createMenuController(ctx.model) as unknown as Readonly<Record<string, ((...a: unknown[]) => void) | undefined>>;
    const rec = ctx.commands as unknown as Readonly<Record<string, (...a: unknown[]) => void>>;
    const out: Record<string, (...a: unknown[]) => void> = {};
    for (const name of COMMAND_NAMES) {
      out[name] = (...args: unknown[]) => {
        rec[name]?.(...args);
        ctrl[name]?.(...args);
      };
    }
    c = out as unknown as HudCommands;
    composed.set(ctx.model, c);
  }
  return c;
}

function Interactive({ ctx, children }: { readonly ctx: StoryContext; readonly children: ComponentChildren }): JSX.Element {
  return (
    <HudProvider model={ctx.model} commands={menuCommands(ctx)}>
      {children}
    </HudProvider>
  );
}

function page(
  id: string,
  component: string,
  state: string,
  title: string,
  setup: (ctx: StoryContext) => void,
  body: () => ComponentChildren,
  extra: Partial<Story> = {},
): Story {
  return {
    id,
    component,
    state,
    title,
    layout: 'fullscreen',
    setup,
    render: (ctx) => <Interactive ctx={ctx}>{body()}</Interactive>,
    ...extra,
  };
}

// ---------- MainMenu (menu.html) ----------

const mainMenu = (id: string, state: string, title: string, setup: (ctx: StoryContext) => void, extra: Partial<Story> = {}): Story =>
  page(`main-menu--${id}`, 'MainMenu', state, title, setup, () => <MainMenu />, extra);

// ---------- SkirmishSetup (skirmish.html) ----------

const skirmish = (id: string, state: string, title: string, preset: SkirmishDemoPreset, extra: Partial<Story> = {}): Story =>
  page(`skirmish-setup--${id}`, 'SkirmishSetup', state, title, ({ model }) => applySkirmishDemo(model, preset), () => <SkirmishSetup />, extra);

// ---------- LoadingScreen (loading.html) ----------

const loading = (id: string, state: string, title: string, preset: LoadingDemoPreset): Story =>
  page(`loading-screen--${id}`, 'LoadingScreen', state, title, ({ model }) => applyLoadingDemo(model, preset), () => <LoadingScreen />);

// ---------- GameMenu (not mocked; modal over the running match) ----------

function MatchBackdrop(): JSX.Element {
  // The in-game menu lies over the world; the loading preview stands in for the paused match here.
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <LoadingScreen />
    </div>
  );
}

const gameMenu = (id: string, state: string, title: string, confirm: boolean): Story =>
  page(
    `game-menu--${id}`,
    'GameMenu',
    state,
    title,
    ({ model }) => {
      applyLoadingDemo(model, 'ready');
      applyGameMenuDemo(model, confirm);
    },
    () => (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <MatchBackdrop />
        <GameMenu />
      </div>
    ),
  );

// ---------- Settings (settings.html) ----------

const settings = (id: string, state: string, title: string, tab: SettingsTab, changed = false, extra: Partial<Story> = {}): Story =>
  page(`settings--${id}`, 'Settings', state, title, ({ model }) => applySettingsDemo(model, tab, changed), () => <Settings />, extra);

// ---------- ScoreScreen (score.html) ----------

const score = (id: string, state: string, title: string, preset: ScoreDemoPreset, tab: ScoreTab, extra: Partial<Story> = {}): Story =>
  page(`score-screen--${id}`, 'ScoreScreen', state, title, ({ model }) => applyScoreDemo(model, preset, tab), () => <ScoreScreen />, extra);

export default defineStories([
  mainMenu('standard', 'Standard', 'Hauptmenü (DE, letzte Partie)', ({ model }) => applyMainMenuDemo(model), { tags: ['xbrowser'] }),
  mainMenu('en', 'EN', 'Hauptmenü (EN)', ({ model }) => {
    applyMainMenuDemo(model);
    setLocale('en');
  }),
  mainMenu('empty', 'letzte Partie leer', 'Hauptmenü ohne letzte Partie', ({ model }) => applyMainMenuDemo(model, 'empty')),
  mainMenu('1440', '1440', 'Hauptmenü bei 2560 × 1440 (Skalierung 1,25)', ({ model }) => applyMainMenuDemo(model), { viewport: QHD, scale: 1.25 }),

  skirmish('standard', 'Standard', 'Gefecht einrichten (Setons, KI Normal, AIx ×1,3)', 'standard', { tags: ['xbrowser'] }),
  skirmish('hard-aix', 'KI Schwer + AIx', 'KI Schwer mit AIx ×1,5, Supremacy, Cap 750', 'hardAix'),
  skirmish('invalid', 'Validierungsfehler', 'Gleiche Farbe und gleiches Team sperren den Start', 'invalid'),
  skirmish('cvd', 'Farbenblind', 'Teamfarben farbenblind-sicher (Blau/Rot)', 'cvd'),
  skirmish('1440', '1440', 'Gefecht einrichten bei 2560 × 1440 (Skalierung 1,25)', 'standard', { viewport: QHD, scale: 1.25 }),
  skirmish('hard-aix-1440', '1440 KI Schwer + AIx', 'KI Schwer + AIx bei 2560 × 1440', 'hardAix', { viewport: QHD, scale: 1.25 }),
  skirmish('invalid-1440', '1440 Validierungsfehler', 'Validierungsfehler bei 2560 × 1440', 'invalid', { viewport: QHD, scale: 1.25 }),
  skirmish('cvd-1440', '1440 Farbenblind', 'Teamfarben farbenblind-sicher bei 2560 × 1440', 'cvd', { viewport: QHD, scale: 1.25 }),

  { ...loading('running', 'laufend', 'Laden – Phase 2 (Assets, 71 %)', 'running'), tags: ['xbrowser'] },
  loading('ai-worker', 'KI-Worker', 'Laden – KI-Worker startet', 'aiWorker'),
  loading('error', 'Fehler', 'Laden fehlgeschlagen (HTTP 404)', 'error'),

  { ...gameMenu('open', 'offen', 'Esc-Menü offen (Einzelspieler, pausiert)', false), tags: ['xbrowser'] },
  gameMenu('confirm', 'Aufgeben-Bestätigung', 'Esc-Menü – Aufgeben bestätigen', true),

  settings('graphics', 'Grafik', 'Einstellungen – Grafik', 'graphics', false, { tags: ['xbrowser'] }),
  settings('audio', 'Audio', 'Einstellungen – Audio', 'audio'),
  settings('keys', 'Tasten', 'Einstellungen – Tasten (DE-Beschriftung)', 'keys'),
  settings('access', 'Barrierefreiheit', 'Einstellungen – Barrierefreiheit (Hausfarben)', 'access'),
  settings('game', 'Spiel & Sprache', 'Einstellungen – Spiel & Sprache', 'game'),
  settings('changed', 'geändert', 'Einstellungen – geänderte Werte (Glutpunkt, Preset „Eigen“)', 'graphics', true),
  settings('cvd', 'Farbenblind-Vorschau', 'Einstellungen – Farbenblind-Vorschau', 'access', true),
  settings('keys-1440', '1440 Tasten', 'Einstellungen – Tasten bei 2560 × 1440', 'keys', false, { viewport: QHD, scale: 1.25 }),
  {
    ...settings('keys-en', 'Tasten EN', 'Settings – keys (EN layout, WASD)', 'keys', true),
    setup: ({ model }) => {
      applySettingsDemo(model, 'keys', true);
      model.keyboardLayout.value = 'en';
      setLocale('en');
    },
  },

  score('overview', 'Übersicht', 'Auswertung – Sieg nach 23:41, Übersicht', 'victory', 'overview', { tags: ['xbrowser'] }),
  score('economy', 'Wirtschaft', 'Auswertung – Wirtschaft', 'victory', 'economy'),
  score('army', 'Armee', 'Auswertung – Armee', 'victory', 'army'),
  score('units', 'Einheiten', 'Auswertung – Einheiten', 'victory', 'units'),
  score('defeat', 'Niederlage', 'Auswertung – Lot gebrochen', 'defeat', 'overview'),
  score('minimal', 'Minimalform', 'Endbildschirm Minimalform (A4)', 'minimal', 'overview'),
  score('1440', '1440', 'Auswertung bei 2560 × 1440 (Skalierung 1,25)', 'victory', 'overview', { viewport: QHD, scale: 1.25 }),
  score('economy-1440', '1440 Wirtschaft', 'Auswertung – Wirtschaft bei 2560 × 1440', 'victory', 'economy', { viewport: QHD, scale: 1.25 }),
  score('army-1440', '1440 Armee', 'Auswertung – Armee bei 2560 × 1440', 'victory', 'army', { viewport: QHD, scale: 1.25 }),
  score('units-1440', '1440 Einheiten', 'Auswertung – Einheiten bei 2560 × 1440', 'victory', 'units', { viewport: QHD, scale: 1.25 }),
]);
