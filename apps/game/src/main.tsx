/**
 * Entry point of the game page (MS1): loads the compiled content, starts the sim worker and the
 * client, mounts the Preact overlay and installs the E2E hooks (`window.__faf`).
 */
import SimWorker from '@faf/sim-host/worker?worker';
import { render } from 'preact';
import simBinUrl from '../../../content/generated/sim.bin?url';
import viewJson from '../../../content/generated/view.json?raw';
import { Game } from './game.ts';
import { installTestHooks } from './hooks.ts';
import { parseParams } from './params.ts';
import { App, BootError } from './ui/App.tsx';

const root = document.documentElement;
root.dataset['build'] = __IRONFLOW_BUILD_HASH__;
root.dataset['coi'] = String(globalThis.crossOriginIsolated === true);

async function loadSimBin(): Promise<ArrayBuffer> {
  const res = await fetch(simBinUrl);
  if (!res.ok) throw new Error(`sim.bin: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || uiRoot === null) throw new Error('missing #game-canvas or #ui-root');
  const params = parseParams(location.search);
  const simBin = await loadSimBin();
  const game = new Game({
    canvas,
    params,
    buildHash: __IRONFLOW_BUILD_HASH__,
    assets: { simBin, viewJson },
    createWorker: () => new SimWorker({ name: 'faf-sim' }),
  });
  root.dataset['webgl2'] = 'ok';
  root.dataset['transport'] = game.transport;
  render(<App game={game} />, uiRoot);
  installTestHooks(game);
  await game.whenReady();
  root.dataset['ready'] = '1';
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[faf] boot failed: ${message}`);
  root.dataset['webgl2'] = /webgl2/i.test(message) ? 'unavailable' : (root.dataset['webgl2'] ?? 'unknown');
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot !== null) render(<BootError message={`Start fehlgeschlagen: ${message}`} />, uiRoot);
});
