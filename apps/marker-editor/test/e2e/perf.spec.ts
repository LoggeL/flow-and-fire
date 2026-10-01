import { test } from '@playwright/test';
import { captureErrors, expectNoErrors, MEASURED_LOCALLY, openEditor, writeReport } from './support/editor.ts';

test('Setons load, 60 camera frames and validation after changes (measurement)', async ({ page, browserName }) => {
  const errors = captureErrors(page);
  const runs = [];
  for (let run = 0; run < 2; run++) {
    await openEditor(page, 'setons');
    const measurement = await page.evaluate(async () => {
      const frames = [];
      for (let i = 0; i < 60; i++) {
        // Real keyboard camera input schedules frames through CameraRig.
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        await window.__editor!.waitForRender();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        frames.push(window.__editor!.renderStats().lastFrameMs);
      }
      const validation = [];
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        window.__editor!.store.select([{ type: 'spot', index: 0 }]);
        window.__editor!.store.moveSelectionBy(i % 2 === 0 ? 2048 : -2048, 0);
        validation.push(performance.now() - t0);
      }
      return { loadMs: window.__editorView!.loadMs, frameMs: frames, validationAndOverlayMs: validation, render: window.__editor!.renderStats() };
    });
    runs.push(measurement);
  }
  writeReport(`perf-${browserName}`, { browser: browserName, runs, note: MEASURED_LOCALLY, gate: false });
  expectNoErrors(errors);
});
