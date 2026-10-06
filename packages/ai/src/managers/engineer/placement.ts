/**
 * Placement of build orders (ai.md §4.2 selectors, §5.3 "Platzierung"):
 * candidate from the selector → `canPlace` → spiral search around the first blocked candidate
 * (radius ≤ 12 WU, 2-WU steps, ≤ 24 candidates, each 4 + ⌈footprint cells / 4⌉ ops) → next
 * template place. Only terrain, own objects and KNOWN enemy structures enter (`view.canPlace`,
 * R-08); places decided by other managers but not yet visible are kept in `BuildShared.planned`.
 *
 * Selectors: `slot:<name>` (baseTemplate; `slot:facN` continues on the generated 13-WU grid behind
 * the base; `slot:eco` = power ring r = 12 WU, 4 places per round, then r + 6, followed by places
 * next to own factories), `near:<slot>` (adjacent, clockwise from the side facing +f), `kranz`
 * (the 4 sides of the energy storage), `ring`, `mex:next`, `hydro:next` (spot score §5.1),
 * `spot:<index>` (a fixed spot) and a fixed world position (resume of a started site).
 */
import { canPlaceCost } from '../../budget.ts';
import { RING_MAX_WU } from '../../analysis/map-analysis.ts';
import type { TaskSite } from '../../taskboard.ts';
import type { AiBlueprint, SpotKind, Vec2 } from '../../types.ts';
import type { BuildShared, PlaceContext, PlannedSite } from './shared.ts';
import { pickSpot } from './spots.ts';

/** A resolved build place. */
export interface Placement {
  readonly x: number;
  readonly z: number;
  /** Site key (reservation / failure counting). */
  readonly key: string;
  /** Spot index for extractors, −1 otherwise. */
  readonly spot: number;
  /** Template slot this place stands for (`fac1`, `estore`, …), null otherwise. */
  readonly slot: string | null;
  readonly w: number;
  readonly d: number;
}

export type { PlaceContext } from './shared.ts';

export interface PlaceRequest {
  readonly selector: TaskSite;
  readonly bp: AiBlueprint;
  /** Position of the builder (spot score), null = own start. */
  readonly builder: Vec2 | null;
  readonly owner: string;
  readonly holder: number;
  /** Pre-reserved or fixed spot (opening ring steps, `spot:` tasks), −1 = none. */
  readonly spot?: number;
  /** Commander: mex selectors only pick ring spots (ai.md §5.5: the commander stays in the base). */
  readonly ringOnly?: boolean;
}

export type PlaceResult = Placement | null | 'budget';

/** Maximum eco-ring places tried for `slot:eco` (3 rounds of 8). */
export const ECO_RING_PLACES = 24;
/** Highest generated factory slot. */
export const MAX_FACTORY_SLOT = 23;
/** Spiral: radius ≤ 12 WU in 2-WU steps, 24 candidates. */
export const SPIRAL_MAX_RADIUS_WU = 12;

interface Offset {
  readonly dx: number;
  readonly dz: number;
}

/**
 * Spiral offsets: ring j = 1..6 at r = 2j WU; odd rings on the axes, even rings on the diagonals
 * (component 2·round(r / (2√2)) so every point stays on the 2-WU grid) — 24 candidates.
 */
export const SPIRAL: readonly Offset[] = (() => {
  const out: Offset[] = [];
  const root2 = Math.sqrt(2);
  for (let j = 1; j <= SPIRAL_MAX_RADIUS_WU / 2; j++) {
    const r = 2 * j;
    if (j % 2 === 1) {
      out.push({ dx: r, dz: 0 }, { dx: 0, dz: r }, { dx: -r, dz: 0 }, { dx: 0, dz: -r });
    } else {
      const c = 2 * Math.round(r / (2 * root2));
      out.push({ dx: c, dz: c }, { dx: -c, dz: c }, { dx: -c, dz: -c }, { dx: c, dz: -c });
    }
  }
  return out;
})();

/** Snaps a footprint centre so the footprint edge lies on the 2-WU grid. */
export function snapCentre(c: number, size: number): number {
  return 2 * Math.round((c - size / 2) / 2) + size / 2;
}

interface Candidate {
  readonly x: number;
  readonly z: number;
  readonly key: string;
  readonly slot: string | null;
}

/** World-axis side directions in clockwise order (x east, z south, seen from above). */
const SIDES: readonly Offset[] = [
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: -1 },
];

/**
 * Places of footprint w adjacent to a footprint F centred at (cx, cz): the four sides clockwise,
 * starting with the side facing +f; per round the side centre, then shifted by ±w, ±2w, … while
 * the edges still touch. `centresOnly` limits to the 4 side centres (Glutkranz).
 */
export function adjacentPlaces(
  cx: number,
  cz: number,
  size: number,
  w: number,
  forward: Vec2,
  keyPrefix: string,
  centresOnly: boolean,
): Candidate[] {
  let start = 0;
  let best = -Infinity;
  for (let i = 0; i < 4; i++) {
    const dot = SIDES[i]!.dx * forward.x + SIDES[i]!.dz * forward.z;
    if (dot > best + 1e-9) {
      best = dot;
      start = i;
    }
  }
  const d = size / 2 + w / 2;
  const shifts: number[] = [0];
  if (!centresOnly) {
    for (let k = 1; k * w < (size + w) / 2 - 1e-9; k++) shifts.push(k * w, -k * w);
  }
  const out: Candidate[] = [];
  let j = 0;
  for (const t of shifts) {
    for (let q = 0; q < 4; q++) {
      const s = SIDES[(start + q) % 4]!;
      // Along the side: the clockwise perpendicular of the side normal.
      const x = cx + s.dx * d - s.dz * t;
      const z = cz + s.dz * d + s.dx * t;
      out.push({ x, z, key: `${keyPrefix}:${j}`, slot: null });
      j++;
    }
  }
  return out;
}

function isExtractor(sh: BuildShared, bp: AiBlueprint): SpotKind | null {
  if (sh.flags.mex[bp.index] === 1) return 'mass';
  if (sh.flags.hydro[bp.index] === 1) return 'hydro';
  return null;
}

function overlaps(ax: number, az: number, aw: number, ad: number, bx: number, bz: number, bw: number, bd: number): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw - 1e-9 && Math.abs(az - bz) * 2 < ad + bd - 1e-9;
}

/** Position of a template slot, honouring places decided earlier (spiral-moved slots). */
export function slotPosition(pc: PlaceContext, name: string): Vec2 | null {
  const extra = pc.extraSlots?.get(name);
  if (extra !== undefined) return extra;
  const actual = pc.sh.slotActual.get(name);
  if (actual !== undefined) return actual;
  const m = /^fac(\d+)$/.exec(name);
  if (m !== null) return pc.sh.analysis.factorySlot(Number(m[1]));
  const s = pc.sh.analysis.slots[name];
  return s === undefined ? null : { x: s.x, z: s.z };
}

function slotFootprint(pc: PlaceContext, name: string): number {
  const t = pc.sh.doc.baseTemplate.slots[name];
  if (t !== undefined) return t.footprint;
  if (/^fac\d+$/.test(name)) return pc.sh.bp('fac_land', 1).footprint[0];
  return 2;
}

/** Own energy storage position (existing structure first, then the planned/template slot). */
export function estorePosition(pc: PlaceContext): Vec2 | null {
  const sh = pc.sh;
  for (const r of sh.bb.units.structures) if (sh.flags.estore[r.bp] === 1) return { x: r.x, z: r.z };
  return slotPosition(pc, 'estore');
}

/** Template candidates of a non-extractor selector (unsnapped). */
function templateCandidates(pc: PlaceContext, sel: string, bp: AiBlueprint): Candidate[] {
  const sh = pc.sh;
  const a = sh.analysis;
  const w = bp.footprint[0];
  if (sel === 'slot:eco') {
    const out: Candidate[] = [];
    for (let k = 0; k < ECO_RING_PLACES; k++) {
      const p = a.ecoRingSlot(k);
      out.push({ x: p.x, z: p.z, key: `eco:${k}`, slot: null });
    }
    // "an Fabriken" (ai.md §5.1 Platz: Kranz → eco-Ring → an Fabriken).
    const fw = sh.bp('fac_land', 1).footprint[0];
    for (const f of sh.bb.units.factories) {
      for (const c of adjacentPlaces(f.x, f.z, fw, w, a.forward, `nearh:${f.handle}`, false)) out.push(c);
    }
    return out;
  }
  if (sel.startsWith('slot:')) {
    const name = sel.slice(5);
    const m = /^fac(\d+)$/.exec(name);
    if (m !== null) {
      const out: Candidate[] = [];
      for (let n = Number(m[1]); n <= MAX_FACTORY_SLOT; n++) {
        const key = `slot:fac${n}`;
        const p = n === Number(m[1]) ? slotPosition(pc, `fac${n}`) : a.factorySlot(n);
        if (p !== null) out.push({ x: p.x, z: p.z, key, slot: `fac${n}` });
      }
      return out;
    }
    const p = slotPosition(pc, name);
    return p === null ? [] : [{ x: p.x, z: p.z, key: sel, slot: name }];
  }
  if (sel.startsWith('near:')) {
    const name = sel.slice(5);
    const p = slotPosition(pc, name);
    if (p === null) return [];
    return adjacentPlaces(p.x, p.z, slotFootprint(pc, name), w, a.forward, `near:${name}`, false);
  }
  if (sel === 'kranz') {
    const p = estorePosition(pc);
    if (p === null) return [];
    return adjacentPlaces(p.x, p.z, sh.bp('estore', 1).footprint[0], w, a.forward, 'kranz', true);
  }
  return [];
}

type Check = 'ok' | 'budget' | 'occupied' | 'blocked';

/** 'other' = reserved by another builder (skip), 'locked' = failure lock (spiral allowed), 'free'. */
function siteState(pc: PlaceContext, key: string, owner: string, holder: number): 'free' | 'other' | 'locked' {
  const res = pc.sh.bb.reservations;
  const r = res.siteReservation(key);
  if (r !== undefined && !(r.owner === owner && (r.holder === holder || r.holder === 0))) return 'other';
  return res.isSiteAvailable(key, pc.tick, owner) ? 'free' : 'locked';
}

/**
 * Conflict with places decided but not yet visible (committed plans and plans of the same step).
 * Every plan conflicts, also one of the same builder: a builder with several steps (commander
 * queue) must not get one place twice; re-using a started place goes through the resume path.
 */
function plannedConflict(pc: PlaceContext, x: number, z: number, w: number, d: number): 'none' | 'centre' | 'overlap' {
  let result: 'none' | 'centre' | 'overlap' = 'none';
  const test = (p: PlannedSite): void => {
    if (result === 'centre') return;
    if (Math.abs(p.x - x) <= 1 && Math.abs(p.z - z) <= 1) result = 'centre';
    else if (overlaps(x, z, w, d, p.x, p.z, p.w, p.d)) result = 'overlap';
  };
  for (const p of pc.sh.planned.values()) test(p);
  if (pc.extra !== undefined) for (const p of pc.extra) test(p);
  return result;
}

function checkCandidate(pc: PlaceContext, req: PlaceRequest, c: Candidate, w: number, d: number): Check {
  const sh = pc.sh;
  const state = siteState(pc, c.key, req.owner, req.holder);
  if (state === 'other') return 'occupied';
  if (state === 'locked') return 'blocked';
  if (sh.structureAt(c.x, c.z, () => true) !== null) return 'occupied';
  const pl = plannedConflict(pc, c.x, c.z, w, d);
  if (pl === 'centre') return 'occupied';
  if (pl === 'overlap') return 'blocked';
  for (const r of sh.rejected) if (overlaps(c.x, c.z, w, d, r.x, r.z, r.w, r.d)) return 'blocked';
  if (!pc.budget.take(canPlaceCost(w, d))) return 'budget';
  return pc.view.canPlace(req.bp.index, c.x, c.z, 0) ? 'ok' : 'blocked';
}

function placement(c: Candidate, w: number, d: number): Placement {
  return { x: c.x, z: c.z, key: c.key, spot: -1, slot: c.slot, w, d };
}

function spotPlacement(pc: PlaceContext, req: PlaceRequest, spot: number): PlaceResult {
  const sh = pc.sh;
  const sp = sh.static.spots[spot];
  if (sp === undefined) return null;
  const [w, d] = req.bp.footprint;
  const key = `spot:${spot}`;
  const res = sh.bb.reservations.spotReservation(spot);
  if (res !== undefined) {
    if (!(res.owner === req.owner && (res.holder === req.holder || res.holder === 0))) return null;
  } else if (!sh.bb.reservations.isSpotAvailable(spot, pc.tick)) return null;
  if (plannedConflict(pc, sp.x, sp.z, w, d) === 'centre') return null;
  if (!pc.budget.take(canPlaceCost(w, d))) return 'budget';
  if (!pc.view.canPlace(req.bp.index, sp.x, sp.z, 0)) return null;
  return { x: sp.x, z: sp.z, key, spot, slot: null, w, d };
}

/** Resolves a selector to a concrete place (see module doc). */
export function place(pc: PlaceContext, req: PlaceRequest): PlaceResult {
  const sh = pc.sh;
  const sel = req.selector;
  const [w, d] = req.bp.footprint;
  const ext = isExtractor(sh, req.bp);
  const builder = req.builder ?? sh.analysis.ownStart;

  // Fixed position: resume an own construction site of the same blueprint, else place there.
  if (sel !== null && typeof sel !== 'string') {
    const site = sh.structureAt(sel.x, sel.z, (r) => r.bp === req.bp.index && !r.complete);
    if (site !== null) {
      return { x: site.x, z: site.z, key: req.spot !== undefined && req.spot >= 0 ? `spot:${req.spot}` : posKeyOf(site.x, site.z), spot: req.spot ?? -1, slot: null, w, d };
    }
    if (ext !== null) {
      const spot = req.spot !== undefined && req.spot >= 0 ? req.spot : spotNear(sh, sel, ext);
      return spot < 0 ? null : spotPlacement(pc, req, spot);
    }
    return searchFrom(pc, req, [{ x: snapCentre(sel.x, w), z: snapCentre(sel.z, d), key: posKeyOf(sel.x, sel.z), slot: null }], w, d);
  }
  if (sel === null) return null;

  if (ext !== null) {
    if (req.spot !== undefined && req.spot >= 0) return spotPlacement(pc, req, req.spot);
    if (sel.startsWith('spot:')) return spotPlacement(pc, req, Number(sel.slice(5)));
    let ringOnly = req.ringOnly === true;
    if (sel === 'ring') ringOnly = true;
    else if (sel !== 'mex:next' && sel !== 'hydro:next') return null;
    let pick = pickSpot(pc, { kind: ext, builder, ringOnly, owner: req.owner, holder: req.holder });
    // ecosim: 'ring' without a free ring spot falls back to the best own spot.
    if (pick === null && sel === 'ring' && req.ringOnly !== true) {
      pick = pickSpot(pc, { kind: ext, builder, ringOnly: false, owner: req.owner, holder: req.holder });
    }
    if (pick === 'budget') return 'budget';
    if (pick === null) return null;
    return spotPlacement(pc, req, pick.spot);
  }

  const cands = templateCandidates(pc, sel, req.bp).map((c) => ({
    x: snapCentre(c.x, w),
    z: snapCentre(c.z, d),
    key: c.key,
    slot: c.slot,
  }));
  return searchFrom(pc, req, cands, w, d);
}

/** Exact template candidates in order; spiral around the first blocked one. */
function searchFrom(pc: PlaceContext, req: PlaceRequest, cands: readonly Candidate[], w: number, d: number): PlaceResult {
  let spiraled = false;
  for (const c of cands) {
    const r = checkCandidate(pc, req, c, w, d);
    if (r === 'ok') return placement(c, w, d);
    if (r === 'budget') return 'budget';
    if (r === 'blocked' && !spiraled) {
      spiraled = true;
      // Within a ring (same radius, 4 candidates) the side toward the builder first (tai-p5, AI-ENG-02:
      // the re-planned factory is ≤ 5 s late only if the builder does not walk around the wall).
      const order: number[] = [];
      const bld = req.builder ?? pc.sh.analysis.ownStart;
      for (let ring = 0; ring < SPIRAL.length; ring += 4) {
        const idx = [ring, ring + 1, ring + 2, ring + 3].filter((i) => i < SPIRAL.length);
        const d2 = (i: number): number => {
          const o = SPIRAL[i]!;
          const dx = c.x + o.dx - bld.x;
          const dz = c.z + o.dz - bld.z;
          return dx * dx + dz * dz;
        };
        idx.sort((a, b) => {
          const k = d2(a) - d2(b);
          return k !== 0 ? k : a - b;
        });
        order.push(...idx);
      }
      for (const i of order) {
        const o = SPIRAL[i]!;
        const sc: Candidate = { x: c.x + o.dx, z: c.z + o.dz, key: `${c.key}~${i}`, slot: c.slot };
        const s = checkCandidate(pc, req, sc, w, d);
        if (s === 'ok') return placement(sc, w, d);
        if (s === 'budget') return 'budget';
      }
    }
  }
  return null;
}

function spotNear(sh: BuildShared, p: Vec2, kind: SpotKind): number {
  for (const sp of sh.static.spots) {
    if (sp.kind === kind && Math.abs(sp.x - p.x) <= 1 && Math.abs(sp.z - p.z) <= 1) return sp.index;
  }
  return -1;
}

export function posKeyOf(x: number, z: number): string {
  return `pos:${Math.round(x)}:${Math.round(z)}`;
}

/** The planned-site record of a placement. */
export function plannedOf(p: Placement, bp: AiBlueprint, owner: string, holder: number, tick: number): PlannedSite {
  return { key: p.key, bp: bp.index, x: p.x, z: p.z, w: p.w, d: p.d, owner, holder, tick, spot: p.spot };
}

/** Commits a placement: reservation (site or spot), planned footprint, actual slot position. */
export function commitPlacement(sh: BuildShared, p: Placement, bp: AiBlueprint, owner: string, holder: number, tick: number): void {
  const res = sh.bb.reservations;
  if (p.spot >= 0) res.reserveSpot(p.spot, owner, tick, holder);
  else res.reserveSite(p.key, owner, tick, holder);
  sh.planned.set(p.key, plannedOf(p, bp, owner, holder, tick));
  if (p.slot !== null) sh.slotActual.set(p.slot, { x: p.x, z: p.z });
}

/**
 * Releases a placement. `lockUntilTick` ≥ 0 keeps it blocked (30 s after enemy contact, 60 s after
 * three failures).
 */
export function releasePlacement(sh: BuildShared, key: string | null, spot: number, holder: number, lockUntilTick = -1): void {
  if (key === null) return;
  const res = sh.bb.reservations;
  const pl = sh.planned.get(key);
  if (pl !== undefined && pl.holder === holder) sh.planned.delete(key);
  if (spot >= 0) {
    const r = res.spotReservation(spot);
    if (r === undefined || r.holder === holder || r.holder === 0) res.releaseSpot(spot, lockUntilTick);
    else if (lockUntilTick >= 0) res.lockSpot(spot, lockUntilTick);
  } else {
    const r = res.siteReservation(key);
    if (r === undefined || r.holder === holder || r.holder === 0) res.releaseSite(key, lockUntilTick);
  }
}

/** Ring spots (d_own ≤ 40 WU, zone own) in (d_own, index) order — `analysis.ringSpots`. */
export function ringSpots(sh: BuildShared): readonly number[] {
  return sh.analysis.ringSpots;
}

export { RING_MAX_WU };
