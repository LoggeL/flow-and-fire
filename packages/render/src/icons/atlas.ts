/**
 * Strategic icon atlas contract (C2): the MSDF atlas written by tools/assets-pipeline
 * (`icons/atlas` raw RGBA8 + `icons/atlas-metrics` JSON, see the pipeline's icons.ts).
 *
 * - RGB: MSDF of the glyph (holes cut out), `pxRange` texels of distance over the 0..1 range;
 * - A: plain SDF of the glyph silhouette (holes filled), `alphaRange` texels over 0..1
 *   (outline and backdrop); encoding `0.5 + d / range`, d > 0 inside.
 * - Glyph rectangles in pixels, rows top-down; the glyph index (position in `glyphs`) is what
 *   `VisualEntry.icon` refers to. Special glyph ids: {@link ICON_GLYPH_FALLBACK} (visuals without
 *   icon), `tech1..3` (tech strokes), `blip`, `ghost`.
 */

export interface IconAtlasGlyph {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface IconAtlasMetrics {
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
  readonly pxRange: number;
  readonly alphaRange: number;
  readonly glyphs: readonly IconAtlasGlyph[];
}

export const ICON_GLYPH_FALLBACK = 'generic';
export const ICON_GLYPH_TECH = ['tech1', 'tech2', 'tech3'] as const;
export const ICON_GLYPH_BLIP = 'blip';
export const ICON_GLYPH_GHOST = 'ghost';
/** Glyphs addressable by the renderer's data texture. */
export const MAX_ICON_GLYPHS = 256;

/** Glyph index of an icon id (−1 if the atlas has no such glyph). */
export function iconGlyphIndex(metrics: IconAtlasMetrics, id: string): number {
  const g = metrics.glyphs;
  for (let i = 0; i < g.length; i++) if (g[i]!.id === id) return i;
  return -1;
}

/** Throws if the metrics do not describe `pixels` (RGBA8, width × height). */
export function validateIconAtlas(pixels: Uint8Array, width: number, height: number, m: IconAtlasMetrics): void {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`icon atlas: invalid size ${width}×${height}`);
  if (m.width !== width || m.height !== height) throw new Error(`icon atlas: metrics say ${m.width}×${m.height}, pixels are ${width}×${height}`);
  if (pixels.length !== width * height * 4) throw new Error(`icon atlas: expected ${width * height * 4} bytes (RGBA8), got ${pixels.length}`);
  if (!(m.pxRange > 0 && m.alphaRange > 0 && m.cellPx > 0)) throw new Error('icon atlas: pxRange, alphaRange and cellPx must be > 0');
  if (m.glyphs.length === 0 || m.glyphs.length > MAX_ICON_GLYPHS) throw new Error(`icon atlas: 1..${MAX_ICON_GLYPHS} glyphs expected, got ${m.glyphs.length}`);
  for (const g of m.glyphs) {
    if (!(g.w > 0 && g.h > 0 && g.x >= 0 && g.y >= 0 && g.x + g.w <= width && g.y + g.h <= height)) {
      throw new Error(`icon atlas: glyph '${g.id}' rectangle outside the atlas`);
    }
  }
}
