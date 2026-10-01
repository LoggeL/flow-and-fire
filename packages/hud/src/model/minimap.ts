import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { AlertLevel } from './alerts.ts';

/** Minimap (ui.md §5.4, C16/I1–I3/P8). Units/pings 4 Hz, fog 2 Hz, terrain once. */

export interface MinimapTerrain {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** Fog cells: 0 never seen, 1 explored, 2 visible. */
export interface MinimapFog {
  readonly res: number;
  readonly cells: Uint8Array;
}

export const MINIMAP_KIND_UNIT = 0;
export const MINIMAP_KIND_STRUCTURE = 1;
export const MINIMAP_KIND_BLIP = 2;
export const MINIMAP_KIND_GHOST = 3;

/** Struct-of-arrays unit positions in world units; only the first `count` entries are valid. */
export interface MinimapUnits {
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Army index (0 = self). */
  readonly army: Uint8Array;
  /** 0 unit, 1 structure, 2 blip, 3 ghost. */
  readonly kind: Uint8Array;
}

export interface MinimapSpot {
  readonly x: number;
  readonly z: number;
  readonly kind: 'mass' | 'hydro';
  readonly taken: boolean;
}

export interface MinimapPing {
  readonly x: number;
  readonly z: number;
  readonly bornS: number;
  readonly level: AlertLevel;
}

export type MinimapMode = 'terrain' | 'tactical';

export interface MinimapSection {
  readonly mapName: Signal<string>;
  /** Map edge length in world units. */
  readonly mapSizeWu: Signal<number>;
  readonly terrain: Signal<MinimapTerrain | null>;
  readonly fog: Signal<MinimapFog | null>;
  readonly units: Signal<MinimapUnits>;
  readonly spots: Signal<readonly MinimapSpot[]>;
  readonly pings: Signal<readonly MinimapPing[]>;
  /** Camera trapezoid corners in world units (4 points). */
  readonly camera: Signal<readonly (readonly [number, number])[]>;
  readonly mode: Signal<MinimapMode>;
  readonly showResources: Signal<boolean>;
  /** false before MS11: the dock slot shows map key figures instead (UI-E2). */
  readonly available: Signal<boolean>;
}

export function emptyMinimapUnits(capacity = 0): MinimapUnits {
  return {
    count: 0,
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    army: new Uint8Array(capacity),
    kind: new Uint8Array(capacity),
  };
}

export function createMinimapSection(): MinimapSection {
  return {
    mapName: signal(''),
    mapSizeWu: signal(512),
    terrain: signal<MinimapTerrain | null>(null),
    fog: signal<MinimapFog | null>(null),
    units: signal(emptyMinimapUnits()),
    spots: signal<readonly MinimapSpot[]>([]),
    pings: signal<readonly MinimapPing[]>([]),
    camera: signal<readonly (readonly [number, number])[]>([]),
    mode: signal<MinimapMode>('terrain'),
    showResources: signal(true),
    available: signal(false),
  };
}
