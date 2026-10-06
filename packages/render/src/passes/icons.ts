/**
 * IconPass (C2, PLAN §3.7 "IconPass ist ein einziger Draw (MSDF-Atlas, Tech-Striche, Blip/Ghost)"):
 * ONE instanced draw of screen-space quads for all visible units of the frame.
 *
 * - Instance data are the unit pass's sorted UnitRecords in its instance ring (no extra CPU work or
 *   upload per icon); the VS interpolates prev/cur exactly like the unit pass and computes the unit's
 *   icon fade (strategic.ts); records of the icon-only bucket (instance ≥ `u_iconParams.y`) have fade 1,
 *   units with fade 0 become degenerate (clipped) quads.
 * - Glyph, tech level, threshold and selection radius per visual come from the shared
 *   {@link VisualDataTexture}; team color from the palette; selection (highlight stream) = bright
 *   outline; `UnitFlags.Blip` ⇒ blip glyph in a muted team color, no tech; `UnitFlags.Ghost` ⇒ class
 *   icon at reduced alpha plus the ghost frame.
 * - Screen-fixed size (`u_iconParams.x` CSS px × device px per CSS px), centered on the projected unit
 *   position; above the icon square a strip of {@link ICON_TECH_STRIP} × size for the tech strokes (second
 *   atlas sample in the same shader).
 * - MSDF FS: `median(rgb)` → glyph distance, alpha → silhouette distance (outline + dark backdrop in
 *   holes); distances scaled to screen px by `size / cellPx` (screenPxRange). Without an atlas a
 *   procedural fallback form (ring disc + tech bars) is drawn – still one draw.
 * - No depth test (icons are always on top), alpha blending.
 */
import { UNIT_FLAG_NO_INTERP, UNIT_INSTANCE_OFF_CUR_POS, UNIT_INSTANCE_OFF_PREV_POS, UNIT_INSTANCE_OFF_VISUAL, UNIT_INSTANCE_STRIDE } from '../instance-layout.ts';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, TexH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { ICON_TECH_STRIP, STRATEGIC_GLSL } from '../strategic.ts';
import { UNIT_ICON_ATLAS, UNIT_VISUAL_DATA, VISUAL_DATA_GLSL } from '../units/visual-data.ts';
import type { VisualDataTexture } from '../units/visual-data.ts';
import { FRAME_BLOCK_GLSL, MAX_VISUALS, PALETTE_BLOCK_GLSL, SLOT_FRAME, SLOT_PALETTE } from './shared.ts';
import { HIGHLIGHT_STRIDE } from './units.ts';
import type { UnitPass } from './units.ts';
import { UnitFlags } from '@faf/protocol';

/** Attribute locations shared by the unit-ring passes (icons, HP bars). */
export const RING_ATTR = { prevPos: 0, curPos: 1, meta: 2, highlight: 3 } as const;

/** Streams of a pass that reads the unit instance ring (records + highlight). */
export const UNIT_RING_STREAMS = [
  {
    stepMode: 'instance',
    stride: UNIT_INSTANCE_STRIDE,
    attributes: [
      { location: RING_ATTR.prevPos, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_PREV_POS },
      { location: RING_ATTR.curPos, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_CUR_POS },
      { location: RING_ATTR.meta, format: vf('u16', 4, 'int'), offset: UNIT_INSTANCE_OFF_VISUAL },
    ],
  },
  {
    stepMode: 'instance',
    stride: HIGHLIGHT_STRIDE,
    attributes: [{ location: RING_ATTR.highlight, format: vf('u8', 1, 'int'), offset: 0 }],
  },
] as const;

/** GLSL: ring attributes + interpolated position relative to camPosInt (`ringBase()`). */
export const UNIT_RING_GLSL = /* glsl */ `
layout(location = ${RING_ATTR.prevPos}) in ivec3 a_prevPos;
layout(location = ${RING_ATTR.curPos}) in ivec3 a_curPos;
layout(location = ${RING_ATTR.meta}) in uvec4 a_meta;   // visual | army+hp<<8 | build+bank<<8 | flags
layout(location = ${RING_ATTR.highlight}) in uint a_highlight;
vec3 ringBase() {
  bool noInterp = (a_meta.w & ${UNIT_FLAG_NO_INTERP}u) != 0u;
  vec3 relCur = vec3(a_curPos - u_camPosInt.xyz) / 4096.0;
  vec3 relPrev = vec3(a_prevPos - u_camPosInt.xyz) / 4096.0;
  return noInterp ? relCur : mix(relPrev, relCur, u_camFrac.w);
}
uint ringVisual() { return min(a_meta.x, ${MAX_VISUALS - 1}u); }
// Icon fade of this instance (icon-only bucket ⇒ 1).
float ringFade(vec3 base, vec4 vis) {
  return gl_InstanceID >= int(u_iconParams.y) ? 1.0 : unitIconFade(base - u_camFrac.xyz, vis);
}
`;

const MODE_SELECTED = 1;
const MODE_GHOST = 2;
const MODE_BLIP = 4;
const MODE_FRAME = 16;
const STRIP = ICON_TECH_STRIP.toFixed(4);

const ICON_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${PALETTE_BLOCK_GLSL}
${VISUAL_DATA_GLSL}
${STRATEGIC_GLSL}
${UNIT_RING_GLSL}
out vec2 v_q;            // x 0..1, y 0..1 + strip (icon square = y ≤ 1), y up
flat out vec4 v_icon;    // glyph rect (x, y, w, h) in atlas px; w = 0 ⇒ procedural form
flat out vec4 v_second;  // tech strip or ghost frame rect; w = 0 ⇒ none
flat out vec3 v_color;
flat out vec4 v_params;  // alpha, screen px per atlas texel, mode bits, tech (procedural)
flat out vec3 v_ranges;  // pxRange, alphaRange, icon size in device px

void main() {
  int id = gl_VertexID;
  float qx = (id == 1 || id == 2 || id == 4) ? 1.0 : 0.0;
  float qy = (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0;
  vec3 base = ringBase();
  uint visual = ringVisual();
  vec4 vis = visualRow(visual, 0);
  float fade = ringFade(base, vis);
  vec4 clip = u_viewProj * vec4(base, 1.0);
  if (fade <= 0.0 || clip.w <= 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: no fragments
    return;
  }
  vec4 sp0 = texelFetch(u_visualData, ivec2(0, 3), 0); // tech1, tech2, tech3, blip
  vec4 sp1 = texelFetch(u_visualData, ivec2(1, 3), 0); // ghost, fallback, hasAtlas, glyph count
  vec4 sp2 = texelFetch(u_visualData, ivec2(2, 3), 0); // pxRange, alphaRange, cellPx
  uint flags = a_meta.w;
  bool blip = (flags & ${UnitFlags.Blip}u) != 0u;
  bool ghost = !blip && (flags & ${UnitFlags.Ghost}u) != 0u;
  bool hasAtlas = sp1.z > 0.5;
  float glyph = blip ? sp0.w : vis.x;
  if (glyph < 0.0) glyph = sp1.y;
  v_icon = hasAtlas && glyph >= 0.0 && glyph < sp1.w ? texelFetch(u_visualData, ivec2(int(glyph), 2), 0) : vec4(0.0);
  int tech = blip || ghost ? 0 : int(vis.y + 0.5);
  float second = ghost ? sp1.x : tech == 1 ? sp0.x : tech == 2 ? sp0.y : tech == 3 ? sp0.z : -1.0;
  v_second = hasAtlas && second >= 0.0 && second < sp1.w ? texelFetch(u_visualData, ivec2(int(second), 2), 0) : vec4(0.0);
  int mode = (a_highlight != 0u ? ${MODE_SELECTED} : 0) | (ghost ? ${MODE_GHOST | MODE_FRAME} : 0) | (blip ? ${MODE_BLIP} : 0);
  vec3 team = u_army[a_meta.y & 15u].rgb;
  v_color = blip ? mix(team, vec3(0.62), 0.45) : team;
  float size = u_iconParams.x * u_strategic.z;
  v_params = vec4(fade, size / max(sp2.z, 1.0), float(mode), float(tech));
  v_ranges = vec3(sp2.x, sp2.y, size);
  float top = 1.0 + ${STRIP};
  v_q = vec2(qx, qy * top);
  vec2 offPx = vec2(qx - 0.5, qy * top - 0.5) * size;
  gl_Position = vec4(clip.xy + offPx * 2.0 * u_viewport.zw * clip.w, 0.0, clip.w);
}
`;

const ICON_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
uniform highp sampler2D u_atlas;
in vec2 v_q;
flat in vec4 v_icon;
flat in vec4 v_second;
flat in vec3 v_color;
flat in vec4 v_params;
flat in vec3 v_ranges;
out vec4 o_color;

const float FAR_OUT = -1.0e4;

float median3(vec3 c) {
  return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

// (glyph distance, silhouette distance) in screen px of glyph rect r at cell coordinates (y down, 0..1).
vec2 glyphSd(vec4 r, vec2 cell) {
  vec2 px = clamp(r.xy + cell * r.zw, r.xy + 0.5, r.xy + r.zw - 0.5);
  vec4 t = texture(u_atlas, px / vec2(textureSize(u_atlas, 0)));
  return vec2((median3(t.rgb) - 0.5) * v_ranges.x, (t.a - 0.5) * v_ranges.y) * v_params.y;
}

float boxSd(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
}

void main() {
  vec2 q = v_q;
  bool square = q.y <= 1.0;
  int mode = int(v_params.z + 0.5);
  float size = v_ranges.z;
  vec2 icon = vec2(FAR_OUT);
  vec2 extra = vec2(FAR_OUT);
  if (v_icon.z > 0.0) {
    if (square) icon = glyphSd(v_icon, vec2(q.x, 1.0 - q.y));
    if (v_second.z > 0.0) {
      if ((mode & ${MODE_FRAME}) != 0) {
        if (square) extra = glyphSd(v_second, vec2(q.x, 1.0 - q.y));
      } else if (!square) {
        // Tech strip: the stroke glyph's center band (cell y 0.3..0.7) maps onto the strip.
        extra = glyphSd(v_second, vec2(q.x, 0.5 - (q.y - 1.0 - 0.5 * ${STRIP})));
      }
    }
  } else {
    // Procedural fallback (no atlas): a disc with a hole, tech bars above.
    if (square) {
      float d = length(q - vec2(0.5));
      icon = vec2(min(0.3 - d, d - 0.11), 0.3 - d) * size;
    } else {
      int tech = int(v_params.w + 0.5);
      vec2 p = vec2(q.x, q.y - 1.0 - 0.5 * ${STRIP});
      float sd = FAR_OUT;
      for (int k = 0; k < 3; ++k) {
        if (k >= tech) break;
        float cx = 0.5 + (float(k) - 0.5 * float(tech - 1)) * 0.18;
        sd = max(sd, boxSd(p, vec2(cx, 0.0), vec2(0.05, 0.15)));
      }
      extra = vec2(sd, sd) * size;
    }
  }
  bool selected = (mode & ${MODE_SELECTED}) != 0;
  float px = u_strategic.z;
  float outlineW = (selected ? 1.8 : 1.1) * px;
  vec3 outlineCol = selected ? vec3(0.9, 1.0, 0.78) : vec3(0.04);
  // Base layer: outline (dilated silhouette), dark backdrop inside the silhouette, glyph in team color.
  float fillA = clamp(icon.x + 0.5, 0.0, 1.0);
  float silA = clamp(icon.y + 0.5, 0.0, 1.0);
  float outA = clamp(icon.y + outlineW + 0.5, 0.0, 1.0);
  vec3 rgb = mix(mix(outlineCol, vec3(0.1), silA), v_color, fillA);
  float a = max(outA, fillA) * v_params.x * ((mode & ${MODE_GHOST}) != 0 ? 0.55 : 1.0);
  // Second layer on top: tech strokes (team color) or ghost frame (light grey), each with an outline.
  float eFill = clamp(extra.x + 0.5, 0.0, 1.0);
  float eOut = clamp(extra.y + 1.1 * px + 0.5, 0.0, 1.0);
  vec3 eRgb = mix(vec3(0.04), (mode & ${MODE_FRAME}) != 0 ? vec3(0.86) : v_color, eFill);
  float eA = max(eFill, eOut) * v_params.x;
  float outAlpha = eA + a * (1.0 - eA);
  if (outAlpha < 0.004) discard;
  o_color = vec4((eRgb * eA + rgb * a * (1.0 - eA)) / outAlpha, outAlpha);
}
`;

export class IconPass {
  readonly pipeline: PipeH;
  private atlasTex: TexH;
  private atlasGroup: BindGroupH;
  private atlasPixels: Uint8Array = new Uint8Array(4);
  private atlasWidth = 1;
  private atlasHeight = 1;
  private readonly streams: VertexStreamBinding[] = [
    { buffer: 0 as BufH, offset: 0 },
    { buffer: 0 as BufH, offset: 0 },
  ];

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly paletteGroup: BindGroupH,
    private readonly visualData: VisualDataTexture,
  ) {
    this.pipeline = dev.createPipeline({
      label: 'icons',
      vertex: ICON_VS,
      fragment: ICON_FS,
      streams: UNIT_RING_STREAMS,
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'Palette', slot: SLOT_PALETTE },
      ],
      samplers: [
        { name: 'u_visualData', unit: UNIT_VISUAL_DATA },
        { name: 'u_atlas', unit: UNIT_ICON_ATLAS },
      ],
      cullMode: 'none',
      depthTest: false,
      depthWrite: false,
      blend: 'alpha',
    });
    this.atlasTex = this.createAtlasTexture();
    this.atlasGroup = dev.createBindGroup({ label: 'icons.atlas', textures: [{ unit: UNIT_ICON_ATLAS, texture: this.atlasTex }] });
  }

  private createAtlasTexture(): TexH {
    const dev = this.dev;
    const w = this.atlasWidth;
    const h = this.atlasHeight;
    const px = this.atlasPixels;
    const rect = { x: 0, y: 0, width: w, height: h };
    const tex = dev.createTexture({
      label: 'icons.atlas',
      width: w,
      height: h,
      format: 'rgba8',
      filter: 'linear',
      wrap: 'clamp',
      // Context loss: re-upload the CPU copy of the atlas.
      restore: (t) => dev.writeTexture(t, rect, px),
    });
    dev.writeTexture(tex, rect, px);
    return tex;
  }

  /** Replaces the atlas texture (null = 1×1 placeholder: the procedural form is used). */
  setAtlas(pixels: Uint8Array | null, width: number, height: number): void {
    this.dev.destroyBindGroup(this.atlasGroup);
    this.dev.destroyTexture(this.atlasTex);
    this.atlasPixels = pixels === null ? new Uint8Array(4) : pixels.slice();
    this.atlasWidth = pixels === null ? 1 : width;
    this.atlasHeight = pixels === null ? 1 : height;
    this.atlasTex = this.createAtlasTexture();
    this.atlasGroup = this.dev.createBindGroup({ label: 'icons.atlas', textures: [{ unit: UNIT_ICON_ATLAS, texture: this.atlasTex }] });
  }

  /** Atlas texture handle (tests/diagnostics). */
  get atlasTexture(): TexH {
    return this.atlasTex;
  }

  /**
   * Draws the icons of all visible records of the unit ring in ONE instanced draw. Returns the number
   * of draws (0 when there are no visible records or no icon can be visible this frame).
   */
  draw(enc: PassEncoder, units: UnitPass, anyIcon: boolean): number {
    const n = units.visibleRecords;
    const ring = units.instanceBuffer;
    const hl = units.highlightBuffer;
    if (n === 0 || ring === null || hl === null || !anyIcon) return 0;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.paletteGroup);
    enc.setBindGroup(this.visualData.group);
    enc.setBindGroup(this.atlasGroup);
    const s = this.streams;
    s[0]!.buffer = ring;
    s[0]!.offset = units.instanceOffset();
    s[1]!.buffer = hl;
    s[1]!.offset = units.highlightOffset();
    enc.setVertexStreams(s);
    enc.drawInstanced(6, n);
    return 1;
  }

  dispose(): void {
    this.dev.destroyBindGroup(this.atlasGroup);
    this.dev.destroyTexture(this.atlasTex);
    this.dev.destroyPipeline(this.pipeline);
  }
}
