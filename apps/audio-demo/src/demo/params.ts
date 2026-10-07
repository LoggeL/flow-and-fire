/**
 * URL parameters of the demo: `?shots=200&seconds=&speed=&seed=&zoom=&autostart=1`.
 * Invalid values fall back to the defaults (the page must never fail on a typo).
 */

import { MAX_HEIGHT, MIN_HEIGHT } from './camera.ts';
import { DEFAULT_SHOTS_PER_SECOND } from './scenario.ts';

/** Sim speed range of the demo. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 3;
export const MAX_SHOTS = 2000;

export interface DemoParams {
  /** Shots per second (0..2000, default 200). */
  shots: number;
  /** Sim seconds until the battle stops by itself (null = endless). */
  seconds: number | null;
  /** Sim speed factor 0.25..3 (default 1). */
  speed: number;
  seed: number;
  /** Initial camera height in WU (20..400, default 90). */
  zoom: number;
  /** Start the battle as soon as the sounds are loaded (default: start on unlock). */
  autostart: boolean;
}

export const DEFAULT_PARAMS: Readonly<DemoParams> = Object.freeze({
  shots: DEFAULT_SHOTS_PER_SECOND,
  seconds: null,
  speed: 1,
  seed: 1,
  zoom: 90,
  autostart: false,
});

function num(q: URLSearchParams, key: string): number | null {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function parseDemoParams(search: string): DemoParams {
  const q = new URLSearchParams(search);
  const shots = num(q, 'shots');
  const seconds = num(q, 'seconds');
  const speed = num(q, 'speed');
  const seed = num(q, 'seed');
  const zoom = num(q, 'zoom');
  const auto = q.get('autostart');
  return {
    shots: shots === null ? DEFAULT_PARAMS.shots : clamp(Math.round(shots), 0, MAX_SHOTS),
    seconds: seconds === null || seconds <= 0 ? null : seconds,
    speed: speed === null ? DEFAULT_PARAMS.speed : clamp(speed, MIN_SPEED, MAX_SPEED),
    seed: seed === null ? DEFAULT_PARAMS.seed : Math.trunc(seed) >>> 0,
    zoom: zoom === null ? DEFAULT_PARAMS.zoom : clamp(zoom, MIN_HEIGHT, MAX_HEIGHT),
    autostart: auto === '1' || auto === 'true',
  };
}
