/**
 * Placement with KNOWN occupancy only (ai.md §5.3 R-08, §11 point 9) — provisional replacement for
 * `rules.canPlace` until MS4 (adapter boundary: then rules.canPlace with an occupancy provider that
 * only contains own and known enemy structures).
 *
 * Rules (provisional, documented in the status fragment):
 * - only structures; footprint w×d (rot 1/3 swaps w and d), centred on (x, z), inside the map;
 * - extractors (MASSEXTRACTION / HYDROCARBON) must be centred (±1 WU) on a spot of their kind whose
 *   extractor footprint is not overlapped by a known structure; terrain is not checked for them (the
 *   map places spots on buildable ground);
 * - other structures: every 2-WU cell under the footprint passable, height span of those cells
 *   ≤ 1 WU, and no overlap with the extractor footprint of any spot (spots stay free);
 * - no overlap (positive area; touching edges = adjacency is allowed) with own structures (incl.
 *   construction sites) or KNOWN enemy structures (visible or ghost). Mobile units never block.
 */
import { canPlace, PlacementVerdict, footprintX } from '@faf/rules';
import type { AiBlueprint, AiBlueprintTable, AiStatic, Spot, SpotKind } from '../types.ts';

/** A structure the AI knows about (own, or enemy visible/ghost). */
export interface KnownStructure {
  readonly bp: number;
  readonly x: number;
  readonly z: number;
}

/** Centring tolerance of extractors on spots (WU). */
export const SPOT_TOLERANCE_WU = 1;
/** Maximum height difference under a footprint (WU). */
export const MAX_HEIGHT_SPAN_WU = 1;

const EPS = 1e-9;

/** Footprint [w, d] of a blueprint at rotation rot (0..3). */
export function footprintOf(bp: AiBlueprint, rot: number): readonly [number, number] {
  const [w, d] = bp.footprint;
  return (rot & 1) === 1 ? [d, w] : [w, d];
}

/** Base-stage extractor footprint for a spot kind (smallest tech), [2, 2] / [6, 6] as fallback. */
export function extractorFootprint(table: AiBlueprintTable, kind: SpotKind): readonly [number, number] {
  const expr = table.compile(kind === 'mass' ? 'STRUCTURE & MASSEXTRACTION' : 'STRUCTURE & HYDROCARBON');
  let best: AiBlueprint | null = null;
  for (const bp of table.list) {
    if (!table.matches(bp, expr) || bp.upgradeFrom !== -1) continue;
    if (best === null || bp.tech < best.tech) best = bp;
  }
  if (best !== null) return best.footprint;
  return kind === 'mass' ? [2, 2] : [6, 6];
}

function overlaps(ax: number, az: number, aw: number, ad: number, bx: number, bz: number, bw: number, bd: number): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw - EPS && Math.abs(az - bz) * 2 < ad + bd - EPS;
}

function isExtractorOf(bp: AiBlueprint): SpotKind | null {
  const c = bp.categoryNames;
  if (!c.includes('STRUCTURE')) return null;
  if (c.includes('HYDROCARBON')) return 'hydro';
  if (c.includes('MASSEXTRACTION')) return 'mass';
  return null;
}

/** Precomputed per-static placement data (extractor footprints). */
export interface PlacementContext {
  readonly static: AiStatic;
  readonly massFootprint: readonly [number, number];
  readonly hydroFootprint: readonly [number, number];
  knownCache?: readonly KnownStructure[];
  occupancy?: Uint8Array;
}

export function placementContext(s: AiStatic): PlacementContext {
  return {
    static: s,
    massFootprint: extractorFootprint(s.bps, 'mass'),
    hydroFootprint: extractorFootprint(s.bps, 'hydro'),
  };
}

function spotFootprint(ctx: PlacementContext, spot: Spot): readonly [number, number] {
  return spot.kind === 'mass' ? ctx.massFootprint : ctx.hydroFootprint;
}

/** True if a known structure overlaps the extractor footprint of `spot`. */
export function spotOccupiedKnown(ctx: PlacementContext, known: readonly KnownStructure[], spot: Spot): boolean {
  const [sw, sd] = spotFootprint(ctx, spot);
  const list = ctx.static.bps.list;
  for (let i = 0; i < known.length; i++) {
    const k = known[i]!;
    const kb = list[k.bp];
    if (kb === undefined) continue;
    if (overlaps(spot.x, spot.z, sw, sd, k.x, k.z, kb.footprint[0], kb.footprint[1])) return true;
  }
  return false;
}

/** Spots of `kind` not occupied by a known structure, in spot-index order. */
export function freeSpotsKnown(ctx: PlacementContext, known: readonly KnownStructure[], kind: SpotKind): Spot[] {
  const out: Spot[] = [];
  for (const sp of ctx.static.spots) {
    if (sp.kind === kind && !spotOccupiedKnown(ctx, known, sp)) out.push(sp);
  }
  return out;
}

/** Placement check with known occupancy only (see module doc). */
export function canPlaceKnown(
  ctx: PlacementContext,
  known: readonly KnownStructure[],
  bpIndex: number,
  x: number,
  z: number,
  rot: number,
): boolean {
  const s = ctx.static;
  const bp = s.bps.list[bpIndex];
  if (bp === undefined || !bp.isStructure) return false;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) return false;
  const [w, d] = footprintOf(bp, rot);
  if (s.placement !== undefined) {
    const grid = ctx.occupancy ??= new Uint8Array(s.map.sizeWu * s.map.sizeWu);
    if (ctx.knownCache !== known) {
      grid.fill(0);
      ctx.knownCache = known;
    for (const k of known) {
      const kb = s.bps.list[k.bp];
      if (kb === undefined) continue;
      const kw = kb.footprint[0], kh = kb.footprint[1];
      const x0 = footprintX(Math.round(k.x * 4096), kw), z0 = footprintX(Math.round(k.z * 4096), kh);
      for (let cz = Math.max(0, z0); cz < Math.min(s.map.sizeWu, z0 + kh); cz++)
        for (let cx = Math.max(0, x0); cx < Math.min(s.map.sizeWu, x0 + kw); cx++) grid[cz * s.map.sizeWu + cx] = 1;
    }
    }
    return canPlace({ ...s.placement, footprints: grid }, {
      x: Math.round(x * 4096), z: Math.round(z * 4096), w: bp.footprint[0], h: bp.footprint[1],
      yaw: rot * 16384, maxSlopeRaw: s.placement.maxSlopeRaw[bpIndex]!, spotKind: s.placement.spotKind[bpIndex]!,
    }) === PlacementVerdict.Valid;
  }
  const minX = x - w / 2;
  const maxX = x + w / 2;
  const minZ = z - d / 2;
  const maxZ = z + d / 2;
  const size = s.map.sizeWu;
  if (minX < -EPS || minZ < -EPS || maxX > size + EPS || maxZ > size + EPS) return false;

  const ext = isExtractorOf(bp);
  if (ext !== null) {
    let spot: Spot | null = null;
    for (const sp of s.spots) {
      if (sp.kind === ext && Math.abs(sp.x - x) <= SPOT_TOLERANCE_WU && Math.abs(sp.z - z) <= SPOT_TOLERANCE_WU) {
        spot = sp;
        break;
      }
    }
    if (spot === null || spotOccupiedKnown(ctx, known, spot)) return false;
  } else {
    const cell = s.passCellWu;
    const dim = s.passDim;
    const cx0 = Math.max(0, Math.floor(minX / cell + EPS));
    const cz0 = Math.max(0, Math.floor(minZ / cell + EPS));
    const cx1 = Math.min(dim - 1, Math.ceil(maxX / cell - EPS) - 1);
    const cz1 = Math.min(dim - 1, Math.ceil(maxZ / cell - EPS) - 1);
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cz * dim + cx;
        if (s.passLowRes[i] === 0) return false;
        const h = s.heightLowRes[i]!;
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
    if (hMax - hMin > MAX_HEIGHT_SPAN_WU) return false;
    for (const sp of s.spots) {
      const [sw, sd] = spotFootprint(ctx, sp);
      if (overlaps(x, z, w, d, sp.x, sp.z, sw, sd)) return false;
    }
  }
  const list = s.bps.list;
  for (let i = 0; i < known.length; i++) {
    const k = known[i]!;
    const kb = list[k.bp];
    if (kb === undefined) continue;
    if (overlaps(x, z, w, d, k.x, k.z, kb.footprint[0], kb.footprint[1])) return false;
  }
  return true;
}
