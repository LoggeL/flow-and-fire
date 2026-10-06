import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRtsMap, mapSimData, readRtsMap, type MapSimData, type RtsMap } from '@faf/formats';

let ridge: RtsMap | null = null;

/** The checked-in 512 WU map content/maps/hollow-ridge.rtsmap (parsed once per test file). */
export function hollowRidge(): RtsMap {
  if (ridge === null) {
    ridge = readRtsMap(new Uint8Array(readFileSync(fileURLToPath(new URL('../../../../content/maps/hollow-ridge.rtsmap', import.meta.url)))));
  }
  return ridge;
}

export function hollowRidgeSim(): MapSimData {
  return mapSimData(hollowRidge());
}

/** WU → u16 height steps at heightScaleRaw 32 (1/128 WU per step). */
export const steps = (wu: number): number => Math.round(wu * 128);

/**
 * 64 WU test map with water at 8 WU over land at 10 WU (MS3: banks sloped so that nav
 * passability ends at the water, not at a cliff):
 * - a channel along z: ground 10 − 0.5·(x − 20) for x in [20, 30], 5 WU (3 WU deep) for x in
 *   [30, 34], 5 + 0.5·(x − 34) for x in [34, 44]; deep (> 0.5 WU) for x in (25, 39);
 * - a shallow ford through the channel for z in [40, 48] (ground ≥ 7.75 WU = ≤ 0.25 WU deep);
 * - an exactly-0.5-WU strip (ground ≥ 7.5 WU) for z in [52, 56] (passable: depth ≤ 0.5 WU).
 * Sample coordinates are integer WU (index z·65 + x).
 */
export function channelProfile(x: number): number {
  if (x <= 20 || x >= 44) return 10;
  if (x <= 30) return 10 - 0.5 * (x - 20);
  if (x < 34) return 5;
  return 5 + 0.5 * (x - 34);
}

export function channelMap(): RtsMap {
  return createRtsMap({
    sizeWu: 64,
    name: 'channel',
    heightScaleRaw: 32,
    waterLevelRaw: 8 * 4096,
    heights: (x, z) => {
      const p = channelProfile(x);
      if (z >= 40 && z <= 48) return steps(Math.max(p, 7.75));
      if (z >= 52 && z <= 56) return steps(Math.max(p, 7.5));
      return steps(p);
    },
    starts: [
      { army: 0, x: 10 * 4096, z: 10 * 4096 },
      { army: 1, x: 54 * 4096, z: 54 * 4096 },
    ],
    spots: [
      { kind: 'mass', x: 12 * 4096, z: 12 * 4096 },
      { kind: 'hydro', x: 50 * 4096, z: 20 * 4096 },
    ],
  });
}

/**
 * 64 WU dry map with slopes (ramp in x, triangle bumps in z) for height-following tests; every
 * cell stays below the nav slope limit (0.75 WU/WU: 0.3 in x + 0.4 in z).
 */
export function slopeMap(): RtsMap {
  return createRtsMap({
    sizeWu: 64,
    name: 'slopes',
    heightScaleRaw: 32,
    heights: (x, z) => steps(2 + x * 0.3 + (z % 8 < 4 ? z % 8 : 8 - (z % 8)) * 0.4),
  });
}
