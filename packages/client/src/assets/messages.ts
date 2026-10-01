/**
 * Asset worker protocol (P3, PLAN §3.6 "Asset-Worker ──Transfer──▶ Main"). All payload buffers
 * are transferred, never copied.
 */
import type { AssetKind, AssetManifest } from '@faf/blueprints/asset-manifest';
import type { MeshData } from '@faf/render';
import type { ModelPartInfo } from './glb.ts';

/** Where the bytes of an asset came from. */
export type AssetSource = 'cache' | 'network';

/** Main → worker: load assets of a manifest. */
export interface AssetLoadRequest {
  readonly t: 'load';
  readonly requestId: number;
  /** Absolute URL of `manifest.json`. */
  readonly manifestUrl: string;
  /** Logical ids to load (default: all, content → maps → models). */
  readonly ids?: readonly string[];
  /** Force the uncompressed model fallback (`?assets=raw`). */
  readonly raw?: boolean;
  /** Use the Cache API (default true when available). */
  readonly cache?: boolean;
}

export interface AssetManifestMsg {
  readonly t: 'manifest';
  readonly requestId: number;
  readonly manifest: AssetManifest;
  /** Bytes of the planned downloads (primary files; raw fallbacks when requested). */
  readonly bytesTotal: number;
  /** Number of assets of this request. */
  readonly assets: number;
}

/** Progress of one asset (bytes of this asset and of the whole request). */
export interface AssetProgressMsg {
  readonly t: 'progress';
  readonly requestId: number;
  readonly id: string;
  readonly url: string;
  readonly source: AssetSource;
  readonly loaded: number;
  readonly total: number;
  readonly bytesLoaded: number;
  readonly bytesTotal: number;
  /** True once this asset's bytes are complete and verified. */
  readonly done: boolean;
}

/** A non-model asset (map, sim.bin, view.json): raw bytes. */
export interface AssetBytesMsg {
  readonly t: 'asset';
  readonly requestId: number;
  readonly id: string;
  readonly kind: AssetKind;
  readonly source: AssetSource;
  readonly bytes: ArrayBuffer;
}

/** A decoded model: MeshData per LOD (buffers transferred). */
export interface AssetModelMsg {
  readonly t: 'model';
  readonly requestId: number;
  readonly id: string;
  readonly source: AssetSource;
  /** 'meshopt' = compressed GLB decoded; 'raw' = uncompressed fallback. */
  readonly variant: 'meshopt' | 'raw';
  /** Why the fallback was used (decoder missing/failed, `?assets=raw`), else null. */
  readonly fallbackReason: string | null;
  readonly lods: MeshData[];
  readonly parts: readonly ModelPartInfo[];
}

export interface AssetLoadStats {
  readonly assets: number;
  readonly bytesNetwork: number;
  readonly bytesCache: number;
  readonly fromCache: number;
  readonly fromNetwork: number;
  readonly ms: number;
  /** Cache API used. */
  readonly cache: boolean;
}

export interface AssetDoneMsg {
  readonly t: 'done';
  readonly requestId: number;
  readonly stats: AssetLoadStats;
}

export interface AssetErrorMsg {
  readonly t: 'error';
  readonly requestId: number;
  readonly id: string | null;
  readonly message: string;
}

export type AssetWorkerMessage = AssetManifestMsg | AssetProgressMsg | AssetBytesMsg | AssetModelMsg | AssetDoneMsg | AssetErrorMsg;

/** Transfer list of a worker message (payload buffers). */
export function transferablesOf(m: AssetWorkerMessage): ArrayBuffer[] {
  if (m.t === 'asset') return [m.bytes];
  if (m.t !== 'model') return [];
  const out: ArrayBuffer[] = [];
  const add = (v: ArrayBufferView | undefined): void => {
    if (v === undefined) return;
    const b = v.buffer;
    if (b instanceof ArrayBuffer && !out.includes(b)) out.push(b);
  };
  for (const l of m.lods) {
    add(l.positions);
    add(l.normals);
    add(l.partIds);
    add(l.indices);
    add(l.partPivots);
    add(l.partParents);
    add(l.colors);
    add(l.mask);
  }
  return out;
}
