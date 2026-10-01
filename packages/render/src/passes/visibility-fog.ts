/** Server-provided visibility, consumed only by ground/water presentation. */
import type { BindGroupH, BufH, GpuDevice, PipeH, Rect, TexH } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { Std140Writer, std140Layout } from '../std140.ts';
import { SLOT_TERRAIN_HEIGHT, TERRAIN_HEIGHT_GLSL, UNIT_HEIGHTMAP } from '../terrain/glsl.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS } from './shared.ts';

export const VISIBILITY_FOG_CELL_WU = 8;
export const VISIBILITY_FOG_TRANSITION_MS = 150;
/** Brightness of unknown, explored and currently visible server cells. */
export const VISIBILITY_FOG_BRIGHTNESS = [0.04, 0.35, 1] as const;
export interface VisibilityFogSnapshot {
  readonly dim: number;
  readonly cells: Uint8Array;
  /** Monotonic within one viewer/session. Pass null to reset on a viewer change or seek. */
  readonly version: number;
  readonly timeMs: number;
  readonly transitionMs?: number;
}
export interface VisibilityFogStats {
  /** A snapshot contains dimmed cells. */
  enabled: boolean;
  /** Last presentation used a matching terrain grid. */
  active: boolean;
  dim: number;
  version: number;
  unknown: number;
  explored: number;
  visible: number;
  uploads: number;
  uploadBytes: number;
  draws: number;
  transition: number;
}
export function visibilityFogStats(): VisibilityFogStats {
  return { enabled: false, active: false, dim: 0, version: -1, unknown: 0, explored: 0, visible: 0, uploads: 0, uploadBytes: 0, draws: 0, transition: 1 };
}
const LAYOUT = std140Layout([{ name: 'params', type: 'vec4' }, { name: 'surface', type: 'ivec4' }]);
const BLOCK = /* glsl */ `
layout(std140) uniform VisibilityFog {
  vec4 u_visibilityParams; // transition fraction, grid dimension, has water, reserved
  ivec4 u_visibilitySurface; // water level raw, map size raw, reserved
};
`;
const GROUND_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
layout(location = 0) in uvec2 a_local;
layout(location = 1) in uvec2 a_chunk;
out vec2 v_world;
void main() {
  ivec2 xz = (ivec2(a_chunk) * 32 + ivec2(a_local)) * 4096;
  int h = terrainHeightRaw(xz);
  v_world = vec2(xz) / 4096.0;
  vec3 rel = vec3(ivec3(xz.x, h, xz.y) - u_camPosInt.xyz) / 4096.0;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;
const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${BLOCK}
layout(location = 0) in uvec2 a_corner;
out vec2 v_world;
void main() {
  ivec2 xz = ivec2(a_corner) * u_visibilitySurface.y;
  v_world = vec2(xz) / 4096.0;
  vec3 rel = vec3(ivec3(xz.x, u_visibilitySurface.x, xz.y) - u_camPosInt.xyz) / 4096.0;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;
function fragment(water: boolean): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${TERRAIN_HEIGHT_GLSL}
${BLOCK}
uniform sampler2D u_visibility;
in vec2 v_world;
out vec4 o_color;
void main() {
  // Match WaterPass's exact height function and shoreline, without fogging submerged ground twice.
  int h = terrainHeightRaw(ivec2(floor(v_world * 4096.0 + 0.5)));
  ${water ? 'if (h >= u_visibilitySurface.x) discard;' : 'if (u_visibilityParams.z > 0.5 && h < u_visibilitySurface.x) discard;'}
  vec2 uv = v_world / (${VISIBILITY_FOG_CELL_WU}.0 * u_visibilityParams.y);
  vec2 levels = texture(u_visibility, uv).rg;
  float brightness = mix(levels.r, levels.g, u_visibilityParams.x);
  if (brightness >= 0.999) discard;
  o_color = vec4(0.0, 0.0, 0.0, 1.0 - brightness);
}
`;
}

/** Owns only fog texture/UBO/pipelines; surface passes retain all geometry and height resources. */
export class VisibilityFogPass {
  readonly groundPipeline: PipeH;
  readonly waterPipeline: PipeH;
  group: BindGroupH | null = null;
  private texture: TexH | null = null;
  private readonly ubo: BufH;
  private readonly data = new Std140Writer(LAYOUT);
  private bytes = new Uint8Array(0);
  private rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private startMs = 0;
  private durationMs = 0;
  private lastFraction = -1;
  private lastMapSize = -1;
  private lastWaterLevel: number | null | undefined;

  constructor(private readonly dev: GpuDevice, readonly stats: VisibilityFogStats = visibilityFogStats()) {
    if (dev.caps.maxTextureUnits < 2) throw new Error('visibility fog needs two texture units');
    const base = {
      uniformBlocks: [{ name: 'Frame', slot: SLOT_FRAME }, { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT }, { name: 'VisibilityFog', slot: SLOT_PASS }],
      samplers: [{ name: 'u_heightmap', unit: UNIT_HEIGHTMAP }, { name: 'u_visibility', unit: 1 }],
      cullMode: 'none' as const, depthTest: true, depthWrite: false, depthCompare: 'lequal' as const, blend: 'alpha' as const,
    };
    this.groundPipeline = dev.createPipeline({ ...base, label: 'visibility.ground', vertex: GROUND_VS, fragment: fragment(false), streams: [
      { stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
      { stepMode: 'instance', stride: 4, attributes: [{ location: 1, format: vf('u16', 2, 'int'), offset: 0 }] },
    ] });
    this.waterPipeline = dev.createPipeline({ ...base, label: 'visibility.water', vertex: WATER_VS, fragment: fragment(true), streams: [
      { stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
    ] });
    this.ubo = dev.createBuffer({ label: 'visibility.ubo', usage: 'uniform', size: LAYOUT.size, restore: h => dev.writeBuffer(h, 0, this.data.bytes) });
    dev.writeBuffer(this.ubo, 0, this.data.bytes);
  }

  clear(): void {
    const s = this.stats;
    s.enabled = false; s.active = false; s.dim = 0; s.version = -1; s.unknown = 0; s.explored = 0; s.visible = 0; s.draws = 0; s.transition = 1;
    this.durationMs = 0;
  }

  set(snapshot: VisibilityFogSnapshot): void {
    const { dim, cells, version, timeMs } = snapshot;
    if (!Number.isInteger(dim) || dim < 1 || dim > 512 || dim > this.dev.caps.maxTextureSize || cells.length !== dim * dim ||
        !Number.isSafeInteger(version) || version < 0 || !Number.isFinite(timeMs) ||
        (snapshot.transitionMs !== undefined && (!Number.isFinite(snapshot.transitionMs) || snapshot.transitionMs < 0 || snapshot.transitionMs > 1000))) {
      throw new RangeError('invalid visibility fog snapshot');
    }
    if (this.stats.version >= version && this.stats.dim === dim) return;
    let unknown = 0; let explored = 0; let visible = 0;
    for (let i = 0; i < cells.length; i++) {
      switch (cells[i]) { case 0: unknown++; break; case 1: explored++; break; case 2: visible++; break; default: throw new RangeError('invalid visibility fog cell'); }
    }
    const first = this.stats.dim !== dim || this.stats.version < 0;
    const fraction = this.fraction(timeMs);
    if (this.rect.width !== dim) {
      if (this.group !== null) this.dev.destroyBindGroup(this.group);
      if (this.texture !== null) this.dev.destroyTexture(this.texture);
      this.bytes = new Uint8Array(dim * dim * 4);
      this.rect = { x: 0, y: 0, width: dim, height: dim };
      this.texture = this.dev.createTexture({ label: 'visibility.cells', width: dim, height: dim, format: 'rgba8', filter: 'nearest', wrap: 'clamp', restore: h => this.dev.writeTexture(h, this.rect, this.bytes) });
      this.group = this.dev.createBindGroup({ label: 'visibility', buffers: [{ slot: SLOT_PASS, buffer: this.ubo }], textures: [{ unit: 1, texture: this.texture }] });
    }
    const allVisible = visible === cells.length;
    for (let i = 0; i < cells.length; i++) {
      const o = i * 4;
      const next = Math.round(VISIBILITY_FOG_BRIGHTNESS[cells[i] as 0 | 1 | 2] * 255);
      this.bytes[o] = first || allVisible ? next : Math.round(this.bytes[o]! + (this.bytes[o + 1]! - this.bytes[o]!) * fraction);
      this.bytes[o + 1] = next;
      this.bytes[o + 2] = cells[i]!;
      this.bytes[o + 3] = 255;
    }
    this.startMs = timeMs;
    this.durationMs = first || allVisible ? 0 : snapshot.transitionMs ?? VISIBILITY_FOG_TRANSITION_MS;
    this.lastFraction = -1;
    const s = this.stats;
    s.dim = dim; s.version = version; s.unknown = unknown; s.explored = explored; s.visible = visible; s.enabled = !allVisible; s.active = false;
    s.transition = this.fraction(timeMs);
    if (!allVisible) { this.dev.writeTexture(this.texture!, this.rect, this.bytes); s.uploads++; s.uploadBytes += this.bytes.byteLength; }
  }

  private fraction(now: number): number { return this.durationMs === 0 ? 1 : Math.max(0, Math.min(1, (now - this.startMs) / this.durationMs)); }

  prepare(now: number, mapSizeWu: number, waterLevelRaw: number | null): boolean {
    const s = this.stats;
    s.draws = 0;
    s.transition = this.fraction(now);
    s.active = s.enabled && s.dim * VISIBILITY_FOG_CELL_WU === mapSizeWu && this.group !== null;
    if (!s.active) return false;
    if (this.lastFraction !== s.transition || this.lastMapSize !== mapSizeWu || this.lastWaterLevel !== waterLevelRaw) {
      this.data.vec4(LAYOUT.offsetOf('params'), s.transition, s.dim, waterLevelRaw === null ? 0 : 1, 0);
      this.data.ivec4(LAYOUT.offsetOf('surface'), waterLevelRaw ?? 0, mapSizeWu * 4096, 0, 0);
      this.dev.writeBuffer(this.ubo, 0, this.data.bytes);
      this.lastFraction = s.transition;
      this.lastMapSize = mapSizeWu;
      this.lastWaterLevel = waterLevelRaw;
    }
    return true;
  }

  dispose(): void {
    if (this.group !== null) this.dev.destroyBindGroup(this.group);
    if (this.texture !== null) this.dev.destroyTexture(this.texture);
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyPipeline(this.groundPipeline);
    this.dev.destroyPipeline(this.waterPipeline);
  }
}
