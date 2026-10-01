/**
 * Lab ground: 512 × 512 WU of gentle hills, 256 × 256 quads generated from gl_VertexID (no vertex
 * buffers, 1 draw). The height function exists twice – `labGroundHeight` in JS (unit placement,
 * scene logic) and `LAB_GROUND_GLSL` generated from the same wave table (test: same constants).
 *
 * Shading: procedural albedo (earth, dry grass, dark iron ground), CSM receiver, scorch/crater decals
 * (SCORCH_GLSL, ember glow as HDR emissive) and distance fog.
 */
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, TexH } from '@faf/render';
import {
  SCORCH_GLSL,
  SCORCH_LAYOUT,
  SCORCH_SAMPLERS,
  SCORCH_UNIFORM_BLOCKS,
  SHADOW_CASTER_GLSL,
  SHADOW_CASTER_PIPELINE,
  SHADOW_CASTER_UNIFORM_BLOCKS,
  SLOT_FX_SCORCH,
  UNIT_FX_SCORCH_CELLS,
  UNIT_FX_SCORCH_DATA,
} from '@faf/render-fx';
import type { ScorchDecals } from '@faf/render-fx';
import { LAB_WORLD_WU } from './context.ts';
import { LAB_NOISE_GLSL, LAB_VS_HEADER, RECEIVER_BLOCKS, RECEIVER_SAMPLERS, receiverFsHeader } from './glsl.ts';

/** One sine wave of the height field: amplitude (WU), wave numbers kx/kz (rad/WU), phase (rad). */
export type GroundWave = readonly [amp: number, kx: number, kz: number, phase: number];

/** Wave table of the hills (shared by JS and GLSL). Sum of amplitudes 7.3 WU, max slope ≈ 10°. */
export const GROUND_WAVES: readonly GroundWave[] = [
  [3.1, 0.0112, 0.0071, 0.41],
  [2.05, -0.0063, 0.0143, 1.73],
  [1.25, 0.0247, 0.0188, 2.91],
  [0.58, 0.0413, -0.0352, 0.83],
  [0.32, 0.0707, 0.0641, 4.12],
];
/** Height offset so the lowest point stays above 0. */
export const GROUND_BASE_WU = 8;
/** Quads per side of the rendered ground. */
export const GROUND_GRID = 256;
/** Quads per side of the shadow-caster ground (curvature is tiny, 4 WU cells are enough). */
export const GROUND_CASTER_GRID = 128;

/** Height of the lab ground at (x, z) in WU (mirrored by `labGroundHeight` in LAB_GROUND_GLSL). */
export function labGroundHeight(xWu: number, zWu: number): number {
  let h = GROUND_BASE_WU;
  for (const w of GROUND_WAVES) h += w[0] * Math.sin(w[1] * xWu + w[2] * zWu + w[3]);
  return h;
}

/** Gradient (dh/dx, dh/dz) of {@link labGroundHeight}. */
export function labGroundGradient(xWu: number, zWu: number, out: [number, number] = [0, 0]): [number, number] {
  let gx = 0;
  let gz = 0;
  for (const w of GROUND_WAVES) {
    const c = w[0] * Math.cos(w[1] * xWu + w[2] * zWu + w[3]);
    gx += c * w[1];
    gz += c * w[2];
  }
  out[0] = gx;
  out[1] = gz;
  return out;
}

/** GLSL float literal that parses to exactly the same double as `n` (always with a decimal point). */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`glslFloat: ${n} is not finite`);
  const s = String(n);
  if (/e/i.test(s)) throw new Error(`glslFloat: ${s} needs an exponent – keep table values plain`);
  return s.includes('.') ? s : `${s}.0`;
}

/** `float labGroundHeight(vec2 p)` and `vec2 labGroundGrad(vec2 p)` generated from {@link GROUND_WAVES}. */
export const LAB_GROUND_GLSL = ((): string => {
  const h: string[] = [];
  const g: string[] = [];
  for (const [a, kx, kz, ph] of GROUND_WAVES) {
    const arg = `${glslFloat(kx)} * p.x + ${glslFloat(kz)} * p.y + ${glslFloat(ph)}`;
    h.push(`  h += ${glslFloat(a)} * sin(${arg});`);
    g.push(`  c = ${glslFloat(a)} * cos(${arg}); g += c * vec2(${glslFloat(kx)}, ${glslFloat(kz)});`);
  }
  return /* glsl */ `
float labGroundHeight(vec2 p) {
  float h = ${glslFloat(GROUND_BASE_WU)};
${h.join('\n')}
  return h;
}
vec2 labGroundGrad(vec2 p) {
  vec2 g = vec2(0.0);
  float c;
${g.join('\n')}
  return g;
}
`;
})();

const CELL_WU = LAB_WORLD_WU / GROUND_GRID;
const CASTER_CELL_WU = LAB_WORLD_WU / GROUND_CASTER_GRID;

/** Quad corner offsets of a gl_VertexID-generated grid (two triangles, CCW seen from above). */
const QUAD_CORNERS_GLSL = /* glsl */ `
ivec2 labQuadCorner(int c) {
  // 0:(0,0) 1:(0,1) 2:(1,1) | 3:(0,0) 4:(1,1) 5:(1,0)
  if (c == 0 || c == 3) return ivec2(0, 0);
  if (c == 1) return ivec2(0, 1);
  if (c == 5) return ivec2(1, 0);
  return ivec2(1, 1);
}
`;

const GROUND_VS = /* glsl */ `${LAB_VS_HEADER}
${LAB_GROUND_GLSL}
${QUAD_CORNERS_GLSL}
out vec3 v_rel;
out vec2 v_world;
void main() {
  int q = gl_VertexID / 6;
  ivec2 cell = ivec2(q % ${GROUND_GRID}, q / ${GROUND_GRID}) + labQuadCorner(gl_VertexID - q * 6);
  ivec2 xzRaw = cell * ${CELL_WU * 4096};
  vec2 xz = vec2(cell) * ${glslFloat(CELL_WU)};
  float h = labGroundHeight(xz);
  v_world = xz;
  v_rel = vec3(float(xzRaw.x - u_camPosInt.x) / 4096.0, h - float(u_camPosInt.y) / 4096.0, float(xzRaw.y - u_camPosInt.z) / 4096.0);
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

function groundFs(hdr: boolean): string {
  return /* glsl */ `${receiverFsHeader(hdr)}
${SCORCH_GLSL}
${LAB_GROUND_GLSL}
${LAB_NOISE_GLSL}
in vec3 v_rel;
in vec2 v_world;
out vec4 o_color;

vec3 labGroundAlbedo(vec2 p, vec3 n) {
  float broad = labFbm(p * 0.035);
  float mid = labFbm(p * 0.13 + 31.0);
  float fine = labNoise(p * 0.9);
  vec3 earth = vec3(0.34, 0.28, 0.21);
  vec3 grass = vec3(0.33, 0.37, 0.2);
  vec3 iron = vec3(0.19, 0.19, 0.2);
  vec3 c = mix(earth, grass, smoothstep(0.42, 0.62, broad));
  float slope = 1.0 - n.y;
  float ironMask = smoothstep(0.58, 0.74, mid) * (1.0 - smoothstep(0.62, 0.7, broad) * 0.5) + smoothstep(0.03, 0.08, slope) * 0.5;
  c = mix(c, iron, clamp(ironMask, 0.0, 1.0));
  // Rust flecks on the iron ground, pebbles/grain everywhere.
  c = mix(c, vec3(0.36, 0.2, 0.11), smoothstep(0.78, 0.86, fine) * clamp(ironMask, 0.0, 1.0) * 0.6);
  c *= 0.86 + 0.28 * fine;
  return c;
}

void main() {
  vec2 g = labGroundGrad(v_world);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 albedo = labGroundAlbedo(v_world, n);
  vec4 sc = fxScorch(v_rel - u_camFrac.xyz);
  albedo *= sc.rgb;
  vec3 c = fxLight(albedo, n, fxShadow(v_rel, n));
  c += fxScorchGlow(sc.a);
  o_color = vec4(labFog(c, v_rel), 1.0);
}
`;
}

const GROUND_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SHADOW_CASTER_GLSL}
${LAB_GROUND_GLSL}
${QUAD_CORNERS_GLSL}
void main() {
  int q = gl_VertexID / 6;
  ivec2 cell = ivec2(q % ${GROUND_CASTER_GRID}, q / ${GROUND_CASTER_GRID}) + labQuadCorner(gl_VertexID - q * 6);
  vec2 xz = vec2(cell) * ${glslFloat(CASTER_CELL_WU)};
  ivec3 posRaw = ivec3(cell.x * ${CASTER_CELL_WU * 4096}, 0, cell.y * ${CASTER_CELL_WU * 4096});
  gl_Position = fxShadowCasterPos(posRaw, vec3(0.0, labGroundHeight(xz), 0.0));
}
`;

/**
 * GPU side of the scorch field: data + cells textures (uploaded when the pool is dirty, restored from
 * the packed arrays after a context loss) and the FxScorch uniform block (written every frame).
 */
export class ScorchTextures {
  readonly dataTex: TexH;
  readonly cellsTex: TexH;
  readonly ubo: BufH;
  readonly group: BindGroupH;
  /** Texture uploads so far. */
  uploads = 0;
  private scorch: ScorchDecals;
  private readonly blockBytes: Uint8Array;

  constructor(
    private readonly dev: GpuDevice,
    scorch: ScorchDecals,
  ) {
    this.scorch = scorch;
    const d = scorch.dataTexture;
    const c = scorch.cellsTexture;
    this.dataTex = dev.createTexture({
      label: 'lab.scorch.data',
      width: d.width,
      height: d.height,
      format: d.format,
      filter: 'nearest',
      restore: (h) => this.uploadData(h),
    });
    this.cellsTex = dev.createTexture({
      label: 'lab.scorch.cells',
      width: c.width,
      height: c.height,
      format: c.format,
      filter: 'nearest',
      restore: (h) => this.uploadCells(h),
    });
    this.ubo = dev.createBuffer({ label: 'lab.scorch.ubo', usage: 'uniform', size: SCORCH_LAYOUT.size, dynamic: true });
    this.blockBytes = new Uint8Array(scorch.block);
    this.group = dev.createBindGroup({
      label: 'lab.scorch',
      buffers: [{ slot: SLOT_FX_SCORCH, buffer: this.ubo }],
      textures: [
        { unit: UNIT_FX_SCORCH_DATA, texture: this.dataTex },
        { unit: UNIT_FX_SCORCH_CELLS, texture: this.cellsTex },
      ],
    });
    scorch.pack();
    this.uploadData(this.dataTex);
    this.uploadCells(this.cellsTex);
  }

  /** Switches to another pool of the same capacity (scene switch). */
  setScorch(scorch: ScorchDecals): void {
    const a = scorch.dataTexture;
    const b = this.scorch.dataTexture;
    const c = scorch.cellsTexture;
    const d = this.scorch.cellsTexture;
    if (a.width !== b.width || a.height !== b.height || c.width !== d.width || c.height !== d.height) {
      throw new Error('ScorchTextures.setScorch: pool layout differs (same cap and map size required)');
    }
    this.scorch = scorch;
    scorch.pack();
    this.upload();
  }

  /** Packs and uploads when the pool changed; writes the uniform block. Call once per frame. */
  update(tS: number, hdr: boolean): void {
    if (this.scorch.dirty) {
      this.scorch.pack();
      this.upload();
    }
    this.scorch.writeBlock(tS, hdr ? 4 : 1.2);
    this.dev.writeBuffer(this.ubo, 0, this.blockBytes);
  }

  private upload(): void {
    this.uploadData(this.dataTex);
    this.uploadCells(this.cellsTex);
    this.uploads++;
  }

  private uploadData(h: TexH): void {
    const d = this.scorch.dataTexture;
    this.dev.writeTexture(h, { x: 0, y: 0, width: d.width, height: d.height }, this.scorch.data);
  }

  private uploadCells(h: TexH): void {
    const c = this.scorch.cellsTexture;
    this.dev.writeTexture(h, { x: 0, y: 0, width: c.width, height: c.height }, this.scorch.cells);
  }

  destroy(): void {
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyTexture(this.dataTex);
    this.dev.destroyTexture(this.cellsTex);
  }
}

/** Ground pass (receiver) and ground shadow caster. Bind groups (frame, receiver, scorch) are set by the app. */
export class GroundPass {
  private pipe: PipeH;
  private readonly caster: PipeH;
  private hdr: boolean;

  constructor(
    private readonly dev: GpuDevice,
    hdr: boolean,
  ) {
    this.hdr = hdr;
    this.pipe = this.createPipeline(hdr);
    this.caster = dev.createPipeline({
      ...SHADOW_CASTER_PIPELINE,
      label: 'lab.ground.caster',
      vertex: GROUND_CASTER_VS,
      streams: [],
      uniformBlocks: SHADOW_CASTER_UNIFORM_BLOCKS,
    });
  }

  private createPipeline(hdr: boolean): PipeH {
    return this.dev.createPipeline({
      label: 'lab.ground',
      vertex: GROUND_VS,
      fragment: groundFs(hdr),
      streams: [],
      uniformBlocks: [...RECEIVER_BLOCKS, ...SCORCH_UNIFORM_BLOCKS],
      samplers: [...RECEIVER_SAMPLERS, ...SCORCH_SAMPLERS],
      depthTest: true,
      depthWrite: true,
      cullMode: 'back',
    });
  }

  /** Rebuilds the pipeline for another scene format (emissive convention differs HDR/LDR). */
  setHdr(hdr: boolean): void {
    if (hdr === this.hdr) return;
    this.dev.destroyPipeline(this.pipe);
    this.pipe = this.createPipeline(hdr);
    this.hdr = hdr;
  }

  encode(enc: PassEncoder): number {
    enc.setPipeline(this.pipe);
    enc.drawInstanced(GROUND_GRID * GROUND_GRID * 6, 1);
    return 1;
  }

  /** Static shadow caster (the caller sets the caster view's bind group after setPipeline). */
  encodeShadow(enc: PassEncoder, casterGroup: BindGroupH): number {
    enc.setPipeline(this.caster);
    enc.setBindGroup(casterGroup);
    enc.drawInstanced(GROUND_CASTER_GRID * GROUND_CASTER_GRID * 6, 1);
    return 1;
  }

  destroy(): void {
    this.dev.destroyPipeline(this.pipe);
    this.dev.destroyPipeline(this.caster);
  }
}
