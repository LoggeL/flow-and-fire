/**
 * HP bars (part of the overlay pass, MS3): ONE instanced draw over the visible records of the unit
 * instance ring (the same data as the unit pass and the IconPass, no CPU work per bar). The VS keeps
 * a bar only for records matching the mode mask (`u_iconParams.z`: bit 0 selected = highlight ≠ 0,
 * bit 1 damaged = hp < 255, bit 2 all) and places it screen-fixed ({@link HP_BAR_WIDTH_PX} ×
 * {@link HP_BAR_HEIGHT_PX} CSS px, DPR-scaled): above the mesh top (visual row 1) in mesh mode, below
 * the icon square when the unit is shown as an icon (fade ≥ 0.5). Fill color green → yellow → red
 * by `hp / 255`; selected units get a light border.
 */
import { UnitFlags } from '@faf/protocol';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { HP_BAR_GAP_PX, HP_BAR_HEIGHT_PX, HP_BAR_WIDTH_PX, STRATEGIC_GLSL } from '../strategic.ts';
import { UNIT_VISUAL_DATA, VISUAL_DATA_GLSL } from '../units/visual-data.ts';
import type { VisualDataTexture } from '../units/visual-data.ts';
import { UNIT_RING_GLSL, UNIT_RING_STREAMS } from './icons.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME } from './shared.ts';
import type { UnitPass } from './units.ts';

/** Which units show an HP bar. */
export type HpBarMode = 'auto' | 'selected' | 'damaged' | 'all' | 'off';
export const HP_BAR_SELECTED = 1;
export const HP_BAR_DAMAGED = 2;
export const HP_BAR_ALL = 4;

/** Mode → mask bits of `u_iconParams.z` ('auto' = selected or damaged). */
export function hpBarMask(mode: HpBarMode): number {
  switch (mode) {
    case 'auto':
      return HP_BAR_SELECTED | HP_BAR_DAMAGED;
    case 'selected':
      return HP_BAR_SELECTED;
    case 'damaged':
      return HP_BAR_DAMAGED;
    case 'all':
      return HP_BAR_ALL;
    case 'off':
      return 0;
  }
}

/** CPU mirror of the VS mask test (tests, client-side hit lists). */
export function hpBarVisible(mask: number, highlighted: boolean, hp: number): boolean {
  return (mask & HP_BAR_ALL) !== 0 || ((mask & HP_BAR_SELECTED) !== 0 && highlighted) || ((mask & HP_BAR_DAMAGED) !== 0 && hp < 255);
}

const HP_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${VISUAL_DATA_GLSL}
${STRATEGIC_GLSL}
${UNIT_RING_GLSL}
out vec2 v_px;          // position inside the bar in device px
flat out vec4 v_bar;    // size x, size y, border, hp 0..1
flat out float v_sel;

void main() {
  int id = gl_VertexID;
  float qx = (id == 1 || id == 2 || id == 4) ? 1.0 : 0.0;
  float qy = (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0;
  uint hp = (a_meta.y >> 8u) & 255u;
  bool sel = a_highlight != 0u;
  int mask = int(u_iconParams.z + 0.5);
  // Radar blips carry no health information.
  bool blip = (a_meta.w & ${UnitFlags.Blip}u) != 0u;
  bool show = !blip && ((mask & ${HP_BAR_ALL}) != 0 || ((mask & ${HP_BAR_SELECTED}) != 0 && sel) || ((mask & ${HP_BAR_DAMAGED}) != 0 && hp < 255u));
  vec3 base = ringBase();
  uint visual = ringVisual();
  float fade = ringFade(base, visualRow(visual, 0));
  bool iconMode = fade >= 0.5;
  vec3 anchor = iconMode ? base : base + vec3(0.0, visualRow(visual, 1).x, 0.0);
  vec4 clip = u_viewProj * vec4(anchor, 1.0);
  if (!show || clip.w <= 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float dpr = u_strategic.z;
  float border = max(1.0, floor(dpr + 0.5));
  vec2 size = vec2(${HP_BAR_WIDTH_PX}.0, ${HP_BAR_HEIGHT_PX}.0) * dpr + 2.0 * border;
  float icon = u_iconParams.x * dpr;
  float cy = iconMode ? -(0.5 * icon + ${HP_BAR_GAP_PX}.0 * dpr + 0.5 * size.y) : (2.0 * ${HP_BAR_GAP_PX}.0 * dpr + 0.5 * size.y);
  vec2 offPx = vec2((qx - 0.5) * size.x, cy + (qy - 0.5) * size.y);
  v_px = vec2(qx, qy) * size;
  v_bar = vec4(size, border, float(hp) / 255.0);
  v_sel = sel ? 1.0 : 0.0;
  gl_Position = vec4(clip.xy + offPx * 2.0 * u_viewport.zw * clip.w, 0.0, clip.w);
}
`;

const HP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_px;
flat in vec4 v_bar;
flat in float v_sel;
out vec4 o_color;
void main() {
  vec2 size = v_bar.xy;
  float b = v_bar.z;
  vec3 border = v_sel > 0.5 ? vec3(0.9, 1.0, 0.8) : vec3(0.03);
  if (v_px.x < b || v_px.y < b || v_px.x > size.x - b || v_px.y > size.y - b) {
    o_color = vec4(border, 0.9);
    return;
  }
  float t = (v_px.x - b) / max(size.x - 2.0 * b, 1.0);
  float hp = v_bar.w;
  vec3 fill = hp > 0.5 ? mix(vec3(0.95, 0.85, 0.15), vec3(0.2, 0.9, 0.25), (hp - 0.5) * 2.0) : mix(vec3(0.95, 0.15, 0.1), vec3(0.95, 0.85, 0.15), hp * 2.0);
  o_color = t <= hp ? vec4(fill, 0.95) : vec4(0.12, 0.12, 0.12, 0.75);
}
`;

export class HpBarPass {
  readonly pipeline: PipeH;
  private readonly streams: VertexStreamBinding[] = [
    { buffer: 0 as BufH, offset: 0 },
    { buffer: 0 as BufH, offset: 0 },
  ];

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly visualData: VisualDataTexture,
  ) {
    this.pipeline = dev.createPipeline({
      label: 'hp-bars',
      vertex: HP_VS,
      fragment: HP_FS,
      streams: UNIT_RING_STREAMS,
      uniformBlocks: [{ name: 'Frame', slot: SLOT_FRAME }],
      samplers: [{ name: 'u_visualData', unit: UNIT_VISUAL_DATA }],
      cullMode: 'none',
      depthTest: false,
      depthWrite: false,
      blend: 'alpha',
    });
  }

  /**
   * One instanced draw over all visible records when at least one of them can show a bar under
   * `mask` (CPU counts of the unit pass's last sort). Returns the draws.
   */
  draw(enc: PassEncoder, units: UnitPass, mask: number): number {
    const n = units.visibleRecords;
    const ring = units.instanceBuffer;
    const hl = units.highlightBuffer;
    if (n === 0 || ring === null || hl === null || mask === 0) return 0;
    const any = (mask & HP_BAR_ALL) !== 0 || ((mask & HP_BAR_SELECTED) !== 0 && units.selectedVisible > 0) || ((mask & HP_BAR_DAMAGED) !== 0 && units.damagedVisible > 0);
    if (!any) return 0;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.visualData.group);
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
    this.dev.destroyPipeline(this.pipeline);
  }
}
