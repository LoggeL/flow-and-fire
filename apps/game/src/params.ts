/**
 * URL parameters of the game page (MS1 + MS2):
 *
 * - `?transport=sab|transfer` — frame transport; default: SAB when cross-origin isolated, else transfer.
 * - `?seed=<u32>` — sim seed (default 1).
 * - `?cubes=<n>` — own cubes spawned around the own start position (default 1000, 0..8192).
 * - `?enemy=<n>` — cubes of the second army around its start (default 24, 0..8192).
 * - `?autostart=0` — the sim starts paused (deterministic E2E: advance with `step`).
 * - `?map=<name>` — map asset `maps/<name>` from the asset manifest (default `setons`, the 1,024 WU
 *   8-player map; `?map=hollow-ridge` = the 512 WU MS2 map); `?map=testplane` = the flat MS1 test
 *   plane (a generated map).
 * - `?preset=low|medium|high|ultra` — render preset (default medium: render scale 0.8).
 * - `?units=<n>` — flight test: n placeholders of both armies spread over the land of the whole map
 *   (0..16384). When set, `cubes`/`enemy` default to 0 (explicit values still add their start armies).
 * - `?assets=raw` — uncompressed model fallback (read by the AssetManager itself).
 */
import { parsePresetName, type RenderPresetName } from '@faf/client';

export type TransportRequest = 'auto' | 'sab' | 'transfer';

export interface GameParams {
  readonly transport: TransportRequest;
  readonly spawn: 'tanks' | 'cubes' | 'none';
  readonly seed: number;
  readonly cubes: number;
  readonly enemyCubes: number;
  readonly autostart: boolean;
  /** Map name (`maps/<name>` in the asset manifest) or {@link TEST_PLANE_MAP}. */
  readonly map: string;
  readonly preset: RenderPresetName;
  /** Flight-test units spread over the whole map (0 = none). */
  readonly units: number;
}

export const DEFAULT_SEED = 1;
export const DEFAULT_CUBES = 150;
export const DEFAULT_ENEMY_CUBES = 150;
export const DEFAULT_MAP = 'setons';
/** `?map=testplane`: the flat 512 WU MS1 test plane (no `.rtsmap`). */
export const TEST_PLANE_MAP = 'testplane';
export const DEFAULT_PRESET: RenderPresetName = 'medium';
/** Unit cap per army of the world (sim `unitCapPerArmy` default). */
export const MAX_CUBES_PER_ARMY = 8192;
/** `?units=` covers both armies. */
export const MAX_FLIGHT_UNITS = 2 * MAX_CUBES_PER_ARMY;

function intParam(q: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw === null || raw.trim() === '') return def;
  if (!/^\d+$/.test(raw.trim())) return def;
  const v = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(v)) return def;
  return Math.min(max, Math.max(min, v));
}

/** Map names are asset-id path segments: lower case, digits, `-`/`_`. */
function mapParam(q: URLSearchParams): string {
  const raw = q.get('map');
  if (raw === null) return DEFAULT_MAP;
  const m = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(m) ? m : DEFAULT_MAP;
}

/** Parses `location.search` (with or without the leading `?`). Invalid values fall back to defaults. */
export function parseParams(search: string): GameParams {
  const q = new URLSearchParams(search);
  const t = q.get('transport');
  const transport: TransportRequest = t === 'sab' || t === 'transfer' ? t : 'auto';
  const auto = q.get('autostart');
  const spawn = q.get('spawn') === 'none' ? 'none' : q.get('spawn') === 'cubes' || (q.get('spawn') !== 'tanks' && q.has('cubes')) ? 'cubes' : 'tanks';
  const units = intParam(q, 'units', 0, 0, MAX_FLIGHT_UNITS);
  return {
    transport,
    spawn,
    seed: intParam(q, 'seed', DEFAULT_SEED, 0, 0xffffffff),
    cubes: intParam(q, 'cubes', units > 0 || spawn === 'none' ? 0 : spawn === 'cubes' ? 1000 : DEFAULT_CUBES, 0, MAX_CUBES_PER_ARMY),
    enemyCubes: intParam(q, 'enemy', units > 0 || spawn === 'none' ? 0 : spawn === 'cubes' ? 24 : DEFAULT_ENEMY_CUBES, 0, MAX_CUBES_PER_ARMY),
    autostart: !(auto === '0' || auto === 'false' || auto === 'no'),
    map: mapParam(q),
    preset: parsePresetName(q.get('preset')) ?? DEFAULT_PRESET,
    units,
  };
}

/**
 * Picks the frame transport. SAB needs cross-origin isolation (SharedArrayBuffer + Atomics);
 * a SAB request without it falls back to transfer and reports why.
 */
export function chooseTransport(
  req: TransportRequest,
  isolated: boolean,
): { readonly kind: 'sab' | 'transfer'; readonly note: string | null } {
  if (req === 'transfer') return { kind: 'transfer', note: null };
  if (isolated) return { kind: 'sab', note: null };
  if (req === 'sab') return { kind: 'transfer', note: 'SAB requested but the page is not cross-origin isolated: using transfer' };
  return { kind: 'transfer', note: null };
}
