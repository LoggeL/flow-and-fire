/**
 * three.js marker overlay of the editor (TRACK-EDITOR P4): starts, mass/hydro spots, prop fields
 * (draped fill + outline), expanded and explicit props, selection/hover, field handles, issues,
 * symmetry guide and the field being drawn.
 *
 * update() compares the arrays of ViewMarkers by identity and rebuilds only the parts whose input
 * changed (or everything draped when the map itself changed). Screen markers keep a minimum size
 * in pixels (per-frame scaling in onBeforeRender), so they stay readable in a whole-map view.
 */
import { MAP_MAX_PROPS, type MapPropField, type PropFieldKind } from '@faf/formats';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import {
  circleOutlineWu,
  drapeEdgeWu,
  drapePolyline,
  drapeTriangles,
  fieldOutlineWu,
  outlineCenterWu,
  pointsToWu,
  polygonAreaWu,
  subdivideTriangles,
  symmetryGuideWu,
  triangulateOutline,
} from './geometry.ts';
import { badgeTexture, issueTexture } from './labels.ts';
import { armyHex, COLORS, FIELD_COLORS, FIELD_FILL_OPACITY, FX, minPixelScale, SIZES, wuPerPixel } from './style.ts';
import { fieldSelected, refIn, sameRef, type EditorIssue, type MarkerRef, type OverlayLayer, type OverlayView, type ViewMarkers } from './types.ts';

/** Render order of the overlay (view: terrain 0, grid 1, water 2, overlay >= 10). */
const ORDER = { fill: 10, outline: 11, props: 12, guide: 13, spots: 14, starts: 15, highlight: 16, handles: 17, draft: 18, issues: 19 } as const;

/** Triangle budget of all field fills together (split evenly over the fields, >= 2000 each). */
const FILL_TRIANGLE_BUDGET = 240_000;

/** Parts of the overlay that update() rebuilds independently. */
export type OverlayPart = 'starts' | 'spots' | 'fields' | 'expanded' | 'props' | 'issues' | 'symmetry' | 'draft' | 'highlight';

export interface OverlayStats {
  readonly starts: number;
  readonly spots: number;
  readonly fields: number;
  readonly fillTriangles: number;
  readonly expandedPoints: number;
  readonly explicitPoints: number;
  readonly issues: number;
  readonly handles: number;
  readonly highlights: number;
}

/** A screen marker scaled per frame: obj.scale = baseScale · max(1, minPx · wuPerPx / radiusWu). */
interface ScaledMarker {
  readonly obj: THREE.Object3D;
  readonly radiusWu: number;
  readonly minPx: number;
  readonly baseScale: number;
}

/** A dashed line whose dash length is kept in pixels. */
interface DashedLine {
  readonly mat: LineMaterial;
  readonly center: THREE.Vector3;
  readonly dashPx: number;
  readonly gapPx: number;
}

/** Everything a part created (disposed on rebuild). */
interface PartContent {
  readonly group: THREE.Group;
  readonly scaled: ScaledMarker[];
  readonly dashed: DashedLine[];
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

const POINT_VERTEX = /* glsl */ `
attribute vec3 pcolor;
uniform float uScale;
uniform float uSizeWu;
uniform float uMinPx;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uMinPx, uSizeWu * uScale / max(0.001, -mv.z));
  vColor = pcolor;
}
`;

const POINT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  gl_FragColor = vec4(r > 0.5 ? vColor * 0.35 : vColor, 1.0);
  #include <colorspace_fragment>
}
`;

function linear(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.rotateX(-Math.PI / 2);
}

function emptyPart(name: string): PartContent {
  const group = new THREE.Group();
  group.name = name;
  return { group, scaled: [], dashed: [], geometries: [], materials: [] };
}

export class MarkerOverlay {
  /** Root of all overlay objects (added to view.scene). */
  readonly root = new THREE.Group();
  private readonly view: OverlayView;
  private readonly layers: Record<OverlayLayer, THREE.Group>;
  private readonly guides = new THREE.Group();
  private readonly parts: Record<OverlayPart, PartContent>;
  private readonly builds: Record<OverlayPart, number> = {
    starts: 0,
    spots: 0,
    fields: 0,
    expanded: 0,
    props: 0,
    issues: 0,
    symmetry: 0,
    draft: 0,
    highlight: 0,
  };
  /** Shared unit geometries (flat in x/z, radius 1) and cached materials. */
  private readonly shared: {
    readonly ring: THREE.BufferGeometry;
    readonly thickRing: THREE.BufferGeometry;
    readonly disc: THREE.BufferGeometry;
    readonly border: THREE.BufferGeometry;
    readonly diamond: THREE.BufferGeometry;
    readonly diamondBorder: THREE.BufferGeometry;
    readonly hiRing: THREE.BufferGeometry;
    readonly pillar: THREE.BufferGeometry;
  };
  private readonly meshMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly spriteTextures = new Map<string, THREE.Texture | null>();
  private readonly lineMaterials: LineMaterial[] = [];
  private readonly pointMaterials: THREE.ShaderMaterial[] = [];
  private prev: ViewMarkers | null = null;
  private lastMap: unknown = undefined;
  /** Draped outline per field (segment pairs), reused by the selection highlight. */
  private fieldOutlines: Float32Array[] = [];
  private fillTriangles = 0;
  private readonly offBeforeRender: () => void;
  private readonly tmp = new THREE.Vector3();
  private disposed = false;

  constructor(view: OverlayView) {
    this.view = view;
    this.root.name = 'marker-overlay';
    const layer = (name: OverlayLayer): THREE.Group => {
      const g = new THREE.Group();
      g.name = `overlay-${name}`;
      this.root.add(g);
      return g;
    };
    this.layers = { fields: layer('fields'), props: layer('props'), spots: layer('spots'), starts: layer('starts'), issues: layer('issues') };
    this.guides.name = 'overlay-guides';
    this.root.add(this.guides);
    this.parts = {
      starts: emptyPart('starts'),
      spots: emptyPart('spots'),
      fields: emptyPart('fields'),
      expanded: emptyPart('expanded-props'),
      props: emptyPart('explicit-props'),
      issues: emptyPart('issues'),
      symmetry: emptyPart('symmetry'),
      draft: emptyPart('draft'),
      highlight: emptyPart('highlight'),
    };
    this.shared = {
      ring: flat(new THREE.RingGeometry(0.78, 1, 48)),
      thickRing: flat(new THREE.RingGeometry(0.58, 1, 48)),
      disc: flat(new THREE.CircleGeometry(1, 32)),
      border: flat(new THREE.RingGeometry(1, 1.14, 48)),
      diamond: flat(new THREE.RingGeometry(0.62, 1, 4)),
      diamondBorder: flat(new THREE.RingGeometry(1, 1.18, 4)),
      hiRing: flat(new THREE.RingGeometry(0.86, 1, 48)),
      pillar: new THREE.CylinderGeometry(0.09, 0.09, 1, 10).translate(0, 0.5, 0),
    };
    this.offBeforeRender = view.onBeforeRender(() => this.beforeRender());
    view.scene.add(this.root);
  }

  /** Shows the markers `m`; only parts whose inputs changed (array identity) are rebuilt. */
  update(m: ViewMarkers): void {
    if (this.disposed) return;
    const p = this.prev;
    const map = this.view.map;
    const all = p === null || map !== this.lastMap || p.sizeWu !== m.sizeWu;
    const ch = (k: keyof ViewMarkers): boolean => all || p === null || p[k] !== m[k];
    let any = false;
    const run = (part: OverlayPart, cond: boolean, build: (c: PartContent) => void, layer: THREE.Group): void => {
      if (!cond) return;
      any = true;
      const c = this.reset(part, layer);
      build(c);
      this.builds[part]++;
    };
    const L = this.layers;
    run('starts', ch('starts'), (c) => this.buildStarts(c, m), L.starts);
    run('spots', ch('spots'), (c) => this.buildSpots(c, m), L.spots);
    run('fields', ch('fields'), (c) => this.buildFields(c, m), L.fields);
    run('expanded', ch('expanded') || ch('fields'), (c) => this.buildExpanded(c, m), L.props);
    run('props', ch('props'), (c) => this.buildExplicitProps(c, m), L.props);
    run('issues', ch('issues') || ch('starts') || ch('spots') || ch('fields'), (c) => this.buildIssues(c, m), L.issues);
    run('symmetry', ch('symmetry'), (c) => this.buildSymmetry(c, m), this.guides);
    run('draft', ch('draft'), (c) => this.buildDraft(c, m), L.fields);
    run(
      'highlight',
      ch('selection') || ch('hover') || ch('starts') || ch('spots') || ch('fields'),
      (c) => this.buildHighlight(c, m),
      this.guides,
    );
    this.prev = m;
    this.lastMap = map;
    if (any) this.view.requestRender();
  }

  setVisible(layer: OverlayLayer, v: boolean): void {
    this.layers[layer].visible = v;
    // Selection highlight and handles follow the starts/spots/fields layers they belong to.
    this.parts.highlight.group.traverse((o) => {
      const l = o.userData['layer'] as OverlayLayer | undefined;
      if (l !== undefined) o.visible = this.layers[l].visible;
    });
    this.view.requestRender();
  }

  isVisible(layer: OverlayLayer): boolean {
    return this.layers[layer].visible;
  }

  /** How often each part was rebuilt (tests: unchanged arrays rebuild nothing). */
  buildCounts(): Readonly<Record<OverlayPart, number>> {
    return { ...this.builds };
  }

  stats(): OverlayStats {
    const pts = (part: PartContent): number => {
      let n = 0;
      part.group.traverse((o) => {
        if (o instanceof THREE.Points) n += o.geometry.drawRange.count === Infinity ? o.geometry.getAttribute('position').count : o.geometry.drawRange.count;
      });
      return n;
    };
    const hl = this.parts.highlight.group.children;
    return {
      starts: this.parts.starts.group.children.length,
      spots: this.parts.spots.group.children.length,
      fields: this.fieldOutlines.length,
      fillTriangles: this.fillTriangles,
      expandedPoints: pts(this.parts.expanded),
      explicitPoints: pts(this.parts.props),
      issues: this.parts.issues.group.children.length,
      handles: hl.filter((o) => o.userData['handle'] === true).length,
      highlights: hl.filter((o) => o.userData['handle'] !== true).length,
    };
  }

  /** The object group of a part (tests, debugging). */
  partGroup(part: OverlayPart): THREE.Group {
    return this.parts[part].group;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offBeforeRender();
    for (const k of Object.keys(this.parts) as OverlayPart[]) this.release(this.parts[k]);
    this.view.scene.remove(this.root);
    for (const g of Object.values(this.shared)) g.dispose();
    for (const m of this.meshMaterials.values()) m.dispose();
    this.meshMaterials.clear();
    for (const t of this.spriteTextures.values()) t?.dispose();
    this.spriteTextures.clear();
    this.view.requestRender();
  }

  // ---------------------------------------------------------------------------------------------
  // Parts

  private buildStarts(c: PartContent, m: ViewMarkers): void {
    const r = SIZES.start.radiusWu;
    for (let i = 0; i < m.starts.length; i++) {
      const s = m.starts[i]!;
      const color = armyHex(s.army);
      const g = this.markerGroup(c, s.x, s.z, ORDER.starts, `start-${i}`);
      g.userData['ref'] = { type: 'start', index: i } satisfies MarkerRef;
      g.add(this.mesh(this.shared.disc, this.meshMat(color, 0.28), ORDER.starts, 0.05));
      g.add(this.mesh(this.shared.ring, this.meshMat(color, 0.95), ORDER.starts, 0.1));
      g.add(this.mesh(this.shared.border, this.meshMat(COLORS.handleBorder, 0.85), ORDER.starts, 0.1));
      const pillar = this.mesh(this.shared.pillar, this.meshMat(color, 1), ORDER.starts, 0);
      pillar.scale.set(1, SIZES.startPillarWu / r, 1);
      g.add(pillar);
      const label = this.sprite(`army-${s.army}`, () => badgeTexture(String(s.army + 1), color), color, ORDER.starts + 0.5);
      label.center.set(0.5, 0);
      label.scale.setScalar(1.25);
      label.position.y = SIZES.startPillarWu / r;
      g.add(label);
      c.scaled.push({ obj: g, radiusWu: r, minPx: SIZES.start.minPx, baseScale: r });
    }
  }

  private buildSpots(c: PartContent, m: ViewMarkers): void {
    for (let i = 0; i < m.spots.length; i++) {
      const s = m.spots[i]!;
      const hydro = s.kind === 'hydro';
      const size = hydro ? SIZES.hydro : SIZES.mass;
      const g = this.markerGroup(c, s.x, s.z, ORDER.spots, `spot-${i}`);
      g.userData['ref'] = { type: 'spot', index: i } satisfies MarkerRef;
      if (hydro) {
        g.add(this.mesh(this.shared.diamond, this.meshMat(COLORS.hydro, 0.95), ORDER.spots, 0.1));
        g.add(this.mesh(this.shared.diamondBorder, this.meshMat(COLORS.handleBorder, 0.8), ORDER.spots, 0.1));
      } else {
        g.add(this.mesh(this.shared.thickRing, this.meshMat(COLORS.mass, 0.95), ORDER.spots, 0.1));
        g.add(this.mesh(this.shared.border, this.meshMat(COLORS.handleBorder, 0.8), ORDER.spots, 0.1));
      }
      c.scaled.push({ obj: g, radiusWu: size.radiusWu, minPx: size.minPx, baseScale: size.radiusWu });
    }
  }

  private buildFields(c: PartContent, m: ViewMarkers): void {
    const h = this.heightAt;
    const fields = m.fields;
    this.fieldOutlines = [];
    this.fillTriangles = 0;
    if (fields.length === 0) return;
    const budget = Math.max(2000, Math.floor(FILL_TRIANGLE_BUDGET / fields.length));
    const fillParts: Float32Array[] = [];
    const fillColors: [THREE.Color, number][] = [];
    const lineParts: Float32Array[] = [];
    const lineColors: THREE.Color[] = [];
    for (const f of fields) {
      const outline = fieldOutlineWu(f.shape);
      const tris = triangulateOutline(outline);
      const xz = subdivideTriangles(outline, tris, drapeEdgeWu(polygonAreaWu(outline), budget));
      fillParts.push(drapeTriangles(xz, h, SIZES.fillLiftWu));
      fillColors.push([linear(FIELD_COLORS[f.kind].fill), FIELD_FILL_OPACITY]);
      const line = drapePolyline(outline, true, 1, h, SIZES.lineLiftWu);
      this.fieldOutlines.push(line);
      lineParts.push(line);
      lineColors.push(linear(FIELD_COLORS[f.kind].prop));
    }
    let verts = 0;
    for (const p of fillParts) verts += p.length / 3;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 4);
    let v = 0;
    for (let k = 0; k < fillParts.length; k++) {
      const p = fillParts[k]!;
      pos.set(p, v * 3);
      const [cc, a] = fillColors[k]!;
      for (let i = 0; i < p.length / 3; i++) {
        col[(v + i) * 4] = cc.r;
        col[(v + i) * 4 + 1] = cc.g;
        col[(v + i) * 4 + 2] = cc.b;
        col[(v + i) * 4 + 3] = a;
      }
      v += p.length / 3;
    }
    this.fillTriangles = verts / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const fill = new THREE.Mesh(geo, mat);
    fill.name = 'field-fill';
    fill.renderOrder = ORDER.fill;
    c.geometries.push(geo);
    c.materials.push(mat);
    c.group.add(fill);
    const outline = this.lines(c, lineParts, lineColors, SIZES.lineWidthPx, 1, ORDER.outline, false);
    if (outline !== null) outline.name = 'field-outline';
  }

  private buildExpanded(c: PartContent, m: ViewMarkers): void {
    const n = Math.min(m.expanded.length, MAP_MAX_PROPS);
    if (n === 0) return;
    const colors: Record<PropFieldKind, THREE.Color> = {
      tree: linear(FIELD_COLORS.tree.prop),
      rock: linear(FIELD_COLORS.rock.prop),
      wreck: linear(FIELD_COLORS.wreck.prop),
    };
    const grey = linear(COLORS.explicitProp);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = m.expanded[i]!;
      const x = p.x / FX;
      const z = p.z / FX;
      pos[i * 3] = x;
      pos[i * 3 + 1] = this.heightAt(x, z) + SIZES.propLiftWu;
      pos[i * 3 + 2] = z;
      const f: MapPropField | undefined = m.fields[p.field];
      const cc = f === undefined ? grey : colors[f.kind];
      col[i * 3] = cc.r;
      col[i * 3 + 1] = cc.g;
      col[i * 3 + 2] = cc.b;
    }
    const pts = this.points(c, pos, col, SIZES.propWu, SIZES.propMinPx);
    pts.name = 'expanded-props';
  }

  private buildExplicitProps(c: PartContent, m: ViewMarkers): void {
    const n = Math.min(m.props.length, MAP_MAX_PROPS);
    if (n === 0) return;
    const grey = linear(COLORS.explicitProp);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = m.props[i]!;
      const x = p.x / FX;
      const z = p.z / FX;
      pos[i * 3] = x;
      pos[i * 3 + 1] = this.heightAt(x, z) + SIZES.propLiftWu;
      pos[i * 3 + 2] = z;
      col[i * 3] = grey.r;
      col[i * 3 + 1] = grey.g;
      col[i * 3 + 2] = grey.b;
    }
    const pts = this.points(c, pos, col, SIZES.explicitPropWu, SIZES.explicitPropMinPx);
    pts.name = 'explicit-props';
  }

  private buildIssues(c: PartContent, m: ViewMarkers): void {
    const r = SIZES.issue.radiusWu;
    for (let i = 0; i < m.issues.length; i++) {
      const issue = m.issues[i]!;
      const at = issuePosition(issue, m);
      if (at === null) continue;
      const color = COLORS.issue[issue.severity];
      const g = this.markerGroup(c, at.x, at.z, ORDER.issues, `issue-${i}`);
      g.userData['issue'] = i;
      g.add(this.mesh(this.shared.hiRing, this.meshMat(color, 0.95), ORDER.issues, 0.15));
      const badge = this.sprite(`issue-${issue.severity}`, () => issueTexture(issue.severity, color), color, ORDER.issues + 0.5);
      badge.center.set(0.5, 0);
      badge.scale.setScalar(1.6);
      badge.position.y = 0.4;
      g.add(badge);
      c.scaled.push({ obj: g, radiusWu: r, minPx: SIZES.issue.minPx, baseScale: r });
    }
  }

  private buildSymmetry(c: PartContent, m: ViewMarkers): void {
    const segs = symmetryGuideWu(m.symmetry, m.sizeWu);
    if (segs.length === 0) return;
    const color = linear(COLORS.symmetry);
    const parts = segs.map((s) => drapePolyline(s, false, 2, this.heightAt, SIZES.lineLiftWu * 2));
    const line = this.lines(c, parts, parts.map(() => color), SIZES.lineWidthPx, 0.9, ORDER.guide, true);
    if (line !== null) line.name = `symmetry-${m.symmetry}`;
    if (m.symmetry === 'point') {
      const half = (m.sizeWu * FX) / 2;
      const g = this.markerGroup(c, half, half, ORDER.guide, 'symmetry-center');
      g.add(this.mesh(this.shared.hiRing, this.meshMat(COLORS.symmetry, 0.95), ORDER.guide, 0.2));
      c.scaled.push({ obj: g, radiusWu: 2, minPx: 8, baseScale: 2 });
    }
  }

  private buildDraft(c: PartContent, m: ViewMarkers): void {
    const d = m.draft;
    if (d === null || d.points.length === 0) return;
    const color = linear(COLORS.draft);
    let outline: number[] | null = null;
    let closed = false;
    if (d.kind === 'circle') {
      const p0 = d.points[0]!;
      const p1 = d.points[1];
      if (p1 !== undefined) {
        const r = Math.hypot(p1.x - p0.x, p1.z - p0.z) / FX;
        if (r > 0) {
          outline = circleOutlineWu(p0.x / FX, p0.z / FX, r);
          closed = true;
        }
      }
    } else if (d.points.length >= 2) {
      outline = pointsToWu(d.points);
      closed = d.points.length >= 3;
    }
    if (outline !== null) {
      const part = drapePolyline(outline, closed, 1, this.heightAt, SIZES.lineLiftWu * 1.5);
      const line = this.lines(c, [part], [color], SIZES.lineWidthPx, 1, ORDER.draft, true);
      if (line !== null) line.name = 'draft-outline';
    }
    const pts = d.kind === 'circle' ? d.points.slice(0, 2) : d.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      this.handle(c, p.x, p.z, COLORS.draft, `draft-${i}`);
    }
  }

  private buildHighlight(c: PartContent, m: ViewMarkers): void {
    const marks: { ref: MarkerRef; color: number }[] = [];
    if (m.hover !== null) marks.push({ ref: m.hover, color: COLORS.hover });
    for (const r of m.selection) marks.push({ ref: r, color: COLORS.selection });
    // Rings around selected/hovered starts and spots (selection drawn last = on top).
    for (const { ref, color } of marks) {
      if (ref.type === 'start' || ref.type === 'spot') {
        const s = ref.type === 'start' ? m.starts[ref.index] : m.spots[ref.index];
        if (s === undefined) continue;
        const size = ref.type === 'start' ? SIZES.start : m.spots[ref.index]?.kind === 'hydro' ? SIZES.hydro : SIZES.mass;
        const r = size.radiusWu * SIZES.highlightFactor;
        const g = this.markerGroup(c, s.x, s.z, ORDER.highlight, `highlight-${ref.type}-${ref.index}`);
        g.userData['layer'] = ref.type === 'start' ? 'starts' : 'spots';
        g.visible = this.layers[ref.type === 'start' ? 'starts' : 'spots'].visible;
        g.add(this.mesh(this.shared.hiRing, this.meshMat(color, 1), ORDER.highlight, 0.12));
        c.scaled.push({ obj: g, radiusWu: r, minPx: size.minPx * SIZES.highlightFactor, baseScale: r });
      }
    }
    // Field outlines of selected/hovered fields.
    const fieldLines: Float32Array[] = [];
    const fieldColors: THREE.Color[] = [];
    const seen: number[] = [];
    for (let k = marks.length - 1; k >= 0; k--) {
      const { ref, color } = marks[k]!;
      if (ref.type === 'start' || ref.type === 'spot') continue;
      if (seen.includes(ref.index)) continue;
      const line = this.fieldOutlines[ref.index];
      if (line === undefined || line.length === 0) continue;
      seen.push(ref.index);
      fieldLines.push(line);
      fieldColors.push(linear(color));
    }
    const hl = this.lines(c, fieldLines, fieldColors, SIZES.selectedLineWidthPx, 1, ORDER.highlight, false);
    if (hl !== null) {
      hl.name = 'field-highlight';
      hl.userData['layer'] = 'fields';
      hl.visible = this.layers.fields.visible;
    }
    // Vertex and radius handles of selected fields.
    for (let i = 0; i < m.fields.length; i++) {
      if (!fieldSelected(m.selection, i)) continue;
      const shape = m.fields[i]!.shape;
      if (shape.kind === 'polygon') {
        for (let v = 0; v < shape.points.length; v++) {
          const p = shape.points[v]!;
          const ref: MarkerRef = { type: 'fieldVertex', index: i, vertex: v };
          const color = sameRef(m.hover, ref) ? COLORS.hover : refIn(m.selection, ref) ? COLORS.selection : COLORS.handle;
          this.handle(c, p.x, p.z, color, `handle-${i}-${v}`).userData['ref'] = ref;
        }
      } else {
        const ref: MarkerRef = { type: 'fieldRadius', index: i };
        const color = sameRef(m.hover, ref) ? COLORS.hover : refIn(m.selection, ref) ? COLORS.selection : COLORS.handleRadius;
        this.handle(c, shape.x + shape.r, shape.z, color, `handle-${i}-radius`).userData['ref'] = ref;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Building blocks

  private readonly heightAt = (xWu: number, zWu: number): number => this.view.heightWuAt(xWu, zWu);

  /** Group at a map position (Fx raw), on the terrain. */
  private markerGroup(c: PartContent, xRaw: number, zRaw: number, order: number, name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    const x = xRaw / FX;
    const z = zRaw / FX;
    g.position.set(x, this.heightAt(x, z), z);
    g.renderOrder = order;
    c.group.add(g);
    return g;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, order: number, y: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.position.y = y;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Field handle: white/coloured disc with a dark border, in the highlight part. */
  private handle(c: PartContent, xRaw: number, zRaw: number, color: number, name: string): THREE.Group {
    const r = SIZES.handle.radiusWu;
    const g = this.markerGroup(c, xRaw, zRaw, ORDER.handles, name);
    g.userData['handle'] = true;
    g.userData['layer'] = 'fields';
    g.visible = this.layers.fields.visible;
    g.add(this.mesh(this.shared.disc, this.meshMat(color, 1), ORDER.handles, 0.14));
    g.add(this.mesh(this.shared.border, this.meshMat(COLORS.handleBorder, 1), ORDER.handles, 0.14));
    c.scaled.push({ obj: g, radiusWu: r, minPx: SIZES.handle.minPx, baseScale: r });
    return g;
  }

  /** Cached overlay mesh material (always visible: no depth test). */
  private meshMat(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = `${color}|${opacity}`;
    let mat = this.meshMaterials.get(key);
    if (mat === undefined) {
      mat = new THREE.MeshBasicMaterial({
        color,
        // Always in the transparent pass: three draws opaque objects first, so an opaque marker
        // would be covered by the (transparent) water and field fills despite its renderOrder.
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.meshMaterials.set(key, mat);
    }
    return mat;
  }

  /** Sprite with a cached canvas texture; plain colour square without a canvas. */
  private sprite(key: string, make: () => THREE.Texture | null, color: number, order: number): THREE.Sprite {
    let tex = this.spriteTextures.get(key);
    if (tex === undefined) {
      tex = make();
      this.spriteTextures.set(key, tex);
    }
    const mat =
      tex === null
        ? new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false, transparent: true })
        : new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.renderOrder = order;
    s.frustumCulled = false;
    // Sprite materials are per sprite (cheap); collected by the owning part via traverse on release.
    return s;
  }

  /** Several draped segment lists as one LineSegments2 (screen-space width, per-segment colour). */
  private lines(
    c: PartContent,
    parts: readonly Float32Array[],
    colors: readonly THREE.Color[],
    widthPx: number,
    opacity: number,
    order: number,
    dashed: boolean,
  ): LineSegments2 | null {
    let n = 0;
    for (const p of parts) n += p.length;
    if (n === 0) return null;
    const pos = new Float32Array(n);
    const col = new Float32Array(n);
    let o = 0;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k]!;
      pos.set(p, o);
      const cc = colors[k]!;
      for (let i = 0; i < p.length; i += 3) {
        col[o + i] = cc.r;
        col[o + i + 1] = cc.g;
        col[o + i + 2] = cc.b;
      }
      o += p.length;
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = new LineMaterial({
      color: 0xffffff,
      linewidth: widthPx,
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      dashed,
      dashSize: 1,
      gapSize: 1,
    });
    const line = new LineSegments2(geo, mat);
    line.renderOrder = order;
    line.frustumCulled = false;
    if (dashed) {
      line.computeLineDistances();
      geo.computeBoundingSphere();
      const center = geo.boundingSphere?.center.clone() ?? new THREE.Vector3();
      c.dashed.push({ mat, center, dashPx: 12, gapPx: 8 });
    }
    this.lineMaterials.push(mat);
    c.geometries.push(geo);
    c.materials.push(mat);
    c.group.add(line);
    return line;
  }

  /** One THREE.Points with the prop shader (world size, minimum size in pixels). */
  private points(c: PartContent, pos: Float32Array, col: Float32Array, sizeWu: number, minPx: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, pos.length / 3);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uScale: { value: 500 }, uSizeWu: { value: sizeWu }, uMinPx: { value: minPx } },
      // Transparent pass (after water/fills, see meshMat), still depth-tested against the terrain.
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    mat.userData['minPx'] = minPx;
    this.pointMaterials.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = ORDER.props;
    pts.frustumCulled = false;
    c.geometries.push(geo);
    c.materials.push(mat);
    c.group.add(pts);
    return pts;
  }

  /** Disposes a part's content and returns it emptied, attached to `parent`. */
  private reset(part: OverlayPart, parent: THREE.Group): PartContent {
    const old = this.parts[part];
    this.release(old);
    const fresh = emptyPart(old.group.name);
    parent.add(fresh.group);
    this.parts[part] = fresh;
    return fresh;
  }

  private release(c: PartContent): void {
    c.group.removeFromParent();
    c.group.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    for (const g of c.geometries) g.dispose();
    for (const mat of c.materials) {
      mat.dispose();
      const li = this.lineMaterials.indexOf(mat as LineMaterial);
      if (li >= 0) this.lineMaterials.splice(li, 1);
      const pi = this.pointMaterials.indexOf(mat as THREE.ShaderMaterial);
      if (pi >= 0) this.pointMaterials.splice(pi, 1);
    }
    c.scaled.length = 0;
    c.dashed.length = 0;
    c.geometries.length = 0;
    c.materials.length = 0;
  }

  /** Per frame: minimum pixel sizes, line resolution, dash lengths, point scale. */
  private beforeRender(): void {
    const cam = this.view.camera;
    const rect = this.view.canvas.getBoundingClientRect();
    const hPx = Math.max(1, rect.height);
    const ratio = this.view.renderer?.getPixelRatio() ?? 1;
    const camPos = cam.getWorldPosition(this.tmp);
    for (const part of Object.values(this.parts)) {
      for (const s of part.scaled) {
        const wpp = wuPerPixel(camPos.distanceTo(s.obj.position), cam.fov, hPx);
        s.obj.scale.setScalar(s.baseScale * minPixelScale(s.radiusWu, s.minPx, wpp));
      }
      for (const d of part.dashed) {
        const wpp = wuPerPixel(camPos.distanceTo(d.center), cam.fov, hPx);
        d.mat.dashSize = d.dashPx * wpp;
        d.mat.gapSize = d.gapPx * wpp;
      }
    }
    for (const mat of this.lineMaterials) mat.resolution.set(Math.max(1, rect.width), hPx);
    const scale = (hPx * ratio) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const mat of this.pointMaterials) {
      mat.uniforms['uScale']!.value = scale;
      mat.uniforms['uMinPx']!.value = (mat.userData['minPx'] as number) * ratio;
    }
  }
}

/** Position (Fx raw) of an issue marker: its own x/z, else the first positioned ref, else null. */
export function issuePosition(issue: EditorIssue, m: Pick<ViewMarkers, 'starts' | 'spots' | 'fields'>): { x: number; z: number } | null {
  if (issue.x !== null && issue.z !== null) return { x: issue.x, z: issue.z };
  for (const r of issue.refs) {
    if (r.type === 'start' || r.type === 'spot') {
      const s = r.type === 'start' ? m.starts[r.index] : m.spots[r.index];
      if (s !== undefined) return { x: s.x, z: s.z };
      continue;
    }
    const f = m.fields[r.index];
    if (f === undefined) continue;
    const shape = f.shape;
    if (r.type === 'fieldVertex' && shape.kind === 'polygon') {
      const p = shape.points[r.vertex];
      if (p !== undefined) return { x: p.x, z: p.z };
    }
    if (r.type === 'fieldRadius' && shape.kind === 'circle') return { x: shape.x + shape.r, z: shape.z };
    if (shape.kind === 'circle') return { x: shape.x, z: shape.z };
    const c = outlineCenterWu(pointsToWu(shape.points));
    return { x: Math.round(c.x * FX), z: Math.round(c.z * FX) };
  }
  return null;
}
