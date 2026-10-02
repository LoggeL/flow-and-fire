import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRtsReplay, ReplayFlags } from '../../packages/formats/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, COI_URL, expectNoErrors } from './support/game.ts';
import { setFrontendLocale } from './support/skirmish.ts';

const fixturePath = process.env['FAF_RETAINED_REPLAY_FILE'];
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Explicit historical-code qualification; the supplied recording and retained bundle are read-only. */
test('actual retained build: native byte handoff, HASH seeks and continuous browser playback at least 5x', async ({ page, browserName }, testInfo) => {
  test.skip(fixturePath === undefined, 'Requires an archived real recording via FAF_RETAINED_REPLAY_FILE');
  test.setTimeout(180_000);
  const fixture = resolve(fixturePath!), bytes = new Uint8Array(await readFile(fixture)), replay = readRtsReplay(bytes);
  const endTick = replay.meta?.endTick;
  expect(endTick).toBeDefined();
  expect(endTick!).toBeGreaterThanOrEqual(800);
  expect(replay.head.flags & ReplayFlags.Tainted).toBe(0);
  expect(replay.hashes.hashes.length).toBeGreaterThan(0);
  expect(replay.hashes.regionNames.length).toBeGreaterThan(0);
  expect(replay.hashes.subHashes.length).toBeGreaterThan(0);
  const recordedBuild = replay.head.buildHash, route = `/b/${encodeURIComponent(recordedBuild)}/`;
  const errors = captureErrors(page);
  await page.goto(`${COI_URL}?menu=1&map=hollow-ridge`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0);
  const main = page.getByTestId('MainMenu');
  await expect(main).toBeVisible();
  await setFrontendLocale(page, 'de');
  const currentBuild = await page.evaluate(() => document.documentElement.dataset['build']);
  expect(currentBuild).toBeTruthy();
  expect(currentBuild).not.toBe(recordedBuild);

  // Check the actual retained route before exercising the native compatibility button.
  const retainedUrl = new URL(route, COI_URL).href;
  const capabilityResponse = await page.request.get(`${retainedUrl}replay-capabilities.json`);
  expect(capabilityResponse.status()).toBe(200);
  expect(capabilityResponse.url()).toBe(`${retainedUrl}replay-capabilities.json`);
  expect(capabilityResponse.headers()['content-type']).toContain('application/json');
  expect(await capabilityResponse.json()).toEqual({ buildHash: recordedBuild, replayPlayer: 1, sessionTransfer: 1 });
  const retainedIndex = await page.request.get(`${retainedUrl}index.html`);
  expect(retainedIndex.status()).toBe(200);
  expect(retainedIndex.url()).toBe(`${retainedUrl}index.html`);
  expect(retainedIndex.headers()['content-type']).toContain('text/html');
  const indexHtml = await retainedIndex.text();
  expect(indexHtml).toContain(`${route}assets/`);

  await main.getByRole('button', { name: /Replays$/ }).click({ timeout: 10_000 });
  await page.getByTestId('replay-import').setInputFiles(fixture);
  const handoff = page.getByRole('button', { name: 'Aufgezeichneten Build öffnen', exact: true });
  await expect(handoff).toBeVisible({ timeout: 60_000 });
  const compatibilityMessage = (await page.getByTestId('replay-panel').getByRole('alert').allTextContents()).join('\n');
  expect(compatibilityMessage).toContain(recordedBuild);
  await expect(page.getByTestId('replay-panel').getByRole('alert')).toHaveCount(1);
  await expect(page.getByText(/Sim-Start fehlgeschlagen|Sim-Worker ausgefallen/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  expectNoErrors(errors);
  await assertSilentOutput(page);
  await handoff.click({ timeout: 10_000 });
  await page.waitForURL(url => url.pathname === route && url.searchParams.has('replayTransfer'), { timeout: 60_000 });
  const transferredUrl = new URL(page.url()), transferId = transferredUrl.searchParams.get('replayTransfer');
  expect(transferredUrl.origin).toBe(new URL(COI_URL).origin);
  expect(transferId).toMatch(/^[a-f0-9-]{36}$/);
  await page.waitForFunction(build => document.documentElement.dataset['build'] === build
    && document.documentElement.dataset['ready'] === '1' && window.__faf?.ready && window.__faf.tick === 0,
  recordedBuild, { timeout: 60_000 });
  await expect(page.getByTestId('replay-controls')).toBeVisible();
  const staged = await page.evaluate(id => sessionStorage.getItem(`faf-replay-transfer:${id}`), transferId);
  expect(staged).not.toBeNull();
  const transferredBytes = new Uint8Array(Buffer.from(staged!, 'base64'));
  expect(transferredBytes).toEqual(bytes);
  expect(sha256(transferredBytes)).toBe(sha256(bytes));

  // Verify that the executing module belongs to the retained index and matches its saved bytes.
  const entry = await page.evaluate(() => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src);
  expect(entry).toBeTruthy();
  const entryUrl = new URL(entry!);
  expect(entryUrl.origin).toBe(transferredUrl.origin);
  expect(entryUrl.pathname.startsWith(`${route}assets/`)).toBe(true);
  expect(indexHtml).toContain(entryUrl.pathname);
  const entryResponse = await page.request.get(entry!);
  expect(entryResponse.status()).toBe(200);
  const servedEntry = new Uint8Array(await entryResponse.body());
  const savedEntry = new Uint8Array(await readFile(resolve(import.meta.dirname, '../../apps/game/dist', entryUrl.pathname.slice(1))));
  expect(servedEntry).toEqual(savedEntry);
  const inspection = await page.evaluate(() => window.__faf!.inspection());
  expect(inspection).toMatchObject({ tick: 0, readOnlyCommands: true, sentCommands: 0 });
  expect(await page.evaluate(() => window.__faf!.paused)).toBe(true);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  await assertSilentOutput(page);

  const hashAt = (tick: number): number => {
    const row = (tick - replay.hashes.firstTick) / replay.hashes.interval;
    expect(Number.isInteger(row)).toBe(true);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(replay.hashes.hashes.length);
    return replay.hashes.hashes[row]!;
  };
  const seeks: { tick: number; hash: number }[] = [];
  for (const target of [600, 100, 800, 200]) {
    await page.getByTestId('replay-seek').evaluate((input, tick) => {
      (input as HTMLInputElement).value = String(tick);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, target);
    await expect.poll(() => page.evaluate(() => window.__faf!.tick)).toBe(target);
    const actual = await page.evaluate(() => window.__faf!.ruleHash());
    expect(actual).toMatchObject({ tick: target, hashTick: target, hash: hashAt(target) });
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(true);
    seeks.push({ tick: target, hash: actual!.hash });
  }

  // Measure actual accepted replay ticks in one page-clock interval. Import and seek costs are
  // outside it; native click dispatch is included. No step or seek occurs during this interval.
  await page.getByTestId('replay-speed').selectOption('10');
  await expect(page.getByTestId('replay-speed')).toHaveValue('10');
  await expect(page.getByTestId('replay-play')).toHaveText('Abspielen');
  const began = await page.evaluate(() => ({ tick: window.__faf!.tick, wallMs: performance.now(), frames: window.__faf!.renderStats().frames }));
  await page.getByTestId('replay-play').click();
  await page.waitForFunction(end => window.__faf?.tick === end && window.__faf.paused, endTick!, { timeout: 45_000 });
  const finished = await page.evaluate(() => ({ tick: window.__faf!.tick, wallMs: performance.now(),
    hash: window.__faf!.ruleHash(), inspection: window.__faf!.inspection(), hostErrors: window.__faf!.hostErrors,
    frames: window.__faf!.renderStats().frames, glError: document.querySelector<HTMLCanvasElement>('#game-canvas')!.getContext('webgl2')!.getError() }));
  const advancedTicks = finished.tick - began.tick, wallSeconds = (finished.wallMs - began.wallMs) / 1000;
  const xRealtime = advancedTicks / (10 * wallSeconds);
  expect(began.tick).toBe(200);
  expect(advancedTicks).toBeGreaterThanOrEqual(600);
  expect(wallSeconds).toBeGreaterThan(0);
  expect(Number.isFinite(xRealtime)).toBe(true);
  expect(xRealtime).toBeGreaterThanOrEqual(5);
  const lastHashTick = replay.hashes.firstTick + (replay.hashes.hashes.length - 1) * replay.hashes.interval;
  expect(finished.hash).toMatchObject({ tick: endTick, hashTick: lastHashTick, hash: hashAt(lastHashTick) });
  expect(finished.inspection).toMatchObject({ readOnlyCommands: true, sentCommands: 0 });
  expect(finished.hostErrors).toEqual([]);
  expect(finished.frames).toBeGreaterThan(began.frames);
  expect(finished.glError).toBe(0);
  await expect(page.getByTestId('replay-verification')).toContainText('Keine Abweichung.');
  const verification = await page.getByTestId('replay-verification').innerText();
  const counts = /([0-9]+) Regel-Hashes, ([0-9]+) Tabellen geprüft/.exec(verification);
  expect(counts).not.toBeNull();
  expect(Number(counts![1])).toBe(replay.hashes.hashes.length);
  expect(Number(counts![2])).toBe(replay.hashes.subHashes.length / replay.hashes.regionNames.length);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Replay herunterladen', exact: true }).click();
  const exported = testInfo.outputPath('retained-build-export.rtsreplay');
  await (await download).saveAs(exported);
  expect(new Uint8Array(await readFile(exported))).toEqual(bytes);
  await assertSilentOutput(page);
  expectNoErrors(errors);
  await testInfo.attach('actual-retained-replay-end', { body: await page.screenshot(), contentType: 'image/png' });
  await attachJson(testInfo, `retained-build-replay-${browserName}`, {
    fixture, fixtureSha256: sha256(bytes), byteLength: bytes.length, currentBuild, recordedBuild,
    transferredUrl: transferredUrl.href, entryUrl: entryUrl.href, retainedEntrySha256: sha256(servedEntry),
    compatibilityMessage, seeks, began, finished, advancedTicks, wallSeconds, xRealtime,
    playbackUiSpeed: 10, tickRate: 10, verification, silent: true,
  });
});
