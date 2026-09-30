/** Shared helpers of the model tests (Node only). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapPropField, PropFieldShape } from '@faf/formats';
import { EditorDocument } from '../../src/model/document.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const MAPS_DIR = resolve(REPO_ROOT, 'content/maps');
export const MAP_NAMES = ['hollow-ridge', 'tessera', 'braidwater', 'setons'] as const;
export type MapName = (typeof MAP_NAMES)[number];

/** Pinned mapSimHash goldens of the checked-in maps (docs/status/track-editor-p0.md). */
export const MAP_SIM_HASH: Readonly<Record<MapName, number>> = {
  'hollow-ridge': 0x90ec94f0,
  tessera: 0x22cb60a8,
  braidwater: 0xeeaec694,
  setons: 0x52eccf92,
};

const cache = new Map<string, Uint8Array>();

/** Fresh copy of content/maps/<name>.rtsmap. */
export function mapBytes(name: MapName): Uint8Array {
  let b = cache.get(name);
  if (b === undefined) {
    b = new Uint8Array(readFileSync(resolve(MAPS_DIR, `${name}.rtsmap`)));
    cache.set(name, b);
  }
  return b.slice();
}

export function openDoc(name: MapName): EditorDocument {
  return EditorDocument.fromBytes(mapBytes(name));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const WU = 4096;

/** A valid field with sensible values (tests override what they need). */
export function field(shape: PropFieldShape, over: Partial<MapPropField> = {}): MapPropField {
  return {
    name: 'test field',
    kind: 'tree',
    shape,
    entries: [{ id: 'core:tree_01', weight: 1 }],
    densityPerKWu2: 64,
    seed: 12345,
    scaleMinPermille: 800,
    scaleMaxPermille: 1200,
    maxSlopePermille: 600,
    dryOnly: true,
    reclaimMassMilli: 0,
    reclaimEnergyMilli: 25000,
    ...over,
  };
}

export function circle(xWu: number, zWu: number, rWu: number): PropFieldShape {
  return { kind: 'circle', x: xWu * WU, z: zWu * WU, r: rWu * WU };
}

/** Axis-aligned rectangle polygon (WU corners). */
export function rect(x0: number, z0: number, x1: number, z1: number): PropFieldShape {
  return {
    kind: 'polygon',
    points: [
      { x: x0 * WU, z: z0 * WU },
      { x: x1 * WU, z: z0 * WU },
      { x: x1 * WU, z: z1 * WU },
      { x: x0 * WU, z: z1 * WU },
    ],
  };
}

/** Vertices of a polygon shape (throws for a circle). */
export function pointsOf(shape: PropFieldShape): readonly { readonly x: number; readonly z: number }[] {
  if (shape.kind !== 'polygon') throw new Error('not a polygon');
  return shape.points;
}
