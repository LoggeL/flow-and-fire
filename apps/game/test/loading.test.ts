import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAssetManifest } from '@faf/blueprints/asset-manifest';
import type { AssetProgress } from '@faf/client';
import { describe, expect, it } from 'vitest';
import {
  ASSET_PROGRESS_SHARE,
  ICON_ATLAS_ASSET,
  ICON_METRICS_ASSET,
  INITIAL_LOAD_STATE,
  parseIconAtlas,
  SIM_BIN_ASSET,
  VIEW_JSON_ASSET,
  applyProgress,
  assetPercent,
  mapAssetId,
  sessionAssetIds,
} from '../src/loading.ts';

const manifest = parseAssetManifest(
  readFileSync(resolve(import.meta.dirname, '../../../content/generated/assets/manifest.json'), 'utf8'),
);

function progress(p: Partial<AssetProgress>): AssetProgress {
  return {
    id: 'maps/hollow-ridge',
    url: 'x',
    source: 'network',
    loaded: 0,
    total: 100,
    bytesLoaded: 0,
    bytesTotal: 1000,
    done: false,
    assetsDone: 0,
    assetsTotal: 4,
    ...p,
  };
}

describe('session assets', () => {
  it('hollow-ridge: content, the map and every model', () => {
    const ids = sessionAssetIds(manifest, 'hollow-ridge');
    expect(ids.slice(0, 3)).toEqual([SIM_BIN_ASSET, VIEW_JSON_ASSET, mapAssetId('hollow-ridge')]);
    expect(ids).toContain('units/cube_bot');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('testplane loads no map asset (it is generated); an unknown map names the available ones', () => {
    const ids = sessionAssetIds(manifest, 'testplane');
    expect(ids.some((id) => id.startsWith('maps/'))).toBe(false);
    expect(() => sessionAssetIds(manifest, 'nowhere')).toThrow(/nowhere.*hollow-ridge, testplane/);
  });
});

describe('strategic icon atlas (MS3)', () => {
  const assets = resolve(import.meta.dirname, '../../../content/generated/assets');

  it('is part of the session assets when the manifest has it', () => {
    const ids = sessionAssetIds(manifest, 'hollow-ridge');
    expect(ids).toContain(ICON_ATLAS_ASSET);
    expect(ids).toContain(ICON_METRICS_ASSET);
    const without = { ...manifest, assets: { ...manifest.assets } };
    delete (without.assets as Record<string, unknown>)[ICON_ATLAS_ASSET];
    expect(sessionAssetIds(without, 'hollow-ridge')).not.toContain(ICON_METRICS_ASSET);
  });

  it('parses the pipeline atlas (raw RGBA8 + metrics) and rejects mismatches', () => {
    const px = new Uint8Array(readFileSync(resolve(assets, manifest.assets[ICON_ATLAS_ASSET]!.url)));
    const text = readFileSync(resolve(assets, manifest.assets[ICON_METRICS_ASSET]!.url), 'utf8');
    const a = parseIconAtlas(px, text);
    expect(a.width * a.height * 4).toBe(px.length);
    expect(a.metrics.glyphs.some((g) => g.id === 'land_direct')).toBe(true);
    expect(() => parseIconAtlas(px.subarray(4), text)).toThrow(/bytes/);
    expect(() => parseIconAtlas(px, JSON.stringify({ format: 'other' }))).toThrow(/format/);
  });
});

describe('loading progress', () => {
  it('asset bytes fill 0–90 %, clamped', () => {
    expect(assetPercent(0, 0)).toBe(0);
    expect(assetPercent(0, 1000)).toBe(0);
    expect(assetPercent(500, 1000)).toBe(45);
    expect(assetPercent(1000, 1000)).toBe(ASSET_PROGRESS_SHARE);
    expect(assetPercent(2000, 1000)).toBe(ASSET_PROGRESS_SHARE);
  });

  it('never decreases; counts finished assets per source', () => {
    let s = applyProgress(INITIAL_LOAD_STATE, progress({ bytesLoaded: 600 }));
    expect(s.progress).toBe(54);
    expect(s.phase).toBe('assets');
    // A later event with fewer bytes (parallel downloads) must not move the bar back.
    s = applyProgress(s, progress({ bytesLoaded: 300 }));
    expect(s.progress).toBe(54);
    s = applyProgress(s, progress({ id: 'content/sim.bin', source: 'cache', bytesLoaded: 700, done: true, assetsDone: 1 }));
    s = applyProgress(s, progress({ bytesLoaded: 1000, done: true, assetsDone: 2 }));
    expect(s.fromCache).toBe(1);
    expect(s.fromNetwork).toBe(1);
    expect(s.progress).toBe(90);
    expect(s.asset).toBe('maps/hollow-ridge');
    expect(s.assetsDone).toBe(2);
  });
});
