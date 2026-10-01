import type { AudioStats } from '../../packages/audio/src/types.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

const AUDIO_PERF_GATE = process.env['FAF_AUDIO_PERF_GATE'] === '1';
type AckSample = { trusted: boolean; inputFrame: number; inputMs: number; beforeVoices: number; observedFrame: number | null; observedMs: number | null; voices: number; sentBefore: number; sentAfter: number };
type AudioProbe = { armed: boolean; samples: AckSample[]; trustedKeys: number };
declare global { interface Window { __fafNativeAudioProbe?: AudioProbe } }

async function rendered(page: Page): Promise<void> {
  const next = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, next);
}

test('actual GameAudio: native command feedback, camera listener and real combat voice/timing budget', async ({ page, browserName }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  const evidence: Record<string, unknown> = { browserName, measuredLocally: MEASURED_LOCALLY, timingGate: AUDIO_PERF_GATE,
    fixture: 'Actual human/AI game. Bounded diagnostic Spawn commands create the explicitly tainted load; native selection/AttackGround produce genuine accepted-frame combat events. No fabricated audio events, engine patch or direct play/unlock calls.' };
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const commander = await startHumanAiSkirmish(page);
    const load = await page.evaluate(() => window.__faf!.audioLoadReport());
    evidence['load'] = load;
    expect(load.requested).toBeGreaterThan(0);
    expect(load.loaded).toBeGreaterThan(0);
    expect(load.failed).toBe(0);
    expect(load.decodedBytes).toBeGreaterThan(0);
    // This observer reads actual state only. It is installed after the navigation's strict
    // silent guard and never constructs an audio context, dispatches events or invokes sound.
    await page.evaluate(() => {
      const probe: AudioProbe = { armed: false, samples: [], trustedKeys: 0 };
      window.__fafNativeAudioProbe = probe;
      document.addEventListener('keydown', event => { if (event.isTrusted) probe.trustedKeys++; }, { capture: true });
      document.addEventListener('pointerdown', event => {
        if (!probe.armed || event.button !== 2 || !(event.target instanceof HTMLCanvasElement)) return;
        probe.armed = false;
        const h = window.__faf!;
        const sample: AckSample = { trusted: event.isTrusted, inputFrame: h.renderStats().frames, inputMs: performance.now(),
          beforeVoices: h.soundVoices('ack_pip_direct'), observedFrame: null, observedMs: null, voices: 0,
          sentBefore: h.inspection()?.sentCommands ?? -1, sentAfter: -1 };
        probe.samples.push(sample);
        let observed = 0;
        const inspect = (): void => {
          const voices = h.soundVoices('ack_pip_direct');
          if (voices > 0 || ++observed >= 6) {
            sample.voices = voices; sample.observedFrame = h.renderStats().frames; sample.observedMs = performance.now();
            sample.sentAfter = h.inspection()?.sentCommands ?? -1;
          } else requestAnimationFrame(inspect);
        };
        requestAnimationFrame(inspect);
      }, { capture: true });
    });
    evidence['beforeGesture'] = await page.evaluate(() => window.__faf!.audioSnapshot());
    await page.keyboard.press('KeyP');
    await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__faf!.audioStats().state)).toBe('running');
    evidence['afterGesture'] = await page.evaluate(() => ({ ...window.__faf!.audioSnapshot(), trustedKeys: window.__fafNativeAudioProbe!.trustedKeys }));
    expect(await page.evaluate(() => window.__fafNativeAudioProbe!.trustedKeys)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__faf!.audioSnapshot().muted)).toBe(false);
    await assertSilentOutput(page);

    await page.evaluate(() => window.__faf!.setCamera(96, 96, 52));
    await rendered(page);
    await clickUnit(page, commander);
    for (let i = 0; i < 12; i++) {
      // Observe a new allocation, rather than mistake the previous acknowledgement tail
      // for the next click. 200ms also exceeds the real catalog's 150ms ack cooldown.
      await page.waitForTimeout(200);
      await expect.poll(() => page.evaluate(() => window.__faf!.soundVoices('ack_pip_direct'))).toBe(0);
      const point = await groundPixel(page, 102 + (i % 2) * 2, 101);
      await page.evaluate(() => { window.__fafNativeAudioProbe!.armed = true; });
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.waitForFunction(count => {
        const sample = window.__fafNativeAudioProbe!.samples[count - 1];
        return sample !== undefined && sample.observedFrame !== null;
      }, i + 1);
    }
    const acknowledgements = await page.evaluate(() => window.__fafNativeAudioProbe!.samples);
    evidence['acknowledgements'] = acknowledgements;
    expect(acknowledgements).toHaveLength(12);
    for (const sample of acknowledgements) {
      expect(sample.trusted).toBe(true);
      expect(sample.beforeVoices).toBe(0);
      expect(sample.voices).toBeGreaterThan(0);
      expect(sample.observedFrame! - sample.inputFrame, 'local issued-command feedback, not Sim acceptance').toBeLessThanOrEqual(1);
      expect(sample.sentAfter).toBeGreaterThan(sample.sentBefore);
    }

    const beforeCamera = await page.evaluate(() => ({ camera: window.__faf!.camera(), audio: window.__faf!.audioSnapshot(),
      spatial: window.__faf!.audioSpatial('wpn_cannon_t1_fire', 106, 96) }));
    await page.mouse.move(800, 400);
    await page.keyboard.down('Control');
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(920, 400, { steps: 12 });
    await page.mouse.up({ button: 'middle' });
    await page.keyboard.up('Control');
    await rendered(page);
    const rotated = await page.evaluate(() => ({ camera: window.__faf!.camera(), audio: window.__faf!.audioSnapshot(),
      spatial: window.__faf!.audioSpatial('wpn_cannon_t1_fire', 106, 96) }));
    await page.mouse.wheel(0, 800);
    await rendered(page);
    const zoomed = await page.evaluate(() => ({ camera: window.__faf!.camera(), audio: window.__faf!.audioSnapshot(),
      spatial: window.__faf!.audioSpatial('wpn_cannon_t1_fire', 106, 96) }));
    evidence['camera'] = { beforeCamera, rotated, zoomed };
    expect(rotated.camera.yaw).not.toBe(beforeCamera.camera.yaw);
    expect(rotated.audio.listener.rightX).toBeCloseTo(-Math.sin(rotated.camera.yaw), 6);
    expect(rotated.audio.listener.rightZ).toBeCloseTo(Math.cos(rotated.camera.yaw), 6);
    expect(rotated.audio.listener.focusX).toBeCloseTo(rotated.camera.x, 6);
    expect(rotated.audio.listener.focusZ).toBeCloseTo(rotated.camera.z, 6);
    expect(rotated.spatial!.pan).not.toBe(beforeCamera.spatial!.pan);
    expect(zoomed.camera.distance).toBeGreaterThan(rotated.camera.distance);
    expect(zoomed.audio.listener.height).toBeGreaterThan(rotated.audio.listener.height);
    expect(zoomed.audio.listener.viewHalfWidth).toBeGreaterThan(rotated.audio.listener.viewHalfWidth);
    expect(zoomed.spatial!.gain).toBeLessThan(rotated.spatial!.gain);

    // Actual compiled weapon-bearing units. The setup is explicitly tainted; no simulated
    // event arrays or shortened fake ticks substitute for the measured running battle below.
    const groups = [
      { id: 'core:lnd_t1_tank', count: 64, columns: 8, x: 96, z: 88, spacing: 2 },
      { id: 'core:lnd_t3_heavy', count: 36, columns: 6, x: 115, z: 88, spacing: 3 },
      { id: 'core:lnd_t1_arty', count: 16, columns: 4, x: 96, z: 111, spacing: 3 },
    ];
    const beforeUnits = await page.evaluate(() => window.__faf!.unitCount);
    await page.evaluate(groups => {
      for (const group of groups) for (let i = 0; i < group.count; i++) window.__faf!.spawnAt(group.id,
        group.x + (i % group.columns) * group.spacing, group.z + Math.floor(i / group.columns) * group.spacing);
    }, groups);
    await stepTicks(page, 2);
    expect(await page.evaluate(() => window.__faf!.unitCount)).toBe(beforeUnits + 116);
    await page.evaluate(() => { window.__faf!.setYaw(0); window.__faf!.setCamera(112, 106, 100); });
    await rendered(page);
    const commanded: { id: string; selected: number }[] = [];
    for (const group of groups) {
      const visual = SKIRMISH_BLUEPRINTS.indexOf(group.id);
      const handle = await page.evaluate(visual => window.__faf!.ownHandles().find(h => window.__faf!.unitInfo(h)?.visual === visual) ?? null, visual);
      expect(handle).not.toBeNull();
      const pixel = await page.evaluate(handle => window.__faf!.unitScreenPos(handle), handle!);
      expect(pixel).not.toBeNull();
      await page.mouse.dblclick(pixel!.x, pixel!.y);
      await expect.poll(() => page.evaluate(() => window.__faf!.selected().length)).toBe(group.count);
      const selected = await page.evaluate(() => window.__faf!.selected().length);
      commanded.push({ id: group.id, selected });
      await page.keyboard.press('Alt+KeyZ');
      await expect(page.locator('#game-canvas')).toHaveAttribute('data-game-cursor', 'attack');
      const target = await groundPixel(page, 115, 118);
      await page.mouse.click(target.x, target.y);
      await stepTicks(page, 1);
    }
    evidence['loadCommands'] = commanded;
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
    await page.keyboard.press('KeyP');
    await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(false);
    // Warm the actual battle and then measure at least 600 distinct rendered frames. No
    // direct audio update/play calls occur; Game's real onFrame/onPresent paths own the work.
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__faf!.resetAudioStats());
    const workload = await page.evaluate(() => new Promise<{ stats: AudioStats; renderedFrames: number; activeFrames: number; maxObservedVoices: number; elapsedMs: number; initialTick: number; finalTick: number }>(resolve => {
      const h = window.__faf!, began = performance.now(), initialTick = h.tick;
      let previous = h.renderStats().frames, frames = 0, activeFrames = 0, maxObservedVoices = 0;
      const sample = (): void => {
        const current = h.renderStats().frames;
        if (current !== previous) {
          previous = current; frames++;
          const voices = h.audioSnapshot().voices;
          if (voices > 0) activeFrames++;
          maxObservedVoices = Math.max(maxObservedVoices, voices);
        }
        if (frames >= 600 && performance.now() - began >= 10000) resolve({ stats: h.audioStats(), renderedFrames: frames, activeFrames, maxObservedVoices,
          elapsedMs: performance.now() - began, initialTick, finalTick: h.tick });
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    evidence['workload'] = workload;
    evidence['snapshot'] = await page.evaluate(() => window.__faf!.audioSnapshot());
    evidence['buildHash'] = await page.evaluate(() => window.__faf!.buildHash);
    evidence['hostErrors'] = await page.evaluate(() => window.__faf!.hostErrors);
    // Write every measured counter before budget assertions so failure retains useful evidence.
    await attachJson(info, 'actual-game-audio-measurements', evidence);
    expect(workload.renderedFrames).toBeGreaterThanOrEqual(600);
    expect(workload.elapsedMs).toBeGreaterThanOrEqual(10000);
    expect(workload.stats.mainJs.samples).toBeGreaterThanOrEqual(600);
    expect(workload.finalTick - workload.initialTick).toBeGreaterThanOrEqual(100);
    expect(workload.stats.events).toBeGreaterThanOrEqual(500);
    expect(workload.stats.played).toBeGreaterThanOrEqual(100);
    expect(workload.activeFrames).toBeGreaterThanOrEqual(60);
    expect(workload.stats.peakVoices).toBeGreaterThanOrEqual(4);
    expect(workload.stats.peakVoices).toBeLessThanOrEqual(32);
    expect(workload.maxObservedVoices).toBeLessThanOrEqual(32);
    expect(await page.evaluate(() => window.__faf!.audioSnapshot().maxVoices)).toBe(32);
    expect(workload.stats.eventsUnmapped).toBe(0);
    expect(workload.stats.dropped.notLoaded).toBe(0);
    expect(workload.stats.dropped.unknownSound).toBe(0);
    if (AUDIO_PERF_GATE) expect(workload.stats.mainJs.p95).toBeLessThanOrEqual(0.5);
    await assertSilentOutput(page);
    expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
    expectNoErrors(errors);
  } finally {
    evidence['errors'] = [...errors];
    if (!page.isClosed()) evidence['finalDiagnostics'] = await page.evaluate(() => ({
      tick: window.__faf?.tick ?? null, paused: window.__faf?.paused ?? null,
      audio: window.__faf?.audioStats() ?? null, snapshot: window.__faf?.audioSnapshot() ?? null,
      hostErrors: window.__faf?.hostErrors ?? null, acknowledgements: window.__fafNativeAudioProbe?.samples ?? null,
      silent: (window as unknown as { __fafSilentAudio?: unknown }).__fafSilentAudio ?? null,
    })).catch(error => ({ unavailable: String(error) }));
    await attachJson(info, 'actual-game-audio-final', evidence);
  }
});
