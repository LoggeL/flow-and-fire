import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureErrors, COI_URL, expectNoErrors, NO_COI_URL, openGame, stepTicks } from './support/game.ts';

// Transport equality (S4, G14): the SAB triple buffer (COI_PORT, COOP/COEP) and the transfer ping-pong
// (NO_COI_PORT, no COOP/COEP) deliver byte-identical frames. Both runs start paused (?autostart=0) and are
// advanced tick by tick with `step`; the frame fingerprint (xxHash32 over all frame bytes except the
// wall-clock tickTimeUs/debug section, see apps/game/src/frame-hash.ts) must match at ticks 1..200.

const TICKS = 200;
const MOVE_AT = 50;

async function runHashes(page: Page, base: string, transport: 'sab' | 'transfer'): Promise<number[]> {
  await openGame(page, base, `spawn=cubes&autostart=0&transport=${transport}&seed=7`, 0);
  const info = await page.evaluate(() => ({ t: window.__faf!.transport, tick: window.__faf!.tick, paused: window.__faf!.paused }));
  expect(info.t).toBe(transport);
  expect(info.tick).toBe(0);
  await page.evaluate(() => window.__faf!.recordFrameHashes(true));
  await stepTicks(page, MOVE_AT);
  // A move command while paused → applied in tick MOVE_AT + 1 (same in both runs); the target lies
  // in the lowland below the NW plateau of hollow-ridge (the cubes drive down the cliff).
  await page.evaluate(() => {
    const h = window.__faf!;
    h.sendMove(h.ownHandles().filter((_, i) => i % 2 === 0), 150, 190);
  });
  await stepTicks(page, TICKS - MOVE_AT);
  const hashes = await page.evaluate((n) => {
    const out: number[] = [];
    for (let t = 1; t <= n; t++) out.push(window.__faf!.frameHashAt(t) ?? -1);
    return out;
  }, TICKS);
  expect(await page.evaluate(() => window.__faf!.unitCount)).toBe(1024);
  return hashes;
}

test('transports: SAB (COOP/COEP) und Transfer (ohne) liefern bytegleiche Frames (Ticks 1..200)', async ({ browser }, testInfo) => {
  const results: Record<string, number[]> = {};
  for (const [transport, base] of [
    ['sab', COI_URL],
    ['transfer', NO_COI_URL],
  ] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = captureErrors(page);
    results[transport] = await runHashes(page, base, transport);
    expectNoErrors(errors);
    await ctx.close();
  }
  const sab = results['sab']!;
  const transfer = results['transfer']!;
  expect(sab.every((h) => h >= 0), 'every tick 1..200 received (SAB)').toBe(true);
  expect(transfer.every((h) => h >= 0), 'every tick 1..200 received (transfer)').toBe(true);
  const firstDiff = sab.findIndex((h, i) => h !== transfer[i]);
  const dir = resolve(import.meta.dirname, '../../test-results');
  mkdirSync(dir, { recursive: true });
  const report = {
    browser: testInfo.project.name,
    ticks: TICKS,
    moveAtTick: MOVE_AT + 1,
    identical: firstDiff < 0,
    firstDiffTick: firstDiff < 0 ? null : firstDiff + 1,
    finalHash: (sab[TICKS - 1]! >>> 0).toString(16).padStart(8, '0'),
    chainHash: sab.reduce((acc, h) => (Math.imul(acc ^ h, 0x01000193) >>> 0), 0x811c9dc5).toString(16).padStart(8, '0'),
    sab,
    transfer,
  };
  writeFileSync(resolve(dir, `transport-hashes-${testInfo.project.name}.json`), JSON.stringify(report, null, 1));
  await testInfo.attach('transport-hashes', { body: JSON.stringify({ ...report, sab: undefined, transfer: undefined }, null, 2), contentType: 'application/json' });
  expect(firstDiff, `first differing tick: ${firstDiff + 1}`).toBe(-1);
});
