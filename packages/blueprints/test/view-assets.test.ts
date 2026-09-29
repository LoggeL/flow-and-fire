// MS2 (P3): view.mesh / view.lod (view only, simHash pinned) and the asset manifest contract.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSET_ID_PATTERN,
  BlueprintCompileError,
  assetIdsOfKind,
  compileBlueprints,
  defineUnit,
  hex32,
  parseAssetManifest,
  parseViewJson,
  serializeAssetManifest,
  type AssetManifest,
  type UnitBlueprint,
} from '../src/index.ts';
import { compileContent, CONTENT_GENERATED } from '../scripts/content.ts';

/** simHash of the game bundle since MS1 (`faf-sim/ms1.x`); view changes must never move it. */
const PINNED_SIM_HASH = 0xd4135af1;
/** SHA-256 of content/generated/sim.bin as checked in with MS1 (commit 01a464a). */
const PINNED_SIM_BIN_SHA256 = 'e6be93f7b7d4d0ae7af46acc103a5918b82b7470118297a103e3be4e97ec46ed';

function unit(id: string, view: Partial<UnitBlueprint['view']> = {}): UnitBlueprint {
  return {
    id,
    categories: ['LAND'],
    sim: {
      health: { max: 10 },
      motion: { layer: 'land', speed: 1, accel: 1, turnRateDeg: 90, sizeClass: 1, footprint: [1, 1], maxSlope: 1 },
    },
    view: { placeholder: { hull: 'box', size: [1, 1, 1] }, ...view },
  };
}

const src = (...defs: ReturnType<typeof defineUnit>[]) => defs.map((def, i) => ({ def, source: `t${i}.ts` }));

describe('blueprint view: mesh + lod (MS2)', () => {
  it('emits view.mesh and view.lod into view.json without touching sim.bin/simHash', () => {
    const plain = compileBlueprints(src(defineUnit(unit('core:a'))));
    const meshed = compileBlueprints(src(defineUnit(unit('core:a', { mesh: 'units/cube_bot', lod: [40, 120] }))));
    expect(meshed.simHash).toBe(plain.simHash);
    expect(Buffer.from(meshed.simBin).equals(Buffer.from(plain.simBin))).toBe(true);
    expect(meshed.viewHash).not.toBe(plain.viewHash);
    expect(meshed.view.visuals[0]).toMatchObject({ mesh: 'units/cube_bot', lod: [40, 120] });
    expect(parseViewJson(meshed.viewJson)).toEqual(meshed.view);
    expect(plain.view.visuals[0]!.mesh).toBeUndefined();
  });

  it('rejects bad mesh ids and non-increasing LOD distances', () => {
    expect(() => compileBlueprints(src(defineUnit(unit('core:a', { mesh: 'Units/Bad Name' }))))).toThrow(BlueprintCompileError);
    expect(() => compileBlueprints(src(defineUnit(unit('core:a', { lod: [100, 50] }))))).toThrow(/LOD distances must increase/);
    expect(() => compileBlueprints(src(defineUnit(unit('core:a', { lod: [0, 50] }))))).toThrow(BlueprintCompileError);
    const base = { format: 'faf-view', version: 1 };
    const v = { id: 'a', nameKey: 'a.b', descKey: 'a.c', placeholder: { hull: 'box', size: [1, 1, 1] } };
    expect(() => parseViewJson({ ...base, visuals: [{ ...v, mesh: '../x' }] })).toThrow(/\/visuals\/0\/mesh/);
    expect(() => parseViewJson({ ...base, visuals: [{ ...v, lod: [9, 3] }] })).toThrow(/lod\[0\] < lod\[1\]/);
    expect(() => parseViewJson({ ...base, visuals: [{ ...v, lod: [1] }] })).toThrow(/\/visuals\/0\/lod/);
  });

  it('game content: core:cube uses units/cube_bot, simHash and sim.bin bytes stay pinned', async () => {
    const game = await compileContent({ includeTest: false });
    expect(hex32(game.simHash)).toBe(hex32(PINNED_SIM_HASH));
    expect(game.view.visuals[0]).toMatchObject({ id: 'core:cube', mesh: 'units/cube_bot', lod: [60, 180] });
    const bin = await readFile(join(CONTENT_GENERATED, 'sim.bin'));
    expect(createHash('sha256').update(bin).digest('hex')).toBe(PINNED_SIM_BIN_SHA256);
    expect(Buffer.from(game.simBin).equals(bin)).toBe(true);
  });
});

describe('asset manifest', () => {
  const h = (c: string) => `sha256-${createHash('sha256').update(c).digest('base64')}`;
  const manifest: AssetManifest = {
    version: 1,
    assets: {
      'units/cube_bot': {
        url: 'models/units/cube_bot.0123abcd.glb',
        bytes: 10,
        hash: h('a'),
        kind: 'model',
        fallback: { url: 'models/units/cube_bot.89abcdef.raw.glb', bytes: 20, hash: h('b') },
      },
      'maps/hollow-ridge': { url: 'maps/hollow-ridge.00000000.rtsmap', bytes: 5, hash: h('c'), kind: 'map' },
      'content/sim.bin': { url: 'content/sim.00000000.bin', bytes: 1, hash: h('d'), kind: 'simbin' },
    },
  };

  it('serializes canonically (sorted keys) and round-trips', () => {
    const text = serializeAssetManifest(manifest);
    expect(text.endsWith('}\n')).toBe(true);
    const keys = [...text.matchAll(/^ {4}"([^"]+)": \{/gm)].map((m) => m[1]);
    expect(keys).toEqual(['content/sim.bin', 'maps/hollow-ridge', 'units/cube_bot']);
    const back = parseAssetManifest(text);
    expect(back).toEqual(manifest);
    expect(serializeAssetManifest(back)).toBe(text);
    expect(assetIdsOfKind(back, 'model')).toEqual(['units/cube_bot']);
  });

  it('rejects malformed manifests', () => {
    const bad = (patch: (m: Record<string, unknown>) => void, re: RegExp): void => {
      const m = JSON.parse(serializeAssetManifest(manifest)) as Record<string, unknown>;
      patch(m);
      expect(() => parseAssetManifest(m)).toThrow(re);
    };
    const assets = (m: Record<string, unknown>) => m.assets as Record<string, Record<string, unknown>>;
    bad((m) => (m.version = 2), /\/version/);
    bad((m) => (m.extra = 1), /\/extra/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.kind = 'texture'), /\/kind/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.hash = 'md5-x'), /\/hash/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.url = '../etc/passwd'), /\/url/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.url = 'https://evil.test/x'), /\/url/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.bytes = -1), /\/bytes/);
    bad((m) => (assets(m)['maps/hollow-ridge']!.fallback = assets(m)['units/cube_bot']!.fallback), /only models/);
    bad((m) => (assets(m)['Bad Id'] = assets(m)['maps/hollow-ridge']!), /invalid logical asset id/);
    expect(new RegExp(ASSET_ID_PATTERN).test('units/cube_bot')).toBe(true);
  });
});
