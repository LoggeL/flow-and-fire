import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRtsMap, readRtsMap, type CreateRtsMapParams, type MapPropField, type RtsMap } from '@faf/formats';
import type { EditorIssue } from '../../src/validate/index.ts';

export const ONE = 4096;
export const wu = (v: number): number => Math.round(v * ONE);

const mapsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');
export const MAP_NAMES = ['hollow-ridge', 'tessera', 'braidwater', 'setons'] as const;
export const loadMap = (name: string): RtsMap => readRtsMap(new Uint8Array(readFileSync(resolve(mapsDir, `${name}.rtsmap`))));

/** Height steps per WU for heightScaleRaw 32 (1 step = 1/128 WU). */
export const STEPS_PER_WU = 128;
/** Ground level of the synthetic maps: 40 WU. */
export const GROUND = 40 * STEPS_PER_WU;

/**
 * 256-WU test map: flat ground at 40 WU, water at 30 WU (dry everywhere unless `heights` digs),
 * point-symmetric starts at (64, 64) / (192, 192) WU, no spots.
 */
export function testMap(p: Partial<CreateRtsMapParams> = {}): RtsMap {
  return createRtsMap({
    sizeWu: 256,
    name: 'validate-test',
    waterLevelRaw: wu(30),
    heights: () => GROUND,
    starts: [
      { army: 0, x: wu(64), z: wu(64) },
      { army: 1, x: wu(192), z: wu(192) },
    ],
    ...p,
  });
}

/** Same map object with other markers/fields (heights object shared, like the editor store). */
export function withMarkers(map: RtsMap, p: { starts?: RtsMap['meta']['starts']; spots?: RtsMap['meta']['spots']; propFields?: readonly MapPropField[] }): RtsMap {
  const meta = { ...map.meta, starts: p.starts ?? map.meta.starts, spots: p.spots ?? map.meta.spots };
  const fields = p.propFields ?? map.propFields;
  return fields === undefined
    ? { meta, heights: map.heights, splat: map.splat, props: map.props, preview: map.preview, unknownChunks: map.unknownChunks }
    : { meta, heights: map.heights, splat: map.splat, props: map.props, propFields: fields, preview: map.preview, unknownChunks: map.unknownChunks };
}

export function circleField(xWu: number, zWu: number, rWu: number, extra: Partial<MapPropField> = {}): MapPropField {
  return {
    name: 'Wald',
    kind: 'tree',
    shape: { kind: 'circle', x: wu(xWu), z: wu(zWu), r: wu(rWu) },
    entries: [{ id: 'core:tree_01', weight: 1 }],
    densityPerKWu2: 64,
    seed: 7,
    scaleMinPermille: 1000,
    scaleMaxPermille: 1000,
    maxSlopePermille: 0,
    dryOnly: false,
    reclaimMassMilli: 0,
    reclaimEnergyMilli: 0,
    ...extra,
  };
}

export const codes = (issues: readonly EditorIssue[]): string[] => issues.map((i) => `${i.severity}:${i.code}`);
export const withCode = (issues: readonly EditorIssue[], code: string): EditorIssue[] => issues.filter((i) => i.code === code);
export const errors = (issues: readonly EditorIssue[]): EditorIssue[] => issues.filter((i) => i.severity === 'error');
