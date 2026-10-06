import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createTestPlaneMap, mapSimHash, readRtsMap, writeRtsMap } from '../../packages/formats/src/index.ts';
import { simIdFor } from '../../packages/sim-host/src/identity.ts';
import { attachJson, captureErrors, expectNoErrors, HOLLOW_RIDGE, openGame, SERVERS, writeReport } from './support/game.ts';

// Map roundtrip (M3, MS2 acceptance "Roundtrip CLI → Datei → Spiel → Datei bytegleich, mapSimHash
// stabil"): the CLI import (mapc: heightmap + JSON markers) produces exactly the checked-in
// hollow-ridge.rtsmap; the game loads it through the asset pipeline, and writeRtsMap(readRtsMap(…))
// in the browser gives the same bytes (SHA-256). mapSimHash is the same constant in Node (ms2-p0
// golden), in the sim worker (`ready`) and in the page; simId = f(SIM_BUILD, bpSimHash, mapSimHash)
// is stable across reloads and matches Node.

const repo = resolve(import.meta.dirname, '../..');
const mapFile = resolve(repo, 'content/maps/hollow-ridge.rtsmap');
const hashes = JSON.parse(readFileSync(resolve(repo, 'content/generated/hashes.json'), 'utf8')) as { simHash: string };
const BP_SIM_HASH = Number.parseInt(hashes.simHash, 16) >>> 0;

function sha256(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

const hex = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(8, '0');

test.describe.configure({ mode: 'serial' });

let cli: { sha: string; bytes: number } | null = null;

test.beforeAll(() => {
  // CLI → file: compile the sources again (mapc), independent of the checked-in file.
  const out = resolve(repo, 'test-results/e2e-map-roundtrip');
  mkdirSync(out, { recursive: true });
  const target = resolve(out, 'hollow-ridge.cli.rtsmap');
  const src = resolve(repo, 'content/maps/src/hollow-ridge');
  execFileSync(
    process.execPath,
    ['--import', 'tsx', resolve(repo, 'packages/formats/scripts/mapc.ts'), '--heightmap', resolve(src, 'heightmap.png'), '--markers', resolve(src, 'markers.json'), '--out', target, '--preview'],
    { cwd: repo, stdio: 'pipe', env: { ...process.env, INIT_CWD: repo } },
  );
  const b = new Uint8Array(readFileSync(target));
  cli = { sha: sha256(b), bytes: b.length };
});

for (const server of SERVERS) {
  test(`map-roundtrip: CLI → Datei → Spiel → Datei bytegleich, mapSimHash + simId stabil – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    const file = new Uint8Array(readFileSync(mapFile));
    const fileSha = sha256(file);
    const nodeHash = mapSimHash(readRtsMap(file)) >>> 0;
    expect(nodeHash, 'Node mapSimHash == ms2-p0 constant').toBe(HOLLOW_RIDGE.mapSimHash);
    expect(cli!.sha, 'mapc output == checked-in file').toBe(fileSha);
    const expectedSimId = simIdFor(BP_SIM_HASH, nodeHash);

    await openGame(page, server.url, 'spawn=cubes', 1024);
    const game = await page.evaluate(async () => {
      const h = window.__faf!;
      return { exp: await h.exportMap(), simId: h.simId, mapSimHash: h.mapSimHash, mapName: h.mapName };
    });
    await expect(page.locator('[data-testid="hud-mapsimhash"]')).toHaveText(hex(HOLLOW_RIDGE.mapSimHash));
    await expect(page.locator('[data-testid="hud-map"]')).toHaveText(HOLLOW_RIDGE.name);

    // Reload: identities unchanged.
    await openGame(page, server.url, 'spawn=cubes', 1024);
    const reload = await page.evaluate(() => ({ simId: window.__faf!.simId, mapSimHash: window.__faf!.mapSimHash }));
    // Test plane: a generated map (formats createTestPlaneMap) on the same path, with its own identity.
    await openGame(page, server.url, 'spawn=cubes&map=testplane', 1024);
    const plane = await page.evaluate(() => ({ simId: window.__faf!.simId, mapSimHash: window.__faf!.mapSimHash, exp: null as unknown }));
    plane.exp = await page.evaluate(() => window.__faf!.exportMap());

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      file: { bytes: file.length, sha256: fileSha },
      cli,
      node: { mapSimHash: hex(nodeHash), simId: hex(expectedSimId), bpSimHash: hex(BP_SIM_HASH) },
      game: { ...game, simId: hex(game.simId ?? 0), mapSimHash: hex(game.mapSimHash ?? 0) },
      reload: { simId: hex(reload.simId ?? 0), mapSimHash: hex(reload.mapSimHash ?? 0) },
      testplane: { simId: hex(plane.simId ?? 0), mapSimHash: hex(plane.mapSimHash ?? 0) },
    };
    writeReport(`map-roundtrip-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'map-roundtrip', report);

    expect(game.exp).not.toBeNull();
    expect(game.exp!.identical).toBe(true);
    expect(game.exp!.bytes).toBe(file.length);
    expect(game.exp!.sha256).toBe(fileSha);
    expect(game.exp!.mapSimHash).toBe(HOLLOW_RIDGE.mapSimHash);
    expect(game.exp!.workerMapSimHash).toBe(HOLLOW_RIDGE.mapSimHash);
    expect(game.mapSimHash).toBe(HOLLOW_RIDGE.mapSimHash);
    expect(game.mapName).toBe(HOLLOW_RIDGE.name);
    expect(game.simId).toBe(expectedSimId);
    expect(reload).toEqual({ simId: game.simId, mapSimHash: game.mapSimHash });
    const planeMap = createTestPlaneMap();
    const planeHash = mapSimHash(planeMap) >>> 0;
    expect(plane.mapSimHash).toBe(planeHash);
    expect(plane.simId).toBe(simIdFor(BP_SIM_HASH, planeHash));
    expect(plane.simId).not.toBe(game.simId);
    const planeExp = plane.exp as { identical: boolean; bytes: number; mapSimHash: number } | null;
    expect(planeExp).not.toBeNull();
    expect(planeExp!.identical).toBe(true);
    expect(planeExp!.bytes).toBe(writeRtsMap(planeMap).length);
    expect(planeExp!.mapSimHash).toBe(planeHash);
    expectNoErrors(errors);
  });
}
