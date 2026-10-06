/**
 * Fake minimap data (gallery, tests, benchmarks): procedural seeded terrain (water, shore, lowland,
 * highland; mirrored across the diagonal like a fair 1v1 map), resource spots, own and enemy units with
 * slow deterministic movement, three-level fog from the own vision, alert pings and a camera trapezoid.
 * Seeded PRNG from demo/core.ts (terrain: the deterministic LCG of menus/shared/terrain.ts), never
 * Math.random. Not sim code: floats are fine here.
 */
import type { MinimapFog, MinimapPing, MinimapSpot, MinimapTerrain, MinimapUnits } from '../model/minimap.ts';
import { MINIMAP_KIND_BLIP, MINIMAP_KIND_GHOST, MINIMAP_KIND_STRUCTURE, MINIMAP_KIND_UNIT, MINIMAP_PING_LIFE_S } from '../model/minimap.ts';
import type { AlertLevel } from '../model/alerts.ts';
import { heightField, terrainPixels, WATER_LEVEL } from '../menus/shared/terrain.ts';
import type { HeightField } from '../menus/shared/terrain.ts';
import { createDemoRng, range } from './core.ts';
import type { Rng } from './core.ts';

export const DEMO_MAP_NAME = 'Setons';
export const DEMO_MAP_SIZE_WU = 512;
export const DEMO_TERRAIN_RES = 128;
export const DEMO_FOG_RES = 64;
export const DEMO_MINIMAP_SEED = 7;

// ---------------------------------------------------------------------------------------------------------
// Terrain

/** Height field in [≈0, 1] over map coordinates 0..1, mirrored across the diagonal (fair 1v1), with
 * terraces; shares the generator of the menu previews (menus/shared/terrain.ts, deterministic LCG). */
export function demoHeightField(seed: number = DEMO_MINIMAP_SEED): HeightField {
  return heightField(seed, { mirror: true, plateau: true, freq: 3 });
}

/** Water line of the demo terrain. */
export const DEMO_WATER = WATER_LEVEL;

const terrainCache = new Map<string, MinimapTerrain>();

/** Procedural terrain bitmap (res × res RGBA, top view with hillshade); cached per seed and resolution. */
export function demoTerrain(seed: number = DEMO_MINIMAP_SEED, res: number = DEMO_TERRAIN_RES): MinimapTerrain {
  const key = `${seed}:${res}`;
  const cached = terrainCache.get(key);
  if (cached !== undefined) return cached;
  const rgba = terrainPixels(demoHeightField(seed), res, res, { view: [0.5 / res, 0.5 / res, 1 + 0.5 / res, 1 + 0.5 / res], tint: 0.95 });
  const t: MinimapTerrain = { width: res, height: res, rgba };
  terrainCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Resource spots

/** Mirrored mass spots on dry land plus two hydros; `taken` marks spots near the own/enemy base. */
export function demoSpots(seed: number = DEMO_MINIMAP_SEED, mapSizeWu: number = DEMO_MAP_SIZE_WU, pairs = 11): readonly MinimapSpot[] {
  const field = demoHeightField(seed);
  const rng = createDemoRng(seed * 7 + 3);
  const pts: { x: number; z: number }[] = [];
  let guard = 0;
  while (pts.length < pairs * 2 && guard++ < 6000) {
    const x = 0.06 + rng() * 0.88;
    const z = 0.06 + rng() * 0.88;
    if (z < x + 0.03) continue;
    const h = field(x, z);
    if (h < DEMO_WATER + 0.03 || h > 0.8) continue;
    if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 0.085)) continue;
    pts.push({ x, z }, { x: z, z: x });
  }
  const out: MinimapSpot[] = pts.map((p, i) => ({
    x: p.x * mapSizeWu,
    z: p.z * mapSizeWu,
    kind: i === 6 || i === 7 ? 'hydro' : 'mass',
    // Own base south-west (x small, z large), enemy base north-east: the nearest spots are taken.
    taken: Math.hypot(p.x - 0.2, p.z - 0.8) < 0.22 || Math.hypot(p.x - 0.8, p.z - 0.2) < 0.18,
  }));
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Units, fog, pings, camera

export interface MinimapDemoOptions {
  readonly seed?: number;
  readonly own?: number;
  readonly enemy?: number;
  readonly mapSizeWu?: number;
  readonly fogRes?: number;
}

/** Live fake minimap state; `step()` advances one sim tick (0.1 s). */
export interface MinimapDemo {
  readonly mapSizeWu: number;
  readonly terrain: MinimapTerrain;
  readonly spots: readonly MinimapSpot[];
  /** Current units wrapper (a new wrapper after every step; the typed arrays are refilled in place). */
  units(): MinimapUnits;
  /** Current fog (a new wrapper after every fog update). */
  fog(): MinimapFog;
  pings(): readonly MinimapPing[];
  /** Camera trapezoid (world units, far edge wider). */
  camera(): readonly (readonly [number, number])[];
  /** Advances one tick; recomputes the fog every `fogEvery` ticks (default 5 = 2 Hz at 10 Hz). */
  step(nowS: number, fogEvery?: number): void;
  addPing(x: number, z: number, nowS: number, level: AlertLevel): void;
  moveCamera(cx: number, cz: number): void;
}

/** Camera trapezoid around (cx, cz): `w` × `h` world units, the far (top) edge `persp` wider on each side. */
export function cameraTrapezoid(cx: number, cz: number, w = 150, h = 92, persp = 16): readonly (readonly [number, number])[] {
  return [
    [cx - w / 2 - persp, cz - h / 2],
    [cx + w / 2 + persp, cz - h / 2],
    [cx + w / 2, cz + h / 2],
    [cx - w / 2, cz + h / 2],
  ];
}

interface Mover {
  tx: number;
  tz: number;
  speed: number;
}

/** Share of own entries that are structures (base), enemy structures likewise. */
const OWN_STRUCTURE_SHARE = 0.18;
const ENEMY_STRUCTURE_SHARE = 0.2;

export function createMinimapDemo(opts: MinimapDemoOptions = {}): MinimapDemo {
  const seed = opts.seed ?? DEMO_MINIMAP_SEED;
  const own = opts.own ?? 500;
  const enemy = opts.enemy ?? 300;
  const size = opts.mapSizeWu ?? DEMO_MAP_SIZE_WU;
  const fogRes = opts.fogRes ?? DEMO_FOG_RES;
  const rng: Rng = createDemoRng(seed * 131 + 17);
  const n = own + enemy;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const army = new Uint8Array(n);
  const kind = new Uint8Array(n);
  /** True kind (unit or structure); `kind` shows what the viewer sees (blip/ghost outside the vision). */
  const structure = new Uint8Array(n);
  const movers: (Mover | null)[] = [];
  const clamp = (v: number): number => (v < 4 ? 4 : v > size - 4 ? size - 4 : v);

  const ownStructures = Math.round(own * OWN_STRUCTURE_SHARE);
  const enemyStructures = Math.round(enemy * ENEMY_STRUCTURE_SHARE);
  // Own army groups: base, south-east flank, centre, north-west flank.
  const ownGroups: readonly (readonly [number, number])[] = [
    [0.22, 0.76],
    [0.52, 0.7],
    [0.46, 0.5],
    [0.3, 0.44],
  ];
  const enemyGroups: readonly (readonly [number, number])[] = [
    [0.78, 0.24],
    [0.6, 0.36],
    [0.7, 0.5],
  ];
  for (let i = 0; i < n; i++) {
    const isOwn = i < own;
    const local = isOwn ? i : i - own;
    const isStructure = isOwn ? local < ownStructures : local < enemyStructures;
    army[i] = isOwn ? 0 : 1;
    structure[i] = isStructure ? 1 : 0;
    if (isStructure) {
      const [bx, bz] = isOwn ? [0.2, 0.8] : [0.8, 0.2];
      const r = range(rng, 0, 0.13);
      const a = range(rng, 0, Math.PI * 2);
      x[i] = clamp((bx + Math.cos(a) * r) * size);
      z[i] = clamp((bz + Math.sin(a) * r) * size);
      movers.push(null);
    } else {
      const groups = isOwn ? ownGroups : enemyGroups;
      const g = groups[local % groups.length]!;
      x[i] = clamp((g[0] + range(rng, -0.06, 0.06)) * size);
      z[i] = clamp((g[1] + range(rng, -0.06, 0.06)) * size);
      movers.push({ tx: x[i]!, tz: z[i]!, speed: range(rng, 0.25, 0.6) });
    }
    kind[i] = isStructure ? MINIMAP_KIND_STRUCTURE : MINIMAP_KIND_UNIT;
  }

  // Fog: explored = own half plus the diagonal band; visible from own units each update.
  const cells = new Uint8Array(fogRes * fogRes);
  const explored = new Uint8Array(fogRes * fogRes);
  for (let j = 0; j < fogRes; j++) {
    for (let i = 0; i < fogRes; i++) {
      const fx = (i + 0.5) / fogRes;
      const fz = (j + 0.5) / fogRes;
      if (fz - fx > -0.18 || Math.hypot(fx - 0.78, fz - 0.22) < 0.12) explored[j * fogRes + i] = 1;
    }
  }
  let fogWrapper: MinimapFog = { res: fogRes, cells };
  let unitsWrapper: MinimapUnits = { count: n, x, z, army, kind };
  let pingList: readonly MinimapPing[] = [];
  let cam = cameraTrapezoid(0.3 * size, 0.7 * size);
  let tick = 0;

  const recomputeFog = (): void => {
    for (let c = 0; c < cells.length; c++) cells[c] = explored[c]! > 0 ? 1 : 0;
    const cellWu = size / fogRes;
    for (let i = 0; i < own; i++) {
      const vision = structure[i] ? 18 : 26;
      const r = Math.ceil(vision / cellWu);
      const ci = Math.floor(x[i]! / cellWu);
      const cj = Math.floor(z[i]! / cellWu);
      const r2 = (vision / cellWu) ** 2;
      for (let dj = -r; dj <= r; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= fogRes) continue;
        for (let di = -r; di <= r; di++) {
          const ii = ci + di;
          if (ii < 0 || ii >= fogRes || di * di + dj * dj > r2) continue;
          const c = j * fogRes + ii;
          cells[c] = 2;
          explored[c] = 1;
        }
      }
    }
    // What the viewer sees of the enemy: in vision → unit/structure, else blip (units) / ghost (seen structures).
    for (let i = own; i < n; i++) {
      const c = Math.min(fogRes - 1, Math.floor(z[i]! / cellWu)) * fogRes + Math.min(fogRes - 1, Math.floor(x[i]! / cellWu));
      const visible = cells[c] === 2;
      kind[i] = structure[i] ? (visible ? MINIMAP_KIND_STRUCTURE : MINIMAP_KIND_GHOST) : visible ? MINIMAP_KIND_UNIT : MINIMAP_KIND_BLIP;
    }
    fogWrapper = { res: fogRes, cells };
  };
  recomputeFog();

  return {
    mapSizeWu: size,
    terrain: demoTerrain(seed),
    spots: demoSpots(seed, size),
    units: () => unitsWrapper,
    fog: () => fogWrapper,
    pings: () => pingList,
    camera: () => cam,
    step(nowS, fogEvery = 5) {
      tick++;
      for (let i = 0; i < n; i++) {
        const m = movers[i];
        if (m === null || m === undefined) continue;
        const dx = m.tx - x[i]!;
        const dz = m.tz - z[i]!;
        const d = Math.hypot(dx, dz);
        if (d < 1.5) {
          // New waypoint near the current position (units drift around their group).
          m.tx = clamp(x[i]! + range(rng, -40, 40));
          m.tz = clamp(z[i]! + range(rng, -40, 40));
          continue;
        }
        x[i] = x[i]! + (dx / d) * m.speed;
        z[i] = z[i]! + (dz / d) * m.speed;
      }
      unitsWrapper = { count: n, x, z, army, kind };
      if (tick % fogEvery === 0) recomputeFog();
      if (pingList.length > 0 && pingList.some((p) => nowS - p.bornS >= MINIMAP_PING_LIFE_S)) {
        pingList = pingList.filter((p) => nowS - p.bornS < MINIMAP_PING_LIFE_S);
      }
    },
    addPing(px, pz, nowS, level) {
      pingList = [...pingList, { x: px, z: pz, bornS: nowS, level }];
    },
    moveCamera(cx, cz) {
      cam = cameraTrapezoid(cx, cz);
    },
  };
}
