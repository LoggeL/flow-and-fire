// MS3 (C2): own MSDF generator + strategic icon atlas – reconstruction quality, sharp corners, edge
// coloring, deterministic atlas layout and manifest entries.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_IDS } from '@faf/blueprints/view';
import { describe, expect, it } from 'vitest';
import {
  ALPHA_RANGE,
  ATLAS_COLUMNS,
  BLUE,
  CELL_PX,
  GREEN,
  PX_RANGE,
  RED,
  REPO_ROOT,
  SPECIAL_GLYPHS,
  WHITE,
  atlasGlyphOrder,
  buildAssets,
  buildIconAtlas,
  circleContour,
  colorEdges,
  encodeDistance,
  flattenShape,
  generateMsdf,
  generateSdf,
  glyphShapes,
  median3,
  orientContour,
  parseIconSource,
  rectContour,
  renderGlyph,
  windingNumber,
  type IconShapeJson,
  type Shape,
} from '../src/index.ts';

const source = parseIconSource(readFileSync(join(REPO_ROOT, 'content', 'icons', 'icons.json'), 'utf8'));

/** Bilinear sample (clamp to edge) of channel c of an n × n RGBA8 cell at texel coordinates (u, v). */
function sample(rgba: Uint8Array, n: number, u: number, v: number, c: number): number {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number): number => rgba[(Math.min(n - 1, Math.max(0, yy)) * n + Math.min(n - 1, Math.max(0, xx))) * 4 + c]!;
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

function insideMedian(rgba: Uint8Array, n: number, u: number, v: number): boolean {
  return median3(sample(rgba, n, u, v, 0), sample(rgba, n, u, v, 1), sample(rgba, n, u, v, 2)) > 127.5;
}

describe('MSDF generator', () => {
  it('median reconstruction matches the rasterized shape in ≥ 99 % of the pixels (every glyph, 4× supersampled)', () => {
    const S = 4;
    for (const id of atlasGlyphOrder()) {
      const shapes = source.glyphs[id]!;
      const { rgba } = renderGlyph(shapes);
      const { glyph } = glyphShapes(shapes);
      const polys = flattenShape(glyph);
      let match = 0;
      let total = 0;
      for (let y = 0; y < CELL_PX * S; y++) {
        for (let x = 0; x < CELL_PX * S; x++) {
          const u = (x + 0.5) / S;
          const v = (y + 0.5) / S;
          const want = windingNumber(polys, u, v) !== 0;
          if (insideMedian(rgba, CELL_PX, u, v) === want) match++;
          total++;
        }
      }
      expect(match / total, id).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('keeps the corners of a square sharp (a plain SDF rounds them)', () => {
    const n = 32;
    const square: Shape = colorEdges({ contours: [orientContour(rectContour(8, 8, 24, 24), false)] });
    const msdf = generateMsdf(square, { size: n, pxRange: PX_RANGE });
    const sdf = generateSdf(square, { size: n });
    const enc = (field: (i: number, c: number) => number): Uint8Array => {
      const out = new Uint8Array(n * n * 4);
      for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = encodeDistance(field(i, c), PX_RANGE);
      return out;
    };
    const m = enc((i, c) => msdf.channels[i * 3 + c]!);
    const s = enc((i) => sdf[i]!);
    // Points on the corner diagonals, 0.2 texel inside and outside each corner.
    const corners: [number, number, number, number][] = [
      [8, 8, 1, 1],
      [24, 8, -1, 1],
      [24, 24, -1, -1],
      [8, 24, 1, -1],
    ];
    let sdfWrong = 0;
    for (const [cx, cy, dx, dy] of corners) {
      for (const d of [0.15, 0.2, 0.3]) {
        expect(insideMedian(m, n, cx + dx * d, cy + dy * d)).toBe(true);
        expect(insideMedian(m, n, cx - dx * d, cy - dy * d)).toBe(false);
        if (!insideMedian(s, n, cx + dx * d, cy + dy * d)) sdfWrong++;
      }
    }
    expect(sdfWrong).toBeGreaterThan(0);
    expect(msdf.corrected).toBe(0);
  });

  it('colors edges: corner edges share exactly one channel, smooth contours stay single-colored', () => {
    const sq = colorEdges({ contours: [orientContour(rectContour(0, 0, 10, 10), false)] });
    const colors = sq.contours[0]!.edges.map((e) => e.color);
    for (let i = 0; i < colors.length; i++) {
      const a = colors[i]!;
      const b = colors[(i + 1) % colors.length]!;
      const shared = a & b;
      expect([RED, GREEN, BLUE]).toContain(shared);
      expect(a).not.toBe(WHITE);
    }
    const circle = colorEdges({ contours: [orientContour(circleContour(5, 5, 3), false)] });
    const cc = circle.contours[0]!.edges.map((e) => e.color);
    expect(new Set(cc).size).toBe(1);
  });

  it('orients holes against outer contours (winding 0 inside a hole)', () => {
    const { glyph } = glyphShapes(source.glyphs['structure_generic']!);
    const polys = flattenShape(glyph);
    expect(windingNumber(polys, 24, 24)).toBe(0); // square hole in the center
    expect(windingNumber(polys, 10, 24)).not.toBe(0); // frame
    expect(windingNumber(polys, 2, 2)).toBe(0);
  });
});

describe('icon atlas', () => {
  it('covers every ICON_IDS entry plus the special glyphs in a stable grid layout', () => {
    const a = buildIconAtlas(source);
    const ids = a.metrics.glyphs.map((g) => g.id);
    expect(ids).toEqual([...ICON_IDS, ...SPECIAL_GLYPHS]);
    expect(a.metrics.width).toBe(ATLAS_COLUMNS * CELL_PX);
    expect(a.metrics.height).toBe(Math.ceil(ids.length / ATLAS_COLUMNS) * CELL_PX);
    expect(a.metrics.cellPx).toBe(48);
    expect(a.metrics.pxRange).toBe(4);
    expect(a.metrics.alphaRange).toBe(ALPHA_RANGE);
    a.metrics.glyphs.forEach((g, k) => {
      expect(g.index).toBe(k);
      expect([g.x, g.y, g.w, g.h]).toEqual([(k % ATLAS_COLUMNS) * 48, Math.floor(k / ATLAS_COLUMNS) * 48, 48, 48]);
      expect(g.uv).toEqual([g.x / a.metrics.width, g.y / a.metrics.height, (g.x + 48) / a.metrics.width, (g.y + 48) / a.metrics.height]);
    });
    expect(a.pixels.length).toBe(a.metrics.width * a.metrics.height * 4);
    expect(JSON.parse(a.metricsText)).toEqual(a.metrics);
    // Deterministic: a second build is byte-identical.
    const b = buildIconAtlas(source);
    expect(Buffer.from(b.pixels).equals(Buffer.from(a.pixels))).toBe(true);
    expect(b.metricsText).toBe(a.metricsText);
  });

  it('alpha is the silhouette SDF: holes filled, the blip center dot is not an inner edge', () => {
    const a = buildIconAtlas(source);
    const g = a.metrics.glyphs.find((x) => x.id === 'blip')!;
    const at = (x: number, y: number, c: number): number => a.pixels[((g.y + y) * a.metrics.width + g.x + x) * 4 + c]!;
    // Inside the ring's hole: RGB outside, alpha inside (silhouette).
    const hx = 24 + Math.round(0.16 * 48);
    expect(median3(at(hx, 24, 0), at(hx, 24, 1), at(hx, 24, 2))).toBeLessThan(128);
    expect(at(hx, 24, 3)).toBeGreaterThan(128);
    // No silhouette edge at the dot's rim (radius 0.09 cell ≈ 4.3 texels): deep inside there.
    expect(at(24 + 4, 24, 3)).toBe(255);
    expect(at(24, 24 - 4, 3)).toBe(255);
  });

  it('rejects incomplete or unknown icon sources', () => {
    const glyphs: Record<string, readonly IconShapeJson[]> = { ...source.glyphs };
    delete glyphs['land_scout'];
    expect(() => parseIconSource({ ...source, glyphs })).toThrow(/land_scout.*missing/);
    expect(() => parseIconSource({ ...source, glyphs: { ...source.glyphs, bogus: [{ circle: [0.5, 0.5, 0.2] }] } })).toThrow(/bogus.*unknown/);
    expect(() => parseIconSource({ ...source, glyphs: { ...source.glyphs, cube: [{ circle: [0.5, 0.5], hole: false }] } })).toThrow(/expected 3 numbers/);
  });

  it('is part of the asset build: raw RGBA + metrics JSON with sha256 in the manifest', async () => {
    const build = await buildAssets();
    const atlas = build.manifest.assets['icons/atlas']!;
    const metrics = build.manifest.assets['icons/atlas-metrics']!;
    expect(atlas.kind).toBe('iconatlas');
    expect(metrics.kind).toBe('iconmetrics');
    expect(atlas.url).toMatch(/^icons\/atlas\.[0-9a-f]{8}\.rgba$/);
    expect(metrics.url).toMatch(/^icons\/atlas\.[0-9a-f]{8}\.json$/);
    const a = buildIconAtlas(source);
    expect(atlas.bytes).toBe(a.pixels.length);
    const mf = build.files.find((f) => f.path === metrics.url)!;
    expect(new TextDecoder().decode(mf.bytes)).toBe(a.metricsText);
  });
});
