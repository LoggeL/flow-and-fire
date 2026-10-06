/**
 * fx-lab entry: parses the URL, installs `window.__fxlab` (before anything can fail, so errors reach
 * the test hooks) and starts the LabApp. See docs/status/rfx-p5-lab-shell.md for the parameters.
 */
import { LabApp } from './app/app.ts';
import type { FxLabHooks } from './app/hooks.ts';
import { parseLabParams } from './app/params.ts';
import { LAB_SCENES, createLabFx } from './scenes/index.ts';

function notReady(): never {
  throw new Error('fx-lab is not initialised');
}

const warnings: string[] = [];
const params = parseLabParams(location.search, (n) => LAB_SCENES[n] !== undefined, warnings);
for (const w of warnings) console.warn(`fx-lab: ${w}`);

const hooks: FxLabHooks = {
  ready: false,
  frame: 0,
  scene: params.scene,
  preset: params.preset,
  error: null,
  restoreCount: 0,
  stats: notReady,
  samples: notReady,
  resetSamples: notReady,
  setScene: notReady,
  loseContext: () => false,
  restoreContext: () => false,
  triggerBigExplosion: () => false,
  markers: () => [],
};
window.__fxlab = hooks;

function report(e: unknown): void {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  if (hooks.error === null) hooks.error = msg;
  console.error(`fx-lab: ${msg}`);
}
window.addEventListener('error', (ev) => report(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => report(ev.reason));

const canvas = document.getElementById('c');
if (!(canvas instanceof HTMLCanvasElement)) {
  report(new Error('canvas #c missing'));
} else {
  try {
    const app = new LabApp({ canvas, container: document.body, params, hooks, scenes: LAB_SCENES, createFx: createLabFx });
    // Handle for manual debugging in the console.
    (window as unknown as { __fxlabApp?: LabApp }).__fxlabApp = app;
  } catch (e) {
    report(e);
  }
}
