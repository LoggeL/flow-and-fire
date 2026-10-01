import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRtsReplay, ReplayFlags } from '../../packages/formats/src/index.ts';
import { parseCommandLog } from '../../packages/sim-host/src/log-format.ts';
import { verifyReplay } from '../../packages/sim-host/src/replay/player.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, COI_URL, expectNoErrors, openGame } from './support/game.ts';

/** Explicit opt-in, run serially only after Root's quiet recorder-durability GO. */
test('real OPFS: 600 seconds at 1x, Chromium tab crash and independently verified recovery', async ({ page, context, browserName }, testInfo) => {
  test.skip(process.env['FAF_RECORDER_TABKILL'] !== '1' || browserName !== 'chromium', 'Requires explicit serial 10-minute OPFS crash qualification');
  test.setTimeout(15 * 60_000);
  const errors = captureErrors(page);
  // Original recording load: 150 real cubes per army. This is an explicit legacy recording,
  // so a skirmish result cannot pause it before the durability gate. No steps or fake OPFS.
  await openGame(page, COI_URL, 'map=hollow-ridge&spawn=cubes&cubes=150&enemy=150&autostart=1', 300, { legacySelection: false });
  await expect.poll(() => page.evaluate(() => (window.__faf!.hostStatus() as { recorder: string }).recorder)).toBe('opfs');
  const initial = await page.evaluate(() => ({ tick: window.__faf!.tick, status: window.__faf!.hostStatus() as { speed: number; paused: boolean }, units: window.__faf!.unitCount }));
  expect(initial.status.speed).toBe(1);
  expect(initial.status.paused).toBe(false);
  expect(initial.units).toBe(300);
  const recordingName = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('faf-logs');
    const files: string[] = [];
    for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name.endsWith('.faflog')) files.push(name);
    }
    if (files.length !== 1) throw new Error(`Expected one actual recording, found ${files.length}`);
    return files[0]!;
  });
  const began = performance.now();
  const deadline = began + 600_000;
  while (performance.now() < deadline) {
    await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - performance.now())));
  }
  const wallSeconds = (performance.now() - began) / 1000;
  const beforeCrash = await page.evaluate(() => ({ tick: window.__faf!.tick, status: window.__faf!.hostStatus() as { speed: number; paused: boolean; recorder: string; recorderNote: string | null }, hostErrors: window.__faf!.hostErrors }));
  expect(wallSeconds).toBeGreaterThanOrEqual(600);
  expect(beforeCrash.tick - initial.tick).toBeGreaterThanOrEqual(5900);
  expect(beforeCrash.status).toMatchObject({ speed: 1, paused: false, recorder: 'opfs', recorderNote: null });
  expect(beforeCrash.hostErrors).toEqual([]);
  await assertSilentOutput(page);
  const silent = await page.evaluate(() => {
    const audit = (window as unknown as { __fafSilentAudio?: { installed: boolean; contexts: number; streamDestinations: number; blockedConnections: number; speakerConnections: number } }).__fafSilentAudio;
    return audit ? { ...audit } : null;
  });
  const beforeCrashReceipt = { wallSeconds, initial, beforeCrash, recordingName, silent };
  await writeFile(testInfo.outputPath('before-crash.json'), JSON.stringify(beforeCrashReceipt, null, 2));
  await attachJson(testInfo, 'actual-opfs-before-crash', beforeCrashReceipt);

  const cdp = await context.newCDPSession(page);
  const crash = page.waitForEvent('crash');
  // The crashed renderer can leave its CDP response pending until context teardown.
  // The actual Page crash event is the authoritative completion of this action.
  void cdp.send('Page.crash').catch(() => undefined);
  await crash;
  await page.close().catch(() => undefined);

  // Keep the same browser context and origin, including its actual OPFS partition.
  const recovered = await context.newPage();
  await installSilentOutput(recovered);
  const recoveryErrors = captureErrors(recovered);
  await recovered.goto(`${COI_URL}?menu=1&map=hollow-ridge`, { waitUntil: 'commit' });
  await expect(recovered.getByTestId('MainMenu')).toBeVisible({ timeout: 60_000 });
  // The recovered menu creates no audio context, but its replacement constructors and
  // hardware-destination block must already be installed before replay processing.
  expect(await recovered.evaluate(() => {
    const audit = (window as unknown as { __fafSilentAudio?: { installed: boolean; contexts: number; streamDestinations: number; blockedConnections: number; speakerConnections: number } }).__fafSilentAudio;
    return audit?.installed === true && audit.contexts === audit.streamDestinations && audit.blockedConnections === 0 && audit.speakerConnections === 0;
  })).toBe(true);
  const rawBytes = new Uint8Array(await recovered.evaluate(async name => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('faf-logs');
    const handle = await directory.getFileHandle(name);
    return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
  }, recordingName));
  const raw = parseCommandLog(rawBytes);
  expect(raw.endTick).toBe(-1); // Page.crash bypassed graceful close/export.
  expect(raw.lastTick).toBeGreaterThanOrEqual(5900);
  expect(raw.hashes.length).toBeGreaterThanOrEqual(590);
  await writeFile(testInfo.outputPath('crashed-session.faflog'), rawBytes);
  await recovered.getByTestId('MainMenu').getByRole('button', { name: /Replays/ }).click();
  const entry = recovered.getByTestId('replay-library').locator('li').filter({ hasText: recordingName });
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await expect(entry).toContainText('Teilaufnahme');
  const downloadEvent = recovered.waitForEvent('download');
  await entry.getByRole('button', { name: 'Exportieren', exact: true }).click();
  const exported = testInfo.outputPath('recovered-session.rtsreplay');
  await (await downloadEvent).saveAs(exported);
  const bytes = new Uint8Array(await readFile(exported)), replay = readRtsReplay(bytes);
  expect(replay.head.flags & ReplayFlags.Truncated).toBe(ReplayFlags.Truncated);
  expect(replay.meta?.endTick).toBe(raw.lastTick);
  expect([...replay.hashes.hashes]).toEqual(raw.hashes.map(hash => hash.hash));
  // Independent Node simulation checks every recovered recorded hash and table hash.
  const simBin = new Uint8Array(await readFile(resolve(import.meta.dirname, '../../content/generated/sim.bin')));
  const map = new Uint8Array(await readFile(resolve(import.meta.dirname, '../../content/maps/hollow-ridge.rtsmap')));
  const verified = verifyReplay(bytes, { simBin, map, keyframes: false });
  expect(verified.divergences).toEqual([]);
  expect(verified.compared).toBe(raw.hashes.length);
  expect(replay.hashes.regionNames.length).toBeGreaterThan(0);
  expect(replay.hashes.subInterval).toBeGreaterThan(0);
  expect(verified.subCompared).toBe(replay.hashes.subHashes.length / replay.hashes.regionNames.length);
  expect(verified.endTick).toBe(raw.lastTick);
  const persistedFinalHash = raw.hashes.at(-1)!;
  expect(persistedFinalHash.tick).toBe(raw.lastTick);
  expect(verified.ruleHash).toBe(persistedFinalHash.hash);
  expect(verified.truncated).toBe(true);
  await attachJson(testInfo, 'actual-opfs-tab-crash', { wallSeconds, initial, beforeCrash, recordingName, persistedTick: raw.lastTick, rawBytes: rawBytes.length, replayBytes: bytes.length, verification: verified });
  expectNoErrors(errors);
  expectNoErrors(recoveryErrors);
  await recovered.close();
});
