/**
 * Full HUD views (hud-p5-root, ui.md §4, §12): the mockup screenshots hud-1080-*, hud-1440-* and hud-720-*
 * as live stories – every story runs a HudScheduler fed by the seeded SnapshotGenerator at 10 Hz (paused
 * scenarios push only events). Plus the perf case (`hud--perf-500`, also reachable as #/perf?units=500&…,
 * see src/perf) that the browser benchmark drives.
 */
import { Hud, computeUiScale, createHudScenario, startHudDemo } from '@faf/hud';
import type { HudScenarioId } from '@faf/hud';
import { PERF_STORY_ID, PerfHud, installPerfRoute, parsePerfParams } from '../perf/index.ts';
import { defineStories } from '../story.ts';
import type { Story, StoryContext } from '../story.ts';

// `#/perf?…` → the perf story (must run before the router reads the hash; no-op in Node).
installPerfRoute();

const R1080 = { width: 1920, height: 1080 };
const R1440 = { width: 2560, height: 1440 };
const R720 = { width: 1280, height: 720 };

interface HudStoryOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly scale?: number;
  readonly tags?: readonly string[];
}

function runScenario(ctx: StoryContext, id: HudScenarioId): () => void {
  const driver = startHudDemo(ctx.model, createHudScenario(id));
  return () => driver.stop();
}

function hudStory(slug: string, state: string, title: string, scenario: HudScenarioId, opts: HudStoryOptions = {}): Story {
  const vp = opts.viewport ?? R1080;
  return {
    id: `hud--${slug}`,
    component: 'Hud',
    state,
    title,
    layout: 'fullscreen',
    viewport: { width: vp.width, height: vp.height },
    scale: opts.scale ?? 1,
    ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
    setup: (ctx) => runScenario(ctx, scenario),
    render: () => <Hud mac={false} hotkeys />,
  };
}

const perfStory: Story = {
  id: PERF_STORY_ID,
  component: 'Hud',
  state: 'perf-500',
  title: 'Messfall: 500 eigene Einheiten, Auswahl 60/24, Flow-Details, 3 Alerts, Minimap 800 Punkte (#/perf)',
  layout: 'fullscreen',
  viewport: R1080,
  tags: ['perf'],
  setup: (ctx) => {
    // Measurement mode: the harness drives the scheduler itself (PerfHud).
    if (typeof location !== 'undefined' && parsePerfParams(location.hash).perf) return undefined;
    return runScenario(ctx, 'perf-500');
  },
  render: () => {
    const params = parsePerfParams(typeof location !== 'undefined' ? location.hash : '');
    return params.perf ? <PerfHud params={params} /> : <Hud mac={false} />;
  },
};

export default defineStories([
  hudStory('vogt', 'vogt', '1080p: Vogt baut Glutkessel, Befehlskette, Tooltip Glutkessel mit Nachbarschaft', 'vogt', { tags: ['xbrowser'] }),
  hudStory('armee', 'armee', '1080p: 19 Einheiten / 5 Typen, Befehlsraster, Angriff scharf', 'armee'),
  hudStory('fabrik-stall', 'fabrik-stall', '1080p: Landwerk mit Queue, Energy-Stall, Flow-Details, Tooltip Punze', 'fabrik-stall', { tags: ['xbrowser'] }),
  hudStory('pause-cvd', 'pause-cvd', '1080p: Pause, farbenblind-sichere Teamfarben', 'pause-cvd'),
  hudStory('dichtester-fall', 'dichtester Fall', '1080p: Pause + Stall + Flow-Details + Tooltip + 3 Alerts + Befehlsleiste', 'dichtester-fall'),
  hudStory('1440-vogt', '1440', '2560 × 1440 @1,25: Vogt mit Tooltip', 'vogt', { viewport: R1440, scale: 1.25 }),
  hudStory('1440-fabrik', '1440 Fabrik', '2560 × 1440 @1,25: Landwerk, Flow-Details offen', 'fabrik', { viewport: R1440, scale: 1.25 }),
  hudStory('1440-kompakt', '1440-kompakt', '2560 × 1440 @1,0 (kompakt): Armee, Sim-Tempo ×2', 'kompakt', { viewport: R1440, scale: 1 }),
  hudStory('720-fabrik', '720', '1280 × 720 @0,8 (automatisch): Landwerk, Stall, Tooltip Punze', 'fabrik-stall', {
    viewport: R720,
    scale: computeUiScale(R720.width, R720.height),
  }),
  hudStory('720-armee', '720 Armee', '1280 × 720 @0,8 (automatisch): Armee', 'armee', {
    viewport: R720,
    scale: computeUiScale(R720.width, R720.height),
    tags: ['xbrowser'],
  }),
  perfStory,
]);
