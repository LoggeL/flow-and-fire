/**
 * Selection panel, order chain and factory queue (hud-p3, ui.md §5.5, §5.7). Every story renders the
 * real SelectionPanel in the middle dock column at 1080p (84.75 rem = 1356 px × 220 px); the demo
 * scenarios come from @faf/hud (src/demo/selection.ts) and match hud.html?sel=vogt|army|factory|none.
 */
import { SelectionPanel, applySelectionDemo, setLocale } from '@faf/hud';
import type { SelectionDemoScenario } from '@faf/hud';
import type { JSX } from 'preact';
import { defineStories } from '../story.ts';
import type { Story } from '../story.ts';

/** Middle dock column: 1920 − 2 × 8 (gutter) − 216 (minimap) − 324 (card) − 2 × 4 (gaps) = 1356 px. */
const DOCK_MID_REM = 84.75;
/** At 1440p (scale 1.25): 2560 − 20 × (1 + 13.5 + 20.25 + 0.5) = 1855 px = 92.75 rem. */
const DOCK_MID_1440_REM = 92.75;
const VIEWPORT = { width: 1356 + 48, height: 220 + 48 };
const VIEWPORT_1440 = { width: 1855 + 48, height: 275 + 48 };

function DockColumn({ widthRem }: { readonly widthRem: number }): JSX.Element {
  return (
    <div style={{ width: `${widthRem}rem`, height: 'var(--hud-dock-h)', display: 'grid' }}>
      <SelectionPanel />
    </div>
  );
}

interface StorySpec {
  readonly id: string;
  readonly component: 'SelectionPanel' | 'OrderQueue' | 'FactoryQueue';
  readonly state: string;
  readonly title: string;
  readonly scenario: SelectionDemoScenario;
  readonly nodeBudget?: number;
  readonly tags?: readonly string[];
  readonly en?: boolean;
  readonly wide?: boolean;
}

function story(s: StorySpec): Story {
  return {
    id: s.id,
    component: s.component,
    state: s.state,
    title: s.title,
    layout: 'component',
    viewport: s.wide ? VIEWPORT_1440 : VIEWPORT,
    ...(s.wide ? { scale: 1.25 } : {}),
    ...(s.nodeBudget !== undefined ? { nodeBudget: s.nodeBudget } : {}),
    ...(s.tags !== undefined ? { tags: s.tags } : {}),
    setup: ({ model }) => {
      if (s.en) {
        setLocale('en');
        model.keyboardLayout.value = 'en';
      }
      applySelectionDemo(model, s.scenario);
    },
    render: () => <DockColumn widthRem={s.wide ? DOCK_MID_1440_REM : DOCK_MID_REM} />,
  };
}

export default defineStories([
  // --- SelectionPanel (ui.md §6: leer, einzeln, mehrfach, Fabrik, Kachel-Fokus)
  story({ id: 'selection-panel--leer', component: 'SelectionPanel', state: 'leer', title: 'Auswahl leer: Kurzhilfe', scenario: 'none' }),
  story({
    id: 'selection-panel--einzeln',
    component: 'SelectionPanel',
    state: 'einzeln',
    title: 'Vogt mit Abstich, Vet und Befehlskette (hud.html?sel=vogt)',
    scenario: 'commander',
    tags: ['xbrowser'],
  }),
  story({
    id: 'selection-panel--einzeln-beschaedigt',
    component: 'SelectionPanel',
    state: 'einzeln (beschädigt)',
    title: 'Punze einzeln, 27 % HP (kritisch, schraffiert), Gruppe 2',
    scenario: 'tankDamaged',
  }),
  story({
    id: 'selection-panel--mehrfach',
    component: 'SelectionPanel',
    state: 'mehrfach',
    title: 'Armee: 19 Einheiten, 5 Typen – Kacheln + Einzeleinheiten (hud.html?sel=army)',
    scenario: 'army',
    tags: ['xbrowser'],
  }),
  story({
    id: 'selection-panel--fabrik',
    component: 'SelectionPanel',
    state: 'Fabrik',
    title: 'Landwerk I mit Queue, BP 20 + 15, 3 Helfer (hud.html?sel=factory)',
    scenario: 'factory',
    tags: ['xbrowser'],
  }),
  story({
    id: 'selection-panel--kachel-fokus',
    component: 'SelectionPanel',
    state: 'Kachel-Fokus',
    title: 'Armee, Fokus-Typ Kelle (Tab)',
    scenario: 'armyFocus',
  }),
  story({
    id: 'selection-panel--grenzfall',
    component: 'SelectionPanel',
    state: 'Grenzfall 60 Einheiten / 24 Typen',
    title: 'Grenzfall ui.md §9.2: 60 Einheiten in 24 Typen, feste Slots + „+N“, Knotenbudget 210',
    scenario: 'edge',
    nodeBudget: 210,
  }),
  story({
    id: 'selection-panel--mehrfach-1440',
    component: 'SelectionPanel',
    state: 'mehrfach (1440, 1,25)',
    title: 'Armee bei 1440p, Skalierung 1,25 (breitere Mittelspalte)',
    scenario: 'army',
    wide: true,
  }),
  story({
    id: 'selection-panel--fabrik-en',
    component: 'SelectionPanel',
    state: 'Fabrik (EN)',
    title: 'Landwerk I, englische Texte und Tastenbeschriftung',
    scenario: 'factory',
    en: true,
  }),

  // --- OrderQueue (ui.md §6: laufend, gehängt, leer)
  story({
    id: 'order-queue--laufend',
    component: 'OrderQueue',
    state: 'laufend',
    title: 'Lehrling baut Zapfstelle I (38 %), ein laufender Befehl',
    scenario: 'engineerRunning',
  }),
  story({
    id: 'order-queue--gehaengt',
    component: 'OrderQueue',
    state: 'gehängt',
    title: 'Vogt: laufender Befehl + 4 gehängte (nummeriert)',
    scenario: 'commander',
  }),
  story({
    id: 'order-queue--gehaengt-mehr',
    component: 'OrderQueue',
    state: 'gehängt (+N)',
    title: 'Vogt mit 9 Befehlen: 5 Zeilen + „+4 weitere Befehle“',
    scenario: 'commanderLongChain',
  }),
  story({ id: 'order-queue--leer', component: 'OrderQueue', state: 'leer', title: 'Untätiger Lehrling ohne Befehle', scenario: 'engineerIdle' }),

  // --- FactoryQueue (ui.md §6: laufend, Wiederholen an, pausiert, leer, Mehrfach-Fabrik)
  story({ id: 'factory-queue--laufend', component: 'FactoryQueue', state: 'laufend', title: 'Punze 64 %, noch 3,1 s, 4 Blöcke', scenario: 'factory' }),
  story({
    id: 'factory-queue--wiederholen-an',
    component: 'FactoryQueue',
    state: 'Wiederholen an',
    title: 'Loop: ↻ an jedem Block, Wiederholen aktiv',
    scenario: 'factoryRepeat',
  }),
  story({ id: 'factory-queue--pausiert', component: 'FactoryQueue', state: 'pausiert', title: 'Produktion pausiert (E13), beschädigtes Werk', scenario: 'factoryPaused' }),
  story({ id: 'factory-queue--leer', component: 'FactoryQueue', state: 'leer', title: 'Leerlauf, Queue leer, kein Helfer, kein Rally', scenario: 'factoryEmpty' }),
  story({
    id: 'factory-queue--mehrfach-fabrik',
    component: 'FactoryQueue',
    state: 'Mehrfach-Fabrik',
    title: '3 Fabriken: Summe der Queues, Aufträge reihum',
    scenario: 'factoryMulti',
  }),
  story({
    id: 'factory-queue--mehr-bloecke',
    component: 'FactoryQueue',
    state: 'mehr als 10 Blöcke',
    title: '12 Blöcke: 9 sichtbar + „+3“, Wiederholen an',
    scenario: 'factoryLong',
  }),
]);
