/**
 * Minimap states (hud-p5-root, ui.md §5.4, §6): terrain/tactical, resource spots on/off, alert pings, the
 * three fog levels and the map key figures that fill the dock slot before MS11 (UI-E2). Fake data from
 * demo/minimap.ts (seeded); the tools and the canvas are interactive (mode, spots, camera by click/drag).
 */
import { DEMO_MAP_NAME, HudProvider, Minimap, cameraTrapezoid, createMinimapDemo } from '@faf/hud';
import type { HudCommands, MinimapMode } from '@faf/hud';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { defineStories } from '../story.ts';
import type { Story, StoryContext } from '../story.ts';

interface Setup {
  readonly mode?: MinimapMode;
  readonly resources?: boolean;
  readonly pings?: boolean;
  /** Only the fog: no units, so the three levels are easy to compare. */
  readonly fogOnly?: boolean;
  readonly available?: boolean;
}

/** Sim time of the stories (pings are aged against it). */
const NOW_S = 702;

function fill(ctx: StoryContext, s: Setup): void {
  const demo = createMinimapDemo({ own: 64, enemy: 48 });
  const mm = ctx.model.minimap;
  mm.mapName.value = DEMO_MAP_NAME;
  mm.mapSizeWu.value = demo.mapSizeWu;
  mm.terrain.value = demo.terrain;
  mm.spots.value = demo.spots;
  mm.fog.value = demo.fog();
  mm.available.value = s.available ?? true;
  mm.mode.value = s.mode ?? 'terrain';
  mm.showResources.value = s.resources ?? true;
  mm.units.value = s.fogOnly === true ? { ...demo.units(), count: 0 } : demo.units();
  mm.camera.value = demo.camera();
  ctx.model.match.timeS.value = NOW_S;
  if (s.pings === true) {
    const size = demo.mapSizeWu;
    mm.pings.value = [
      { x: size * 0.3, z: size * 0.62, bornS: NOW_S - 0.5, level: 'crit' },
      { x: size * 0.58, z: size * 0.44, bornS: NOW_S - 4, level: 'warn' },
    ];
  }
}

/** Nested provider whose commands also change the model like the game would (mode, spots, camera). */
function InteractiveMinimap({ ctx }: { readonly ctx: StoryContext }): JSX.Element {
  const commands = useMemo<HudCommands>(() => {
    const mm = ctx.model.minimap;
    return {
      ...ctx.commands,
      setMinimapMode(mode) {
        ctx.commands.setMinimapMode(mode);
        mm.mode.value = mode;
      },
      toggleResources() {
        ctx.commands.toggleResources();
        mm.showResources.value = !mm.showResources.peek();
      },
      setCamera(x, z) {
        ctx.commands.setCamera(x, z);
        mm.camera.value = cameraTrapezoid(x, z);
      },
    };
  }, [ctx]);
  return (
    <HudProvider model={ctx.model} commands={commands}>
      <div style={{ width: 'var(--hud-minimap)', height: 'var(--hud-dock-h)' }}>
        <Minimap />
      </div>
    </HudProvider>
  );
}

function story(slug: string, state: string, title: string, s: Setup, tags?: readonly string[]): Story {
  return {
    id: `minimap--${slug}`,
    component: 'Minimap',
    state,
    title,
    layout: 'component',
    scale: 1.5,
    ...(tags !== undefined ? { tags } : {}),
    setup: (ctx) => fill(ctx, s),
    render: (ctx) => <InteractiveMinimap ctx={ctx} />,
  };
}

export default defineStories([
  story('gelaende', 'Gelände', 'Gelände-Ansicht mit Einheiten, Ressourcenpunkten und Kamera-Trapez', {}, ['xbrowser']),
  story('taktisch', 'Taktisch', 'Taktische Einfärbung (Wasser + drei Landstufen)', { mode: 'tactical' }),
  story('ressourcen-an', 'Ressourcen an', 'Ressourcenpunkte als Rauten (frei gefüllt, belegt hohl)', { resources: true }),
  story('ressourcen-aus', 'Ressourcen aus', 'Ressourcenpunkte ausgeblendet', { resources: false }),
  story('ping', 'Ping', 'Alert-Pings als Glutringe (neu und 4 s alt)', { pings: true }),
  story('fog', 'Fog-Stufen', 'Fog in drei Stufen: nie gesehen dunkel, erkundet gedimmt, sichtbar klar', { fogOnly: true, resources: false }),
  story('kennzahlen', 'Karten-Kennzahlen', 'Vor MS11 (UI-E2): Name, Größe, Mex/Hydro frei/belegt', { available: false }),
]);
