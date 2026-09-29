/**
 * Deterministic SPK4 scene (PLAN §4 SPK4), pure data without GPU access so the counts can be tested
 * in Node:
 *
 * - Terrain: `content/maps/hollow-ridge.rtsmap` (512 WU, water) read via @faf/formats, plus a
 *   synthetic 8-layer splatmap (2 RGBA8 planes, 512², from height, slope and value noise) – the map
 *   itself carries no SPLT chunk yet.
 * - 2,000 units ({@link UNIT_VISUALS} merged-part variants with 3 LODs) in two bases and a front,
 *   standing on the terrain (y = `rules.sampleHeightRaw`), moving on small circles at 10 Hz with a
 *   synthetic PartStream (turret yaw rotating, barrel pitch nodding).
 * - 30,000 props (tree/rock/bush, clustered forests and rock fields) on dry, not too steep land.
 * - A 10-s camera flight (close base view → front → overview → other base → front).
 *
 * All randomness comes from a seeded xorshift generator: the same map bytes give the same scene.
 */
import type { MapSpot, RtsMap } from '@faf/formats';
import { UnitRecordWriter, UNIT_FLAG_NO_INTERP } from '@faf/render';
import type { TerrainDecal, TerrainDesc, UnitPartsView } from '@faf/render';
import { sampleHeightRaw } from '@faf/rules';
import type { Heightfield } from '@faf/rules';
import { PARTS_PER_UNIT, PROP_MESHES, UNIT_VARIANTS, UNIT_VISUALS } from './meshes.ts';

export const RAW = 4096;
export const UNIT_COUNT = 2000;
export const PROP_COUNT = 30000;
export const SPLAT_LAYERS = 8;
export const SPLAT_RESOLUTION = 512;
/** Sim tick of the synthetic unit motion (10 Hz like the sim). */
export const TICK_MS = 100;
/** Duration of one flight loop in seconds. */
export const FLIGHT_SECONDS = 10;

/** Seeded xorshift32 → [0, 1). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

/** Height sampling helper around the map (raw in, raw out; bit-identical to the sim). */
export class MapHeights {
  readonly hf: Heightfield;
  readonly sizeWu: number;
  readonly waterRaw: number | null;
  constructor(readonly map: RtsMap) {
    const m = map.meta;
    this.sizeWu = m.sizeWu;
    this.waterRaw = m.waterLevelRaw;
    this.hf = { sizeWu: m.sizeWu, dim: m.sizeWu + 1, heights: map.heights, heightScaleRaw: m.heightScaleRaw };
  }
  raw(xRaw: number, zRaw: number): number {
    return sampleHeightRaw(this.hf, xRaw, zRaw);
  }
  /** Height in WU at (x, z) WU (sim formula). */
  wu(x: number, z: number): number {
    return this.raw(Math.round(x * RAW), Math.round(z * RAW)) / RAW;
  }
  /** Max height difference to the 4 neighbours at distance `d` WU (slope proxy, WU per d). */
  slope(x: number, z: number, d = 1): number {
    const h = this.wu(x, z);
    return Math.max(
      Math.abs(this.wu(x + d, z) - h),
      Math.abs(this.wu(x - d, z) - h),
      Math.abs(this.wu(x, z + d) - h),
      Math.abs(this.wu(x, z - d) - h),
    ) / d;
  }
  /** Dry land at least `margin` WU above the water level. */
  dry(x: number, z: number, margin: number): boolean {
    return this.waterRaw === null || this.wu(x, z) >= this.waterRaw / RAW + margin;
  }
}

// -------------------------------------------------------------------------------------------------
// Terrain + synthetic splatmap
// -------------------------------------------------------------------------------------------------

/** Tileable value noise on an integer lattice (0..1), deterministic. */
export function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fbm(x: number, z: number, seed: number): number {
  return 0.55 * valueNoise(x, z, 48, seed) + 0.3 * valueNoise(x, z, 17, seed + 1) + 0.15 * valueNoise(x, z, 6, seed + 2);
}

function byte(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
}

function band(v: number, lo: number, hi: number): number {
  const t = (v - lo) / (hi - lo);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * Synthetic painted splat weights: `layers / 4` RGBA8 planes of `resolution²` texels. Each weight is
 * the lerp factor of its layer over the auto-splat base (TERRAIN_SPLAT_GLSL order):
 * plane 0 = sand, grass, rock, highland; plane 1 = dirt, dry grass, dark rock, moss.
 */
export function syntheticSplat(h: MapHeights, layers: 4 | 8, resolution = SPLAT_RESOLUTION): Uint8Array[] {
  const planes: Uint8Array[] = [];
  for (let p = 0; p < layers / 4; p++) planes.push(new Uint8Array(resolution * resolution * 4));
  const size = h.sizeWu;
  const water = h.waterRaw === null ? -1e9 : h.waterRaw / RAW;
  for (let tz = 0; tz < resolution; tz++) {
    for (let tx = 0; tx < resolution; tx++) {
      const x = ((tx + 0.5) * size) / resolution;
      const z = ((tz + 0.5) * size) / resolution;
      const hw = h.wu(x, z);
      const s = h.slope(x, z, 1);
      const n1 = fbm(x, z, 101);
      const n2 = fbm(x, z, 202);
      const n3 = fbm(x, z, 303);
      const above = hw - water;
      const o = (tz * resolution + tx) * 4;
      const p0 = planes[0]!;
      p0[o] = byte(band(-above, -1.8, 0.2) * (0.6 + 0.4 * n1)); // sand near the shore
      p0[o + 1] = byte(band(n2, 0.45, 0.7) * (1 - band(s, 0.35, 0.6)) * 0.8); // lush grass patches
      p0[o + 2] = byte(band(s, 0.45, 0.8)); // rock on steep slopes
      p0[o + 3] = byte(band(hw, 28, 34) * (0.5 + 0.5 * n3)); // pale highland
      if (layers === 8) {
        const p1 = planes[1]!;
        p1[o] = byte(band(n1, 0.55, 0.75) * band(above, 0.5, 3) * (1 - band(s, 0.3, 0.5))); // dirt
        p1[o + 1] = byte(band(n3, 0.5, 0.72) * band(hw, 14, 20) * 0.85); // dry grass on the heights
        p1[o + 2] = byte(band(s, 0.7, 1.1) * band(n2, 0.3, 0.6)); // dark rock on cliffs
        p1[o + 3] = byte(band(-above, -4, -1) * band(n1, 0.4, 0.65) * 0.9); // moss on the banks
      }
    }
  }
  return planes;
}

/** Terrain description for `setTerrain` with an optional synthetic splatmap (0 = auto-splat only). */
export function terrainDesc(map: RtsMap, splatLayers: 0 | 4 | 8, splatPlanes?: readonly Uint8Array[]): TerrainDesc {
  const m = map.meta;
  const base = {
    sizeWu: m.sizeWu,
    dim: m.sizeWu + 1,
    heights: map.heights,
    heightScaleRaw: m.heightScaleRaw,
    waterLevelRaw: m.waterLevelRaw,
    light: { azimuthDeg: m.light.azimuthDeg, elevationDeg: m.light.elevationDeg, sun: m.light.sun, ambient: m.light.ambient },
  };
  if (splatLayers === 0) return base;
  const planes = splatPlanes ?? syntheticSplat(new MapHeights(map), splatLayers);
  return { ...base, splat: { layers: splatLayers, resolution: SPLAT_RESOLUTION, planes: planes.slice(0, splatLayers / 4) } };
}

/** Spot decals (M4) with the client's constants (mass: green ring r 1.6, hydro: cyan ring r 2.6). */
export function spotDecals(spots: readonly MapSpot[]): TerrainDecal[] {
  return spots.map((s) =>
    s.kind === 'mass'
      ? { kind: 'ring', x: s.x, z: s.z, radiusWU: 1.6, widthWU: 0.35, color: 0x40ff50, alpha: 0.95 }
      : { kind: 'ring', x: s.x, z: s.z, radiusWU: 2.6, widthWU: 0.45, color: 0x20e0ff, alpha: 0.95 },
  );
}

// -------------------------------------------------------------------------------------------------
// Units
// -------------------------------------------------------------------------------------------------

/**
 * 2,000 units as UnitRecords (48 B) + PartStream (2 parts per unit, 8 B each), advanced by
 * {@link UnitScene.tick} at 10 Hz. Stands in for the sim worker: the benchmark measures only the
 * render side.
 */
export class UnitScene {
  readonly count: number;
  readonly writer: UnitRecordWriter;
  readonly visual: Uint8Array;
  readonly army: Uint8Array;
  readonly parts: Uint8Array;
  readonly partsView: { bytes: Uint8Array; count: number; version: number };
  /** Content version of the records (incremented per tick). */
  version = 0;
  tickCount = 0;
  private readonly cx: Float64Array;
  private readonly cz: Float64Array;
  private readonly radius: Float64Array;
  private readonly omega: Float64Array;
  private readonly phase: Float64Array;
  private readonly part16: Uint16Array;

  constructor(
    readonly heights: MapHeights,
    count = UNIT_COUNT,
    seed = 0x5eed4,
  ) {
    this.count = count;
    this.writer = new UnitRecordWriter(count);
    this.visual = new Uint8Array(count);
    this.army = new Uint8Array(count);
    this.cx = new Float64Array(count);
    this.cz = new Float64Array(count);
    this.radius = new Float64Array(count);
    this.omega = new Float64Array(count);
    this.phase = new Float64Array(count);
    this.parts = new Uint8Array(Math.max(1, count * PARTS_PER_UNIT) * 8);
    this.part16 = new Uint16Array(this.parts.buffer);
    this.partsView = { bytes: this.parts, count: count * PARTS_PER_UNIT, version: 0 };

    const rng = new Rng(seed);
    const size = heights.sizeWu;
    const starts = heights.map.meta.starts;
    const s0 = starts[0] ?? { x: size * RAW * 0.2, z: size * RAW * 0.2 };
    const s1 = starts[1] ?? { x: size * RAW * 0.8, z: size * RAW * 0.8 };
    const zones = [
      { x: s0.x / RAW, z: s0.z / RAW, r: 55 },
      { x: s1.x / RAW, z: s1.z / RAW, r: 55 },
      { x: size / 2, z: size / 2, r: 75 },
    ];
    for (let i = 0; i < count; i++) {
      const zone = i % 20 < 7 ? 0 : i % 20 < 14 ? 1 : 2;
      const zc = zones[zone]!;
      let x = zc.x;
      let z = zc.z;
      for (let tries = 0; tries < 80; tries++) {
        const a = rng.next() * Math.PI * 2;
        const d = Math.sqrt(rng.next()) * zc.r;
        x = Math.min(size - 6, Math.max(6, zc.x + Math.cos(a) * d));
        z = Math.min(size - 6, Math.max(6, zc.z + Math.sin(a) * d));
        if (heights.dry(x, z, 0.6) && heights.slope(x, z, 1) < 0.9) break;
      }
      this.cx[i] = x;
      this.cz[i] = z;
      this.radius[i] = 1.5 + rng.next() * 2.5;
      const speed = 1.2 + rng.next() * 1.8; // WU/s
      this.omega[i] = (speed / this.radius[i]!) * (rng.next() < 0.5 ? 1 : -1);
      this.phase[i] = rng.next() * Math.PI * 2;
      this.visual[i] = pickVisual(rng.next());
      this.army[i] = zone === 2 ? (x + z < size ? 0 : 1) : zone;
    }
    for (let i = 0; i < count; i++) {
      const p = this.pose(i, 0);
      this.writer.write(i, {
        prevX: p[0],
        prevY: p[1],
        prevZ: p[2],
        x: p[0],
        y: p[1],
        z: p[2],
        prevYaw: p[3],
        yaw: p[3],
        visual: this.visual[i]!,
        army: this.army[i]!,
        handle: i + 1,
        flags: UNIT_FLAG_NO_INTERP,
        partBase: i * PARTS_PER_UNIT,
        partCount: PARTS_PER_UNIT,
      });
    }
    this.writeParts(0);
    this.writeParts(0);
  }

  private readonly poseOut: [number, number, number, number] = [0, 0, 0, 0];

  /** Raw position (on the terrain) and Ang16 yaw of unit i at tick t. */
  pose(i: number, t: number): [number, number, number, number] {
    const th = this.phase[i]! + (this.omega[i]! * t * TICK_MS) / 1000;
    const x = Math.round((this.cx[i]! + Math.cos(th) * this.radius[i]!) * RAW);
    const z = Math.round((this.cz[i]! + Math.sin(th) * this.radius[i]!) * RAW);
    const heading = th + (this.omega[i]! > 0 ? Math.PI / 2 : -Math.PI / 2);
    const out = this.poseOut;
    out[0] = x;
    out[1] = this.heights.raw(x, z);
    out[2] = z;
    out[3] = toAng16(heading);
    return out;
  }

  private writeParts(t: number): void {
    const p = this.part16;
    for (let i = 0; i < this.count; i++) {
      const o = i * PARTS_PER_UNIT * 4;
      // part 1: turret yaw (relative to the hull), slow sweep
      p[o] = p[o + 1]!;
      p[o + 1] = toAng16(Math.sin(t * 0.05 + i * 0.7) * 2.2 + i);
      p[o + 2] = p[o + 3]!;
      p[o + 3] = 0;
      // part 2: barrel pitch (nod), no yaw of its own
      p[o + 4] = 0;
      p[o + 5] = 0;
      p[o + 6] = p[o + 7]!;
      p[o + 7] = Math.round(Math.sin(t * 0.2 + i) * 2200 + 900) & 0xffff;
    }
    this.partsView.version++;
  }

  /** One synthetic sim tick: cur → prev, new positions/yaws, new part angles. */
  tick(): void {
    this.tickCount++;
    const t = this.tickCount;
    const w = this.writer;
    for (let i = 0; i < this.count; i++) {
      const p = this.pose(i, t);
      w.advance(i, p[0], p[1], p[2], p[3]);
      if (t === 1) w.setFlags(i, w.flags(i) & ~UNIT_FLAG_NO_INTERP);
    }
    this.writeParts(t);
    this.version++;
  }

  /** PartStream view for the renderer. */
  get partStream(): UnitPartsView {
    return this.partsView;
  }
}

/** Weighted variant choice: many T1/T2 tanks, few command units. */
function pickVisual(r: number): number {
  const weights = [6, 14, 12, 6, 6, 5, 5, 4, 7, 3, 6, 1];
  let total = 0;
  for (const w of weights) total += w;
  let acc = 0;
  for (let v = 0; v < UNIT_VISUALS; v++) {
    acc += weights[v]! / total;
    if (r < acc) return v;
  }
  return UNIT_VISUALS - 1;
}

export function toAng16(rad: number): number {
  return Math.round((rad / (2 * Math.PI)) * 65536) & 0xffff;
}

// -------------------------------------------------------------------------------------------------
// Props
// -------------------------------------------------------------------------------------------------

/** 30,000 static props: raw position on the terrain, Ang16 yaw, scale (/64), mesh, tint (0..63). */
export interface SceneProps {
  readonly count: number;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly z: Int32Array;
  readonly yaw: Uint16Array;
  /** Scale × 64 (1.0 = 64). */
  readonly scale: Uint8Array;
  readonly mesh: Uint8Array;
  readonly tint: Uint8Array;
}

export function generateProps(h: MapHeights, count = PROP_COUNT, seed = 0x9709): SceneProps {
  const rng = new Rng(seed);
  const size = h.sizeWu;
  const props: SceneProps = {
    count,
    x: new Int32Array(count),
    y: new Int32Array(count),
    z: new Int32Array(count),
    yaw: new Uint16Array(count),
    scale: new Uint8Array(count),
    mesh: new Uint8Array(count),
    tint: new Uint8Array(count),
  };
  // Clusters: forests (trees + bushes) and rock fields.
  const clusters: { x: number; z: number; r: number; kind: number }[] = [];
  for (let c = 0; c < 110; c++) {
    let x = 0;
    let z = 0;
    for (let t = 0; t < 40; t++) {
      x = rng.range(10, size - 10);
      z = rng.range(10, size - 10);
      if (h.dry(x, z, 1)) break;
    }
    clusters.push({ x, z, r: rng.range(8, 30), kind: c % 3 === 2 ? 1 : 0 });
  }
  let n = 0;
  let guard = 0;
  while (n < count) {
    guard++;
    const scattered = rng.next() < 0.18 || guard > count * 40;
    let x: number;
    let z: number;
    let mesh: number;
    if (scattered) {
      x = rng.range(2, size - 2);
      z = rng.range(2, size - 2);
      mesh = rng.int(PROP_MESHES);
    } else {
      const c = clusters[rng.int(clusters.length)]!;
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * c.r;
      x = c.x + Math.cos(a) * d;
      z = c.z + Math.sin(a) * d;
      mesh = c.kind === 1 ? (rng.next() < 0.8 ? 1 : 2) : rng.next() < 0.72 ? 0 : 2;
    }
    if (x < 1 || z < 1 || x > size - 1 || z > size - 1) continue;
    if (!h.dry(x, z, 0.35)) continue;
    if (guard <= count * 40 && h.slope(x, z, 0.5) > (mesh === 1 ? 1.2 : 0.7)) continue;
    const xr = Math.round(x * RAW);
    const zr = Math.round(z * RAW);
    props.x[n] = xr;
    props.z[n] = zr;
    props.y[n] = h.raw(xr, zr) - 400; // sink ~0.1 WU so slopes show no gap under the prop
    props.yaw[n] = rng.int(65536);
    props.scale[n] = Math.round((mesh === 0 ? rng.range(0.75, 1.35) : rng.range(0.6, 1.5)) * 64);
    props.mesh[n] = mesh;
    props.tint[n] = rng.int(64);
    n++;
  }
  return props;
}

// -------------------------------------------------------------------------------------------------
// Camera flight
// -------------------------------------------------------------------------------------------------

export interface CameraPose {
  /** Focus point in WU. */
  x: number;
  z: number;
  /** Focus height (terrain height under the focus) in WU. */
  y: number;
  distance: number;
  /** Angle below the horizon, radians. */
  pitch: number;
  /** Heading of the view direction, radians (RtsCamera.yaw). */
  yaw: number;
}

interface Key {
  t: number;
  x: number;
  z: number;
  distance: number;
  pitchDeg: number;
  yawDeg: number;
}

/**
 * Keyframes of the 10-s flight over hollow-ridge (fractions of the map size so it works for any
 * size): close over base A → the front → strategic overview → base B → back to the front. Headings
 * keep the sun (hollow-ridge: azimuth 215°) to the side so shadows are visible, with one fast turn.
 */
function flightKeys(size: number, starts: readonly { x: number; z: number }[]): Key[] {
  const a = starts[0] ?? { x: size * RAW * 0.2, z: size * RAW * 0.2 };
  const b = starts[1] ?? { x: size * RAW * 0.8, z: size * RAW * 0.8 };
  const ax = a.x / RAW;
  const az = a.z / RAW;
  const bx = b.x / RAW;
  const bz = b.z / RAW;
  return [
    { t: 0, x: ax + 6, z: az + 4, distance: 42, pitchDeg: 48, yawDeg: 130 },
    { t: 2.2, x: (ax + size / 2) / 2 + 20, z: (az + size / 2) / 2 + 10, distance: 75, pitchDeg: 50, yawDeg: 110 },
    { t: 4, x: size / 2, z: size / 2, distance: 110, pitchDeg: 52, yawDeg: 90 },
    { t: 5.6, x: size / 2 + 10, z: size / 2 - 10, distance: 260, pitchDeg: 62, yawDeg: 100 },
    { t: 7.6, x: bx - 8, z: bz - 6, distance: 65, pitchDeg: 50, yawDeg: 300 },
    { t: 10, x: size / 2 + 20, z: size / 2 + 20, distance: 95, pitchDeg: 48, yawDeg: 320 },
  ];
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Camera pose of the flight at `t` seconds (loops every {@link FLIGHT_SECONDS}). */
export function flightPose(h: MapHeights, t: number, out: CameraPose): CameraPose {
  const keys = flightKeys(h.sizeWu, h.map.meta.starts);
  const tt = ((t % FLIGHT_SECONDS) + FLIGHT_SECONDS) % FLIGHT_SECONDS;
  let k = 0;
  while (k < keys.length - 2 && tt >= keys[k + 1]!.t) k++;
  const k0 = keys[k]!;
  const k1 = keys[k + 1]!;
  const u = smooth(Math.min(1, Math.max(0, (tt - k0.t) / (k1.t - k0.t))));
  const lerp = (p: number, q: number): number => p + (q - p) * u;
  out.x = lerp(k0.x, k1.x);
  out.z = lerp(k0.z, k1.z);
  out.y = h.wu(out.x, out.z);
  // Zoom interpolates logarithmically (feels like mouse-wheel zoom).
  out.distance = Math.exp(lerp(Math.log(k0.distance), Math.log(k1.distance)));
  out.pitch = (lerp(k0.pitchDeg, k1.pitchDeg) * Math.PI) / 180;
  out.yaw = (lerp(k0.yawDeg, k1.yawDeg) * Math.PI) / 180;
  return out;
}

// -------------------------------------------------------------------------------------------------
// Whole scene
// -------------------------------------------------------------------------------------------------

export interface BenchScene {
  readonly map: RtsMap;
  readonly heights: MapHeights;
  /** Splat planes (8 layers); scenarios with 4 layers use the first plane. */
  readonly splat: Uint8Array[];
  readonly units: UnitScene;
  readonly props: SceneProps;
  readonly decals: TerrainDecal[];
}

export function buildScene(map: RtsMap, opts: { units?: number; props?: number } = {}): BenchScene {
  const heights = new MapHeights(map);
  return {
    map,
    heights,
    splat: syntheticSplat(heights, SPLAT_LAYERS),
    units: new UnitScene(heights, opts.units ?? UNIT_COUNT),
    props: generateProps(heights, opts.props ?? PROP_COUNT),
    decals: spotDecals(map.meta.spots),
  };
}

/** FNV-1a over byte arrays (scene determinism checks). */
export function fnv1a(...parts: readonly ArrayBufferView[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const b = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
  }
  return h >>> 0;
}

/** Variant names in visual order (reports). */
export const VISUAL_NAMES: readonly string[] = UNIT_VARIANTS.map((v) => v.name);
