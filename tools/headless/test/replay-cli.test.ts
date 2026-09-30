/**
 * replay-verify (TRACK-REPLAY p5): verifyReplayFile on converted golden logs, a manipulated HASH
 * entry, FAFL input, map choice, incompatible/broken input; the CLI's exit codes 0/1/2.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FormatError,
  readContainer,
  readRtsReplay,
  replayMetaToCanonicalJson,
  RTSREPLAY_FORMAT_VERSION,
  RTSREPLAY_MAGIC,
  rtsReplayToInput,
  writeContainer,
  writeRtsReplay,
  type RtsReplayInput,
} from '@faf/formats';
import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import { convertCommandLog, ReplayCompatError } from '@faf/sim-host';
import { detectReplayFileKind, findMapBySimHash, ReplayInputError, verifyReplayFile, type ReplayAssets } from '../src/replay/verify.ts';
import { HEADLESS_DIR, REPO_DIR } from '../scripts/lib.ts';
import { loadReplayAssets } from '../scripts/replay-cli-lib.ts';

const LOGS = resolve(REPO_DIR, 'test/golden-replays/logs');
const RIDGE = 'content/maps/hollow-ridge.rtsmap';

let assets: ReplayAssets;
let ridgeLog: Uint8Array;
let ridgeReplay: Uint8Array;
let badHash: Uint8Array;
let tmp: string;

function modified(bytes: Uint8Array, edit: (inp: RtsReplayInput) => RtsReplayInput): Uint8Array {
  return writeRtsReplay(edit(rtsReplayToInput(readRtsReplay(bytes))));
}

/** Byte-level edit of the container chunks (for files the writer would refuse). */
function patched(bytes: Uint8Array, edit: (chunks: { id: string; data: Uint8Array }[]) => void): Uint8Array {
  const chunks = readContainer(bytes, RTSREPLAY_MAGIC).chunks.map((c) => ({ id: c.id, data: c.data.slice() }));
  edit(chunks);
  return writeContainer(RTSREPLAY_MAGIC, RTSREPLAY_FORMAT_VERSION, chunks);
}

/** ridgeReplay with META.endTick set to `endTick` and every rule hash from tick `flipFrom` on flipped. */
function shortenedMeta(endTick: number, flipFrom: number): Uint8Array {
  const flipped = modified(ridgeReplay, (inp) => {
    const hashes = inp.hashes.hashes.map((h, i) => (inp.hashes.firstTick + i * inp.hashes.interval >= flipFrom ? (h ^ 1) >>> 0 : h));
    return { ...inp, hashes: { ...inp.hashes, hashes } };
  });
  return patched(flipped, (cs) => {
    const i = cs.findIndex((c) => c.id === 'META');
    const t = new TextEncoder().encode(replayMetaToCanonicalJson({ ...readRtsReplay(ridgeReplay).meta!, endTick }));
    const d = new Uint8Array(2 + t.length);
    d[0] = 1;
    d.set(t, 2);
    cs[i] = { id: 'META', data: d };
  });
}

/** ridgeReplay with the rule-hash grid shifted by 5 ticks (the sim never produces those hashes). */
function offGrid(): Uint8Array {
  return modified(ridgeReplay, (inp) => ({ ...inp, hashes: { ...inp.hashes, firstTick: inp.hashes.firstTick - 5 } }));
}

beforeAll(() => {
  assets = loadReplayAssets();
  ridgeLog = new Uint8Array(readFileSync(resolve(LOGS, 'ridge-1000-move.faflog')));
  const conv = convertCommandLog(ridgeLog, { map: assets.maps[RIDGE]!, simBin: assets.simBin });
  expect(conv.verified).toBe(true);
  ridgeReplay = conv.bytes;
  badHash = modified(ridgeReplay, (inp) => {
    const hashes = inp.hashes.hashes.slice();
    const i = (1100 - inp.hashes.firstTick) / inp.hashes.interval;
    hashes[i] = (hashes[i]! ^ 0x00400000) >>> 0;
    return { ...inp, hashes: { ...inp.hashes, hashes } };
  });
  tmp = mkdtempSync(resolve(tmpdir(), 'faf-replay-cli-'));
});

afterAll(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
});

describe('verifyReplayFile', () => {
  it('a converted golden log plays bit-identically (all hashes and sub-hash rows)', () => {
    let t = 0;
    const v = verifyReplayFile(ridgeReplay, assets, { clock: () => (t += 50) });
    expect(v).toMatchObject({
      kind: 'rtsreplay',
      endTick: 2000,
      replayEndTick: 2000,
      compared: 200,
      recordedHashes: 200,
      subCompared: 20,
      recordedSubHashes: 20,
      divergences: [],
      tainted: true,
      complete: true,
      truncated: false,
      mapKey: RIDGE,
      convertMs: 0,
    });
    // Injected clock: open → end = 50 ms → 2,000 ticks / 0.05 s.
    expect(v.ms).toBe(50);
    expect(v.ticksPerSecond).toBe(40000);
    expect(v.xRealtime).toBe(4000);
  });

  it('a manipulated HASH entry → divergence with tick, expected/actual', () => {
    const v = verifyReplayFile(badHash, assets);
    expect(v.divergences).toHaveLength(1);
    const d = v.divergences[0]!;
    expect(d).toMatchObject({ tick: 1100, kind: 'rule', regions: [] });
    expect(d.expected).toBe((d.actual ^ 0x00400000) >>> 0);
    expect(v.compared).toBe(200);
  });

  it('FAFL input is converted with sub-hashes first and verifies the same way', () => {
    const v = verifyReplayFile(ridgeLog, assets);
    expect(v.kind).toBe('fafl');
    expect(v.divergences).toEqual([]);
    expect(v.subCompared).toBe(20);
    expect(v.convertMs).toBeGreaterThan(0);
    expect(v.fullHash).toBe(verifyReplayFile(ridgeReplay, assets, { untilTick: 2000 }).fullHash);
  });

  it('untilTick stops early; the test plane is generated when no map matches', () => {
    const cubes = new Uint8Array(readFileSync(resolve(LOGS, 'cubes-churn.faflog')));
    const v = verifyReplayFile(cubes, assets, { untilTick: 300 });
    expect(v).toMatchObject({ kind: 'fafl', endTick: 300, replayEndTick: 2000, compared: 30, subCompared: 3, divergences: [], mapKey: null, mapName: 'testplane' });
  });

  it('chooses the map by HEAD.mapSimHash; without it the replay is refused (map)', () => {
    const head = readRtsReplay(ridgeReplay).head;
    expect(findMapBySimHash(assets.maps, head.mapSimHash)?.key).toBe(RIDGE);
    const noRidge: ReplayAssets = { simBin: assets.simBin, maps: Object.fromEntries(Object.entries(assets.maps).filter(([k]) => k !== RIDGE)) };
    expect(findMapBySimHash(noRidge.maps, head.mapSimHash)).toBeNull();
    expect(() => verifyReplayFile(ridgeReplay, noRidge)).toThrow(ReplayCompatError);
  });

  it('a shortened META.endTick cannot hide divergences behind it (review: 50/200 hashes, exit 0)', () => {
    // META.endTick 500 and every rule hash from tick 610 on flipped: refused as a broken file.
    const short = shortenedMeta(500, 610);
    expect(() => verifyReplayFile(short, assets)).toThrow(expect.objectContaining({ code: 'bad-value', chunkId: 'META' }));
    // An inflated META.endTick is ignored: all hashes compared, playback ends at the content.
    const huge = patched(ridgeReplay, (cs) => {
      const i = cs.findIndex((c) => c.id === 'META');
      const t = new TextEncoder().encode(replayMetaToCanonicalJson({ ...readRtsReplay(ridgeReplay).meta!, endTick: 0xffffffff }));
      const d = new Uint8Array(2 + t.length);
      d[0] = 1;
      d.set(t, 2);
      cs[i] = { id: 'META', data: d };
    });
    const v = verifyReplayFile(huge, assets);
    expect(v).toMatchObject({ endTick: 2000, replayEndTick: 2000, compared: 200, expectedHashes: 200, subCompared: 20, fullyCompared: true, divergences: [] });
    expect(v.warnings.some((w) => w.includes('META.endTick 4294967295'))).toBe(true);
  });

  it('recorded hashes that were not compared make the verification incomplete', () => {
    const v = verifyReplayFile(offGrid(), assets);
    expect(v.divergences).toEqual([]);
    expect(v).toMatchObject({ compared: 0, expectedHashes: 200, fullyCompared: false });
    // Sub-hash regions of another layout: sub-hash check off (warning) → incomplete too.
    const regions = modified(ridgeReplay, (inp) => ({ ...inp, hashes: { ...inp.hashes, regionNames: inp.hashes.regionNames.map((n, i) => (i === 0 ? `${n}X` : n)) } }));
    const w = verifyReplayFile(regions, assets);
    expect(w).toMatchObject({ compared: 200, subCompared: 0, expectedSubHashes: 20, fullyCompared: false, divergences: [] });
    expect(w.warnings.join('\n')).toContain('sub-hash check off');
    // untilTick: only the hashes up to that tick are expected.
    expect(verifyReplayFile(ridgeReplay, assets, { untilTick: 305 })).toMatchObject({ compared: 30, expectedHashes: 30, subCompared: 3, expectedSubHashes: 3, fullyCompared: true });
  });

  it('other protocol or chunk versions: ReplayCompatError with redirect, not a FormatError', () => {
    for (const [reason, bytes] of [
      ['protocol', patched(ridgeReplay, (cs) => new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION + 1, true))],
      ['protocol', patched(ridgeReplay, (cs) => new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION - 1, true))],
      ['format', patched(ridgeReplay, (cs) => void (cs.find((c) => c.id === 'HASH')!.data[0] = 2))],
    ] as const) {
      let err: unknown;
      try {
        verifyReplayFile(bytes, assets);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ReplayCompatError);
      expect((err as ReplayCompatError).reason).toBe(reason);
      expect((err as ReplayCompatError).redirect).toBe(`/b/${readRtsReplay(ridgeReplay).head.buildHash}/`);
    }
  });

  it('incompatible and broken input: ReplayCompatError, FormatError, ReplayInputError', () => {
    const otherBuild = modified(ridgeReplay, (inp) => ({ ...inp, head: { ...inp.head, simBuild: 'faf-sim/ms9.9' } }));
    let err: unknown;
    try {
      verifyReplayFile(otherBuild, assets);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplayCompatError);
    expect((err as ReplayCompatError).reason).toBe('sim-build');
    const cut = ridgeReplay.slice(0, ridgeReplay.length - 7);
    expect(() => verifyReplayFile(cut, assets)).toThrow(FormatError);
    expect(() => verifyReplayFile(new Uint8Array([1, 2, 3, 4, 5, 6]), assets)).toThrow(ReplayInputError);
    expect(detectReplayFileKind(ridgeReplay)).toBe('rtsreplay');
    expect(detectReplayFileKind(ridgeLog)).toBe('fafl');
    expect(detectReplayFileKind(new Uint8Array([0x52]))).toBe('unknown');
  });
});

describe('replay-verify CLI', () => {
  function cli(args: readonly string[]): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', resolve(HEADLESS_DIR, 'scripts/replay-verify.ts'), ...args], {
      cwd: HEADLESS_DIR,
      encoding: 'utf8',
      env: { ...process.env, INIT_CWD: tmp },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('exit 0 bit-identical, 1 divergence (tick, expected/actual, tables), 2 incompatible/format error', () => {
    writeFileSync(resolve(tmp, 'ok.rtsreplay'), ridgeReplay);
    writeFileSync(resolve(tmp, 'bad.rtsreplay'), badHash);
    writeFileSync(resolve(tmp, 'other.rtsreplay'), modified(ridgeReplay, (inp) => ({ ...inp, head: { ...inp.head, simBuild: 'faf-sim/ms9.9', buildHash: 'c0ffee42' } })));
    writeFileSync(resolve(tmp, 'broken.rtsreplay'), ridgeReplay.slice(0, 40));
    writeFileSync(resolve(tmp, 'short.rtsreplay'), shortenedMeta(500, 610));
    writeFileSync(resolve(tmp, 'offgrid.rtsreplay'), offGrid());

    const ok = cli(['--', 'ok.rtsreplay', '--until', '200']);
    expect(ok.status).toBe(0);
    expect(ok.out).toContain('Hashes geprüft');
    expect(ok.out).toMatch(/ok\.rtsreplay\s+\|\s+200 \|\s+20\/200 \|\s+2\/20 \| bitgleich/);

    const bad = cli(['ok.rtsreplay', 'bad.rtsreplay', '--until', '1.100']);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('erste Abweichung bei Tick 1.100 (Regel-Hash)');
    expect(bad.out).toMatch(/erwartet 0x[0-9a-f]{8}, ist 0x[0-9a-f]{8}; Tabelle\(n\)/);

    const incompatible = cli(['other.rtsreplay', 'broken.rtsreplay', '--json']);
    expect(incompatible.status).toBe(2);
    const j = JSON.parse(incompatible.out) as { exitCode: number; files: { file: string; exitCode: number; result: string; detail: string }[] };
    expect(j.exitCode).toBe(2);
    expect(j.files.map((f) => [f.file, f.exitCode, f.result])).toEqual([
      ['other.rtsreplay', 2, 'inkompatibel'],
      ['broken.rtsreplay', 2, 'Formatfehler'],
    ]);
    expect(j.files[0]!.detail).toContain('faf-sim/ms9.9');
    expect(j.files[0]!.detail).toContain('/b/c0ffee42/');
    expect(j.files[1]!.detail).toMatch(/^Formatfehler [a-z-]+/);

    // Review scenario: shortened META + flipped hashes behind it → format error, never "bitgleich".
    const short = cli(['short.rtsreplay']);
    expect(short.status).toBe(2);
    expect(short.out).not.toContain('bitgleich');
    // Hashes recorded but not compared → not exit 0.
    const incomplete = cli(['offgrid.rtsreplay', '--until', '500']);
    expect(incomplete.status).toBe(1);
    expect(incomplete.out).toContain('unvollständig geprüft: nur 0 von 50 Regel-Hashes');

    expect(cli([]).status).toBe(2);
  });
});
