/**
 * URL parameters of the game page (MS1):
 *
 * - `?transport=sab|transfer` — frame transport; default: SAB when cross-origin isolated, else transfer.
 * - `?seed=<u32>` — sim seed (default 1).
 * - `?cubes=<n>` — own cubes spawned at start (default 1000, 0..8192).
 * - `?enemy=<n>` — cubes of the second army (default 24, 0..8192).
 * - `?autostart=0` — the sim starts paused (deterministic E2E: advance with `step`).
 */

export type TransportRequest = 'auto' | 'sab' | 'transfer';

export interface GameParams {
  readonly transport: TransportRequest;
  readonly seed: number;
  readonly cubes: number;
  readonly enemyCubes: number;
  readonly autostart: boolean;
}

export const DEFAULT_SEED = 1;
export const DEFAULT_CUBES = 1000;
export const DEFAULT_ENEMY_CUBES = 24;
/** Unit cap per army of the MS1 world (sim `unitCapPerArmy` default). */
export const MAX_CUBES_PER_ARMY = 8192;

function intParam(q: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw === null || raw.trim() === '') return def;
  if (!/^\d+$/.test(raw.trim())) return def;
  const v = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(v)) return def;
  return Math.min(max, Math.max(min, v));
}

/** Parses `location.search` (with or without the leading `?`). Invalid values fall back to defaults. */
export function parseParams(search: string): GameParams {
  const q = new URLSearchParams(search);
  const t = q.get('transport');
  const transport: TransportRequest = t === 'sab' || t === 'transfer' ? t : 'auto';
  const auto = q.get('autostart');
  return {
    transport,
    seed: intParam(q, 'seed', DEFAULT_SEED, 0, 0xffffffff),
    cubes: intParam(q, 'cubes', DEFAULT_CUBES, 0, MAX_CUBES_PER_ARMY),
    enemyCubes: intParam(q, 'enemy', DEFAULT_ENEMY_CUBES, 0, MAX_CUBES_PER_ARMY),
    autostart: !(auto === '0' || auto === 'false' || auto === 'no'),
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
