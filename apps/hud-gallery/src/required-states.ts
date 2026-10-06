/**
 * Target matrix of the gallery: every component of TRACK-HUD with the states it must show (ui.md §6,
 * §5.x and the menu pages of §5.15). test/coverage.test.ts checks the stories against it:
 *   - a component with at least one story must cover ALL of its states;
 *   - every component below must have stories (strict default since hud-p7-final; FAF_HUD_REQUIRE_ALL=0 relaxes).
 * State names are German as in ui.md; a story matches a state by exact string (Story.state).
 * Not part of this track (no required states): ReplayBar (§5.16), DevConsole/BudgetOverlay (§5.13),
 * Cursor (§7.1) – they stay in packages/client/apps/game.
 */
import type { StoryMeta } from './story.ts';

/** Story file (group) that owns the component's stories. */
export type StoryGroup = 'primitives' | 'data' | 'top' | 'selection' | 'card' | 'minimap' | 'hud' | 'menus';

export interface RequiredComponent {
  readonly component: string;
  readonly group: StoryGroup;
  readonly states: readonly string[];
  /** Where the states come from. */
  readonly ref: string;
}

const PRIMITIVE_STATES = ['Standard', 'Hover', 'Ausgewählt/An', 'Fokus', 'Deaktiviert'] as const;
const TONES = ['neutral', 'ok', 'info', 'warn', 'crit', 'ember'] as const;

export const REQUIRED_STATES: readonly RequiredComponent[] = [
  // --- Primitives (hud-p0, primitives.stories.tsx)
  { component: 'Button', group: 'primitives', states: ['Standard', 'Hover', 'Gedrückt', 'Fokus', 'Deaktiviert'], ref: 'ui.md §6' },
  { component: 'Tab', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Segmented', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Switch', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Check', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Range', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Select', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Input', group: 'primitives', states: PRIMITIVE_STATES, ref: 'ui.md §6' },
  { component: 'Bar', group: 'primitives', states: ['Wert', 'Warnung', 'Kritisch'], ref: 'ui.md §6' },
  { component: 'Badge', group: 'primitives', states: TONES, ref: 'ui.md §6' },
  { component: 'Key', group: 'primitives', states: TONES, ref: 'ui.md §6' },
  { component: 'Vet', group: 'primitives', states: TONES, ref: 'ui.md §6' },

  // --- Data (hud-p1, data.stories.tsx)
  {
    component: 'StrategicIcon',
    group: 'data',
    states: ['normal', 'ghost', 'Maske (Ein-Knoten)', 'Hausfarben', 'Eigen/Feind', 'Farbenblind'],
    ref: 'faction.md §6.5, ui.md §8.2, §9.2',
  },

  // --- Top bar, status, alerts, tooltips (hud-p2, top.stories.tsx)
  { component: 'ResourceMeter', group: 'top', states: ['Normal', 'Überlauf', 'Stall droht', 'Stall'], ref: 'ui.md §6, §5.1' },
  { component: 'FlowDetails', group: 'top', states: ['geschlossen', 'offen', 'Zeile pausiert', 'Engpass'], ref: 'ui.md §6, §5.1' },
  { component: 'MatchStatus', group: 'top', states: ['normal', 'Tempo ≠ 1', 'Cap nah', 'Cap erreicht'], ref: 'ui.md §6, §5.2' },
  {
    component: 'PauseBanner',
    group: 'top',
    states: ['Pause', 'Hintergrund-Pause', 'Tempo', 'Sim-Lag', 'Context-Loss'],
    ref: 'ui.md §6, §5.3',
  },
  {
    component: 'Alert',
    group: 'top',
    states: ['kritisch (neu blitzt)', 'Warnung', 'Info', 'Erfolg', 'veraltet', 'zusammengefasst'],
    ref: 'ui.md §6, §5.11',
  },
  {
    component: 'Tooltip',
    group: 'top',
    states: ['Einheit', 'Gebäude', 'Ressource', 'mit Nachbarschaft', 'ohne Nachbarschaft'],
    ref: 'ui.md §6, §5.12 (Befehl → OrderTooltip, hud-p4)',
  },

  // --- Selection panel, order queue, factory queue (hud-p3, selection.stories.tsx)
  {
    component: 'SelectionPanel',
    group: 'selection',
    states: ['leer', 'einzeln', 'mehrfach', 'Fabrik', 'Kachel-Fokus'],
    ref: 'ui.md §6, §5.5',
  },
  { component: 'OrderQueue', group: 'selection', states: ['laufend', 'gehängt', 'leer'], ref: 'ui.md §6, §5.5' },
  {
    component: 'FactoryQueue',
    group: 'selection',
    states: ['laufend', 'Wiederholen an', 'pausiert', 'leer', 'Mehrfach-Fabrik'],
    ref: 'ui.md §6, §5.7',
  },

  // --- Command card, order bar, strip (hud-p4, card.stories.tsx)
  {
    component: 'CommandCard',
    group: 'card',
    states: ['Bau', 'Produktion', 'Gebäude', 'Befehle', 'leer', 'Tab T1', 'Tab T2', 'Tab T3'],
    ref: 'ui.md §6, §5.6',
  },
  {
    component: 'CardCell',
    group: 'card',
    states: [
      'Standard',
      'Hover',
      'Gedrückt',
      'Aktiv (Platzieren)',
      'Fokus',
      'Queue-Badge',
      'Fortschritt',
      'Tech-Striche',
      'Gesperrt',
      'Deaktiviert',
      'Leer',
      'Gefahr',
    ],
    ref: 'ui.md §6, §5.6',
  },
  { component: 'OrderBar', group: 'card', states: ['sichtbar', 'ausgeblendet'], ref: 'ui.md §6, §5.8' },
  {
    component: 'OrderButton',
    group: 'card',
    states: ['Standard', 'Hover', 'Scharf', 'An', 'Gemischt', 'Zyklus', 'Deaktiviert', 'Fokus', 'Gefahr', 'Countdown'],
    ref: 'ui.md §6, §5.8',
  },
  { component: 'OrderTooltip', group: 'card', states: ['Befehl', 'deaktiviert mit Grund'], ref: 'ui.md §6 Tooltip, §5.12' },
  { component: 'SelectionFilter', group: 'card', states: ['Standard', 'Hover'], ref: 'ui.md §6, §5.9' },
  { component: 'IdleButton', group: 'card', states: ['Standard', 'Hover', 'Idle-Zähler 0', 'Idle-Zähler N'], ref: 'ui.md §6, §5.9' },
  {
    component: 'ControlGroups',
    group: 'card',
    states: ['leer', 'belegt', 'aktiv', 'Rechtsklick speichert'],
    ref: 'ui.md §6, §5.10',
  },

  // --- Minimap and full HUD views (hud-p5, minimap.stories.tsx / hud.stories.tsx)
  {
    component: 'Minimap',
    group: 'minimap',
    states: ['Gelände', 'Taktisch', 'Ressourcen an', 'Ressourcen aus', 'Ping', 'Fog-Stufen', 'Karten-Kennzahlen'],
    ref: 'ui.md §6, §5.4 (Kennzahlen: UI-E2)',
  },
  {
    component: 'Hud',
    group: 'hud',
    states: ['vogt', 'armee', 'fabrik-stall', 'pause-cvd', 'dichtester Fall', '1440', '1440-kompakt', '720'],
    ref: 'ui.md §4, §12 (Screenshot-Liste)',
  },

  // --- Menus (hud-p6, menus.stories.tsx)
  { component: 'MainMenu', group: 'menus', states: ['Standard', 'EN', 'letzte Partie leer'], ref: 'ui.md §5.15' },
  {
    component: 'SkirmishSetup',
    group: 'menus',
    states: ['Standard', 'KI Schwer + AIx', 'Validierungsfehler', 'Farbenblind', '1440'],
    ref: 'ui.md §5.15',
  },
  {
    component: 'Settings',
    group: 'menus',
    states: ['Grafik', 'Audio', 'Tasten', 'Barrierefreiheit', 'Spiel & Sprache', 'geändert', 'Farbenblind-Vorschau', 'Tasten EN'],
    ref: 'ui.md §5.15',
  },
  { component: 'LoadingScreen', group: 'menus', states: ['laufend', 'KI-Worker', 'Fehler'], ref: 'ui.md §5.15' },
  {
    component: 'ScoreScreen',
    group: 'menus',
    states: ['Übersicht', 'Wirtschaft', 'Armee', 'Einheiten', 'Niederlage', 'Minimalform', '1440'],
    ref: 'ui.md §5.15',
  },
  { component: 'GameMenu', group: 'menus', states: ['offen', 'Aufgeben-Bestätigung'], ref: 'ui.md §5.15' },
];

export function requiredOf(component: string): RequiredComponent | undefined {
  return REQUIRED_STATES.find((c) => c.component === component);
}

export interface ComponentCoverage {
  readonly component: string;
  readonly group: StoryGroup | null;
  readonly required: readonly string[];
  readonly covered: readonly string[];
  readonly missing: readonly string[];
  /** Story states that are not in the target list (allowed: extra variants). */
  readonly extra: readonly string[];
  readonly storyCount: number;
}

/** Coverage per component: every required component plus every component that has stories. */
export function computeCoverage(stories: readonly Pick<StoryMeta, 'component' | 'state'>[]): ComponentCoverage[] {
  const names: string[] = REQUIRED_STATES.map((c) => c.component);
  for (const s of stories) if (!names.includes(s.component)) names.push(s.component);
  return names.map((component) => {
    const req = requiredOf(component);
    const own = stories.filter((s) => s.component === component);
    const states: string[] = [];
    for (const s of own) if (!states.includes(s.state)) states.push(s.state);
    const required = req?.states ?? [];
    return {
      component,
      group: req?.group ?? null,
      required,
      covered: required.filter((st) => states.includes(st)),
      missing: required.filter((st) => !states.includes(st)),
      extra: states.filter((st) => !required.includes(st)),
      storyCount: own.length,
    };
  });
}

/**
 * Contract check used by test/coverage.test.ts and the gallery index. Returns human-readable problems:
 * - always: a component with stories misses required states;
 * - requireAll: components without stories, and stories of components that are not in the matrix.
 */
export function coverageProblems(stories: readonly Pick<StoryMeta, 'component' | 'state'>[], requireAll: boolean): string[] {
  const out: string[] = [];
  for (const c of computeCoverage(stories)) {
    if (c.group === null) {
      if (requireAll) out.push(`${c.component}: not in required-states.ts (stories: ${c.storyCount})`);
      continue;
    }
    if (c.storyCount === 0) {
      if (requireAll) out.push(`${c.component} (${c.group}.stories.tsx): no stories`);
      continue;
    }
    if (c.missing.length > 0) out.push(`${c.component} (${c.group}.stories.tsx): missing states ${c.missing.map((s) => `„${s}“`).join(', ')}`);
  }
  return out;
}
