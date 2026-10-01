import {
  COMMAND_NAMES,
  HudProvider,
  bindUiSettings,
  createHudModel,
  demoCommandHandlers,
  createRecordingCommands,
  setLocale,
} from '@faf/hud';
import type { HudCommands, RecordedCall } from '@faf/hud';
import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import type { RegisteredStory } from '../registry.ts';
import type { Story, StoryContext } from '../story.ts';
import { CommandLog } from './CommandLog.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { reportError, setCommandLogSource, setReady, settled } from './global.ts';
import type { GalleryParams } from './route.ts';
import { GalleryBar } from './GalleryBar.tsx';

interface StoryRuntime {
  readonly ctx: StoryContext;
  /** Bumped on every command call so the log re-renders. */
  readonly logVersion: Signal<number>;
  readonly clearLog: () => void;
  readonly cleanup: (() => void) | undefined;
}

function createRuntime(entry: RegisteredStory, params: GalleryParams): StoryRuntime {
  const logVersion = signal(0);
  const model = createHudModel();
  const handlers = demoCommandHandlers(model);
  const bump: Partial<Record<string, (...args: unknown[]) => void>> = {};
  for (const name of COMMAND_NAMES) bump[name] = (...args) => {
    (handlers[name] as ((...args: unknown[]) => void) | undefined)?.(...args);
    logVersion.value++;
  };
  const rec = createRecordingCommands(bump as Partial<HudCommands>);
  setLocale(params.locale ?? 'de');
  model.scale.value = params.scale ?? entry.meta.scale;
  model.teams.value = params.teams ?? 'house';
  model.reducedMotion.value = params.motion === 'reduce' ? 'on' : 'system';
  const ctx: StoryContext = { model, commands: rec.commands, log: rec.log };
  let cleanup: (() => void) | undefined;
  try {
    const r = entry.story.setup?.(ctx);
    if (typeof r === 'function') cleanup = r;
  } catch (e) {
    reportError(`setup of ${entry.meta.id} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
  return {
    ctx,
    logVersion,
    clearLog: () => {
      rec.clear();
      logVersion.value++;
    },
    cleanup,
  };
}

/** Calls story.render inside its own component so the ErrorBoundary above catches render errors. */
function StoryBody({ story, ctx }: { readonly story: Story; readonly ctx: StoryContext }): JSX.Element {
  return <>{story.render(ctx)}</>;
}

export interface StoryPageProps {
  readonly entry: RegisteredStory;
  readonly params: GalleryParams;
  /** Unique key of the route (re-creates model and commands on change). */
  readonly routeKey: string;
}

/**
 * Renders one story in a fixed viewport box with a fresh model and recording commands (contract:
 * docs/plans/TRACK-HUD-contract.md). Scale/teams/motion go to <html> through bindUiSettings.
 */
export function StoryPage({ entry, params, routeKey }: StoryPageProps): JSX.Element {
  const rt = useMemo(() => createRuntime(entry, params), [routeKey]);
  const { meta, story } = entry;

  useEffect(() => {
    const unbind = bindUiSettings(document.documentElement, rt.ctx.model);
    setCommandLogSource(() => rt.ctx.log.map((c: RecordedCall) => ({ name: c.name, args: c.args })));
    let live = true;
    void settled().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
      setReady(false);
      unbind();
      setCommandLogSource(() => []);
      try {
        rt.cleanup?.();
      } catch (e) {
        reportError(`cleanup of ${meta.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
  }, [rt]);

  const box = (
    <div
      class={`gal-viewport gal-viewport--${meta.layout}`}
      style={{ width: `${meta.viewport.width}px`, height: `${meta.viewport.height}px` }}
      data-story-root=""
      data-story-id={meta.id}
      data-layout={meta.layout}
    >
      <ErrorBoundary storyId={meta.id}>
        <HudProvider model={rt.ctx.model} commands={rt.ctx.commands}>
          <StoryBody story={story} ctx={rt.ctx} />
        </HudProvider>
      </ErrorBoundary>
    </div>
  );

  if (params.shot) return box;
  return (
    <div class="gal-page gal-page--story">
      <GalleryBar meta={meta} params={params} />
      <main class="gal-stage">{box}</main>
      <CommandLog log={rt.ctx.log} version={rt.logVersion} onClear={rt.clearLog} />
    </div>
  );
}
