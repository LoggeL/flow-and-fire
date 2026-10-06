/**
 * Target choice of the PlatoonManager (ai.md §5.5):
 *
 *   score = Wert / (1 + T_surface auf dem Pfad) / (1 + d / 200)
 *
 * Values (UnitClasses.value): mex 100 + tech × 100, engineer 60, power 40, factory 80, point defense
 * −50 (+100 while the platoon has ≥ 25 % artillery by mass), enemy commander 300 only at R_ziel ≥ 2.
 * Candidates: known enemy structures (visible or ghost), visible enemy engineers and commanders,
 * and the enemy start as fallback base target (value 100, only while no known structure stands
 * within 60 WU of it — documented addition so a wave always has a destination).
 *
 * T_surface on the path = maximum of `bb.threat.threatAt('surface')` sampled every 16 WU on the
 * straight line from the platoon to the target (documented: the maximum instead of a sum, because
 * one unit's threat covers many samples). Only the 8 best candidates by value / (1 + d/200) are
 * sampled (ops: 1 per candidate + 1 per sample).
 */
import type { ManagerContext } from '../../brain.ts';
import { compareNumbers, dist } from '../../det.ts';
import type { Vec2 } from '../../types.ts';
import { UC, type UnitClasses } from '../intel/unit-classes.ts';
import type { Scene } from './scene.ts';

export const TARGET_DISTANCE_SCALE = 200;
export const PATH_SAMPLE_WU = 16;
export const TARGET_TOP_N = 8;
export const ENEMY_START_VALUE = 100;
export const ENEMY_START_CLEAR_WU = 60;
/** Value of a point defense while the platoon has ≥ 25 % artillery. */
export const PD_VALUE_WITH_ARTY = 100;
export const ARTY_SHARE_FOR_PD = 0.25;
/** The enemy commander is a target only at R_ziel ≥ 2. */
export const COMMANDER_TARGET_RATIO = 2;

export interface TargetCandidate {
  /** Enemy id, 0 for the enemy-start fallback. */
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly value: number;
  readonly commander: boolean;
  /** Filled by `evaluateTargets`. */
  ratio: number;
  pathThreat: number;
  score: number;
}

/** Collects candidates (value > 0 after the artillery rule; the commander is kept, value 300). */
export function collectCandidates(ctx: ManagerContext, classes: UnitClasses, artyShare: number): TargetCandidate[] | null {
  const bb = ctx.bb;
  const out: TargetCandidate[] = [];
  const structs = bb.enemy.structures;
  const cur = bb.enemy.current;
  if (!ctx.budget.take(structs.length + cur.length)) return null;
  const es = ctx.analysis.enemyStart;
  let baseKnown = false;
  const clear2 = ENEMY_START_CLEAR_WU * ENEMY_START_CLEAR_WU;
  for (const s of structs) {
    if (s.bp < 0) continue;
    let v = classes.value[s.bp]!;
    if (classes.has(s.bp, UC.pd) && artyShare >= ARTY_SHARE_FOR_PD) v = PD_VALUE_WITH_ARTY;
    const dx = s.x - es.x;
    const dz = s.z - es.z;
    if (dx * dx + dz * dz <= clear2) baseKnown = true;
    if (v <= 0) continue;
    out.push({ id: s.id, x: s.x, z: s.z, value: v, commander: false, ratio: 0, pathThreat: 0, score: 0 });
  }
  for (const c of cur) {
    if (c.kind !== 'visible' || c.bp < 0) continue;
    if (classes.has(c.bp, UC.engineer)) {
      out.push({ id: c.id, x: c.x, z: c.z, value: classes.value[c.bp]!, commander: false, ratio: 0, pathThreat: 0, score: 0 });
    } else if (classes.has(c.bp, UC.commander)) {
      out.push({ id: c.id, x: c.x, z: c.z, value: classes.value[c.bp]!, commander: true, ratio: 0, pathThreat: 0, score: 0 });
    }
  }
  if (!baseKnown) out.push({ id: 0, x: es.x, z: es.z, value: ENEMY_START_VALUE, commander: false, ratio: 0, pathThreat: 0, score: 0 });
  return out;
}

/** Max T_surface along the straight line (samples every 16 WU, both ends included). */
export function pathThreat(ctx: ManagerContext, ax: number, az: number, bx: number, bz: number): number | null {
  const d = dist(ax, az, bx, bz);
  const n = Math.max(1, Math.ceil(d / PATH_SAMPLE_WU));
  if (!ctx.budget.take(n + 1)) return null;
  let m = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = ctx.bb.threat.threatAt('surface', ax + (bx - ax) * t, az + (bz - az) * t);
    if (v > m) m = v;
  }
  return m;
}

/**
 * Scores candidates from `from` for a platoon with threat `ownThreat` and strength radius r:
 * R_ziel = ownThreat / max(1, Σ enemy threat within r of the target), path threat and score for the
 * top N by value / (1 + d/200). Returns them sorted by score (desc; tie id), commander only at R ≥ 2.
 * Null if the budget is exhausted.
 */
export function evaluateTargets(
  scene: Scene,
  cands: TargetCandidate[],
  from: Vec2,
  ownThreat: number,
  r: number,
): TargetCandidate[] | null {
  const ctx = scene.ctx;
  const pre = cands.map((c) => ({ c, v: c.value / (1 + dist(from.x, from.z, c.x, c.z) / TARGET_DISTANCE_SCALE) }));
  pre.sort((a, b) => {
    const k = compareNumbers(b.v, a.v);
    return k !== 0 ? k : a.c.id - b.c.id;
  });
  const top = pre.slice(0, TARGET_TOP_N).map((p) => p.c);
  const out: TargetCandidate[] = [];
  for (const c of top) {
    const e = scene.enemyNear(c.x, c.z, r);
    if (e === null) return null;
    c.ratio = ownThreat / Math.max(1, e);
    if (c.commander && c.ratio < COMMANDER_TARGET_RATIO) continue;
    const p = pathThreat(ctx, from.x, from.z, c.x, c.z);
    if (p === null) return null;
    c.pathThreat = p;
    c.score = c.value / (1 + p) / (1 + dist(from.x, from.z, c.x, c.z) / TARGET_DISTANCE_SCALE);
    out.push(c);
  }
  out.sort((a, b) => {
    const k = compareNumbers(b.score, a.score);
    return k !== 0 ? k : a.id - b.id;
  });
  return out;
}

/** True if (x, z) lies in the enemy half (q = d_own / (d_own + d_enemy) > 0.5; air line as fallback). */
export function inEnemyHalf(ctx: ManagerContext, x: number, z: number): boolean {
  const a = ctx.analysis;
  const dOwn = a.dOwnAt(x, z);
  const dEnemy = a.dEnemyAt(x, z);
  if (Number.isFinite(dOwn) && Number.isFinite(dEnemy)) return dOwn > dEnemy;
  return dist(x, z, a.enemyStart.x, a.enemyStart.z) < dist(x, z, a.ownStart.x, a.ownStart.z);
}
