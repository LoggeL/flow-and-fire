/**
 * Battle demo with the real engine in Chromium/Firefox/WebKit: unlock through a real click on the
 * overlay (no autoplay flag), 10 s 'Gefecht-200' within the voice limits, jump-to-alert moves the
 * camera, settings survive a reload. The engine's main-thread p95 is annotated and only gated with
 * FAF_AUDIO_PERF_GATE=1 (≤ 0.5 ms, DECISIONS 16).
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import type { DemoHook, DemoStats } from '../../src/demo/hook.ts';

declare global {
  interface Window {
    __fafAudioDemo?: DemoHook;
  }
}

const PERF_GATE = process.env['FAF_AUDIO_PERF_GATE'] === '1';
const MAIN_JS_BUDGET_MS = 0.5;

/** Console errors and page errors of one page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function openDemo(page: Page, query = ''): Promise<void> {
  await page.goto(`/index.html${query}`);
  await page.waitForFunction(() => window.__fafAudioDemo !== undefined);
  await page.evaluate(() => window.__fafAudioDemo!.ready);
}

async function stats(page: Page): Promise<DemoStats> {
  return page.evaluate(() => window.__fafAudioDemo!.stats());
}

/**
 * Unlocks through a real click on the overlay. Every page load must start 'locked' (no autoplay
 * flag): if the engine already reports 'running' the autoplay policy or the unlocker changed and
 * the test fails instead of silently skipping the click.
 */
async function unlockByClick(page: Page): Promise<string> {
  const before = await page.evaluate(() => window.__fafAudioDemo!.engine.state);
  expect(before, 'engine state before the first user gesture').toBe('locked');
  const overlay = page.locator('#unlock-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Klicken zum Aktivieren des Tons');
  await overlay.click();
  await page.waitForFunction(() => window.__fafAudioDemo!.engine.state === 'running');
  await expect(page.locator('#unlock-overlay')).toBeHidden();
  return before;
}

test('unlock, 10 s Gefecht-200 within the limits, jump to alert', async ({ page, browserName }, info) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openDemo(page, '?shots=200&seed=7');

  // 1 s of battle BEFORE the gesture: every play is dropped as 'locked', nothing is played.
  await page.evaluate(() => window.__fafAudioDemo!.start({ shots: 200, seed: 7, speed: 1 }));
  await page.evaluate(() => window.__fafAudioDemo!.setCamera({ x: 256, z: 256, height: 90, yaw: 0 }));
  await page.waitForTimeout(1000);
  const pre = await stats(page);
  await page.evaluate(() => window.__fafAudioDemo!.stop());
  expect(pre.engine.state).toBe('locked');
  expect(pre.engine.events).toBeGreaterThan(100);
  expect(pre.engine.dropped.locked).toBeGreaterThan(0);
  expect(pre.engine.played).toBe(0);

  const initial = await unlockByClick(page);
  info.annotations.push({
    type: 'unlock',
    description: `${browserName}: state before the click '${initial}' → running; ${pre.engine.events} events / ${pre.engine.dropped.locked} locked drops before the gesture`,
  });
  // No catch-up: with the battle stopped nothing from the locked phase is played afterwards.
  await page.waitForTimeout(500);
  expect((await stats(page)).engine.played).toBe(0);

  await page.evaluate(() => window.__fafAudioDemo!.start({ shots: 200, seed: 7, speed: 1 }));
  // Camera on the front line so that the battle is audible (not culled).
  await page.evaluate(() => window.__fafAudioDemo!.setCamera({ x: 256, z: 256, height: 90, yaw: 0 }));
  await page.waitForTimeout(10_000);
  const s = await stats(page);
  await page.evaluate(() => window.__fafAudioDemo!.stop());

  const e = s.engine;
  const drops = Object.values(e.dropped).reduce((a, b) => a + b, 0);
  const paths = Object.entries(e.decodePaths)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${p} ${n}`)
    .join(', ');
  info.annotations.push(
    {
      type: 'main-js',
      description: `${browserName}: engine.mainJs p50 ${e.mainJs.p50.toFixed(3)} / p95 ${e.mainJs.p95.toFixed(3)} / p99 ${e.mainJs.p99.toFixed(3)} ms (${e.mainJs.samples} frames); engine calls p95 ${s.engineCalls.p95.toFixed(3)} ms; generator p95 ${s.generator.p95.toFixed(3)} ms; timer ${s.timerResolutionMs.toFixed(3)} ms, COI ${s.crossOriginIsolated}`,
    },
    {
      type: 'voices',
      description: `${browserName}: max ${s.maxVoicesSeen}/32, tails ${s.maxTailsSeen}, played ${e.played}, stolen ${e.stolen}, dropped ${drops} ${JSON.stringify(e.dropped)}`,
    },
    { type: 'decode-path', description: `${browserName}: ${paths}; ${e.loadedSounds} sounds, ${(e.decodedBytes / 1048576).toFixed(1)} MiB, load ${Math.round(s.load.ms)} ms` },
    { type: 'latency', description: `${browserName}: base ${String(e.baseLatencyMs)} ms, output ${String(e.outputLatencyMs)} ms` },
  );

  expect(s.load.phase).toBe('done');
  expect(s.load.failed).toBe(0);
  expect(s.scenario.simTimeS).toBeGreaterThan(5);
  // Shot rate of the generator: 200/s of sim time.
  expect(Math.abs(s.scenario.shots - 200 * s.scenario.simTimeS)).toBeLessThanOrEqual(200 * s.scenario.simTimeS * 0.05);
  expect(e.events).toBeGreaterThan(1000);
  expect(e.played).toBeGreaterThan(100);
  expect(s.maxVoicesSeen).toBeGreaterThan(8);
  expect(s.maxVoicesSeen).toBeLessThanOrEqual(32);
  for (const [c, n] of Object.entries(s.maxByCategorySeen)) {
    expect(n, `category ${c}`).toBeLessThanOrEqual(s.categoryLimits[c as keyof typeof s.categoryLimits]);
  }
  expect(drops + e.stolen).toBeGreaterThan(0);
  expect(e.dropped.locked).toBe(0);
  if (PERF_GATE) expect(e.mainJs.p95).toBeLessThanOrEqual(MAIN_JS_BUDGET_MS);

  // Acknowledgement: starts synchronously inside the click handler.
  await page.locator('#btn-ack').click();
  const ack = (await stats(page)).ack;
  expect(ack.started).toBeGreaterThanOrEqual(1);

  // Jump to the latest located alert with the space bar: the camera flies there.
  let alerts = await page.evaluate(() => window.__fafAudioDemo!.alerts());
  if (!alerts.some((a) => a.x !== null)) {
    await page.evaluate(() => window.__fafAudioDemo!.engine.alert({ kind: 'alt_enemy_commander_spotted', x: 440, z: 60 }));
    await page.waitForFunction(() => window.__fafAudioDemo!.alerts().some((a) => a.x !== null));
    alerts = await page.evaluate(() => window.__fafAudioDemo!.alerts());
  }
  const target = alerts.find((a) => a.x !== null)!;
  // Park the camera far away from the target first.
  const park = { x: target.x! < 256 ? 480 : 32, z: target.z! < 256 ? 480 : 32 };
  await page.evaluate((p) => window.__fafAudioDemo!.setCamera({ x: p.x, z: p.z }), park);
  await page.locator('#view').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(
    (t) => {
      const c = window.__fafAudioDemo!.camera();
      return Math.hypot(c.x - t.x, c.z - t.z) < 1;
    },
    { x: target.x!, z: target.z! },
  );
  info.annotations.push({ type: 'jump', description: `${browserName}: ${target.kind} at (${target.x!.toFixed(0)}, ${target.z!.toFixed(0)})` });

  expect(errors).toEqual([]);
});

/** Records every AudioBufferSourceNode.start() with its `when` and the context time of the call. */
async function recordSourceStarts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { when: number; now: number }[] = [];
    (window as unknown as { __fafStartLog: typeof log }).__fafStartLog = log;
    const proto = AudioBufferSourceNode.prototype;
    const original = proto.start;
    proto.start = function (this: AudioBufferSourceNode, when?: number, offset?: number, duration?: number): void {
      log.push({ when: when ?? 0, now: this.context.currentTime });
      if (duration !== undefined) original.call(this, when, offset, duration);
      else if (offset !== undefined) original.call(this, when, offset);
      else original.call(this, when);
    };
  });
}

test('ack under a full voice pool starts synchronously in the click handler', async ({ page, browserName }, info) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await recordSourceStarts(page);
  await openDemo(page);
  await unlockByClick(page);
  await page.evaluate(() => window.__fafAudioDemo!.stop());

  // Fill all 32 voices with looping low-priority sounds (priority < 80, i.e. below ui/ack), one per
  // sound and pass; later passes pick up lazily loaded sounds and expired per-sound cooldowns.
  const filled = await page.evaluate(async () => {
    const engine = window.__fafAudioDemo!.engine;
    const cat = engine.catalog!;
    const voices = engine.voices!;
    for (let pass = 0; pass < 40 && voices.voiceCount < 32; pass++) {
      for (let i = 0; i < cat.size && voices.voiceCount < 32; i++) {
        const s = cat.byIndex(i);
        if (s.priority >= 80 || s.bus === 'music') continue;
        engine.play({ sound: i, loop: true, gain: 0.05 });
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return voices.voiceCount;
  });
  expect(filled).toBe(32);

  const before = await page.evaluate(() => {
    const d = window.__fafAudioDemo!;
    const log = (window as unknown as { __fafStartLog: unknown[] }).__fafStartLog;
    return { starts: log.length, stolen: d.engine.stats().stolen, ackStarted: d.stats().ack.started };
  });
  // A real click (user gesture) on the HUD button: ui_cmd_move + ack_pip_direct via playUi.
  await page.locator('#btn-ack').click();
  const after = await page.evaluate(() => {
    const d = window.__fafAudioDemo!;
    const log = (window as unknown as { __fafStartLog: { when: number; now: number }[] }).__fafStartLog;
    return { log: log.slice(), stats: d.stats(), voices: d.engine.voices!.voiceCount };
  });
  const newStarts = after.log.slice(before.starts);
  info.annotations.push({
    type: 'ack',
    description: `${browserName}: pool 32/32, ${newStarts.length} starts in the handler (when ${newStarts.map((x) => x.when).join(', ')}), handler ${after.stats.ack.lastLatencyMs?.toFixed(3) ?? '?'} ms, output latency ${String(after.stats.engine.outputLatencyMs)} ms`,
  });
  expect(after.stats.ack.started).toBe(before.ackStarted + 1);
  // Both sounds were started inside the click handler, scheduled for "now" (when ≤ currentTime).
  expect(newStarts.length).toBe(2);
  for (const x of newStarts) expect(x.when).toBeLessThanOrEqual(x.now);
  // They took voices from the full pool by stealing (never exceeding 32).
  expect(after.stats.engine.stolen).toBeGreaterThanOrEqual(before.stolen + 2);
  expect(after.voices).toBeLessThanOrEqual(32);
  // Main-thread side of the acknowledgement: far below one frame (16.7 ms).
  expect(after.stats.ack.lastLatencyMs!).toBeLessThan(16.7);
  expect(errors).toEqual([]);
});

test('mixer settings survive a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await openDemo(page);
  await unlockByClick(page);
  await page.locator('#vol-sfx').fill('0.35');
  await page.locator('#vol-music').fill('0.2');
  await page.locator('#in-muted').check();
  await expect.poll(() => page.evaluate(() => window.__fafAudioDemo!.settings())).toMatchObject({ sfx: 0.35, music: 0.2, muted: true });

  await page.reload();
  await page.waitForFunction(() => window.__fafAudioDemo !== undefined);
  await page.evaluate(() => window.__fafAudioDemo!.ready);
  const s = await page.evaluate(() => window.__fafAudioDemo!.settings());
  expect(s.sfx).toBeCloseTo(0.35, 5);
  expect(s.music).toBeCloseTo(0.2, 5);
  expect(s.muted).toBe(true);
  await expect(page.locator('#vol-sfx')).toHaveValue('0.35');
  await expect(page.locator('#in-muted')).toBeChecked();
  // Muted engine drops one-shots with reason 'muted' instead of playing them.
  await unlockByClick(page);
  await page.evaluate(() => window.__fafAudioDemo!.ack());
  const dropped = await page.evaluate(() => window.__fafAudioDemo!.stats().engine.dropped.muted);
  expect(dropped).toBeGreaterThan(0);

  // Restore the defaults for the next test run in this browser profile.
  await page.locator('#in-muted').uncheck();
  expect(errors).toEqual([]);
});
