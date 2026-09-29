import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readRtsMap, writeRtsMap } from '../src/index.ts';
import { decodePgm, decodeR16, encodeHeightmapPng, encodePgm, encodeR16, HeightmapError, readHeightmap, type HeightmapData } from '../scripts/heightmap-io.ts';
import { compileMap, compileMapSource, MapcError, mapcFiles, MAPS_DIR, MAPS_SRC_DIR, wuToRaw, degToAng16 } from '../scripts/mapc.ts';
import { generateHollowRidgeHeights, hollowRidgeMarkers } from '../scripts/mapgen.ts';
import { decodePng, encodePng } from '../scripts/png.ts';

const tmp = mkdtempSync(join(tmpdir(), 'faf-mapc-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function testHeightmap(dim = 65): HeightmapData {
  const samples = new Uint16Array(dim * dim);
  for (let z = 0; z < dim; z++) for (let x = 0; x < dim; x++) samples[z * dim + x] = 1000 + ((x * 311 + z * 173) % 4000);
  return { dim, samples };
}

function testMarkers(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Testkarte',
    sizeWu: 64,
    heightScale: 1 / 128,
    waterLevel: 5,
    starts: [
      { army: 1, x: 48, z: 48.5 },
      { army: 0, x: 16.25, z: 16 },
    ],
    mass: [{ x: 10, z: 10 }],
    hydro: [{ x: 30.0001, z: 20 }],
    props: [{ id: 'core:rock_01', x: 5, z: 6, yawDeg: 90, scale: 1.25 }],
    ...extra,
  };
}

function problemsOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof MapcError) return e.message;
    throw e;
  }
  return '';
}

describe('mapc (CLI import)', () => {
  it('converts WU to Fx raw exactly once (Math.round(v·4096))', () => {
    const m = compileMap({ heightmap: testHeightmap(), markers: testMarkers() });
    expect(m.meta.heightScaleRaw).toBe(32);
    expect(m.meta.waterLevelRaw).toBe(5 * 4096);
    expect(m.meta.starts).toEqual([
      { army: 0, x: 16.25 * 4096, z: 16 * 4096 },
      { army: 1, x: 48 * 4096, z: 48.5 * 4096 },
    ]);
    expect(m.meta.spots).toEqual([
      { kind: 'mass', x: 40960, z: 40960 },
      { kind: 'hydro', x: Math.round(30.0001 * 4096), z: 20 * 4096 },
    ]);
    expect(m.props).toEqual([{ id: 'core:rock_01', x: 5 * 4096, z: 6 * 4096, yaw: 16384, scalePermille: 1250 }]);
    expect(wuToRaw(-0.00001)).toBe(0);
    expect(Object.is(wuToRaw(-0.00001), -0)).toBe(false);
    expect(degToAng16(-90)).toBe(49152);
    expect(degToAng16(360)).toBe(0);
  });

  it('produces the same map from .png, .pgm and .r16 of the same heights', () => {
    const hm = testHeightmap();
    const markers = join(tmp, 'markers.json');
    writeFileSync(markers, JSON.stringify(testMarkers()));
    const files = { png: encodeHeightmapPng(hm), pgm: encodePgm(hm), r16: encodeR16(hm) };
    const outputs = Object.entries(files).map(([ext, bytes]) => {
      const path = join(tmp, `h.${ext}`);
      writeFileSync(path, bytes);
      expect(readHeightmap(path)).toEqual(hm);
      return mapcFiles({ heightmap: path, markers, preview: true }).bytes;
    });
    expect(outputs[1]).toEqual(outputs[0]);
    expect(outputs[2]).toEqual(outputs[0]);
  });

  it('reads 8-bit PNG/PGM heightmaps with v·257 expansion and rejects bad inputs', () => {
    const png8 = encodePng({ width: 65, height: 65, bitDepth: 8, channels: 1, samples: new Uint16Array(65 * 65).fill(200) });
    const p = join(tmp, 'h8.png');
    writeFileSync(p, png8);
    expect(readHeightmap(p).samples[100]).toBe(200 * 257);
    const pgm8 = new Uint8Array([...new TextEncoder().encode('P5\n# comment\n65 65\n255\n'), ...new Uint8Array(65 * 65).fill(3)]);
    expect(decodePgm(pgm8).samples[7]).toBe(3 * 257);
    expect(() => decodeR16(new Uint8Array(64 * 64 * 2))).toThrow(HeightmapError);
    expect(() => decodeR16(new Uint8Array(3))).toThrow(HeightmapError);
    expect(() => decodePgm(new TextEncoder().encode('P2\n65 65\n65535\n'))).toThrow(HeightmapError);
    const rgb = join(tmp, 'rgb.png');
    writeFileSync(rgb, encodePng({ width: 65, height: 65, bitDepth: 8, channels: 4, samples: new Uint16Array(65 * 65 * 4) }));
    expect(() => readHeightmap(rgb)).toThrow(/grayscale/);
    expect(() => readHeightmap(join(tmp, 'x.tif'))).toThrow();
  });

  it('builds a splat chunk from RGBA PNGs', () => {
    const plane = new Uint16Array(4 * 4 * 4).map((_, i) => i & 0xff);
    const png = encodePng({ width: 4, height: 4, bitDepth: 8, channels: 4, samples: plane });
    const m = compileMap({ heightmap: testHeightmap(), markers: testMarkers(), splatPngs: [png, png] });
    expect(m.splat).toEqual({ codec: 0, layers: 8, resolution: 4, planes: [Uint8Array.from(plane), Uint8Array.from(plane)] });
    expect(readRtsMap(writeRtsMap(m)).splat).toEqual(m.splat);
  });

  it('reports validation errors clearly', () => {
    const hm = testHeightmap();
    const c = (extra: Record<string, unknown>) => problemsOf(() => compileMap({ heightmap: hm, markers: testMarkers(extra) }));
    expect(c({ sizeWu: 128 })).toMatch(/sizeWu 128 does not match the heightmap \(65×65 samples ⇒ sizeWu 64\)/);
    expect(c({ mass: [{ x: 70, z: 1 }] })).toMatch(/mass\[0\] \(x=70, z=1\) lies outside the map \(0\.\.64 WU\)/);
    expect(c({ starts: [{ army: 0, x: 1, z: 1 }, { army: 0, x: 2, z: 2 }] })).toMatch(/army 0 has more than one start position/);
    expect(c({ starts: [] })).toMatch(/at least one start position/);
    expect(c({ version: 2 })).toMatch(/version must be 1/);
    expect(c({ colour: 'x' })).toMatch(/unknown key 'colour'/);
    expect(c({ heightScale: 0.01 })).toMatch(/outside 1\.\.32 raw/);
    expect(c({ heightScaleRaw: 32 })).toMatch(/either 'heightScale' or 'heightScaleRaw'/);
    expect(c({ props: [{ id: 'Rock', x: 1, z: 1 }] })).toMatch(/namespace id/);
    expect(c({ light: { azimuthDeg: 400, elevationDeg: 10, sun: [1, 2, 3], ambient: [1, 2] } })).toMatch(/azimuthDeg[\s\S]*ambient/);
    expect(c({ waterLevel: undefined })).toMatch(/missing 'waterLevel'/);
    // Spot in deep water: terrain ≈ 7.8..39 WU, water at 30 WU ⇒ the low corner is deep.
    expect(c({ waterLevel: 30, mass: [{ x: 0, z: 0 }] })).toMatch(/mass\[0\] \(x=0, z=0\) lies in deep water/);
    // All problems at once.
    expect(c({ version: 3, name: '' }).split('\n').length).toBeGreaterThan(2);
  });

  it('runs as a CLI (pnpm --filter @faf/formats mapc -- …)', () => {
    const hmPath = join(tmp, 'cli.png');
    writeFileSync(hmPath, encodeHeightmapPng(testHeightmap()));
    const markers = join(tmp, 'cli-markers.json');
    writeFileSync(markers, JSON.stringify(testMarkers()));
    const out = join(tmp, 'cli.rtsmap');
    const script = resolve(import.meta.dirname, '../scripts/mapc.ts');
    const r = spawnSync(process.execPath, ['--import', 'tsx', script, '--', '--heightmap', hmPath, '--markers', markers, '--out', out, '--preview'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mapc: wrote .*cli\.rtsmap/);
    expect(new Uint8Array(readFileSync(out))).toEqual(mapcFiles({ heightmap: hmPath, markers, preview: true }).bytes);
    const bad = spawnSync(process.execPath, ['--import', 'tsx', script, '--heightmap', hmPath], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/missing --markers, --out/);
  });
});

describe('checked-in maps are fresh', () => {
  it('mapc from content/maps/src/hollow-ridge reproduces content/maps/hollow-ridge.rtsmap byte-exactly', () => {
    const checkedIn = new Uint8Array(readFileSync(join(MAPS_DIR, 'hollow-ridge.rtsmap')));
    const { bytes } = compileMapSource(join(MAPS_SRC_DIR, 'hollow-ridge'));
    expect(bytes.length).toBe(checkedIn.length);
    expect(Buffer.from(bytes).equals(Buffer.from(checkedIn))).toBe(true);
  });

  it('mapgen reproduces the checked-in sources (heights and markers.json)', () => {
    const dir = join(MAPS_SRC_DIR, 'hollow-ridge');
    const png = decodePng(new Uint8Array(readFileSync(join(dir, 'heightmap.png'))));
    expect(png.bitDepth).toBe(16);
    expect(png.channels).toBe(1);
    const gen = generateHollowRidgeHeights();
    expect(png.width).toBe(gen.dim);
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(gen.samples.buffer))).toBe(true);
    expect(readFileSync(join(dir, 'markers.json'), 'utf8')).toBe(`${JSON.stringify(hollowRidgeMarkers(), null, 2)}\n`);
  });
});
