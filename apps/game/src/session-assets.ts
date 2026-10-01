import { assetIdsOfKind } from '@faf/blueprints/asset-manifest';
import { ClientMap, type AssetManager, type IconAtlasMetrics } from '@faf/client';
import { mapSimHash, readRtsMap } from '@faf/formats';
import type { SkirmishMap } from '@faf/hud';
import type { GameAssets } from './game.ts';
import { fetchManifest, loadSessionAssets, type LoadState, type SessionAssets } from './loading.ts';

export interface SessionMap {
  readonly menu: SkirmishMap;
  readonly simHash: number;
}

/** Menu and replay map identities come from the same verified bytes used by the simulation. */
export function describeSessionMap(id: string, bytes: Uint8Array): SessionMap {
  const parsed = readRtsMap(bytes), map = ClientMap.fromBytes(bytes);
  return {
    simHash: mapSimHash(parsed) >>> 0,
    menu: {
      id, name: map.name, sizeWu: map.sizeWu, starts: map.starts.length, available: map.starts.length >= 2,
      massSpots: map.spots.filter(spot => spot.kind === 'mass').length,
      hydroSpots: map.spots.filter(spot => spot.kind !== 'mass').length,
      startPositions: map.starts.map(start => [start.x / (map.sizeWu * 4096), start.z / (map.sizeWu * 4096)] as const),
    },
  };
}

export function gameAssetsFromSession(session: SessionAssets): GameAssets {
  const atlas = session.loaded.files.get('icons/atlas'), metrics = session.loaded.files.get('icons/atlas-metrics');
  const iconAtlas = atlas !== undefined && metrics !== undefined
    ? { pixels: atlas.bytes, metrics: JSON.parse(new TextDecoder().decode(metrics.bytes)) as IconAtlasMetrics }
    : undefined;
  return {
    simBin: session.simBin, viewJson: session.viewJson, models: session.loaded.models, mapBytes: session.mapBytes,
    ...(iconAtlas !== undefined ? { iconAtlas } : {}),
  };
}

export class SessionAssetsStore {
  constructor(readonly manager: AssetManager) {}
  async maps(): Promise<readonly SessionMap[]> {
    const manifest = await fetchManifest(this.manager.manifestUrl);
    const ids = assetIdsOfKind(manifest, 'map');
    const loaded = await this.manager.load(ids);
    return ids.map(id => {
      const file = loaded.files.get(id);
      if (file === undefined) throw new Error(`Missing verified map '${id}'`);
      return describeSessionMap(id.slice('maps/'.length), file.bytes);
    });
  }
  load(map: string, onState: (state: LoadState) => void): Promise<import('./loading.ts').SessionAssets> {
    return loadSessionAssets(this.manager, map, onState);
  }
}
