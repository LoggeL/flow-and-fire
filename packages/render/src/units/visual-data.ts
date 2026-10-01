/**
 * Per-visual strategic data as a small RGBA32F data texture ({@link VISUAL_DATA_WIDTH} × 4), shared by
 * the unit pass (crossfade), the IconPass and the HP bars (bind group on texture unit
 * {@link UNIT_VISUAL_DATA}):
 *
 * - row 0, texel v: (icon glyph index or −1, tech 0..3, iconThreshold CSS px, selectionRadius WU)
 * - row 1, texel v: (mesh top WU (HP bar anchor), 0, 0, 0)
 * - row 2, texel g: glyph rectangle (x, y, w, h) in atlas pixels (rows top-down)
 * - row 3: texel 0 = glyphs (tech1, tech2, tech3, blip), texel 1 = (ghost, fallback, hasAtlas, glyph count),
 *   texel 2 = (pxRange, alphaRange, cellPx, 0) – −1 = glyph missing.
 *
 * Content is kept on the CPU and uploaded lazily (only after a change) and after a context restore.
 */
import type { BindGroupH, GpuDevice, TexH } from '../rhi/types.ts';
import type { IconAtlasMetrics } from '../icons/atlas.ts';
import { ICON_GLYPH_BLIP, ICON_GLYPH_FALLBACK, ICON_GLYPH_GHOST, ICON_GLYPH_TECH, MAX_ICON_GLYPHS, iconGlyphIndex } from '../icons/atlas.ts';
import { MAX_VISUALS } from '../passes/shared.ts';

export const VISUAL_DATA_WIDTH = Math.max(MAX_VISUALS, MAX_ICON_GLYPHS);
export const VISUAL_DATA_ROWS = 4;
/** Texture unit of the visual data texture (all unit-instance passes). */
export const UNIT_VISUAL_DATA = 8;
/** Texture unit of the icon atlas (IconPass). */
export const UNIT_ICON_ATLAS = 9;

export interface VisualStrategic {
  /** Glyph index (−1 = none ⇒ fallback glyph / procedural form). */
  readonly glyph: number;
  readonly tech: number;
  readonly iconThreshold: number;
  readonly selectionRadius: number;
  readonly meshTop: number;
}

export class VisualDataTexture {
  readonly texture: TexH;
  readonly group: BindGroupH;
  /** CPU copy (RGBA32F, row-major). */
  readonly data = new Float32Array(VISUAL_DATA_WIDTH * VISUAL_DATA_ROWS * 4);
  /** CPU mirror of rows 0/1 per visual (selection radius, threshold … for the CPU culler). */
  readonly selectionRadius = new Float64Array(MAX_VISUALS);
  readonly iconThreshold = new Float64Array(MAX_VISUALS);
  private dirty = true;
  private readonly offRestored: () => void;

  constructor(private readonly dev: GpuDevice) {
    const rect = { x: 0, y: 0, width: VISUAL_DATA_WIDTH, height: VISUAL_DATA_ROWS };
    this.texture = dev.createTexture({
      label: 'visual-data.tex',
      width: VISUAL_DATA_WIDTH,
      height: VISUAL_DATA_ROWS,
      format: 'rgba32f',
      restore: (h) => dev.writeTexture(h, rect, this.data),
    });
    this.group = dev.createBindGroup({ label: 'visual-data', textures: [{ unit: UNIT_VISUAL_DATA, texture: this.texture }] });
    this.setAtlas(null);
    this.offRestored = dev.onRestored(() => {
      this.dirty = false; // restore callback re-uploaded the CPU copy
    });
  }

  /** Writes row 0/1 of one visual. */
  setVisual(v: number, s: VisualStrategic): void {
    if (v < 0 || v >= MAX_VISUALS) throw new Error(`visual data: visual ${v} outside 0..${MAX_VISUALS - 1}`);
    const d = this.data;
    const o0 = v * 4;
    d[o0] = s.glyph;
    d[o0 + 1] = s.tech;
    d[o0 + 2] = s.iconThreshold;
    d[o0 + 3] = s.selectionRadius;
    const o1 = (VISUAL_DATA_WIDTH + v) * 4;
    d[o1] = s.meshTop;
    d[o1 + 1] = 0;
    d[o1 + 2] = 0;
    d[o1 + 3] = 0;
    this.selectionRadius[v] = s.selectionRadius;
    this.iconThreshold[v] = s.iconThreshold;
    this.dirty = true;
  }

  /** Clears the visuals from `from` on (visual table shrank). */
  clearVisualsFrom(from: number): void {
    for (let v = from; v < MAX_VISUALS; v++) this.setVisual(v, { glyph: -1, tech: 0, iconThreshold: 0, selectionRadius: 0, meshTop: 0 });
  }

  /** Rows 2/3 from atlas metrics (null = no atlas: procedural fallback form in the IconPass). */
  setAtlas(m: IconAtlasMetrics | null): void {
    const d = this.data;
    const row2 = 2 * VISUAL_DATA_WIDTH * 4;
    d.fill(0, row2, row2 + VISUAL_DATA_WIDTH * 4);
    const row3 = 3 * VISUAL_DATA_WIDTH * 4;
    d.fill(0, row3, row3 + VISUAL_DATA_WIDTH * 4);
    const idx = (id: string): number => (m === null ? -1 : iconGlyphIndex(m, id));
    if (m !== null) {
      m.glyphs.forEach((g, i) => {
        const o = row2 + i * 4;
        d[o] = g.x;
        d[o + 1] = g.y;
        d[o + 2] = g.w;
        d[o + 3] = g.h;
      });
    }
    d[row3] = idx(ICON_GLYPH_TECH[0]);
    d[row3 + 1] = idx(ICON_GLYPH_TECH[1]);
    d[row3 + 2] = idx(ICON_GLYPH_TECH[2]);
    d[row3 + 3] = idx(ICON_GLYPH_BLIP);
    d[row3 + 4] = idx(ICON_GLYPH_GHOST);
    d[row3 + 5] = idx(ICON_GLYPH_FALLBACK);
    d[row3 + 6] = m === null ? 0 : 1;
    d[row3 + 7] = m === null ? 0 : m.glyphs.length;
    d[row3 + 8] = m?.pxRange ?? 1;
    d[row3 + 9] = m?.alphaRange ?? 1;
    d[row3 + 10] = m?.cellPx ?? 1;
    this.dirty = true;
  }

  /** Uploads after a change (call once per frame before drawing). Returns true if it uploaded. */
  upload(): boolean {
    if (!this.dirty || this.dev.isLost()) return false;
    this.dev.writeTexture(this.texture, { x: 0, y: 0, width: VISUAL_DATA_WIDTH, height: VISUAL_DATA_ROWS }, this.data);
    this.dirty = false;
    return true;
  }

  dispose(): void {
    this.offRestored();
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyTexture(this.texture);
  }
}

/** GLSL accessors (sampler `u_visualData` on {@link UNIT_VISUAL_DATA}). */
export const VISUAL_DATA_GLSL = /* glsl */ `
uniform highp sampler2D u_visualData;
vec4 visualRow(uint visual, int row) { return texelFetch(u_visualData, ivec2(int(visual), row), 0); }
`;
