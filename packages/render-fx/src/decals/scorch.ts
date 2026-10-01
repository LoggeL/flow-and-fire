/**
 * Scorch/crater decal field (PLAN §3.7 "Decals im Terrain-Fragment-Shader", MS7 "Scorch-Decals im
 * Terrain-FS"). CPU pool + packing into typed arrays; the consumer uploads them with
 * `dev.writeTexture` and evaluates {@link SCORCH_GLSL} in its ground/terrain fragment shader.
 * Layout follows @faf/render's terrain decals (data texture + per-chunk lists) but is independent.
 *
 * GPU layout:
 * - data texture RGBA32I, {@link SCORCH_DATA_WIDTH} × ceil(cap / {@link SCORCH_DECALS_PER_ROW}),
 *   2 texels per decal (decal i at x = (i mod 64)·2, y = i div 64):
 *   texel 0 = (xRaw, zRaw, radiusRaw, rot12 | kind << 12 | seed17 << 14) – always ≥ 0 as int32
 *   texel 1 = (tBornMs, lifetimeMs (0 = permanent), emberMs (0 = none), strength·1000)
 *   with tBornMs = round(tS·1000) mod (FX_TIME_WRAP_S·1000).
 * - cells texture R32UI, {@link SCORCH_CELLS_WIDTH} wide; entry e at (e mod W, e div W):
 *   entries [0, chunks²) = chunk index `(listStart << 6) | count` (count ≤ 32, listStart absolute),
 *   entries [chunks², …) = decal indices of the chunk lists. Chunks are 32 × 32 WU.
 *   Index and list share ONE texture (unit UNIT_FX_SCORCH_CELLS), so no third unit is needed.
 */
import { FX_TIME_WRAP_S, SLOT_FX_SCORCH, UNIT_FX_SCORCH_CELLS, UNIT_FX_SCORCH_DATA } from '../core/slots.ts';

const RAW = 4096;
const TAU = Math.PI * 2;

export type ScorchKind = 'scorch' | 'crater' | 'scar';
export const SCORCH_KIND_ID: Readonly<Record<ScorchKind, number>> = { scorch: 0, crater: 1, scar: 2 };

/** Pool caps per render preset. */
export const SCORCH_CAPS = { low: 128, medium: 256, high: 512, ultra: 1024 } as const;
export type ScorchPreset = keyof typeof SCORCH_CAPS;

export const SCORCH_CHUNK_WU = 32;
/** log2(SCORCH_CHUNK_WU · 4096): world raw → chunk via arithmetic shift. */
export const SCORCH_CHUNK_SHIFT = 17;
export const MAX_SCORCH_PER_CHUNK = 32;
export const SCORCH_DECALS_PER_ROW = 64;
export const SCORCH_DATA_WIDTH = SCORCH_DECALS_PER_ROW * 2;
export const SCORCH_CELLS_WIDTH = 1024;
/** Largest decal radius (bounds the chunk lists: ≤ 4 × 4 chunks per decal). */
export const MAX_SCORCH_RADIUS_WU = 40;
/** Longest finite lifetime (must stay below the FX time wrap). */
export const MAX_SCORCH_LIFETIME_S = 3600;
/** Extra reach when binning (WU). */
export const SCORCH_BIN_MARGIN_WU = 0.5;
/** Width factor of 'scar' decals (elongated along their rotation axis). */
export const SCORCH_SCAR_WIDTH = 0.35;
/** Default lifetimes / ember durations per kind (s). */
export const SCORCH_DEFAULTS: Readonly<Record<ScorchKind, { lifetimeS: number; emberS: number }>> = {
  scorch: { lifetimeS: 120, emberS: 2.5 },
  crater: { lifetimeS: 240, emberS: 5 },
  scar: { lifetimeS: 90, emberS: 1.5 },
};

export interface ScorchTextureDesc {
  readonly width: number;
  readonly height: number;
  readonly format: 'rgba32i' | 'r32ui';
}

export const SCORCH_BLOCK_NAME = 'FxScorch';

/** Uniform block at SLOT_FX_SCORCH (std140; two 16-byte rows). */
export const SCORCH_BLOCK_GLSL = /* glsl */ `
layout(std140) uniform FxScorch {
  ivec4 u_fxScorchGrid; // x: chunks per side, y: cells texture width, z: decal count, w: decals per data row
  vec4 u_fxScorchTime;  // x: FX time s (mod ${FX_TIME_WRAP_S}), y: ember HDR intensity, z: global strength, w: 0
};
`;

interface LayoutField {
  readonly name: string;
  readonly type: 'ivec4' | 'vec4';
  readonly count: number;
  readonly isArray: boolean;
  readonly offset: number;
  readonly stride: number;
}

/** std140 layout of {@link SCORCH_BLOCK_GLSL} (same shape as @faf/render's Std140Layout). */
export const SCORCH_LAYOUT: {
  readonly size: number;
  readonly fields: readonly LayoutField[];
  offsetOf(name: string): number;
} = {
  size: 32,
  fields: [
    { name: 'grid', type: 'ivec4', count: 1, isArray: false, offset: 0, stride: 16 },
    { name: 'time', type: 'vec4', count: 1, isArray: false, offset: 16, stride: 16 },
  ],
  offsetOf(name: string): number {
    const f = this.fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(`SCORCH_LAYOUT: unknown field '${name}'`);
    return f.offset;
  },
};

export const SCORCH_UNIFORM_BLOCKS: readonly { readonly name: string; readonly slot: number }[] = [
  { name: SCORCH_BLOCK_NAME, slot: SLOT_FX_SCORCH },
];

export const SCORCH_SAMPLERS: readonly { readonly name: string; readonly unit: number }[] = [
  { name: 'u_fxScorchData', unit: UNIT_FX_SCORCH_DATA },
  { name: 'u_fxScorchCells', unit: UNIT_FX_SCORCH_CELLS },
];

/** Linear glow colors (VARKAN_GLOW core/falloff, duplicated here to keep decals self-contained). */
const GLOW_CORE = [1, 217 / 255, 160 / 255] as const;
const GLOW_FALLOFF = [1, 138 / 255, 42 / 255] as const;
const glslVec3 = (c: readonly number[]): string => `vec3(${c.map((v) => v.toFixed(6)).join(', ')})`;

/**
 * Fragment-shader snippet. Include AFTER render's FRAME_BLOCK_GLSL (u_camPosInt, u_camFrac) and
 * with `precision highp float; precision highp int;`. Provides
 * - `vec4 fxScorch(vec3 relPos)`: relPos = camera-relative position in WU
 *   (`vec3(ivec3(posRaw) - u_camPosInt.xyz) / 4096.0 - u_camFrac.xyz`); rgb = albedo multiplier,
 *   a = ember emission intensity (0 = none),
 * - `vec3 fxScorchGlow(float e)`: HDR emissive color for that intensity (add to the lit color).
 */
export const SCORCH_GLSL = /* glsl */ `
${SCORCH_BLOCK_GLSL}
uniform highp isampler2D u_fxScorchData;
uniform highp usampler2D u_fxScorchCells;

const float FX_SCORCH_TAU = 6.28318530718;

vec2 fxScorchOne(vec2 d, ivec4 t0, ivec4 t1) {
  float R = float(t0.z) / 4096.0;
  uint pk = uint(t0.w);
  float rot = float(pk & 4095u) * (FX_SCORCH_TAU / 4096.0);
  int kind = int((pk >> 12u) & 3u);
  uint seed = pk >> 14u;
  float c = cos(rot);
  float s = sin(rot);
  vec2 q = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / R;
  if (kind == 2) q.y /= ${SCORCH_SCAR_WIDTH.toFixed(2)};
  float r = length(q);
  if (r >= 1.0) return vec2(1.0, 0.0);
  float th = atan(q.y, q.x);
  vec3 ph = vec3(float(seed & 63u), float((seed >> 6u) & 63u), float((seed >> 12u) & 63u)) * (FX_SCORCH_TAU / 64.0);
  float n = 0.5 * sin(3.0 * th + ph.x) + 0.3 * sin(5.0 * th + ph.y) + 0.2 * sin(9.0 * th + ph.z);
  float re = 1.0 - 0.22 * (0.5 + 0.5 * n);
  float sn = r / re;
  float mask = 1.0 - smoothstep(0.78, 1.0, sn);
  float m;
  if (kind == 1) {
    float fl = 1.0 - smoothstep(0.42, 0.62, sn);
    float rim = exp(-(sn - 0.74) * (sn - 0.74) / 0.01);
    m = 1.0 - mask * (0.7 * fl + 0.38 * (1.0 - fl)) + 0.5 * rim * mask;
  } else if (kind == 2) {
    m = 1.0 - 0.6 * mask * (1.0 - 0.5 * sn);
  } else {
    m = 1.0 - 0.82 * mask * (1.0 - 0.4 * sn);
  }
  float age = mod(u_fxScorchTime.x - float(t1.x) * 0.001 + ${FX_TIME_WRAP_S}.0, ${FX_TIME_WRAP_S}.0);
  float life = float(t1.y) * 0.001;
  float ember = float(t1.z) * 0.001;
  float strength = float(t1.w) * 0.001 * u_fxScorchTime.z;
  float f = life > 0.0 ? 1.0 - smoothstep(0.6 * life, life, age) : 1.0;
  m = 1.0 + (m - 1.0) * f * strength;
  float e = 0.0;
  if (ember > 0.0 && age < ember) {
    float k = 1.0 - age / ember;
    float gm = (1.0 - smoothstep(0.05, kind == 1 ? 0.55 : 0.5, sn)) * (0.8 + 0.2 * n);
    e = k * k * gm * strength * (0.85 + 0.15 * sin(age * 11.0 + ph.y));
  }
  return vec2(m, e);
}

vec4 fxScorch(vec3 relPos) {
  if (u_fxScorchGrid.z == 0) return vec4(1.0, 1.0, 1.0, 0.0);
  ivec2 wr = u_camPosInt.xz + ivec2(floor((relPos.xz + u_camFrac.xz) * 4096.0));
  ivec2 chunk = wr >> ${SCORCH_CHUNK_SHIFT};
  int nc = u_fxScorchGrid.x;
  if (chunk.x < 0 || chunk.y < 0 || chunk.x >= nc || chunk.y >= nc) return vec4(1.0, 1.0, 1.0, 0.0);
  int W = u_fxScorchGrid.y;
  int ci = chunk.y * nc + chunk.x;
  uint cell = texelFetch(u_fxScorchCells, ivec2(ci % W, ci / W), 0).r;
  int cnt = int(cell & 63u);
  int first = int(cell >> 6u);
  float mult = 1.0;
  float glow = 0.0;
  for (int i = 0; i < ${MAX_SCORCH_PER_CHUNK}; i++) {
    if (i >= cnt) break;
    int li = first + i;
    int di = int(texelFetch(u_fxScorchCells, ivec2(li % W, li / W), 0).r);
    ivec2 tc = ivec2((di % u_fxScorchGrid.w) * 2, di / u_fxScorchGrid.w);
    ivec4 t0 = texelFetch(u_fxScorchData, tc, 0);
    ivec4 t1 = texelFetch(u_fxScorchData, tc + ivec2(1, 0), 0);
    vec2 d = relPos.xz - (vec2(t0.xy - u_camPosInt.xz) / 4096.0 - u_camFrac.xz);
    vec2 r = fxScorchOne(d, t0, t1);
    mult *= r.x;
    glow += r.y;
  }
  return vec4(vec3(max(mult, 0.1)), min(glow, 4.0));
}

vec3 fxScorchGlow(float e) {
  return mix(${glslVec3(GLOW_FALLOFF)}, ${glslVec3(GLOW_CORE)}, clamp(e, 0.0, 1.0)) * e * u_fxScorchTime.y;
}
`;

// ------------------------------------------------------------------------------------------------
// JS mirror of the shader math

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function glslMod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

export interface ScorchShadeInput {
  /** Offset of the shaded point from the decal center (WU). */
  readonly dxWu: number;
  readonly dzWu: number;
  readonly radiusWu: number;
  /** Rotation in rad (quantized to 1/4096 turn like the packed data). */
  readonly rotation: number;
  readonly kind: ScorchKind;
  /** Seed (17 bits used). */
  readonly seed: number;
  /** Age in s. */
  readonly ageS: number;
  /** 0 = permanent. */
  readonly lifetimeS: number;
  /** 0 = no ember glow. */
  readonly emberS: number;
  /** 0..1 (default 1). */
  readonly strength?: number;
}

export interface ScorchShade {
  /** Albedo multiplier (1 = untouched, < 1 soot/crater floor, > 1 crater rim). */
  mult: number;
  /** Ember emission intensity. */
  ember: number;
}

/** Quantized rotation (12 bits). */
export function scorchRot12(rotation: number): number {
  return Math.round((rotation / TAU) * 4096) & 4095;
}

/** Core of the per-decal shading with already-quantized inputs; mirrors `fxScorchOne`. */
function shadeOne(
  dx: number,
  dz: number,
  R: number,
  rot12: number,
  kind: number,
  seed: number,
  age: number,
  life: number,
  ember: number,
  strength: number,
  out: ScorchShade,
): ScorchShade {
  const rot = rot12 * (TAU / 4096);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const qx = (c * dx + s * dz) / R;
  let qz = (-s * dx + c * dz) / R;
  if (kind === 2) qz /= SCORCH_SCAR_WIDTH;
  const r = Math.sqrt(qx * qx + qz * qz);
  if (r >= 1) {
    out.mult = 1;
    out.ember = 0;
    return out;
  }
  const th = Math.atan2(qz, qx);
  const p0 = (seed & 63) * (TAU / 64);
  const p1 = ((seed >>> 6) & 63) * (TAU / 64);
  const p2 = ((seed >>> 12) & 63) * (TAU / 64);
  const n = 0.5 * Math.sin(3 * th + p0) + 0.3 * Math.sin(5 * th + p1) + 0.2 * Math.sin(9 * th + p2);
  const re = 1 - 0.22 * (0.5 + 0.5 * n);
  const sn = r / re;
  const mask = 1 - smoothstep(0.78, 1, sn);
  let m: number;
  if (kind === 1) {
    const fl = 1 - smoothstep(0.42, 0.62, sn);
    const rim = Math.exp((-(sn - 0.74) * (sn - 0.74)) / 0.01);
    m = 1 - mask * (0.7 * fl + 0.38 * (1 - fl)) + 0.5 * rim * mask;
  } else if (kind === 2) {
    m = 1 - 0.6 * mask * (1 - 0.5 * sn);
  } else {
    m = 1 - 0.82 * mask * (1 - 0.4 * sn);
  }
  const f = life > 0 ? 1 - smoothstep(0.6 * life, life, age) : 1;
  m = 1 + (m - 1) * f * strength;
  let e = 0;
  if (ember > 0 && age < ember) {
    const k = 1 - age / ember;
    const gm = (1 - smoothstep(0.05, kind === 1 ? 0.55 : 0.5, sn)) * (0.8 + 0.2 * n);
    e = k * k * gm * strength * (0.85 + 0.15 * Math.sin(age * 11 + p1));
  }
  out.mult = m;
  out.ember = e;
  return out;
}

/** JS mirror of the GLSL shading of ONE decal (tests, CPU previews). */
export function scorchShadeReference(p: ScorchShadeInput, out: ScorchShade = { mult: 1, ember: 0 }): ScorchShade {
  return shadeOne(
    p.dxWu,
    p.dzWu,
    Math.round(p.radiusWu * RAW) / RAW,
    scorchRot12(p.rotation),
    SCORCH_KIND_ID[p.kind],
    (p.seed >>> 0) & 0x1ffff,
    p.ageS,
    p.lifetimeS,
    p.emberS,
    p.strength ?? 1,
    out,
  );
}

// ------------------------------------------------------------------------------------------------
// Pool

export interface ScorchDecalInput {
  readonly xWu: number;
  readonly zWu: number;
  readonly radiusWu: number;
  readonly kind: ScorchKind;
  /** Rotation in rad (default 0). */
  readonly rotation?: number;
  readonly seed: number;
  /** Creation time (FX/scene time in s, unwrapped). */
  readonly tS: number;
  /** Lifetime in s (default per kind, 0 = permanent until replaced). */
  readonly lifetimeS?: number;
  /** Ember glow duration in s (default per kind, 0 = none). */
  readonly emberS?: number;
  /** Darkness/glow strength 0..1 (default 1). */
  readonly strength?: number;
}

export interface ScorchStats {
  /** Decals packed into the data texture at the last pack(). */
  decals: number;
  /** Used list entries at the last pack(). */
  listEntries: number;
  /** (decal, chunk) pairs beyond {@link MAX_SCORCH_PER_CHUNK} at the last pack() (not drawn there). */
  chunkOverflow: number;
  /** Decals replaced because the pool was full (cumulative). */
  replaced: number;
  /** Decals removed at the end of their lifetime (cumulative). */
  expired: number;
}

export interface ScorchDecalsOptions {
  /** Pool size (e.g. SCORCH_CAPS[preset]), 1..4096. */
  readonly cap: number;
  /** Map edge length in WU (multiple of 32). */
  readonly mapSizeWu: number;
}

const HANDLE_SLOTS = 4096;

export class ScorchDecals {
  readonly cap: number;
  readonly mapSizeWu: number;
  /** Chunks per map side. */
  readonly chunks: number;
  /** RGBA32I data texture (upload with writeTexture over {@link dataTexture}). */
  readonly dataTexture: ScorchTextureDesc;
  readonly data: Int32Array;
  /** R32UI cells texture: chunk index + lists. */
  readonly cellsTexture: ScorchTextureDesc;
  readonly cells: Uint32Array;
  /** First list entry in {@link cells} (= chunks²). */
  readonly listBase: number;
  /** Capacity of the list region. */
  readonly listCapacity: number;
  readonly stats: ScorchStats = { decals: 0, listEntries: 0, chunkOverflow: 0, replaced: 0, expired: 0 };
  /** Uniform block content of {@link SCORCH_BLOCK_GLSL} (see {@link writeBlock}). */
  readonly block = new ArrayBuffer(SCORCH_LAYOUT.size);

  private readonly blockI32 = new Int32Array(this.block);
  private readonly blockF32 = new Float32Array(this.block);
  private readonly xRaw: Int32Array;
  private readonly zRaw: Int32Array;
  private readonly radiusRaw: Int32Array;
  private readonly packed: Int32Array;
  private readonly tBorn: Float64Array;
  private readonly life: Float64Array;
  private readonly ember: Float64Array;
  private readonly strength: Float64Array;
  private readonly serial: Float64Array;
  private readonly gen: Uint32Array;
  private readonly live: Uint8Array;
  private readonly freeList: Int32Array;
  private freeCount: number;
  private nextSerial = 0;
  private liveCount = 0;
  private isDirty = true;
  private now = 0;
  private readonly cover: Int32Array;
  private readonly counts: Uint32Array;
  private readonly shadeTmp: ScorchShade = { mult: 1, ember: 0 };

  constructor(opts: ScorchDecalsOptions) {
    const { cap, mapSizeWu } = opts;
    if (!Number.isInteger(cap) || cap < 1 || cap > HANDLE_SLOTS) throw new Error(`ScorchDecals: cap ${cap} must be in [1, ${HANDLE_SLOTS}]`);
    const chunks = mapSizeWu / SCORCH_CHUNK_WU;
    if (!Number.isInteger(chunks) || chunks < 1) {
      throw new Error(`ScorchDecals: mapSizeWu ${mapSizeWu} must be a positive multiple of ${SCORCH_CHUNK_WU}`);
    }
    this.cap = cap;
    this.mapSizeWu = mapSizeWu;
    this.chunks = chunks;
    const rows = Math.ceil(cap / SCORCH_DECALS_PER_ROW);
    this.dataTexture = { width: SCORCH_DATA_WIDTH, height: rows, format: 'rgba32i' };
    this.data = new Int32Array(SCORCH_DATA_WIDTH * rows * 4);
    this.listBase = chunks * chunks;
    this.listCapacity = Math.min(cap * 16, chunks * chunks * MAX_SCORCH_PER_CHUNK);
    const cellRows = Math.ceil((this.listBase + this.listCapacity) / SCORCH_CELLS_WIDTH);
    this.cellsTexture = { width: SCORCH_CELLS_WIDTH, height: cellRows, format: 'r32ui' };
    this.cells = new Uint32Array(SCORCH_CELLS_WIDTH * cellRows);
    this.xRaw = new Int32Array(cap);
    this.zRaw = new Int32Array(cap);
    this.radiusRaw = new Int32Array(cap);
    this.packed = new Int32Array(cap);
    this.tBorn = new Float64Array(cap);
    this.life = new Float64Array(cap);
    this.ember = new Float64Array(cap);
    this.strength = new Float64Array(cap);
    this.serial = new Float64Array(cap);
    this.gen = new Uint32Array(cap);
    this.live = new Uint8Array(cap);
    this.freeList = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.freeList[i] = cap - 1 - i;
    this.freeCount = cap;
    this.cover = new Int32Array(cap * 4);
    this.counts = new Uint32Array(chunks * chunks);
  }

  /** Live decals. */
  get count(): number {
    return this.liveCount;
  }

  /** True when {@link pack} must run (and the textures be re-uploaded). */
  get dirty(): boolean {
    return this.isDirty;
  }

  /**
   * Adds a decal; when the pool is full the oldest decal is replaced. Returns a handle for
   * {@link remove} (stale handles are ignored).
   */
  add(d: ScorchDecalInput): number {
    if (!Number.isFinite(d.xWu) || !Number.isFinite(d.zWu)) throw new Error('ScorchDecals.add: position must be finite');
    if (!(d.radiusWu > 0 && d.radiusWu <= MAX_SCORCH_RADIUS_WU)) {
      throw new Error(`ScorchDecals.add: radiusWu ${d.radiusWu} must be in (0, ${MAX_SCORCH_RADIUS_WU}]`);
    }
    const kind = SCORCH_KIND_ID[d.kind];
    if (kind === undefined) throw new Error(`ScorchDecals.add: unknown kind '${String(d.kind)}'`);
    const def = SCORCH_DEFAULTS[d.kind];
    const life = d.lifetimeS ?? def.lifetimeS;
    if (!(life >= 0 && life <= MAX_SCORCH_LIFETIME_S)) {
      throw new Error(`ScorchDecals.add: lifetimeS ${life} must be in [0, ${MAX_SCORCH_LIFETIME_S}]`);
    }
    const ember = d.emberS ?? def.emberS;
    if (!(ember >= 0 && ember <= 60)) throw new Error(`ScorchDecals.add: emberS ${ember} must be in [0, 60]`);
    if (!Number.isFinite(d.tS)) throw new Error('ScorchDecals.add: tS must be finite');
    let slot: number;
    if (this.freeCount > 0) {
      slot = this.freeList[--this.freeCount]!;
    } else {
      slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < this.cap; i++) {
        if (this.serial[i]! < oldest) {
          oldest = this.serial[i]!;
          slot = i;
        }
      }
      this.live[slot] = 0;
      this.liveCount--;
      this.stats.replaced++;
    }
    this.xRaw[slot] = Math.round(d.xWu * RAW);
    this.zRaw[slot] = Math.round(d.zWu * RAW);
    this.radiusRaw[slot] = Math.round(d.radiusWu * RAW);
    this.packed[slot] = scorchRot12(d.rotation ?? 0) | (kind << 12) | (((d.seed >>> 0) & 0x1ffff) << 14);
    this.tBorn[slot] = d.tS;
    this.life[slot] = life;
    this.ember[slot] = ember;
    this.strength[slot] = Math.min(1, Math.max(0, d.strength ?? 1));
    this.serial[slot] = this.nextSerial++;
    this.gen[slot] = (this.gen[slot]! + 1) >>> 0;
    this.live[slot] = 1;
    this.liveCount++;
    this.isDirty = true;
    return this.gen[slot]! * HANDLE_SLOTS + slot;
  }

  /** Removes a decal by handle; returns false for stale/unknown handles. */
  remove(handle: number): boolean {
    const slot = handle % HANDLE_SLOTS;
    const g = Math.floor(handle / HANDLE_SLOTS);
    if (slot < 0 || slot >= this.cap || this.live[slot] !== 1 || this.gen[slot] !== g) return false;
    this.kill(slot);
    return true;
  }

  private kill(slot: number): void {
    this.live[slot] = 0;
    this.serial[slot] = Infinity;
    this.freeList[this.freeCount++] = slot;
    this.liveCount--;
    this.isDirty = true;
  }

  /**
   * Advances time: removes expired decals and clears finished ember glows (so wrapped FX time can
   * never re-ignite them). Fading itself happens in the shader.
   */
  update(tS: number): void {
    this.now = tS;
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] !== 1) continue;
      const age = tS - this.tBorn[i]!;
      const life = this.life[i]!;
      if (life > 0 && age >= life) {
        this.kill(i);
        this.stats.expired++;
        continue;
      }
      if (this.ember[i]! > 0 && age >= this.ember[i]!) {
        this.ember[i] = 0;
        this.isDirty = true;
      }
    }
  }

  /** Packs the live decals into {@link data} and bins them into {@link cells}; clears `dirty`. */
  pack(): void {
    const data = this.data;
    data.fill(0);
    const cover = this.cover;
    const reachMargin = SCORCH_BIN_MARGIN_WU * RAW;
    const span = SCORCH_CHUNK_WU * RAW;
    const last = this.chunks - 1;
    const wrapMs = FX_TIME_WRAP_S * 1000;
    let n = 0;
    for (let s = 0; s < this.cap; s++) {
      if (this.live[s] !== 1) continue;
      const o = (Math.floor(n / SCORCH_DECALS_PER_ROW) * SCORCH_DATA_WIDTH + (n % SCORCH_DECALS_PER_ROW) * 2) * 4;
      const x = this.xRaw[s]!;
      const z = this.zRaw[s]!;
      const r = this.radiusRaw[s]!;
      data[o] = x;
      data[o + 1] = z;
      data[o + 2] = r;
      data[o + 3] = this.packed[s]!;
      data[o + 4] = glslMod(Math.round(this.tBorn[s]! * 1000), wrapMs);
      data[o + 5] = Math.round(this.life[s]! * 1000);
      data[o + 6] = Math.round(this.ember[s]! * 1000);
      data[o + 7] = Math.round(this.strength[s]! * 1000);
      const reach = r + reachMargin;
      const c = n * 4;
      cover[c] = Math.max(0, Math.floor((x - reach) / span));
      cover[c + 1] = Math.max(0, Math.floor((z - reach) / span));
      cover[c + 2] = Math.min(last, Math.floor((x + reach) / span));
      cover[c + 3] = Math.min(last, Math.floor((z + reach) / span));
      n++;
    }
    const st = this.stats;
    st.decals = n;
    st.chunkOverflow = 0;
    // Pass 1: capped counts; pass 2: prefix sums into the index; pass 3: scatter in packing order.
    const counts = this.counts;
    counts.fill(0);
    const chunks = this.chunks;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const c = i * 4;
      for (let cz = cover[c + 1]!; cz <= cover[c + 3]!; cz++) {
        for (let cx = cover[c]!; cx <= cover[c + 2]!; cx++) {
          const k = cz * chunks + cx;
          if (counts[k]! < MAX_SCORCH_PER_CHUNK && total < this.listCapacity) {
            counts[k]!++;
            total++;
          } else {
            st.chunkOverflow++;
          }
        }
      }
    }
    const cells = this.cells;
    cells.fill(0);
    let acc = this.listBase;
    for (let k = 0; k < chunks * chunks; k++) {
      cells[k] = ((acc << 6) | counts[k]!) >>> 0;
      acc += counts[k]!;
    }
    st.listEntries = acc - this.listBase;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = i * 4;
      for (let cz = cover[c + 1]!; cz <= cover[c + 3]!; cz++) {
        for (let cx = cover[c]!; cx <= cover[c + 2]!; cx++) {
          const k = cz * chunks + cx;
          const used = counts[k]!;
          if (used >= (cells[k]! & 63)) continue;
          cells[(cells[k]! >>> 6) + used] = i;
          counts[k] = used + 1;
        }
      }
    }
    this.isDirty = false;
  }

  /**
   * Fills {@link block} for FX time tS (unwrapped seconds) and returns it (upload to the
   * SLOT_FX_SCORCH uniform buffer). `emberIntensity` = HDR strength of the glow (LDR: ≈ 1).
   */
  writeBlock(tS: number, emberIntensity = 4, strength = 1): ArrayBuffer {
    const i = this.blockI32;
    const f = this.blockF32;
    i[0] = this.chunks;
    i[1] = SCORCH_CELLS_WIDTH;
    i[2] = this.stats.decals;
    i[3] = SCORCH_DECALS_PER_ROW;
    f[4] = glslMod(tS, FX_TIME_WRAP_S);
    f[5] = emberIntensity;
    f[6] = strength;
    f[7] = 0;
    return this.block;
  }

  /**
   * CPU evaluation of the packed field at a world position (mirrors `fxScorch`, reads the packed
   * arrays, so call {@link pack} first). Returns the combined albedo multiplier and ember glow.
   */
  shadeAt(xWu: number, zWu: number, tS: number, out: ScorchShade = { mult: 1, ember: 0 }): ScorchShade {
    out.mult = 1;
    out.ember = 0;
    if (this.stats.decals === 0) return out;
    const cx = Math.floor(xWu * RAW) >> SCORCH_CHUNK_SHIFT;
    const cz = Math.floor(zWu * RAW) >> SCORCH_CHUNK_SHIFT;
    if (cx < 0 || cz < 0 || cx >= this.chunks || cz >= this.chunks) return out;
    const cell = this.cells[cz * this.chunks + cx]!;
    const cnt = cell & 63;
    const first = cell >>> 6;
    const now = Math.fround(glslMod(tS, FX_TIME_WRAP_S));
    let mult = 1;
    let glow = 0;
    const tmp = this.shadeTmp;
    for (let i = 0; i < cnt; i++) {
      const di = this.cells[first + i]!;
      const o = (Math.floor(di / SCORCH_DECALS_PER_ROW) * SCORCH_DATA_WIDTH + (di % SCORCH_DECALS_PER_ROW) * 2) * 4;
      const d = this.data;
      const pk = d[o + 3]! >>> 0;
      const age = glslMod(now - d[o + 4]! * 0.001 + FX_TIME_WRAP_S, FX_TIME_WRAP_S);
      shadeOne(
        xWu - d[o]! / RAW,
        zWu - d[o + 1]! / RAW,
        d[o + 2]! / RAW,
        pk & 4095,
        (pk >>> 12) & 3,
        pk >>> 14,
        age,
        d[o + 5]! * 0.001,
        d[o + 6]! * 0.001,
        d[o + 7]! * 0.001,
        tmp,
      );
      mult *= tmp.mult;
      glow += tmp.ember;
    }
    out.mult = Math.max(mult, 0.1);
    out.ember = Math.min(glow, 4);
    return out;
  }

  /** Current time of the last {@link update}. */
  get timeS(): number {
    return this.now;
  }

  /** Removes all decals. */
  clear(): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] === 1) this.kill(i);
    }
    this.isDirty = true;
  }
}

/** Scorch decal per Varkan gameplay event (death class / large impacts) for the integration. */
export const VARKAN_SCORCH: Readonly<
  Record<'impact_large' | 'small' | 'medium' | 'large' | 'structure' | 'acu', { kind: ScorchKind; radiusWu: number; emberS: number; lifetimeS: number }>
> = {
  impact_large: { kind: 'scorch', radiusWu: 1.6, emberS: 1.5, lifetimeS: 60 },
  small: { kind: 'scorch', radiusWu: 1.8, emberS: 2.5, lifetimeS: 120 },
  medium: { kind: 'scorch', radiusWu: 2.8, emberS: 3.5, lifetimeS: 150 },
  large: { kind: 'crater', radiusWu: 4.5, emberS: 5, lifetimeS: 240 },
  structure: { kind: 'crater', radiusWu: 6.5, emberS: 6, lifetimeS: 300 },
  acu: { kind: 'crater', radiusWu: 22, emberS: 10, lifetimeS: 0 },
};
