/**
 * Marker validation rules of the editor (M12): start positions, mass/hydro spots and prop fields
 * against the terrain analysis (terrain.ts). Every issue carries a fixed code (types.ts ISSUE_CODES),
 * a German message, the location in Fx raw and references to the affected markers.
 *
 * Output order is deterministic: severity (error, warning, info), then rule order, then marker
 * index. Thresholds live in ValidationOptions (Fx raw / 1/1000); the defaults are calibrated so
 * that the shipped maps (hollow-ridge, tessera, braidwater, setons) have no errors
 * (docs/status/track-editor-p3.md).
 */

import { expandPropField, FormatError, MAP_MAX_PROPS, type MapPropField, type RtsMap } from '@faf/formats';
import { sampleHeightRaw } from '@faf/rules';
import { NO_COMPONENT, type TerrainAnalysis } from './terrain.ts';
import type { EditorIssue, MarkerRef, SymmetryMode } from './types.ts';

const FX_ONE = 4096;
const FX_SHIFT = 12;

export interface ValidationOptions {
  /** start-edge: error if a start is closer than this to the map edge. Default 16 WU. */
  readonly startEdgeMinRaw: number;
  /** spot-edge: error if a spot is closer than this to the map edge (DECISIONS 29). Default 12 WU. */
  readonly spotEdgeMinRaw: number;
  /** spot-not-flat (error): radius of the core disc. Default 1.5 WU. */
  readonly spotFlatErrorRadiusRaw: number;
  /** spot-not-flat (error): max |h − h(spot)| inside the core disc. Default 0.5 WU. */
  readonly spotFlatErrorDhRaw: number;
  /** spot-not-flat (warning): radius of the outer disc. Default 3 WU. */
  readonly spotFlatWarnRadiusRaw: number;
  /** spot-not-flat (warning): max |h − h(spot)| inside the outer disc. Default ≈ 0.1 WU (410 raw). */
  readonly spotFlatWarnDhRaw: number;
  /** Lattice step of the flatness probe (Fx raw). Default 0.25 WU. */
  readonly flatProbeStepRaw: number;
  /** start-not-flat: radius of the build platform around a start. Default 8 WU. */
  readonly startPlatformRadiusRaw: number;
  /** start-not-flat: minimum share of passable samples on the platform in 1/1000. Default 500 (> half). */
  readonly startPlatformMinPassablePermille: number;
  /** spot-overlap: error if two spots are closer than this. Default 2 WU. */
  readonly spotOverlapRaw: number;
  /** spot-close: warning if two spots are closer than this. Default 4 WU. */
  readonly spotCloseRaw: number;
  /** spot-on-start: error if a spot is closer than this to a start. Default 4 WU. */
  readonly spotStartMinRaw: number;
  /** start-close: error if two starts are closer than this. Default 48 WU. */
  readonly startCloseErrorRaw: number;
  /** start-close: warning if two starts are closer than this. Default 96 WU. */
  readonly startCloseWarnRaw: number;
  /**
   * start-/spot-unreachable: markers on an impassable sample (spot on a small bump, start on a
   * ramp edge) snap to the nearest passable sample within this radius. Default 4 WU.
   */
  readonly reachSnapRadiusRaw: number;
  /** field-covers-spot: warning if an expanded field prop is closer than this to a spot. Default 2 WU. */
  readonly fieldSpotClearRaw: number;
  /** field-covers-spot: warning if an expanded field prop is closer than this to a start. Default 8 WU. */
  readonly fieldStartClearRaw: number;
  /** prop-count: limit of PROP entries + expanded field props. Default MAP_MAX_PROPS. */
  readonly maxProps: number;
  /** asymmetric: position tolerance when matching a marker with its mirror image. Default 1 WU. */
  readonly symmetryToleranceRaw: number;
}

/** Default thresholds (see ValidationOptions for the meaning of every value). */
export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = Object.freeze({
  startEdgeMinRaw: 16 * FX_ONE,
  spotEdgeMinRaw: 12 * FX_ONE,
  spotFlatErrorRadiusRaw: 6144,
  spotFlatErrorDhRaw: 2048,
  spotFlatWarnRadiusRaw: 3 * FX_ONE,
  spotFlatWarnDhRaw: 410,
  flatProbeStepRaw: 1024,
  startPlatformRadiusRaw: 8 * FX_ONE,
  startPlatformMinPassablePermille: 500,
  spotOverlapRaw: 2 * FX_ONE,
  spotCloseRaw: 4 * FX_ONE,
  spotStartMinRaw: 4 * FX_ONE,
  startCloseErrorRaw: 48 * FX_ONE,
  startCloseWarnRaw: 96 * FX_ONE,
  reachSnapRadiusRaw: 4 * FX_ONE,
  fieldSpotClearRaw: 2 * FX_ONE,
  fieldStartClearRaw: 8 * FX_ONE,
  maxProps: MAP_MAX_PROPS,
  symmetryToleranceRaw: FX_ONE,
});

/** Merges partial options over the defaults. */
export function resolveValidationOptions(options?: Partial<ValidationOptions>): ValidationOptions {
  return options === undefined ? DEFAULT_VALIDATION_OPTIONS : { ...DEFAULT_VALIDATION_OPTIONS, ...options };
}

// ---------------------------------------------------------------------------------------------
// Field expansion cache (per field object and terrain; expansion depends on nothing else)

/** Positions of the props a field expands to, or the reason the field cannot be expanded. */
export interface FieldPoints {
  readonly count: number;
  readonly xs: Int32Array;
  readonly zs: Int32Array;
  /** Non-null if the field is invalid (FormatError detail); count is 0 then. */
  readonly error: string | null;
}

const EMPTY_POINTS = new Int32Array(0);
/**
 * Expansions keyed by field object, one table per analysis (= per terrain). Fields are immutable
 * values in the editor, so identity is a sound key; a changed field is a new object.
 */
const fieldCache = new WeakMap<TerrainAnalysis, WeakMap<MapPropField, FieldPoints>>();

/** Number of field expansions actually computed (cache misses), for tests and the benchmark. */
export const fieldExpansionStats = { expansions: 0 };

/** Expanded prop positions of `map.propFields[index]` on the analysed terrain (cached). */
export function fieldPoints(map: RtsMap, analysis: TerrainAnalysis, index: number): FieldPoints {
  const field = map.propFields![index]!;
  let table = fieldCache.get(analysis);
  if (table === undefined) {
    table = new WeakMap();
    fieldCache.set(analysis, table);
  }
  const hit = table.get(field);
  if (hit !== undefined) return hit;
  fieldExpansionStats.expansions++;
  let out: FieldPoints;
  try {
    const props = expandPropField(map, index);
    const xs = new Int32Array(props.length);
    const zs = new Int32Array(props.length);
    for (let i = 0; i < props.length; i++) {
      xs[i] = props[i]!.x;
      zs[i] = props[i]!.z;
    }
    out = { count: props.length, xs, zs, error: null };
  } catch (e) {
    if (!(e instanceof FormatError)) throw e;
    out = { count: 0, xs: EMPTY_POINTS, zs: EMPTY_POINTS, error: e.message };
  }
  table.set(field, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers

type Severity = EditorIssue['severity'];

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Formats Fx raw as WU with one decimal and a German decimal comma. */
export function fmtWu(raw: number): string {
  return (raw / FX_ONE).toFixed(1).replace('.', ',');
}

function spotName(map: RtsMap, i: number): string {
  return `${map.meta.spots[i]!.kind === 'mass' ? 'Masse' : 'Hydro'}-Spot ${i + 1}`;
}

function startName(map: RtsMap, i: number): string {
  return `Start ${i + 1} (Armee ${map.meta.starts[i]!.army})`;
}

function fieldName(map: RtsMap, i: number): string {
  return `Prop-Feld „${map.propFields![i]!.name}“`;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function edgeDistRaw(sizeRaw: number, x: number, z: number): number {
  return Math.min(x, z, sizeRaw - x, sizeRaw - z);
}

/** Distance in WU with one decimal from a squared raw distance. */
function fmtDist2(d2: number): string {
  return fmtWu(Math.sqrt(d2));
}

const startRef = (index: number): MarkerRef => ({ type: 'start', index });
const spotRef = (index: number): MarkerRef => ({ type: 'spot', index });
const fieldRef = (index: number): MarkerRef => ({ type: 'field', index });

/**
 * Max |h − h(center)| (Fx raw) over a lattice (step `stepRaw`) inside two discs around (x, z):
 * returns [max within rInner, max within rOuter]. The lattice contains the center, so markers on
 * grid positions probe the exact sample heights.
 */
function flatness(analysis: TerrainAnalysis, x: number, z: number, rInnerRaw: number, rOuterRaw: number, stepRaw: number): [number, number] {
  const hf = analysis.hf;
  const h0 = sampleHeightRaw(hf, x, z);
  const nOuter = Math.floor(rOuterRaw / stepRaw);
  const ri2 = rInnerRaw * rInnerRaw;
  const ro2 = rOuterRaw * rOuterRaw;
  const sizeRaw = analysis.sizeWu * FX_ONE;
  let inner = 0;
  let outer = 0;
  for (let j = -nOuter; j <= nOuter; j++) {
    const dz = j * stepRaw;
    const pz = z + dz;
    if (pz < 0 || pz > sizeRaw) continue;
    for (let i = -nOuter; i <= nOuter; i++) {
      const dx = i * stepRaw;
      const d2 = dx * dx + dz * dz;
      if (d2 > ro2) continue;
      const px = x + dx;
      if (px < 0 || px > sizeRaw) continue;
      const dh = Math.abs(sampleHeightRaw(hf, px, pz) - h0);
      if (dh > outer) outer = dh;
      if (d2 <= ri2 && dh > inner) inner = dh;
    }
  }
  return [inner, outer];
}

/** Passable samples / all samples (1/1000) of the grid samples within `radiusRaw` of (x, z). */
function platformPassablePermille(analysis: TerrainAnalysis, x: number, z: number, radiusRaw: number): number {
  const max = analysis.sizeWu;
  const dim = analysis.dim;
  const x0 = Math.max(0, (x - radiusRaw + FX_ONE - 1) >> FX_SHIFT);
  const x1 = Math.min(max, (x + radiusRaw) >> FX_SHIFT);
  const z0 = Math.max(0, (z - radiusRaw + FX_ONE - 1) >> FX_SHIFT);
  const z1 = Math.min(max, (z + radiusRaw) >> FX_SHIFT);
  const r2 = radiusRaw * radiusRaw;
  let total = 0;
  let ok = 0;
  for (let sz = z0; sz <= z1; sz++) {
    const dz = sz * FX_ONE - z;
    for (let sx = x0; sx <= x1; sx++) {
      const dx = sx * FX_ONE - x;
      if (dx * dx + dz * dz > r2) continue;
      total++;
      if (analysis.passable[sz * dim + sx] === 1) ok++;
    }
  }
  return total === 0 ? 0 : Math.floor((ok * 1000) / total);
}

// ---------------------------------------------------------------------------------------------
// Symmetry

/** Every mirror mode (without 'none') in a fixed order. */
export const SYMMETRY_MODES: readonly Exclude<SymmetryMode, 'none'>[] = ['point', 'mirrorX', 'mirrorZ', 'diagonal', 'antiDiagonal'];

const SYMMETRY_LABEL: Record<Exclude<SymmetryMode, 'none'>, string> = {
  point: 'punktsymmetrisch',
  mirrorX: 'achsensymmetrisch zu x = Mitte',
  mirrorZ: 'achsensymmetrisch zu z = Mitte',
  diagonal: 'symmetrisch zur Diagonale (x = z)',
  antiDiagonal: 'symmetrisch zur Gegendiagonale',
};

/** Mirror image of (x, z) under `mode` (S = sizeWu·4096), matching the editor model's convention. */
export function mirrorPoint(mode: SymmetryMode, sizeRaw: number, x: number, z: number): [number, number] {
  switch (mode) {
    case 'point':
      return [sizeRaw - x, sizeRaw - z];
    case 'mirrorX':
      return [sizeRaw - x, z];
    case 'mirrorZ':
      return [x, sizeRaw - z];
    case 'diagonal':
      return [z, x];
    case 'antiDiagonal':
      return [sizeRaw - z, sizeRaw - x];
    case 'none':
      return [x, z];
  }
}

/** Marker classes that must map onto each other: 0 = start, 1 = mass, 2 = hydro. */
interface MarkerSet {
  readonly cls: Int32Array;
  readonly xs: Int32Array;
  readonly zs: Int32Array;
  readonly refs: readonly MarkerRef[];
}

function markerSet(map: RtsMap): MarkerSet {
  const { starts, spots } = map.meta;
  const n = starts.length + spots.length;
  const cls = new Int32Array(n);
  const xs = new Int32Array(n);
  const zs = new Int32Array(n);
  const refs: MarkerRef[] = [];
  let k = 0;
  for (let i = 0; i < starts.length; i++, k++) {
    cls[k] = 0;
    xs[k] = starts[i]!.x;
    zs[k] = starts[i]!.z;
    refs.push(startRef(i));
  }
  for (let i = 0; i < spots.length; i++, k++) {
    cls[k] = spots[i]!.kind === 'mass' ? 1 : 2;
    xs[k] = spots[i]!.x;
    zs[k] = spots[i]!.z;
    refs.push(spotRef(i));
  }
  return { cls, xs, zs, refs };
}

/** Indices (into the marker set) of markers without a mirror partner of the same class under `mode`. */
function unmatched(set: MarkerSet, mode: SymmetryMode, sizeRaw: number, tolRaw: number): number[] {
  const out: number[] = [];
  const tol2 = tolRaw * tolRaw;
  const n = set.cls.length;
  for (let i = 0; i < n; i++) {
    const [mx, mz] = mirrorPoint(mode, sizeRaw, set.xs[i]!, set.zs[i]!);
    let found = false;
    for (let j = 0; j < n && !found; j++) {
      if (set.cls[j] === set.cls[i] && dist2(mx, mz, set.xs[j]!, set.zs[j]!) <= tol2) found = true;
    }
    if (!found) out.push(i);
  }
  return out;
}

/** Symmetry modes under which every start and spot has a mirror partner of the same kind. */
export function detectSymmetry(map: RtsMap, toleranceRaw: number = DEFAULT_VALIDATION_OPTIONS.symmetryToleranceRaw): Exclude<SymmetryMode, 'none'>[] {
  const set = markerSet(map);
  const sizeRaw = map.meta.sizeWu * FX_ONE;
  return SYMMETRY_MODES.filter((m) => unmatched(set, m, sizeRaw, toleranceRaw).length === 0);
}

// ---------------------------------------------------------------------------------------------
// Rules

/**
 * Validates the markers of `map` against `analysis` (which must describe the same terrain, see
 * createValidator for caching). Pure apart from the field expansion cache; deterministic.
 */
export function validateMap(map: RtsMap, analysis: TerrainAnalysis, options?: Partial<ValidationOptions>): EditorIssue[] {
  const o = resolveValidationOptions(options);
  const meta = map.meta;
  if (analysis.heights !== map.heights || analysis.sizeWu !== meta.sizeWu || analysis.heightScaleRaw !== meta.heightScaleRaw || analysis.waterLevelRaw !== meta.waterLevelRaw) {
    throw new Error('validateMap: the terrain analysis belongs to a different heightfield');
  }
  const starts = meta.starts;
  const spots = meta.spots;
  const sizeRaw = meta.sizeWu * FX_ONE;
  const water = meta.waterLevelRaw;
  const hf = analysis.hf;
  const issues: EditorIssue[] = [];
  const add = (severity: Severity, code: string, message: string, x: number | null, z: number | null, refs: readonly MarkerRef[]): void => {
    issues.push({ severity, code, message, x, z, refs });
  };

  // start-count
  if (starts.length < 2) {
    add('error', 'start-count', `Die Karte braucht mindestens 2 Startpositionen (vorhanden: ${starts.length}).`, null, null, starts.map((_, i) => startRef(i)));
  }
  const armies = starts.map((s) => s.army).sort((a, b) => a - b);
  let gapless = true;
  for (let i = 0; i < armies.length; i++) if (armies[i] !== i) gapless = false;
  if (!gapless && starts.length > 0) {
    add('warning', 'start-count', `Armeenummern sind nicht lückenlos 0..${starts.length - 1} (gefunden: ${armies.join(', ')}).`, null, null, starts.map((_, i) => startRef(i)));
  }

  // start-edge / spot-edge
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const d = edgeDistRaw(sizeRaw, s.x, s.z);
    if (d < o.startEdgeMinRaw) add('error', 'start-edge', `${startName(map, i)} liegt ${fmtWu(d)} WU vom Kartenrand (mindestens ${fmtWu(o.startEdgeMinRaw)} WU).`, s.x, s.z, [startRef(i)]);
  }
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    const d = edgeDistRaw(sizeRaw, s.x, s.z);
    if (d < o.spotEdgeMinRaw) add('error', 'spot-edge', `${spotName(map, i)} liegt ${fmtWu(d)} WU vom Kartenrand (mindestens ${fmtWu(o.spotEdgeMinRaw)} WU).`, s.x, s.z, [spotRef(i)]);
  }

  // start-in-water / spot-in-water (waterDepth ≥ 0: at or below the water surface)
  if (water !== null) {
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i]!;
      const depth = water - sampleHeightRaw(hf, s.x, s.z);
      if (depth >= 0) add('error', 'start-in-water', `${startName(map, i)} liegt im Wasser (Tiefe ${fmtWu(depth)} WU).`, s.x, s.z, [startRef(i)]);
    }
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const depth = water - sampleHeightRaw(hf, s.x, s.z);
      if (depth >= 0) add('error', 'spot-in-water', `${spotName(map, i)} liegt im Wasser (Tiefe ${fmtWu(depth)} WU).`, s.x, s.z, [spotRef(i)]);
    }
  }

  // spot-not-flat
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    const [inner, outer] = flatness(analysis, s.x, s.z, o.spotFlatErrorRadiusRaw, o.spotFlatWarnRadiusRaw, o.flatProbeStepRaw);
    if (inner > o.spotFlatErrorDhRaw) {
      add('error', 'spot-not-flat', `${spotName(map, i)} liegt am Hang: ${fmtWu(inner)} WU Höhenunterschied im Radius ${fmtWu(o.spotFlatErrorRadiusRaw)} WU (erlaubt ${fmtWu(o.spotFlatErrorDhRaw)} WU).`, s.x, s.z, [spotRef(i)]);
    } else if (outer > o.spotFlatWarnDhRaw) {
      add('warning', 'spot-not-flat', `${spotName(map, i)} ist uneben: ${(outer / FX_ONE).toFixed(2).replace('.', ',')} WU Höhenunterschied im Radius ${fmtWu(o.spotFlatWarnRadiusRaw)} WU.`, s.x, s.z, [spotRef(i)]);
    }
  }

  // start-not-flat
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const pm = platformPassablePermille(analysis, s.x, s.z, o.startPlatformRadiusRaw);
    if (pm < o.startPlatformMinPassablePermille) {
      add('warning', 'start-not-flat', `Bauplatz von ${startName(map, i)} ist nur zu ${Math.floor(pm / 10)} % befahrbar (Radius ${fmtWu(o.startPlatformRadiusRaw)} WU).`, s.x, s.z, [startRef(i)]);
    }
  }

  // spot-overlap / spot-close
  const overlap2 = o.spotOverlapRaw * o.spotOverlapRaw;
  const close2 = o.spotCloseRaw * o.spotCloseRaw;
  for (let i = 0; i < spots.length; i++) {
    const a = spots[i]!;
    for (let j = i + 1; j < spots.length; j++) {
      const b = spots[j]!;
      const d2 = dist2(a.x, a.z, b.x, b.z);
      if (d2 < overlap2) {
        add('error', 'spot-overlap', `${spotName(map, i)} und ${spotName(map, j)} überlappen (${fmtDist2(d2)} WU Abstand, mindestens ${fmtWu(o.spotOverlapRaw)} WU).`, a.x, a.z, [spotRef(i), spotRef(j)]);
      } else if (d2 < close2) {
        add('warning', 'spot-close', `${spotName(map, i)} und ${spotName(map, j)} liegen sehr nah beieinander (${fmtDist2(d2)} WU).`, a.x, a.z, [spotRef(i), spotRef(j)]);
      }
    }
  }

  // spot-on-start
  const spotStart2 = o.spotStartMinRaw * o.spotStartMinRaw;
  for (let i = 0; i < spots.length; i++) {
    const a = spots[i]!;
    for (let j = 0; j < starts.length; j++) {
      const b = starts[j]!;
      const d2 = dist2(a.x, a.z, b.x, b.z);
      if (d2 < spotStart2) {
        add('error', 'spot-on-start', `${spotName(map, i)} liegt ${fmtDist2(d2)} WU neben ${startName(map, j)} (mindestens ${fmtWu(o.spotStartMinRaw)} WU).`, a.x, a.z, [spotRef(i), startRef(j)]);
      }
    }
  }

  // start-close
  const startErr2 = o.startCloseErrorRaw * o.startCloseErrorRaw;
  const startWarn2 = o.startCloseWarnRaw * o.startCloseWarnRaw;
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i]!;
    for (let j = i + 1; j < starts.length; j++) {
      const b = starts[j]!;
      const d2 = dist2(a.x, a.z, b.x, b.z);
      if (d2 < startErr2) {
        add('error', 'start-close', `${startName(map, i)} und ${startName(map, j)} liegen nur ${fmtDist2(d2)} WU auseinander (mindestens ${fmtWu(o.startCloseErrorRaw)} WU).`, a.x, a.z, [startRef(i), startRef(j)]);
      } else if (d2 < startWarn2) {
        add('warning', 'start-close', `${startName(map, i)} und ${startName(map, j)} liegen nah beieinander (${fmtDist2(d2)} WU, empfohlen ≥ ${fmtWu(o.startCloseWarnRaw)} WU).`, a.x, a.z, [startRef(i), startRef(j)]);
      }
    }
  }

  // start-unreachable: all starts must share one land component. The main component is the one
  // holding the most starts (ties: the one of the lowest start index).
  const startComp = new Int32Array(starts.length);
  for (let i = 0; i < starts.length; i++) startComp[i] = analysis.componentAt(starts[i]!.x, starts[i]!.z, o.reachSnapRadiusRaw);
  if (starts.length > 1) {
    let main = NO_COMPONENT;
    let mainCount = 0;
    for (let i = 0; i < starts.length; i++) {
      const c = startComp[i]!;
      if (c === NO_COMPONENT) continue;
      let count = 0;
      for (let j = 0; j < starts.length; j++) if (startComp[j] === c) count++;
      if (count > mainCount) {
        main = c;
        mainCount = count;
      }
    }
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i]!;
      if (startComp[i] === main) continue;
      const why = startComp[i] === NO_COMPONENT ? 'steht auf unpassierbarem Gelände' : 'ist über Land nicht mit den anderen Startpositionen verbunden';
      add('error', 'start-unreachable', `${startName(map, i)} ${why} (Neigung > ${(analysis.maxSlopePermille / 1000).toFixed(2).replace('.', ',')} oder tiefes Wasser).`, s.x, s.z, [startRef(i)]);
    }
  }

  // spot-unreachable: spot in no land component of any start (island, plateau): air only.
  if (starts.length > 0) {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const c = analysis.componentAt(s.x, s.z, o.reachSnapRadiusRaw);
      let reach = false;
      if (c !== NO_COMPONENT) for (let j = 0; j < starts.length && !reach; j++) if (startComp[j] === c) reach = true;
      if (!reach) add('warning', 'spot-unreachable', `${spotName(map, i)} ist von keiner Startposition über Land erreichbar (nur per Luft/Wasser).`, s.x, s.z, [spotRef(i)]);
    }
  }

  // Prop fields: field-invalid, field-empty, prop-count, field-covers-spot
  const fields = map.propFields;
  if (fields !== undefined && fields.length > 0) {
    const pts: FieldPoints[] = [];
    let total = map.props.length;
    for (let f = 0; f < fields.length; f++) {
      const p = fieldPoints(map, analysis, f);
      pts.push(p);
      total += p.count;
      if (p.error !== null) {
        add('error', 'field-invalid', `${fieldName(map, f)} ist ungültig: ${p.error}`, fieldAnchorX(fields[f]!), fieldAnchorZ(fields[f]!), [fieldRef(f)]);
      } else if (p.count === 0) {
        add('warning', 'field-empty', `${fieldName(map, f)} erzeugt keine Props (Fläche, Dichte, Wasser- oder Neigungsgrenze prüfen).`, fieldAnchorX(fields[f]!), fieldAnchorZ(fields[f]!), [fieldRef(f)]);
      }
    }
    if (total > o.maxProps) {
      const refs: MarkerRef[] = [];
      for (let f = 0; f < fields.length; f++) if (pts[f]!.count > 0) refs.push(fieldRef(f));
      add('error', 'prop-count', `Zu viele Props: ${map.props.length} einzelne + ${total - map.props.length} aus Feldern = ${total} (höchstens ${o.maxProps}).`, null, null, refs);
    }
    coverage(map, o, pts, add);
  }

  // asymmetric (info)
  const set = markerSet(map);
  if (set.cls.length > 0) {
    const found: Exclude<SymmetryMode, 'none'>[] = [];
    let best: number[] | null = null;
    for (const mode of SYMMETRY_MODES) {
      const miss = unmatched(set, mode, sizeRaw, o.symmetryToleranceRaw);
      if (miss.length === 0) found.push(mode);
      else if (best === null || miss.length < best.length) best = miss;
    }
    if (found.length > 0) {
      add('info', 'asymmetric', `Marker sind ${found.map((m) => SYMMETRY_LABEL[m]).join(', ')} (Symmetrie: ${found.join(', ')}).`, null, null, []);
    } else {
      const refs = best!.map((k) => set.refs[k]!);
      add('info', 'asymmetric', `Marker sind unter keiner Spiegelung symmetrisch (bestenfalls ${refs.length} Marker ohne Gegenstück).`, null, null, refs);
    }
  }

  // Stable sort by severity only: rule order and marker order stay as generated.
  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function fieldAnchorX(f: MapPropField): number {
  return f.shape.kind === 'circle' ? f.shape.x : (f.shape.points[0]?.x ?? 0);
}

function fieldAnchorZ(f: MapPropField): number {
  return f.shape.kind === 'circle' ? f.shape.z : (f.shape.points[0]?.z ?? 0);
}

/**
 * field-covers-spot: expanded field props closer than fieldSpotClearRaw to a spot or
 * fieldStartClearRaw to a start. Markers are bucketed into a grid of the larger clearance, every
 * prop checks the 3×3 neighbourhood of its cell: O(props + markers).
 */
function coverage(
  map: RtsMap,
  o: ValidationOptions,
  pts: readonly FieldPoints[],
  add: (severity: Severity, code: string, message: string, x: number | null, z: number | null, refs: readonly MarkerRef[]) => void,
): void {
  const starts = map.meta.starts;
  const spots = map.meta.spots;
  const nMarkers = starts.length + spots.length;
  if (nMarkers === 0) return;
  const cellRaw = Math.max(o.fieldSpotClearRaw, o.fieldStartClearRaw, 1);
  const sizeRaw = map.meta.sizeWu * FX_ONE;
  const cells = Math.floor(sizeRaw / cellRaw) + 1;
  const head = new Int32Array(cells * cells).fill(-1);
  const next = new Int32Array(nMarkers);
  const mx = new Int32Array(nMarkers);
  const mz = new Int32Array(nMarkers);
  const clear2 = new Float64Array(nMarkers);
  for (let k = 0; k < nMarkers; k++) {
    const isStart = k < starts.length;
    const m = isStart ? starts[k]! : spots[k - starts.length]!;
    mx[k] = m.x;
    mz[k] = m.z;
    const c = isStart ? o.fieldStartClearRaw : o.fieldSpotClearRaw;
    clear2[k] = c * c;
    const cell = Math.floor(m.z / cellRaw) * cells + Math.floor(m.x / cellRaw);
    next[k] = head[cell]!;
    head[cell] = k;
  }
  const nFields = pts.length;
  const hits = new Int32Array(nMarkers * nFields);
  const nearest = new Float64Array(nMarkers * nFields).fill(Infinity);
  for (let f = 0; f < nFields; f++) {
    const p = pts[f]!;
    for (let i = 0; i < p.count; i++) {
      const px = p.xs[i]!;
      const pz = p.zs[i]!;
      const cx = Math.floor(px / cellRaw);
      const cz = Math.floor(pz / cellRaw);
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= cells) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= cells) continue;
          for (let k = head[z * cells + x]!; k !== -1; k = next[k]!) {
            const d2 = dist2(px, pz, mx[k]!, mz[k]!);
            if (d2 < clear2[k]!) {
              const slot = k * nFields + f;
              hits[slot] = hits[slot]! + 1;
              if (d2 < nearest[slot]!) nearest[slot] = d2;
            }
          }
        }
      }
    }
  }
  for (let k = 0; k < nMarkers; k++) {
    const isStart = k < starts.length;
    const idx = isStart ? k : k - starts.length;
    for (let f = 0; f < nFields; f++) {
      const n = hits[k * nFields + f]!;
      if (n === 0) continue;
      const who = isStart ? startName(map, idx) : spotName(map, idx);
      const clear = isStart ? o.fieldStartClearRaw : o.fieldSpotClearRaw;
      add(
        'warning',
        'field-covers-spot',
        `${fieldName(map, f)} setzt ${n} Prop${n === 1 ? '' : 's'} näher als ${fmtWu(clear)} WU an ${who} (nächstes ${fmtDist2(nearest[k * nFields + f]!)} WU).`,
        mx[k]!,
        mz[k]!,
        [isStart ? startRef(idx) : spotRef(idx), fieldRef(f)],
      );
    }
  }
}
