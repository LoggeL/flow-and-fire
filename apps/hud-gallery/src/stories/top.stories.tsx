/**
 * Top HUD zone stories (hud-p2): ResourceMeter, FlowDetails, MatchStatus, PauseBanner, Alert and Tooltip in all
 * states of ui.md §6 (names from required-states.ts), plus a fullscreen view of the whole zone to compare
 * with the mockup (hud.html?sel=factory&stall=1&flow=1). All data comes from the demo presets of @faf/hud.
 */
import {
  Alert,
  AlertFeed,
  DEMO_ALERT_EVENTS,
  DEMO_TIME_S,
  DEMO_TOOLTIPS,
  MatchStatus,
  PauseBanner,
  ResourceBar,
  ResourceTooltip,
  UnitTooltip,
  applyAlertEvents,
  applyAlertPreset,
  applyBannerPreset,
  applyEcoPreset,
  applyFlowDetailsPreset,
  applyMatchPreset,
  applyResourcePreset,
  demoAlertEvent,
  mergeAlert,
  t,
} from '@faf/hud';
import type { AlertItem, AlertPreset, AlertType, BannerPreset, EcoPresetName, FlowDetailsPreset, MatchPreset } from '@faf/hud';
import type { ComponentChildren, JSX } from 'preact';
import { defineStories } from '../story.ts';
import type { Story, StoryContext } from '../story.ts';

// ---------- gallery layout helpers (chrome, not product UI) ----------

const row: JSX.CSSProperties = { display: 'flex', gap: '1.5rem', alignItems: 'flex-start', padding: '1.5rem' };
const column: JSX.CSSProperties = { display: 'grid', gap: '0.25rem', padding: '1.5rem', justifyItems: 'start', alignContent: 'start' };

function Row({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <div style={row}>{children}</div>;
}

// ---------- ResourceMeter (ui.md §5.1) ----------

function meterStory(id: string, state: string, preset: EcoPresetName, title: string, tags?: readonly string[]): Story {
  return {
    id: `resource-meter--${id}`,
    component: 'ResourceMeter',
    state,
    title,
    layout: 'component',
    viewport: { width: 720, height: 200 },
    ...(tags ? { tags } : {}),
    setup: ({ model }) => applyEcoPreset(model, preset),
    render: () => <ResourceBar />,
  };
}

// ---------- FlowDetails (ui.md §5.1) ----------

function flowStory(id: string, state: string, preset: FlowDetailsPreset, title: string): Story {
  return {
    id: `flow-details--${id}`,
    component: 'FlowDetails',
    state,
    title,
    layout: 'component',
    viewport: { width: 720, height: 360 },
    setup: ({ model }) => applyFlowDetailsPreset(model, preset),
    render: () => <ResourceBar />,
  };
}

// ---------- MatchStatus (ui.md §5.2) ----------

function statusStory(id: string, state: string, preset: MatchPreset, title: string): Story {
  return {
    id: `match-status--${id}`,
    component: 'MatchStatus',
    state,
    title,
    layout: 'component',
    viewport: { width: 640, height: 120 },
    setup: ({ model }) => applyMatchPreset(model, preset),
    render: () => <MatchStatus />,
  };
}

// ---------- PauseBanner (ui.md §5.3) ----------

function bannerStory(id: string, state: string, preset: BannerPreset, title: string): Story {
  return {
    id: `pause-banner--${id}`,
    component: 'PauseBanner',
    state,
    title,
    layout: 'component',
    viewport: { width: 720, height: 140 },
    setup: ({ model }) => applyBannerPreset(model, preset),
    render: () => <PauseBanner />,
  };
}

// ---------- Alert (ui.md §5.11) ----------

function alertStory(id: string, state: string, preset: AlertPreset, title: string, extra: Partial<Story> = {}): Story {
  return {
    id: `alert--${id}`,
    component: 'Alert',
    state,
    title,
    layout: 'component',
    viewport: { width: 640, height: 280 },
    setup: ({ model }) => applyAlertPreset(model, preset),
    render: () => <AlertFeed />,
    ...extra,
  };
}

/** One alert item per type (for the "alle Typen" sheet, not a feed). */
function allAlertItems(): readonly AlertItem[] {
  const types = Object.keys(DEMO_ALERT_EVENTS) as AlertType[];
  return types.map((type, i) => mergeAlert([], demoAlertEvent(type, DEMO_TIME_S - i), i + 1).items[0] as AlertItem);
}

// ---------- Tooltip (ui.md §5.12) ----------

function tooltipStory(id: string, state: string, title: string, setup: (ctx: StoryContext) => void, render: () => ComponentChildren): Story {
  return {
    id: `tooltip--${id}`,
    component: 'Tooltip',
    state,
    title,
    layout: 'component',
    viewport: { width: 760, height: 520 },
    setup,
    render: () => <Row>{render()}</Row>,
  };
}

/** Economy where the flow demand of Punch at BP 35 fits (no yellow flow line). */
function richEco({ model }: StoryContext): void {
  applyResourcePreset(model, 'mass', 'overflow');
  applyResourcePreset(model, 'energy', 'normal');
}

function normalEco({ model }: StoryContext): void {
  applyEcoPreset(model, 'normal');
}

// ---------- fullscreen: whole top zone vs. mockup ----------

function TopZone(): JSX.Element {
  return (
    <div data-hud-root="" style={{ position: 'absolute', inset: 0 }}>
      <ResourceBar />
      <PauseBanner />
      <MatchStatus />
      <AlertFeed />
    </div>
  );
}

export default defineStories([
  meterStory('normal', 'Normal', 'normal', 'Mass −3,5 (Speicher reicht), Energy +44,0'),
  meterStory('ueberlauf', 'Überlauf', 'overflow', 'Energy voll und Netto > 0: „Voll · verfällt“', ['xbrowser']),
  meterStory('stall-droht', 'Stall droht', 'stallSoon', 'Mass leer in < 10 s: Netto pulsiert gelb, Badge „Leer in N s“'),
  meterStory('stall', 'Stall', 'stall', 'Beide Ressourcen im Stall: Krit-Rahmen, Rot-Verlauf, Schraffur, Fehlbetrag', ['xbrowser']),
  meterStory('stall-energy', 'Stall (nur Energy)', 'stallEnergy', 'Energy-Stall, Mass normal'),

  flowStory('geschlossen', 'geschlossen', 'closed', 'Leiste ohne Flow-Details'),
  flowStory('offen', 'offen', 'open', 'Flow-Details offen, nur lesend (vor E13)'),
  flowStory('zeile-pausiert', 'Zeile pausiert', 'paused', 'Pausieren aktiv (E13), Upgrade-Zeile pausiert'),
  { ...flowStory('engpass', 'Engpass', 'bottleneck', 'Energy-Stall: alle Verbraucher 72 %, Engpass-Markierung'), tags: ['xbrowser'] },

  statusStory('normal', 'normal', 'normal', 'Timer 11:42, ×1,0, 64 / 500'),
  statusStory('tempo', 'Tempo ≠ 1', 'speed', 'Sim-Tempo ×2,0 in Glut'),
  statusStory('cap-nah', 'Cap nah', 'capNear', '462 / 500 (ab 90 % gelb + Dreieck)'),
  statusStory('cap-erreicht', 'Cap erreicht', 'capReached', '500 / 500 (rot + Achteck)'),
  statusStory('replay', 'Replay mit Punkten', 'replay', 'Punkte beider Häuser (nur im Replay, UI-E3)'),
  statusStory('lange-partie', 'lange Partie', 'long', 'Timer ab 60 min als h:mm:ss'),

  { ...bannerStory('pause', 'Pause', 'pause', 'PAUSE mit „P fortsetzen“'), tags: ['xbrowser'] },
  bannerStory('hintergrund', 'Hintergrund-Pause', 'background', 'Pausiert – Tab war verborgen (S9)'),
  bannerStory('tempo', 'Tempo', 'speed', 'SIM-TEMPO ×2,0'),
  bannerStory('sim-lag', 'Sim-Lag', 'lag', 'Sim hinkt nach · ×0,8 effektiv'),
  bannerStory('context-loss', 'Context-Loss', 'contextLoss', 'Grafik wird wiederhergestellt (P10)'),

  alertStory('kritisch', 'kritisch (neu blitzt)', 'commanderDanger', 'Vogt unter Feuer, blitzt zweimal', { tags: ['xbrowser'] }),
  alertStory('warnung', 'Warnung', 'unitAttacked', 'Einheit angegriffen'),
  alertStory('info', 'Info', 'enemyCommanderSpotted', 'Feind-Vogt gesichtet'),
  alertStory('erfolg', 'Erfolg', 'buildComplete', 'Bau fertig: Zapfstelle I'),
  alertStory('veraltet', 'veraltet', 'stale', 'Älter als 20 s: gedimmt'),
  alertStory('zusammengefasst', 'zusammengefasst', 'merged', 'Einheit angegriffen ×3'),
  alertStory('feed', 'Feed gemischt', 'mixed', '5 Alerts: 3 sichtbar + „2 ältere“'),
  alertStory('energie-stall', 'Energie knapp', 'energyStall', 'Sprung öffnet Flow-Details'),
  {
    id: 'alert--alle-typen',
    component: 'Alert',
    state: 'alle Typen',
    title: 'Alle 10 Alert-Typen mit Stufensymbol',
    layout: 'component',
    viewport: { width: 400, height: 600 },
    setup: ({ model }) => {
      model.match.timeS.value = DEMO_TIME_S;
    },
    render: () => (
      <div style={column}>
        {allAlertItems().map((item, i) => (
          <Alert key={item.id} item={item} newest={i === 0} />
        ))}
      </div>
    ),
  },

  tooltipStory('einheit', 'Einheit', 'Punze im Landwerk (BP 35): Kosten, Flow-Bedarf, DPS/Reichweite/Tempo', richEco, () => (
    <UnitTooltip {...DEMO_TOOLTIPS.punch} />
  )),
  tooltipStory('gebaeude', 'Gebäude', 'Horcher I beim Vogt: Unterhalt statt Tempo, Flow-Bedarf über Netto (gelb)', normalEco, () => (
    <UnitTooltip typeId="core:str_t1_radar" builderBp={10} slot="KeyC" mode="build" />
  )),
  tooltipStory('ressource', 'Ressource', 'Mass normal und Energy im Stall: Quellen, Speicher, Prognose', ({ model }) => applyEcoPreset(model, 'stallEnergy'), () => (
    <>
      <ResourceTooltip resource="mass" />
      <ResourceTooltip resource="energy" />
    </>
  )),
  tooltipStory('mit-nachbarschaft', 'mit Nachbarschaft', 'Glutkessel I beim Vogt mit Grünspan-Kasten', normalEco, () => (
    <UnitTooltip {...DEMO_TOOLTIPS.boiler} />
  )),
  tooltipStory('ohne-nachbarschaft', 'ohne Nachbarschaft', 'Vogt (Info, ohne Kosten)', normalEco, () => <UnitTooltip {...DEMO_TOOLTIPS.reeve} />),
  tooltipStory('gesperrt', 'gesperrt', 'Schirm II beim Vogt: Voraussetzung T2', normalEco, () => <UnitTooltip {...DEMO_TOOLTIPS.canopyLocked} />),
  tooltipStory('deaktiviert', 'deaktiviert', 'Zapfstelle I: deaktiviert mit Grund', normalEco, () => (
    <UnitTooltip {...DEMO_TOOLTIPS.tapDisabled} disabledReason={t('ui.tooltip.reason.upgrading')} />
  )),

  {
    id: 'resource-meter--oberzone',
    component: 'ResourceMeter',
    state: 'Oberzone komplett',
    title: 'Vergleich mit hud.html?sel=factory&stall=1&flow=1: Stall, Flow-Details, Status, Alerts',
    layout: 'fullscreen',
    setup: ({ model }) => {
      applyFlowDetailsPreset(model, 'bottleneck');
      applyEcoPreset(model, 'stall');
      applyMatchPreset(model, 'normal');
      applyAlertEvents(
        model,
        [
          demoAlertEvent('buildComplete', DEMO_TIME_S - 14),
          demoAlertEvent('buildComplete', DEMO_TIME_S - 12),
          demoAlertEvent('enemyCommanderSpotted', DEMO_TIME_S - 51),
          demoAlertEvent('factoryUpgraded', DEMO_TIME_S - 2),
          demoAlertEvent('energyStall', DEMO_TIME_S),
        ],
        DEMO_TIME_S,
      );
    },
    render: () => <TopZone />,
  },
] satisfies readonly Story[]);
