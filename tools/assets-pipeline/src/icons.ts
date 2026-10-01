/**
 * Strategic icon atlas (C2, PLAN §3.7 "IconPass … MSDF-Atlas, Tech-Striche, Blip/Ghost").
 *
 * Source: `content/icons/icons.json` (own vector designs, see its `comment`): one entry per icon id of
 * `ICON_IDS` (@faf/blueprints/view) plus the special glyphs {@link SPECIAL_GLYPHS} (`generic` fallback
 * form, tech strokes `tech1..3`, `blip` and `ghost` frames).
 *
 * Output (deterministic, byte-identical on every build):
 * - `icons/atlas.<hash8>.rgba` – raw RGBA8, {@link ATLAS_COLUMNS} glyph cells of {@link CELL_PX}² per row,
 *   rows top-down. RGB = MSDF of the glyph (holes cut out), pxRange {@link PX_RANGE};
 *   A = plain SDF of the glyph SILHOUETTE (holes filled, contained shapes dropped), range
 *   {@link ALPHA_RANGE} (for outlines/backdrop). Encoding `0.5 + d / range` (d in texels, > 0 inside).
 * - `icons/atlas.<hash8>.json` – metrics ({@link IconAtlasMetricsJson}): size, cell, ranges, per glyph
 *   its id, glyph index (used by the renderer's `VisualEntry.icon`), pixel rectangle and UV rectangle.
 *
 * Glyph order (= atlas layout): `ICON_IDS` in registry order, then {@link SPECIAL_GLYPHS}.
 */
import { ICON_IDS } from '@faf/blueprints/view';
import {
  type Contour,
  type Shape,
  circleContour,
  colorEdges,
  encodeDistance,
  flattenShape,
  generateMsdf,
  orientContour,
  polygonContour,
  rectContour,
  roundRectContour,
  trueSignedDistance,
  windingNumber,
  type Vec2,
} from './msdf.ts';

export const CELL_PX = 48;
export const PX_RANGE = 4;
export const ALPHA_RANGE = 12;
export const ATLAS_COLUMNS = 8;
export const ICON_SOURCE_FORMAT = 'faf-icons';
export const ICON_ATLAS_FORMAT = 'faf-icon-atlas';
/** Glyphs besides the class icons (fallback form, tech strokes, blip and ghost frames). */
export const SPECIAL_GLYPHS = ['generic', 'tech1', 'tech2', 'tech3', 'blip', 'ghost'] as const;

/** One shape of an icon source (cell units 0..1, y down). */
export type IconShapeJson =
  | { readonly rect: readonly [number, number, number, number]; readonly hole?: boolean }
  | { readonly roundRect: readonly [number, number, number, number, number]; readonly hole?: boolean }
  | { readonly circle: readonly [number, number, number]; readonly hole?: boolean }
  | { readonly polygon: readonly (readonly number[])[]; readonly hole?: boolean };

export interface IconSourceJson {
  readonly format: typeof ICON_SOURCE_FORMAT;
  readonly version: 1;
  readonly comment?: string;
  readonly glyphs: Readonly<Record<string, readonly IconShapeJson[]>>;
}

export interface IconGlyphRect {
  readonly id: string;
  /** Glyph index (= position in `glyphs`; what the renderer's `VisualEntry.icon` refers to). */
  readonly index: number;
  /** Pixel rectangle in the atlas (rows top-down). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The same rectangle as texture coordinates [u0, v0, u1, v1] (v0 = top row). */
  readonly uv: readonly [number, number, number, number];
}

/** Metrics JSON (structurally the render package's `IconAtlasMetrics`). */
export interface IconAtlasMetricsJson {
  readonly format: typeof ICON_ATLAS_FORMAT;
  readonly version: 1;
  readonly encoding: 'rgba8';
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
  readonly pxRange: number;
  readonly alphaRange: number;
  readonly glyphs: readonly IconGlyphRect[];
}

export interface IconAtlas {
  readonly pixels: Uint8Array;
  readonly metrics: IconAtlasMetricsJson;
  /** Canonical metrics text (sorted keys inside glyph entries, 2-space indent, trailing newline). */
  readonly metricsText: string;
  /** Texels flattened by the MSDF error correction, per glyph id. */
  readonly corrected: Readonly<Record<string, number>>;
}

/** Glyph ids in atlas order. */
export function atlasGlyphOrder(): string[] {
  return [...ICON_IDS, ...SPECIAL_GLYPHS];
}

function fail(path: string, msg: string): never {
  throw new Error(`icons.json ${path}: ${msg}`);
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}

/** Parses and validates the icon source file. Every atlas glyph must be defined, no others. */
export function parseIconSource(input: string | unknown): IconSourceJson {
  const v = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
  if (typeof v !== 'object' || v === null) fail('/', 'expected an object');
  if (v.format !== ICON_SOURCE_FORMAT) fail('/format', `expected '${ICON_SOURCE_FORMAT}'`);
  if (v.version !== 1) fail('/version', 'expected 1');
  const glyphs = v.glyphs as Record<string, unknown> | undefined;
  if (typeof glyphs !== 'object' || glyphs === null) fail('/glyphs', 'expected an object');
  const want = atlasGlyphOrder();
  for (const id of want) if (!(id in glyphs)) fail(`/glyphs/${id}`, 'missing (every ICON_IDS entry and special glyph needs a source)');
  for (const id of Object.keys(glyphs)) if (!want.includes(id)) fail(`/glyphs/${id}`, 'unknown glyph id (not in ICON_IDS or special glyphs)');
  for (const id of want) {
    const shapes = glyphs[id];
    if (!Array.isArray(shapes) || shapes.length === 0) fail(`/glyphs/${id}`, 'expected a non-empty shape list');
    shapes.forEach((s: unknown, i) => {
      const p = `/glyphs/${id}/${i}`;
      if (typeof s !== 'object' || s === null) fail(p, 'expected an object');
      const o = s as Record<string, unknown>;
      const kinds = ['rect', 'roundRect', 'circle', 'polygon'].filter((k) => k in o);
      if (kinds.length !== 1) fail(p, 'expected exactly one of rect, roundRect, circle, polygon');
      for (const k of Object.keys(o)) if (![...kinds, 'hole'].includes(k)) fail(`${p}/${k}`, 'unknown key');
      if (o.hole !== undefined && typeof o.hole !== 'boolean') fail(`${p}/hole`, 'expected a boolean');
      const k = kinds[0]!;
      const arr = o[k];
      if (!Array.isArray(arr)) fail(`${p}/${k}`, 'expected an array');
      if (k === 'polygon') {
        if (arr.length < 3) fail(`${p}/polygon`, 'expected ≥ 3 points');
        arr.forEach((pt: unknown, j) => {
          if (!Array.isArray(pt) || (pt.length !== 2 && pt.length !== 3)) fail(`${p}/polygon/${j}`, 'expected [x, y] or [x, y, bulge]');
          pt.forEach((c, q) => num(c, `${p}/polygon/${j}/${q}`));
          if (pt[0] < 0 || pt[0] > 1 || pt[1] < 0 || pt[1] > 1) fail(`${p}/polygon/${j}`, 'outside the cell (0..1)');
        });
      } else {
        const len = k === 'rect' ? 4 : k === 'roundRect' ? 5 : 3;
        if (arr.length !== len) fail(`${p}/${k}`, `expected ${len} numbers`);
        arr.forEach((c, q) => num(c, `${p}/${k}/${q}`));
      }
    });
  }
  return v as unknown as IconSourceJson;
}

/** One source shape as a contour in texels (y down) plus its hole flag. */
function shapeContour(s: IconShapeJson, cell: number): { contour: Contour; hole: boolean } {
  const hole = s.hole === true;
  let c: Contour;
  if ('rect' in s) {
    const [x0, y0, x1, y1] = s.rect;
    c = rectContour(x0 * cell, y0 * cell, x1 * cell, y1 * cell);
  } else if ('roundRect' in s) {
    const [x0, y0, x1, y1, r] = s.roundRect;
    c = roundRectContour(x0 * cell, y0 * cell, x1 * cell, y1 * cell, r * cell);
  } else if ('circle' in s) {
    const [cx, cy, r] = s.circle;
    c = circleContour(cx * cell, cy * cell, r * cell);
  } else {
    const pts: Vec2[] = s.polygon.map((p) => [p[0]! * cell, p[1]! * cell] as const);
    c = polygonContour(
      pts,
      s.polygon.map((p) => p[2] ?? 0),
    );
  }
  return { contour: orientContour(c, hole), hole };
}

/** Glyph shape (holes cut out) and its silhouette (outer shapes not contained in another outer shape). */
export function glyphShapes(shapes: readonly IconShapeJson[], cell = CELL_PX): { glyph: Shape; silhouette: Shape } {
  const parts = shapes.map((s) => shapeContour(s, cell));
  const glyph: Shape = { contours: parts.map((p) => p.contour) };
  const outers = parts.filter((p) => !p.hole).map((p) => p.contour);
  const kept: Contour[] = [];
  outers.forEach((c, i) => {
    const first = c.edges[0]!.p0;
    const others = outers.filter((_, j) => j !== i);
    const polys = flattenShape({ contours: others });
    if (windingNumber(polys, first[0], first[1]) === 0) kept.push(c);
  });
  // The silhouette never gets MSDF-colored; copy the contours so coloring the glyph cannot leak.
  const silhouette: Shape = { contours: kept.map((c) => ({ edges: c.edges.map((e) => ({ ...e })) })) };
  return { glyph: colorEdges(glyph), silhouette };
}

/** RGBA8 texels (cell × cell, rows top-down) of one glyph. */
export function renderGlyph(shapes: readonly IconShapeJson[], cell = CELL_PX): { rgba: Uint8Array; corrected: number } {
  const { glyph, silhouette } = glyphShapes(shapes, cell);
  const msdf = generateMsdf(glyph, { size: cell, pxRange: PX_RANGE });
  const silPolys = flattenShape(silhouette);
  const rgba = new Uint8Array(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const i = y * cell + x;
      rgba[i * 4] = encodeDistance(msdf.channels[i * 3]!, PX_RANGE);
      rgba[i * 4 + 1] = encodeDistance(msdf.channels[i * 3 + 1]!, PX_RANGE);
      rgba[i * 4 + 2] = encodeDistance(msdf.channels[i * 3 + 2]!, PX_RANGE);
      rgba[i * 4 + 3] = encodeDistance(trueSignedDistance(silhouette, silPolys, x + 0.5, y + 0.5), ALPHA_RANGE);
    }
  }
  return { rgba, corrected: msdf.corrected };
}

/** Atlas grid layout: glyph k at column k % ATLAS_COLUMNS, row ⌊k / ATLAS_COLUMNS⌋. */
export function atlasLayout(ids: readonly string[], cell = CELL_PX): { width: number; height: number; glyphs: IconGlyphRect[] } {
  const rows = Math.max(1, Math.ceil(ids.length / ATLAS_COLUMNS));
  const width = ATLAS_COLUMNS * cell;
  const height = rows * cell;
  const glyphs = ids.map((id, k): IconGlyphRect => {
    const x = (k % ATLAS_COLUMNS) * cell;
    const y = Math.floor(k / ATLAS_COLUMNS) * cell;
    return { id, index: k, x, y, w: cell, h: cell, uv: [x / width, y / height, (x + cell) / width, (y + cell) / height] };
  });
  return { width, height, glyphs };
}

/** Canonical metrics text: fixed key order, 2-space indent, one glyph per line, trailing newline. */
export function serializeIconMetrics(m: IconAtlasMetricsJson): string {
  const head = [
    `  "format": ${JSON.stringify(m.format)}`,
    `  "version": ${m.version}`,
    `  "encoding": ${JSON.stringify(m.encoding)}`,
    `  "width": ${m.width}`,
    `  "height": ${m.height}`,
    `  "cellPx": ${m.cellPx}`,
    `  "pxRange": ${m.pxRange}`,
    `  "alphaRange": ${m.alphaRange}`,
  ];
  const glyphs = m.glyphs.map(
    (g) =>
      `    { "id": ${JSON.stringify(g.id)}, "index": ${g.index}, "x": ${g.x}, "y": ${g.y}, "w": ${g.w}, "h": ${g.h}, "uv": [${g.uv.join(', ')}] }`,
  );
  return `{\n${head.join(',\n')},\n  "glyphs": [\n${glyphs.join(',\n')}\n  ]\n}\n`;
}

/** Builds the whole atlas from the parsed source. */
export function buildIconAtlas(source: IconSourceJson): IconAtlas {
  const ids = atlasGlyphOrder();
  const layout = atlasLayout(ids);
  const pixels = new Uint8Array(layout.width * layout.height * 4);
  const corrected: Record<string, number> = {};
  for (const g of layout.glyphs) {
    const { rgba, corrected: n } = renderGlyph(source.glyphs[g.id]!);
    corrected[g.id] = n;
    for (let y = 0; y < CELL_PX; y++) {
      pixels.set(rgba.subarray(y * CELL_PX * 4, (y + 1) * CELL_PX * 4), ((g.y + y) * layout.width + g.x) * 4);
    }
  }
  const metrics: IconAtlasMetricsJson = {
    format: ICON_ATLAS_FORMAT,
    version: 1,
    encoding: 'rgba8',
    width: layout.width,
    height: layout.height,
    cellPx: CELL_PX,
    pxRange: PX_RANGE,
    alphaRange: ALPHA_RANGE,
    glyphs: layout.glyphs,
  };
  return { pixels, metrics, metricsText: serializeIconMetrics(metrics), corrected };
}
