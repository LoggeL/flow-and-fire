import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAssetManifest } from '@faf/blueprints/asset-manifest';
import type { AssetProgress } from '@faf/client';
import { describe, expect, it } from 'vitest';
import {
  ASSET_PROGRESS_SHARE,
  INITIAL_LOAD_STATE,
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

  it('setons (default map): content, the map and every model', () => {
    const ids = sessionAssetIds(manifest, 'setons');
    expect(ids.slice(0, 3)).toEqual([SIM_BIN_ASSET, VIEW_JSON_ASSET, mapAssetId('setons')]);
    expect(manifest.assets[mapAssetId('setons')]?.kind).toBe('map');
  });

  it('testplane loads no map asset (it is generated); an unknown map names the available ones', () => {
    const ids = sessionAssetIds(manifest, 'testplane');
    expect(ids.some((id) => id.startsWith('maps/'))).toBe(false);
    // Further maps (skirmish set) may sit between setons and testplane.
    expect(() => sessionAssetIds(manifest, 'nowhere')).toThrow(/nowhere.*hollow-ridge, setons, (?:[a-z0-9_-]+, )*testplane/);
  });

  it('tessera (?map=tessera, skirmish map): content, the map and every model', () => {
    const ids = sessionAssetIds(manifest, 'tessera');
    expect(ids.slice(0, 3)).toEqual([SIM_BIN_ASSET, VIEW_JSON_ASSET, mapAssetId('tessera')]);
    expect(manifest.assets[mapAssetId('tessera')]?.kind).toBe('map');
  });

  it('braidwater (?map=braidwater, skirmish map): content, the map and every model', () => {
    const ids = sessionAssetIds(manifest, 'braidwater');
    expect(ids.slice(0, 3)).toEqual([SIM_BIN_ASSET, VIEW_JSON_ASSET, mapAssetId('braidwater')]);
    expect(manifest.assets[mapAssetId('braidwater')]?.kind).toBe('map');
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
