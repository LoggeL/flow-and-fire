// P3 asset pipeline: determinism, manifest contract, meshopt GLB == raw fallback, check/drift.
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { parseAssetManifest } from '@faf/blueprints/asset-manifest';
import { parseViewJson } from '@faf/blueprints/view';
import { mapSimHash, readRtsMap } from '@faf/formats';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSETS_DIR, buildAssets, cubeBot, diffAssets, writeAssets, type AssetBuild } from '../src/index.ts';

let build: AssetBuild;
beforeAll(async () => {
  build = await buildAssets();
});

function file(path: string): Uint8Array {
  const f = build.files.find((x) => x.path === path);
  if (f === undefined) throw new Error(`no file ${path}`);
  return f.bytes;
}

interface DecodedLod {
  positions: number[][];
  normals: number[][];
  partIds: number[];
  triangles: string[];
}

/** Reads a GLB with gltf-transform (independent of the client's parser) into world-space data. */
async function decodeGlb(bytes: Uint8Array): Promise<{ doc: Document; lods: DecodedLod[] }> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(bytes);
  const lods: DecodedLod[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const m = node.getWorldMatrix();
    const prim = mesh.listPrimitives()[0]!;
    const pos = prim.getAttribute('POSITION')!;
    const nrm = prim.getAttribute('NORMAL')!;
    const pid = prim.getAttribute('_PARTID')!;
    const idx = prim.getIndices()!;
    const lod: DecodedLod = { positions: [], normals: [], partIds: [], triangles: [] };
    const e = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, e);
      lod.positions.push([
        m[0] * e[0]! + m[4] * e[1]! + m[8] * e[2]! + m[12],
        m[1] * e[0]! + m[5] * e[1]! + m[9] * e[2]! + m[13],
        m[2] * e[0]! + m[6] * e[1]! + m[10] * e[2]! + m[14],
      ]);
      nrm.getElement(i, e);
      const l = Math.hypot(e[0]!, e[1]!, e[2]!);
      lod.normals.push([e[0]! / l, e[1]! / l, e[2]! / l]);
      lod.partIds.push(pid.getScalar(i));
    }
    for (let t = 0; t < idx.getCount(); t += 3) {
      const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
      // Canonical rotation (the meshopt index codec may rotate a triangle, never flip it).
      const k = tri.indexOf(Math.min(...tri));
      lod.triangles.push([tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]].join(','));
    }
    lods.push(lod);
  }
  return { doc, lods };
}

describe('asset pipeline build', () => {
  it('is byte-deterministic (two builds are identical)', async () => {
    const again = await buildAssets();
    expect(again.files.map((f) => f.path)).toEqual(build.files.map((f) => f.path));
    for (let i = 0; i < build.files.length; i++) {
      expect(Buffer.from(again.files[i]!.bytes).equals(Buffer.from(build.files[i]!.bytes)), build.files[i]!.path).toBe(true);
    }
  });

  it('writes a valid, canonical manifest whose entries match the hashed files', () => {
    const text = new TextDecoder().decode(file('manifest.json'));
    const m = parseAssetManifest(text);
    expect(text).toBe(build.manifestText);
    expect(Object.keys(m.assets)).toEqual([...Object.keys(m.assets)].sort());
    expect(m.assets['content/sim.bin']?.kind).toBe('simbin');
    expect(m.assets['content/view.json']?.kind).toBe('viewjson');
    expect(m.assets['maps/hollow-ridge']?.kind).toBe('map');
    expect(m.assets['units/cube_bot']?.kind).toBe('model');
    const refs = Object.values(m.assets).flatMap((e) => (e.fallback === undefined ? [e] : [e, e.fallback]));
    for (const r of refs) {
      const bytes = file(r.url);
      expect(r.bytes).toBe(bytes.length);
      expect(r.hash).toBe(`sha256-${createHash('sha256').update(bytes).digest('base64')}`);
      const hex = createHash('sha256').update(bytes).digest('hex');
      expect(r.url).toContain(`.${hex.slice(0, 8)}.`);
    }
    expect(m.assets['units/cube_bot']!.url).toMatch(/^models\/units\/cube_bot\.[0-9a-f]{8}\.glb$/);
    expect(m.assets['units/cube_bot']!.fallback!.url).toMatch(/^models\/units\/cube_bot\.[0-9a-f]{8}\.raw\.glb$/);
    // Hashed copies are byte-identical to their sources.
    const map = file(m.assets['maps/hollow-ridge']!.url);
    expect(mapSimHash(readRtsMap(map))).toBe(0x90ec94f0);
    const view = parseViewJson(new TextDecoder().decode(file(m.assets['content/view.json']!.url)));
    expect(view.visuals.map((v) => v.mesh)).toContain('units/cube_bot');
    expect(build.files.length).toBe(refs.length + 1);
  });

  it('meshopt GLB decodes to the same vertex data as the raw fallback (quantization tolerance)', async () => {
    const m = build.manifest.assets['units/cube_bot']!;
    const packed = await decodeGlb(file(m.url));
    const raw = await decodeGlb(file(m.fallback!.url));
    expect(packed.doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).sort()).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
    ]);
    expect(raw.doc.getRoot().listExtensionsUsed()).toEqual([]);
    expect(packed.lods).toHaveLength(3);
    expect(raw.lods).toHaveLength(3);
    const src = cubeBot();
    let maxPos = 0;
    let maxNrm = 0;
    for (let l = 0; l < 3; l++) {
      const a = packed.lods[l]!;
      const b = raw.lods[l]!;
      expect(a.positions.length).toBe(src.lods[l]!.positions.length / 3);
      expect(a.partIds).toEqual(b.partIds);
      expect(a.triangles).toEqual(b.triangles);
      for (let i = 0; i < a.positions.length; i++) {
        for (let c = 0; c < 3; c++) {
          maxPos = Math.max(maxPos, Math.abs(a.positions[i]![c]! - b.positions[i]![c]!));
          maxNrm = Math.max(maxNrm, Math.abs(a.normals[i]![c]! - b.normals[i]![c]!));
          // The raw fallback is exactly the source geometry.
          expect(b.positions[i]![c]).toBe(src.lods[l]!.positions[i * 3 + c]);
        }
      }
    }
    // 14-bit positions over a ≈ 0.67 WU extent: step ≈ 4e-5 WU; 8-bit normals: ≈ 1/127.
    expect(maxPos).toBeLessThan(1e-4);
    expect(maxNrm).toBeLessThan(0.02);
    expect(file(m.url).length).toBeLessThan(file(m.fallback!.url).length);
  });

  it('cube_bot: 3 LODs with decreasing triangle counts, 3 parts with pivots and parents', () => {
    const bot = cubeBot();
    const tris = bot.lods.map((l) => l.indices.length / 3);
    expect(tris[0]).toBeGreaterThan(tris[1]!);
    expect(tris[1]).toBeGreaterThan(tris[2]!);
    expect(bot.parts.map((p) => p.parent)).toEqual([0, 0, 1]);
    for (const lod of bot.lods) {
      expect(new Set(lod.partIds)).toEqual(new Set([0, 1, 2]));
      for (let i = 1; i < lod.positions.length; i += 3) expect(lod.positions[i]).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < lod.normals.length; i += 3) {
        expect(Math.hypot(lod.normals[i]!, lod.normals[i + 1]!, lod.normals[i + 2]!)).toBeCloseTo(1, 3);
      }
    }
  });
});

describe('asset pipeline check', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'faf-assets-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('the checked-in content/generated/assets is up to date (run `pnpm assets`)', async () => {
    expect(await diffAssets(build, ASSETS_DIR)).toEqual([]);
  });

  it('detects missing, changed and stale files; write repairs them', async () => {
    await cp(ASSETS_DIR, dir, { recursive: true });
    expect(await diffAssets(build, dir)).toEqual([]);
    const url = build.manifest.assets['units/cube_bot']!.url;
    const bytes = await readFile(join(dir, url));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await writeFile(join(dir, url), bytes);
    await writeFile(join(dir, 'maps', 'old.00000000.rtsmap'), new Uint8Array(4));
    await rm(join(dir, 'manifest.json'));
    expect(await diffAssets(build, dir)).toEqual([`changed ${url}`, 'missing manifest.json', 'stale maps/old.00000000.rtsmap']);
    const r = await writeAssets(build, dir);
    expect(r).toEqual({ written: 2, removed: 1 });
    expect(await diffAssets(build, dir)).toEqual([]);
  });

  it('rejects view.mesh references to unknown models', async () => {
    await expect(buildAssets({ models: [] })).rejects.toThrow(/core:cube → units\/cube_bot/);
  });
});
