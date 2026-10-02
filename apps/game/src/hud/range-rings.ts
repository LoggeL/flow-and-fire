import type { SimBpTable } from '@faf/blueprints/simbin';
import { FlowFlags, UnitFlags, type FrameReader } from '@faf/protocol';

export type RangeKind = 'vision' | 'radar' | 'weapon' | 'weapon-min' | 'build';
export type RangeState = 'active' | 'planned' | 'incomplete' | 'paused' | 'unpowered' | 'stalled';
export interface RangeRing {
  readonly key: string;
  readonly kind: RangeKind;
  readonly state: RangeState;
  readonly source: 'selection' | 'placement';
  readonly radiusRaw: number;
  readonly x: number;
  readonly z: number;
  /** Separate polylines: clipped samples never introduce a chord across missing terrain. */
  readonly segments: readonly string[];
  readonly label: readonly [number, number] | null;
}
export interface RangeProjection {
  heightAt(x: number, z: number): number;
  project(x: number, y: number, z: number, out: Float64Array): boolean;
  readonly mapSizeRaw: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}
/** BuildGhost is structurally compatible. Pass the hovered/end site once, never its whole drag list. */
export interface RangePlacement { readonly bp: number; readonly x: number; readonly z: number }
type RangeBlueprints = Pick<SimBpTable, 'count' | 'vision' | 'radarCol' | 'firstMount' | 'mountCount' | 'mountWeaponCol' | 'weaponRangeCol' | 'weaponMinRangeCol' | 'buildRangeRawCol' | 'buildPowerQ16PerTickCol'>;
interface Radius { readonly kind: RangeKind; readonly raw: number }
type Point = readonly [number, number];
const RAW_PER_WU = 4096;
const EXCLUDED = UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.Wreck;
export const MAX_RANGE_SOURCES = 4;
export const MAX_RANGE_RINGS = 20;

function radii(table: RangeBlueprints, bp: number, placement: boolean): Radius[] {
  if (bp < 0 || bp >= table.count) return [];
  const result: Radius[] = [], seen = new Set<string>();
  const add = (kind: RangeKind, raw: number) => {
    const key = `${kind}:${raw}`;
    if (!Number.isFinite(raw) || raw <= 0 || seen.has(key)) return;
    seen.add(key); result.push({ kind, raw });
  };
  // Placement emphasizes the capability being sited; selected units begin with what they can see.
  if (!placement) add('vision', table.vision(bp));
  add('radar', table.radarCol[bp]!);
  const first = table.firstMount(bp), end = first + table.mountCount(bp);
  for (let mount = first; mount < end; mount++) {
    const weapon = table.mountWeaponCol[mount]!;
    add('weapon', table.weaponRangeCol[weapon]!);
    add('weapon-min', table.weaponMinRangeCol[weapon]!);
  }
  if (placement) add('vision', table.vision(bp));
  // Engineers' actual construction/repair/reclaim radius is useful on selection only.
  if (!placement && table.buildPowerQ16PerTickCol[bp]! > 0) add('build', table.buildRangeRawCol[bp]!);
  return result;
}

/** Clip a single projected segment to the viewport before serializing any coordinates. */
function clip(a: Point, b: Point, width: number, height: number): readonly [Point, Point] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let lo = 0, hi = 1;
  const p = [-dx, dx, -dy, dy], q = [a[0], width - a[0], a[1], height - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i]! < 0) return null; continue; }
    const t = q[i]! / p[i]!;
    if (p[i]! < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}
function samePoint(a: Point, b: Point): boolean { return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; }

/** Stateless geometry must be reprojected every HUD RAF, including paused simulation ticks. */
export class FrameRangeRings {
  private readonly screen = new Float64Array(4);

  project(frame: FrameReader | null, table: RangeBlueprints, selected: ArrayLike<number>, camera: RangeProjection,
    placement: RangePlacement | null = null, allied: (army: number) => boolean = army => army === frame?.viewer,
    alpha = 1): readonly RangeRing[] {
    if (camera.mapSizeRaw <= 0 || camera.viewportWidth <= 0 || camera.viewportHeight <= 0) return [];
    const rings: RangeRing[] = [], seen = new Set<string>();
    const add = (bp: number, x: number, z: number, state: RangeState, source: RangeRing['source'], handle: number, enabled?: boolean) => {
      for (const radius of radii(table, bp, source === 'placement')) {
        if (rings.length >= MAX_RANGE_RINGS) break;
        // Economy pause switches radar/build work off; sight and firing ranges remain valid.
        const capabilityState = state === 'paused' && radius.kind !== 'radar' && radius.kind !== 'build' ? 'active' : state;
        const ringState = radius.kind === 'radar' && capabilityState === 'active'
          ? enabled === false ? 'unpowered' : enabled === undefined && handle >= 0 && frame && (frame.unitFlags(handle) & UnitFlags.Stalled) ? 'stalled' : 'active'
          : capabilityState;
        const duplicate = `${x}:${z}:${radius.kind}:${radius.raw}:${ringState}`;
        if (seen.has(duplicate)) continue;
        seen.add(duplicate);
        const geometry = this.circle(x, z, radius.raw, camera);
        if (geometry.segments.length === 0) continue;
        rings.push({ key: `${source}:${handle}:${radius.kind}:${radius.raw}`, kind: radius.kind, radiusRaw: radius.raw, x, z,
          state: ringState, source, ...geometry });
      }
    };
    // The proposed site gets a clean overlay, even with many builders selected.
    if (placement !== null) { add(placement.bp, placement.x, placement.z, 'planned', 'placement', -1); return rings; }
    if (frame === null || selected.length === 0) return [];
    const handles = new Set(Array.from(selected)), power = new Map<number, boolean>();
    if (frame.flowTick === frame.tick) for (let i = 0; i < frame.flowCount; i++) power.set(frame.flowHandle(i), (frame.flowFlags(i) & FlowFlags.Enabled) !== 0);
    const t = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    let sources = 0;
    for (let i = 0; i < frame.unitCount && sources < MAX_RANGE_SOURCES && rings.length < MAX_RANGE_RINGS; i++) {
      const flags = frame.unitFlags(i);
      if (!handles.has(frame.unitHandle(i)) || flags & EXCLUDED || (frame.viewer >= 0 && !allied(frame.unitArmy(i)))) continue;
      const progress = frame.unitBuild(i), state: RangeState = progress < 255 ? 'incomplete' : flags & UnitFlags.Paused ? 'paused' : 'active';
      const blend = flags & UnitFlags.NoInterp ? 1 : t;
      const x = frame.unitPrev(i, 0) + (frame.unitCur(i, 0) - frame.unitPrev(i, 0)) * blend;
      const z = frame.unitPrev(i, 2) + (frame.unitCur(i, 2) - frame.unitPrev(i, 2)) * blend;
      const count = rings.length;
      add(frame.unitVisual(i), x, z, state, 'selection', i, power.get(frame.unitHandle(i)));
      if (rings.length > count) sources++;
    }
    return rings;
  }

  private circle(x: number, z: number, radius: number, camera: RangeProjection): Pick<RangeRing, 'segments' | 'label'> {
    const samples = Math.max(192, Math.min(768, Math.ceil(2 * Math.PI * radius / (2 * RAW_PER_WU))));
    const arcs: Point[][] = [];
    let arc: Point[] = [], previous: Point | null = null;
    const flush = () => { if (arc.length > 1) arcs.push(arc); arc = []; };
    for (let i = 0; i <= samples; i++) {
      const angle = i * Math.PI * 2 / samples, cx = x + Math.cos(angle) * radius, cz = z + Math.sin(angle) * radius;
      // Never clamp terrain coordinates: clamping bends the range into a false map-edge chord.
      if (cx < 0 || cz < 0 || cx > camera.mapSizeRaw || cz > camera.mapSizeRaw) { flush(); previous = null; continue; }
      const y = camera.heightAt(cx, cz);
      if (!Number.isFinite(y) || !camera.project(cx, y + RAW_PER_WU / 16, cz, this.screen) || !Number.isFinite(this.screen[0]) || !Number.isFinite(this.screen[1])) {
        flush(); previous = null; continue;
      }
      const current: Point = [this.screen[0]!, this.screen[1]!];
      if (previous !== null) {
        const edge = clip(previous, current, camera.viewportWidth, camera.viewportHeight);
        if (edge === null) flush();
        else {
          if (arc.length > 0 && !samePoint(arc[arc.length - 1]!, edge[0])) flush();
          if (arc.length === 0) arc.push(edge[0]);
          arc.push(edge[1]);
        }
      }
      previous = current;
    }
    flush();
    const longest = arcs.reduce<Point[]>((best, candidate) => candidate.length > best.length ? candidate : best, []);
    // A small readable label on the highest visible part; omit labels on tiny clipped slivers.
    // Keep range captions in the battlefield, clear of the resource bar and command panels.
    const labelPoints = longest.filter(point => point[0] > 65 && point[0] < camera.viewportWidth - 65 && point[1] > 140 && point[1] < camera.viewportHeight - 190);
    const label = longest.length < 12 || labelPoints.length === 0 ? null : labelPoints.reduce((best, point) => point[1] < best[1] ? point : best, labelPoints[0]!);
    return { segments: arcs.map(points => points.map(point => `${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ')),
      label: label && label[0] > 65 && label[0] < camera.viewportWidth - 65 && label[1] > 24 ? label : null };
  }
}

/** Geometry changes with camera position, even if Frame.seq and Frame.tick are unchanged. */
export function equalRangeRings(a: readonly RangeRing[], b: readonly RangeRing[]): boolean {
  return a.length === b.length && a.every((ring, i) => {
    const other = b[i]!;
    return ring.key === other.key && ring.state === other.state && ring.source === other.source &&
      ring.segments.length === other.segments.length && ring.segments.every((segment, k) => segment === other.segments[k]) &&
      (ring.label === null ? other.label === null : other.label !== null && ring.label[0] === other.label[0] && ring.label[1] === other.label[1]);
  });
}
