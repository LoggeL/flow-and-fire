/**
 * Map analysis at `init` (ai.md §3): components, path distance fields from the own and the enemy
 * start, spot zones, mex order, rally and staging points, chokepoint, base axes and the rotated
 * base template. Budget: its own init frame (≤ 2 M ops, counted in `initOps`).
 *
 * Port of `analyze_map` in tools/ai-sim/ecosim.py (Dijkstra on the 2-WU grid, `node()` lookup,
 * q = d_own / (d_own + d_enemy): own < 0.40 ≤ contested ≤ 0.60 < enemy; unreachable = no path from
 * the own start). Adapter boundary: with nav (MS9) the fields come from the sector graph.
 */
import { cosA, deg, FX_ONE, sinA } from '@faf/fixed';
import { compareNumbers } from '../det.ts';
import type { OpeningsDoc } from '../openings.ts';
import type { AiStatic, Spot, SpotKind, Vec2 } from '../types.ts';
import { cellCenter, gridDijkstra, nearestPassableCell } from './grid.ts';

export type Zone = 'own' | 'contested' | 'enemy' | 'unreachable';

/** Zone thresholds on q = d_own / (d_own + d_enemy). */
export const ZONE_OWN_BELOW = 0.4;
export const ZONE_CONTESTED_MAX = 0.6;
/** Rally point: path distance from the own start towards the enemy (ai.md §3 point 4). */
export const RALLY_PATH_WU = 45;
/** Staging point: q on the shortest path. */
export const STAGING_Q = 0.4;
/** Ring mex: d_own ≤ 40 WU (ai.md §4.2). */
export const RING_MAX_WU = 40;
/** Init op frame (ai.md §3). */
export const INIT_OPS_LIMIT = 2_000_000;

export interface SpotInfo {
  readonly spot: Spot;
  readonly index: number;
  readonly kind: SpotKind;
  readonly x: number;
  readonly z: number;
  /** Grid cell used for the distance lookup (−1 = none within 5 cells). */
  readonly cell: number;
  readonly dOwn: number;
  readonly dEnemy: number;
  /** d_own / (d_own + d_enemy); NaN if unreachable. */
  readonly q: number;
  readonly zone: Zone;
}

export interface BaseSlotWorld {
  readonly name: string;
  readonly f: number;
  readonly s: number;
  readonly footprint: number;
  readonly x: number;
  readonly z: number;
}

export interface Chokepoint {
  readonly x: number;
  readonly z: number;
  /** Passable width across the path (WU). */
  readonly widthWu: number;
  /** q of the path cell. */
  readonly q: number;
}

export interface MapAnalysis {
  readonly army: number;
  readonly enemyArmy: number;
  readonly ownStart: Vec2;
  readonly enemyStart: Vec2;
  readonly dim: number;
  readonly cellWu: number;
  readonly ownCell: number;
  readonly enemyCell: number;
  readonly ownComponent: number;
  readonly dOwn: Float64Array;
  readonly dEnemy: Float64Array;
  /** By spot index. */
  readonly spots: readonly SpotInfo[];
  /** Reachable mass spots of the zones own + contested, by (d_own, index). */
  readonly mexOrder: readonly number[];
  /** Reachable hydro spots of the zones own + contested, by (d_own, index). */
  readonly hydroOrder: readonly number[];
  /** Mass spots with d_own ≤ 40 WU (zone own), by (d_own, index). */
  readonly ringSpots: readonly number[];
  /** Cells of the shortest path from the own start to the enemy start (both included). */
  readonly pathToEnemy: Int32Array;
  /** Path distance own start → enemy start (WU), Infinity if none. */
  readonly pathLengthWu: number;
  readonly euclidToEnemy: number;
  readonly rally: Vec2;
  /** Path distance rally → enemy start (WU). */
  readonly rallyToEnemyWu: number;
  readonly staging: Vec2;
  readonly chokepoint: Chokepoint | null;
  /** Unit vector towards the enemy start (air line). */
  readonly forward: Vec2;
  /** Unit vector perpendicular to `forward` (+s of the base template). */
  readonly side: Vec2;
  /** Base template slots in world coordinates. */
  readonly slots: Readonly<Record<string, BaseSlotWorld>>;
  readonly slotNames: readonly string[];
  /** Median of d_own / air line over own spots farther than 30 WU, at least straightLineDetour. */
  readonly detour: number;
  /** Ops of the analysis (Dijkstra expansions, spot lookups, chokepoint cells). */
  readonly initOps: number;
  /** Base-local (f, s) → world. */
  toWorld(f: number, s: number): Vec2;
  /** Nearest passable cell (ecosim node()), −1 if none. */
  cellAt(x: number, z: number): number;
  dOwnAt(x: number, z: number): number;
  dEnemyAt(x: number, z: number): number;
  zoneAt(x: number, z: number): Zone;
  /** k-th place of the `slot:eco` ring (ecosim: r = 12 + 6·⌊k/8⌋, 45° + 90°·(k mod 4) (+20° every other round)). */
  ecoRingSlot(k: number): Vec2;
  /** Factory slot `facN` from the template, or generated behind the base on a 13-WU grid (N ≥ 4). */
  factorySlot(n: number): Vec2;
}

function zoneOf(dOwn: number, dEnemy: number): { q: number; zone: Zone } {
  if (!Number.isFinite(dOwn)) return { q: NaN, zone: 'unreachable' };
  const q = dOwn / (dOwn + dEnemy);
  const zone: Zone = q < ZONE_OWN_BELOW ? 'own' : q <= ZONE_CONTESTED_MAX ? 'contested' : 'enemy';
  return { q, zone };
}

function median(values: number[]): number {
  const v = [...values].sort(compareNumbers);
  const n = v.length;
  if (n === 0) return NaN;
  const m = n >> 1;
  return n % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** Picks the enemy army: in 1v1 the other active army; otherwise the one with the smallest d_own. */
function pickEnemy(s: AiStatic, dOwnAtStart: (a: number) => number): number {
  let best = -1;
  let bestD = Infinity;
  for (const a of s.activeArmies) {
    if (a === s.army || s.alliedArmies?.includes(a)) continue;
    const d = dOwnAtStart(a);
    if (best < 0 || d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Runs the map analysis (ai.md §3). */
export function analyzeMap(s: AiStatic, doc: OpeningsDoc): MapAnalysis {
  const dim = s.passDim;
  const g = s.passCellWu;
  const pass = s.passLowRes;
  let ops = 0;
  const startIdx = s.armyStart[s.army];
  if (startIdx === undefined || startIdx < 0) throw new RangeError(`analyzeMap: army ${s.army} has no start`);
  const ownStart = s.starts[startIdx]!;
  const cellAt = (x: number, z: number): number => nearestPassableCell(pass, dim, g, x, z);
  const ownCell = cellAt(ownStart.x, ownStart.z);
  ops += 1;
  const own = gridDijkstra(pass, dim, g, ownCell);
  ops += own.expansions;
  const startOf = (a: number): Vec2 => s.starts[s.armyStart[a]!]!;
  const enemyArmy = pickEnemy(s, (a) => {
    const st = startOf(a);
    const c = cellAt(st.x, st.z);
    return c >= 0 ? own.dist[c]! : Infinity;
  });
  const enemyStart = enemyArmy >= 0 ? startOf(enemyArmy) : ownStart;
  const enemyCell = enemyArmy >= 0 ? cellAt(enemyStart.x, enemyStart.z) : -1;
  const enemy =
    enemyArmy >= 0
      ? gridDijkstra(pass, dim, g, enemyCell)
      : { dist: new Float64Array(dim * dim).fill(Infinity), pred: new Int32Array(dim * dim).fill(-1), expansions: 0 };
  ops += enemy.expansions;
  const dOwn = own.dist;
  const dEnemy = enemy.dist;

  // Spots and zones.
  const spots: SpotInfo[] = s.spots.map((sp) => {
    const cell = cellAt(sp.x, sp.z);
    ops += 1;
    const dO = cell >= 0 ? dOwn[cell]! : Infinity;
    const dE = cell >= 0 ? dEnemy[cell]! : Infinity;
    const { q, zone } = zoneOf(dO, dE);
    return { spot: sp, index: sp.index, kind: sp.kind, x: sp.x, z: sp.z, cell, dOwn: dO, dEnemy: dE, q, zone };
  });
  const orderOf = (kind: SpotKind, pred: (si: SpotInfo) => boolean): number[] =>
    spots
      .filter((si) => si.kind === kind && pred(si))
      .sort((a, b) => compareNumbers(a.dOwn, b.dOwn) || a.index - b.index)
      .map((si) => si.index);
  const mexOrder = orderOf('mass', (si) => si.zone === 'own' || si.zone === 'contested');
  const hydroOrder = orderOf('hydro', (si) => si.zone === 'own' || si.zone === 'contested');
  const ringSpots = orderOf('mass', (si) => si.zone === 'own' && si.dOwn <= RING_MAX_WU);

  // Axes (air line towards the enemy start).
  const fx0 = enemyStart.x - ownStart.x;
  const fz0 = enemyStart.z - ownStart.z;
  const euclid = Math.sqrt(fx0 * fx0 + fz0 * fz0);
  const forward: Vec2 = euclid > 0 ? { x: fx0 / euclid, z: fz0 / euclid } : { x: 1, z: 0 };
  const side: Vec2 = { x: -forward.z, z: forward.x };
  const toWorld = (f: number, sv: number): Vec2 => ({
    x: ownStart.x + forward.x * f - forward.z * sv,
    z: ownStart.z + forward.z * f + forward.x * sv,
  });

  // Shortest path own → enemy via the predecessors of the enemy field.
  const path: number[] = [];
  const pathLengthWu = ownCell >= 0 && enemyCell >= 0 ? dEnemy[ownCell]! : Infinity;
  if (Number.isFinite(pathLengthWu)) {
    let c = ownCell;
    while (c >= 0) {
      path.push(c);
      ops += 1;
      if (c === enemyCell) break;
      c = enemy.pred[c]!;
    }
  }
  const pathToEnemy = Int32Array.from(path);
  let rally: Vec2 = toWorld(RALLY_PATH_WU, 0);
  let rallyToEnemyWu = Math.max(0, pathLengthWu - RALLY_PATH_WU);
  let staging: Vec2 = toWorld(0.4 * euclid, 0);
  let rallySet = false;
  let stagingSet = false;
  for (const c of path) {
    const along = pathLengthWu - dEnemy[c]!;
    if (!rallySet && along >= RALLY_PATH_WU) {
      rally = cellCenter(c, dim, g);
      rallyToEnemyWu = dEnemy[c]!;
      rallySet = true;
    }
    if (!stagingSet) {
      const q = dOwn[c]! / (dOwn[c]! + dEnemy[c]!);
      if (q >= STAGING_Q) {
        staging = cellCenter(c, dim, g);
        stagingSet = true;
      }
    }
    if (rallySet && stagingSet) break;
  }

  // Chokepoint: minimal passable width across the path (middle section 0.15 ≤ q ≤ 0.85).
  let chokepoint: Chokepoint | null = null;
  const LOOK = 3;
  const MAX_HALF = 160;
  const passAt = (x: number, z: number): boolean => {
    if (x < 0 || z < 0) return false;
    const cx = Math.floor(x / g);
    const cz = Math.floor(z / g);
    if (cx >= dim || cz >= dim) return false;
    return pass[cz * dim + cx] === 1;
  };
  for (let i = LOOK; i + LOOK < path.length; i += 2) {
    const c = path[i]!;
    const q = dOwn[c]! / (dOwn[c]! + dEnemy[c]!);
    if (q < 0.15 || q > 0.85) continue;
    const a = cellCenter(path[i - LOOK]!, dim, g);
    const b = cellCenter(path[i + LOOK]!, dim, g);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) continue;
    const px = -dz / len;
    const pz = dx / len;
    const p = cellCenter(c, dim, g);
    let left = 0;
    while (left < MAX_HALF && passAt(p.x + px * (left + 1), p.z + pz * (left + 1))) left++;
    let right = 0;
    while (right < MAX_HALF && passAt(p.x - px * (right + 1), p.z - pz * (right + 1))) right++;
    ops += left + right + 2;
    const width = left + right + 1;
    if (chokepoint === null || width < chokepoint.widthWu) chokepoint = { x: p.x, z: p.z, widthWu: width, q };
  }

  // Detour median (ecosim: own-zone spots farther than 30 WU).
  const ratios: number[] = [];
  for (const si of spots) {
    if (si.zone !== 'own') continue;
    const dx = si.x - ownStart.x;
    const dz = si.z - ownStart.z;
    const eu = Math.sqrt(dx * dx + dz * dz);
    if (eu > 30) ratios.push(si.dOwn / eu);
  }
  const med = median(ratios);
  const detour = Math.max(doc.assumptions.straightLineDetour, Number.isNaN(med) ? doc.assumptions.straightLineDetour : med);

  // Base template.
  const slots: Record<string, BaseSlotWorld> = {};
  for (const name of doc.baseTemplate.slotNames) {
    const t = doc.baseTemplate.slots[name]!;
    const w = toWorld(t.f, t.s);
    slots[name] = { name, f: t.f, s: t.s, footprint: t.footprint, x: w.x, z: w.z };
  }

  const at = (field: Float64Array, x: number, z: number): number => {
    const c = cellAt(x, z);
    return c >= 0 ? field[c]! : Infinity;
  };

  return {
    army: s.army,
    enemyArmy,
    ownStart,
    enemyStart,
    dim,
    cellWu: g,
    ownCell,
    enemyCell,
    ownComponent: ownCell >= 0 ? s.components[ownCell]! : -1,
    dOwn,
    dEnemy,
    spots,
    mexOrder,
    hydroOrder,
    ringSpots,
    pathToEnemy,
    pathLengthWu,
    euclidToEnemy: euclid,
    rally,
    rallyToEnemyWu,
    staging,
    chokepoint,
    forward,
    side,
    slots,
    slotNames: doc.baseTemplate.slotNames,
    detour,
    initOps: ops,
    toWorld,
    cellAt,
    dOwnAt: (x, z) => at(dOwn, x, z),
    dEnemyAt: (x, z) => at(dEnemy, x, z),
    zoneAt: (x, z) => {
      const c = cellAt(x, z);
      return c < 0 ? 'unreachable' : zoneOf(dOwn[c]!, dEnemy[c]!).zone;
    },
    ecoRingSlot: (k: number) => {
      const r = 12 + 6 * Math.floor(k / 8);
      const ang = deg(45 + 90 * (k % 4) + (Math.floor(k / 4) % 2 === 1 ? 20 : 0));
      return toWorld((r * cosA(ang)) / FX_ONE, (r * sinA(ang)) / FX_ONE);
    },
    factorySlot: (n: number) => {
      const t = slots[`fac${n}`];
      if (t !== undefined) return { x: t.x, z: t.z };
      return toWorld(-4 - 13 * Math.floor((n - 2) / 2), n % 2 === 1 ? 13 : -13);
    },
  };
}
