/**
 * Entry point of the game page (MS2): loading screen → assets through the AssetManager (asset
 * worker, Cache API, integrity, progress) → sim worker with the map → GameClient with terrain,
 * water and spot decals → HUD. Installs the E2E hooks (`window.__faf`).
 *
 * `<html>` data attributes: `data-build`, `data-coi`, `data-loading-progress` (0–100),
 * `data-webgl2`, `data-transport`, `data-sim-id`, `data-ready="1"` once the first frame with the
 * map has been rendered.
 */
import AssetWorker from '@faf/client/asset-worker?worker';
import SimWorker from '@faf/sim-host/worker?worker';
import { AssetManager } from '@faf/client';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { Game } from './game.ts';
import { installTestHooks } from './hooks.ts';
import { INITIAL_LOAD_STATE, SIM_START_PROGRESS, loadSessionAssets, type LoadState, type LoadTimings } from './loading.ts';
import { parseParams } from './params.ts';
import { App, BootError } from './ui/App.tsx';
import { LoadingScreen } from './ui/LoadingScreen.tsx';

const root = document.documentElement;
root.dataset['build'] = __FAF_BUILD_HASH__;
root.dataset['coi'] = String(globalThis.crossOriginIsolated === true);

const params = parseParams(location.search);
const load = signal<LoadState>(INITIAL_LOAD_STATE);
const gameSig = signal<Game | null>(null);
let timings: LoadTimings | null = null;

function setLoad(s: LoadState): void {
  load.value = s;
  root.dataset['loadingProgress'] = String(s.progress);
}

function Root() {
  const g = gameSig.value;
  const l = load.value;
  return (
    <>
      {g !== null ? <App game={g} /> : null}
      {l.phase !== 'ready' ? <LoadingScreen state={l} mapName={params.map} /> : null}
    </>
  );
}

/** Resolves after the renderer has drawn at least one frame. */
function firstFrame(game: Game): Promise<void> {
  return new Promise((res) => {
    const check = (): void => {
      if (game.renderer.stats.frames > 0 || game.renderer.stats.lost) res();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const gameRoot = document.getElementById('game-root');
  if (!(canvas instanceof HTMLCanvasElement) || uiRoot === null || gameRoot === null) throw new Error('missing #game-canvas, #ui-root or #game-root');
  render(<Root />, uiRoot);
  setLoad(INITIAL_LOAD_STATE);

  const mgr = new AssetManager({
    manifestUrl: `${import.meta.env.BASE_URL}assets/manifest.json`,
    createWorker: () => new AssetWorker({ name: 'faf-assets' }),
  });
  const assets = await loadSessionAssets(mgr, params.map, setLoad);
  // The asset worker stays alive for the session: terminating it right after `done` loses Cache API
  // writes in WebKit (the put promises resolve before the entries are committed), and later loads
  // (MS9 streaming) reuse it.
  setLoad({ ...load.value, phase: 'sim', progress: SIM_START_PROGRESS, asset: null, source: null });

  const game = new Game({
    canvas,
    params,
    buildHash: __FAF_BUILD_HASH__,
    assets: { simBin: assets.simBin, viewJson: assets.viewJson, models: assets.loaded.models, mapBytes: assets.mapBytes },
    createWorker: () => new SimWorker({ name: 'faf-sim' }),
    root: gameRoot,
  });
  root.dataset['webgl2'] = 'ok';
  root.dataset['transport'] = game.transport;
  gameSig.value = game;
  installTestHooks(game, () => timings);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      game.dispose();
      mgr.dispose();
    });
  }
  await game.whenReady();
  await firstFrame(game);
  timings = {
    ...assets.timings,
    simStartMs: (game.readyAtMs ?? performance.now()) - game.initAtMs,
    navigationToReadyMs: performance.now(),
  };
  setLoad({ ...load.value, phase: 'ready', progress: 100 });
  root.dataset['ready'] = '1';
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[faf] boot failed: ${message}`);
  root.dataset['webgl2'] = /webgl2/i.test(message) ? 'unavailable' : (root.dataset['webgl2'] ?? 'unknown');
  setLoad({ ...load.value, phase: 'error', message: `Start fehlgeschlagen: ${message}` });
  // Without the Preact root (missing DOM) show at least the plain error box.
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot !== null && document.querySelector('[data-testid="loading-screen"]') === null) {
    render(<BootError message={`Start fehlgeschlagen: ${message}`} />, uiRoot);
  }
});
