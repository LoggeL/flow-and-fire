/**
 * Measurements of the marker editor in the browser (TRACK-EDITOR P7). No gate (DECISIONS 16):
 * the values are written to test-results/marker-editor/perf-<browser>.json and documented in
 * docs/status/track-editor.md. Measured on the developer machine, not on a GPU/iGPU runner.
 *
 * - Setons load: `__editor.load('setons')` until the first rendered frame (fetch, readRtsMap,
 *   validation, terrain geometry, overlay, first frame) plus the session's own loadMs.
 * - Camera flight: 60 animation frames while the camera pans (held key) and zooms (wheel input);
 *   per frame the CPU render time (renderStats().lastFrameMs) and the frame interval.
 * - Synchronous frames: benchFrames(60) with the overlay (render + 1-pixel readPixels = GPU sync).
 * - Validation after one change: a spot added and moved via the store; the store runs the validator
 *   synchronously per revision, so the time of one command is op + validation.
 */
import { expect, test } from '@playwright/test';
import { focusCanvas, waitForMap } from './support/actions.ts';
import { captureErrors, expectNoErrors, MEASURED_LOCALLY, openEditor, writeReport } from './support/editor.ts';

interface Summary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

function summarize(values: readonly number[]): Summary {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const sum = s.reduce((a, b) => a + b, 0);
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return { n: s.length, min: r(s[0] ?? 0), p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1] ?? 0), mean: r(s.length > 0 ? sum / s.length : 0) };
}

test.describe('marker editor measurements', () => {
  test('setons: load time, camera flight, frame time, validation per change', async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');

    // --- load time (3 loads, switching away in between) ------------------------------------------
    const loads: number[] = [];
    const sessionLoadMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__editor!.load('hollow-ridge'));
      const ms = await page.evaluate(async () => {
        const t0 = performance.now();
        await window.__editor!.load('setons');
        return performance.now() - t0;
      });
      await waitForMap(page, 'setons');
      loads.push(ms);
      sessionLoadMs.push(await page.evaluate(() => window.__editorView!.loadMs));
    }

    // --- camera flight: 60 frames of held-key pan plus wheel zoom ------------------------------
    await focusCanvas(page);
    const box = (await page.locator('#terrain').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.keyboard.down('KeyD');
    const flight = await page.evaluate(async () => {
      const ed = window.__editor!;
      const canvas = document.getElementById('terrain')!;
      const rect = canvas.getBoundingClientRect();
      const frames0 = ed.renderStats().frames;
      const cpu: number[] = [];
      const intervals: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 60; i++) {
        if (i % 6 === 0) {
          canvas.dispatchEvent(
            new WheelEvent('wheel', { deltaY: i < 30 ? -120 : 120, clientX: rect.left + rect.width * 0.55, clientY: rect.top + rect.height * 0.5, bubbles: true, cancelable: true }),
          );
        }
        await ed.waitForRender();
        const now = performance.now();
        intervals.push(now - last);
        last = now;
        cpu.push(ed.renderStats().lastFrameMs);
      }
      const s = ed.renderStats();
      return { frames: s.frames - frames0, cpu, intervals, triangles: s.triangles, drawCalls: s.drawCalls };
    });
    await page.keyboard.up('KeyD');
    expect(flight.frames).toBeGreaterThanOrEqual(60);

    const bench = await page.evaluate(() => window.__editorView!.benchFrames(60));

    // --- validation per change (store command incl. synchronous validator) ----------------------
    const validation = await page.evaluate(() => {
      const ed = window.__editor!;
      const st = ed.store;
      const doc = st.doc.peek()!;
      const s = doc.sizeWu * 4096;
      const add: number[] = [];
      const move: number[] = [];
      const undo: number[] = [];
      for (let i = 0; i < 25; i++) {
        const x = Math.round(s * (0.3 + 0.016 * i));
        const z = Math.round(s * 0.42);
        let t0 = performance.now();
        st.addSpot('mass', x, z);
        add.push(performance.now() - t0);
        t0 = performance.now();
        st.moveSelectionBy(4096, 2048);
        move.push(performance.now() - t0);
        t0 = performance.now();
        st.undo();
        st.undo();
        undo.push((performance.now() - t0) / 2);
      }
      return { add, move, undo, issues: ed.issues().length, undoDepth: ed.undoDepth() };
    });
    expect(validation.undoDepth).toBe(0);

    const report = {
      browser: browserName,
      map: 'setons',
      viewport: page.viewportSize(),
      note: MEASURED_LOCALLY,
      loadMs: summarize(loads),
      sessionLoadMs: summarize(sessionLoadMs),
      cameraFlight: {
        frames: flight.frames,
        cpuRenderMs: summarize(flight.cpu),
        frameIntervalMs: summarize(flight.intervals),
        triangles: flight.triangles,
        drawCalls: flight.drawCalls,
      },
      benchFrames60: bench,
      validationPerChangeMs: { addSpot: summarize(validation.add), moveSpot: summarize(validation.move), undo: summarize(validation.undo), issues: validation.issues },
    };
    writeReport(`perf-${browserName}`, report);
    expectNoErrors(errors);
  });
});
