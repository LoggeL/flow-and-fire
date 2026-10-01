/**
 * Asset loading of the game page (P3, MS2): picks the assets of the session from the manifest
 * (content, the chosen map, all models), loads them through the AssetManager (asset worker,
 * Cache API, SHA-256 integrity, progress) and turns the progress into the loading-screen state.
 *
 * Progress: 0–90 % = asset bytes (loaded / planned), 95 % = sim worker initialising, 100 % =
 * `ready` (map set, start armies requested). `<html data-loading-progress>` mirrors it.
 */
import { assetIdsOfKind, parseAssetManifest, type AssetManifest } from '@faf/blueprints/asset-manifest';
import type { AssetManager, AssetProgress, AssetSource, LoadedAssets } from '@faf/client';
import { createTestPlaneMap, writeRtsMap } from '@faf/formats';
import { TEST_PLANE_MAP } from './params.ts';

/** Logical ids of the compiled content (see tools/assets-pipeline). */
export const SIM_BIN_ASSET = 'content/sim.bin';
export const VIEW_JSON_ASSET = 'content/view.json';

/** Asset id of a map name (`maps/<name>`). */
export function mapAssetId(name: string): string {
  return `maps/${name}`;
}

/**
 * Ids to load for a session on `mapName`: sim.bin, view.json, the map (not for the test plane: it is
 * generated, see {@link loadSessionAssets}) and every model. Throws with the available maps if the map is not in the manifest.
 */
export function sessionAssetIds(manifest: AssetManifest, mapName: string): string[] {
  const ids = [SIM_BIN_ASSET, VIEW_JSON_ASSET];
  for (const id of ids) if (manifest.assets[id] === undefined) throw new Error(`asset manifest has no '${id}'`);
  if (mapName !== TEST_PLANE_MAP) {
    const id = mapAssetId(mapName);
    if (manifest.assets[id]?.kind !== 'map') {
      const maps = assetIdsOfKind(manifest, 'map').map((m) => m.slice('maps/'.length));
      throw new Error(`Karte '${mapName}' ist nicht im Asset-Manifest (verfügbar: ${[...maps, TEST_PLANE_MAP].join(', ')})`);
    }
    ids.push(id);
  }
  ids.push(...assetIdsOfKind(manifest, 'model'));
  for (const id of ['icons/atlas', 'icons/atlas-metrics']) {
    if (manifest.assets[id] !== undefined) ids.push(id);
  }
  return ids;
}

export type LoadPhase = 'manifest' | 'assets' | 'sim' | 'ready' | 'error';

/** Loading-screen state (plain, immutable snapshots in a signal). */
export interface LoadState {
  readonly phase: LoadPhase;
  /** 0–100 (integer). */
  readonly progress: number;
  /** Asset currently loading (logical id) and where its bytes come from. */
  readonly asset: string | null;
  readonly source: AssetSource | null;
  readonly bytesLoaded: number;
  readonly bytesTotal: number;
  readonly assetsDone: number;
  readonly assetsTotal: number;
  /** Assets served from the Cache API / the network so far. */
  readonly fromCache: number;
  readonly fromNetwork: number;
  /** Error text (phase 'error'). */
  readonly message: string | null;
}

export const INITIAL_LOAD_STATE: LoadState = {
  phase: 'manifest',
  progress: 0,
  asset: null,
  source: null,
  bytesLoaded: 0,
  bytesTotal: 0,
  assetsDone: 0,
  assetsTotal: 0,
  fromCache: 0,
  fromNetwork: 0,
  message: null,
};

/** Share of the bar for the asset bytes; the rest is sim start-up. */
export const ASSET_PROGRESS_SHARE = 90;
export const SIM_START_PROGRESS = 95;

/** Asset byte progress → bar percentage (0–90, integer, never decreasing within one load). */
export function assetPercent(bytesLoaded: number, bytesTotal: number): number {
  if (bytesTotal <= 0) return 0;
  const f = Math.min(1, Math.max(0, bytesLoaded / bytesTotal));
  return Math.floor(f * ASSET_PROGRESS_SHARE);
}

/** Folds one progress event into the state (sources are counted per finished asset). */
export function applyProgress(s: LoadState, p: AssetProgress): LoadState {
  const pct = Math.max(s.progress, assetPercent(p.bytesLoaded, p.bytesTotal));
  return {
    ...s,
    phase: 'assets',
    progress: pct,
    asset: p.id,
    source: p.source,
    bytesLoaded: Math.max(s.bytesLoaded, p.bytesLoaded),
    bytesTotal: p.bytesTotal,
    assetsDone: p.assetsDone,
    assetsTotal: p.assetsTotal,
    fromCache: s.fromCache + (p.done && p.source === 'cache' ? 1 : 0),
    fromNetwork: s.fromNetwork + (p.done && p.source === 'network' ? 1 : 0),
  };
}

/** Load timings for the E2E report (`window.__faf.loadTimings()`). */
export interface LoadTimings {
  /** performance.now() at `data-ready` (time origin = navigation start of this document). */
  navigationToReadyMs: number | null;
  /** Manifest + asset loading in ms. */
  assetsMs: number;
  /** Sim worker `init` → `ready` in ms. */
  simStartMs: number | null;
  /** Assets from the Cache API / network, and their bytes. */
  fromCache: number;
  fromNetwork: number;
  bytesNetwork: number;
  bytesCache: number;
  /** Cache API available. */
  cacheApi: boolean;
  /** 'worker' (asset worker) or 'inline' (fallback). */
  mode: 'worker' | 'inline';
  /** Source per asset id. */
  sources: Record<string, AssetSource>;
  /** Model variants per id ('meshopt' | 'raw') and fallback reasons. */
  models: Record<string, { variant: 'meshopt' | 'raw'; fallbackReason: string | null }>;
}

export interface SessionAssets {
  readonly loaded: LoadedAssets;
  readonly simBin: ArrayBuffer;
  readonly viewJson: string;
  /**
   * `.rtsmap` bytes of the session map. `?map=testplane` gets the generated flat map (formats
   * createTestPlaneMap) serialized like a file, so it takes exactly the path of every other map.
   */
  readonly mapBytes: Uint8Array;
  readonly timings: LoadTimings;
}

/** Fetches and parses the manifest (always revalidated: it is the only unhashed file). */
export async function fetchManifest(url: string): Promise<AssetManifest> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`asset manifest: HTTP ${res.status} (${url})`);
  return parseAssetManifest(await res.text());
}

function ownedCopy(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer;
}

/** Loads the session's assets; `onState` receives every loading-screen state. */
export async function loadSessionAssets(
  mgr: AssetManager,
  mapName: string,
  onState: (s: LoadState) => void,
  now: () => number = () => performance.now(),
): Promise<SessionAssets> {
  const t0 = now();
  let state: LoadState = INITIAL_LOAD_STATE;
  onState(state);
  const manifest = await fetchManifest(mgr.manifestUrl);
  const ids = sessionAssetIds(manifest, mapName);
  state = { ...state, phase: 'assets', assetsTotal: ids.length };
  onState(state);
  const off = mgr.onProgress((p) => {
    state = applyProgress(state, p);
    onState(state);
  });
  let loaded: LoadedAssets;
  try {
    loaded = await mgr.load(ids);
  } finally {
    off();
  }
  const simBin = loaded.files.get(SIM_BIN_ASSET);
  const view = loaded.files.get(VIEW_JSON_ASSET);
  if (simBin === undefined || view === undefined) throw new Error('asset loading returned no sim.bin/view.json');
  const mapBytes = mapName === TEST_PLANE_MAP ? writeRtsMap(createTestPlaneMap()) : loaded.files.get(mapAssetId(mapName))?.bytes;
  if (mapBytes === undefined) throw new Error(`asset loading returned no map '${mapName}'`);
  const sources: Record<string, AssetSource> = {};
  for (const [id, f] of loaded.files) sources[id] = f.source;
  const models: LoadTimings['models'] = {};
  for (const [id, m] of loaded.models) {
    sources[id] = m.source;
    models[id] = { variant: m.variant, fallbackReason: m.fallbackReason };
  }
  const st = loaded.stats;
  state = { ...state, progress: ASSET_PROGRESS_SHARE, assetsDone: ids.length, bytesLoaded: state.bytesTotal };
  onState(state);
  return {
    loaded,
    simBin: ownedCopy(simBin.bytes),
    viewJson: new TextDecoder().decode(view.bytes),
    mapBytes,
    timings: {
      navigationToReadyMs: null,
      assetsMs: now() - t0,
      simStartMs: null,
      fromCache: st.fromCache,
      fromNetwork: st.fromNetwork,
      bytesNetwork: st.bytesNetwork,
      bytesCache: st.bytesCache,
      cacheApi: st.cache,
      mode: loaded.mode,
      sources,
      models,
    },
  };
}
