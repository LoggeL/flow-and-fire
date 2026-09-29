/**
 * SPK1 systems. Integer-only (Q20.12 raw values, products < 2^53), iteration in slot / dense
 * order, stateless rng32 — see world.ts for the scale and the layout.
 */
import { angDiff, angRotateTowards, asAng16, asFx, atan2A, cosA, FX_ONE, fxMul, isqrt, rng32, sinA } from '@faf/fixed';
import { HANDLE_NONE, ruleHash } from '@faf/heap';
import {
  AIR_ACCEL,
  AIR_CRUISE,
  AIR_HP,
  AIR_MIN_SPEED,
  AIR_PER_TEAM,
  AIR_RADIUS,
  AIR_TURN,
  Cat,
  COARSE_DIM,
  COARSE_SHIFT,
  DAMAGE,
  FINE_CELLS,
  FINE_DIM,
  FINE_SHIFT,
  frontTarget,
  FRONT_Z_MIN,
  GROUND_ACCEL,
  GROUND_HP,
  GROUND_PER_TEAM,
  GROUND_RADIUS,
  GROUND_SPEED,
  GROUND_TURN,
  HDR_HITS,
  HDR_KILLS,
  HDR_LAST_HASH,
  HDR_LAST_HASH_TICK,
  HDR_SHOTS,
  HDR_TICK,
  MAP_MAX,
  PROJ_LIVE_TARGET,
  PROJ_SPEED,
  PROJ_TTL,
  RANGE,
  RELOAD,
  SALT_AIR_CIRCLE,
  SALT_AIR_WP,
  SALT_RELOAD,
  SALT_SEP,
  SALT_SPAWN,
  SALT_SPREAD,
  SPAN_AIR,
  SPAN_GROUND,
  SPAWN_X,
  TEAMS,
  VISION_R_AIR,
  VISION_R_GROUND,
  type Grid,
  type Spk1World,
} from './world.ts';

/** Sub-system ids of the SPK1 probe (measurement order = execution order). */
export const Spk1Phase = {
  Movement: 0,
  Air: 1,
  Spatial: 2,
  Vision: 3,
  Targeting: 4,
  Weapons: 5,
  Projectiles: 6,
  Cleanup: 7,
  Hash: 8,
} as const;
export type Spk1Phase = (typeof Spk1Phase)[keyof typeof Spk1Phase];
export const SPK1_PHASE_NAMES: readonly string[] = ['Movement', 'Air', 'Spatial', 'Vision', 'Targeting', 'Weapons', 'Projectiles', 'Cleanup', 'Hash'];
export const SPK1_PHASE_COUNT = 9;

export interface Spk1Probe {
  begin(phase: number): void;
  end(phase: number): void;
}

const NO_PROBE: Spk1Probe = { begin() {}, end() {} };

export const HASH_INTERVAL = 10;
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
/** Hit test works on raw >> 4 (1/256 WU) so every product stays far below 2^53. */
const HIT_SHIFT = 4;
const PROJ_RADIUS = FX_ONE >> 2;
const HIT_R_GROUND = (GROUND_RADIUS + PROJ_RADIUS) >> HIT_SHIFT;
const HIT_R_AIR = (AIR_RADIUS + PROJ_RADIUS) >> HIT_SHIFT;
const ARRIVE = FX_ONE;
const AIR_ARRIVE2 = (6 * FX_ONE) * (6 * FX_ONE);
const SEP_MIN = 2 * GROUND_RADIUS;
const SEP_MAX_NEIGHBORS = 8;
/** Target priority (lower = better) [weapon category * 4 + target category]. */
const PRIO = new Int32Array([
  0, 1, 0, 9, // Light: light/AA first, then heavy; no air
  1, 0, 1, 9, // Heavy: heavy first
  1, 2, 1, 0, // AntiAir: air first
]);

const tmp2 = new Int32Array(2);

function clampCell(v: number, dim: number): number {
  return v < 0 ? 0 : v >= dim ? dim - 1 : v;
}

function clampPos(v: number): number {
  return v < 0 ? 0 : v > MAP_MAX ? MAP_MAX : v;
}

// ---- spawning -------------------------------------------------------------------------------

function initGround(w: Spk1World, i: number, team: number, cat: number, serial: number, initial: boolean): void {
  const c = w.ground.col;
  const seed = w.seed;
  const tick = w.tick;
  c.team[i] = team;
  c.cat[i] = cat;
  c.dead[i] = 0;
  c.hp[i] = GROUND_HP[cat as 0 | 1 | 2];
  c.tgt[i] = HANDLE_NONE;
  c.tgtLayer[i] = 0;
  c.cooldown[i] = RELOAD[cat as 0 | 1 | 2];
  c.visX[i] = -1;
  c.visZ[i] = -1;
  c.speed[i] = 0;
  c.yaw[i] = team === 0 ? 0 : 32768;
  const r = rng32(seed, tick, serial, SALT_SPAWN);
  if (initial) {
    frontTarget(seed, 0x7fffffff, serial, team, tmp2);
    c.x[i] = tmp2[0]!;
    c.z[i] = tmp2[1]!;
  } else {
    c.x[i] = SPAWN_X[team]! + ((r & 0xff) % 16) * FX_ONE;
    c.z[i] = FRONT_Z_MIN + ((r >>> 8) % 256) * FX_ONE;
  }
  c.px[i] = c.x[i]!;
  c.pz[i] = c.z[i]!;
  frontTarget(seed, tick, serial, team, tmp2);
  c.tx[i] = tmp2[0]!;
  c.tz[i] = tmp2[1]!;
}

function newWaypoint(w: Spk1World, i: number): void {
  const c = w.air.col;
  const r = rng32(w.seed, w.tick, i, SALT_AIR_WP);
  c.wx[i] = (32 + (r & 0xffff) % 448) * FX_ONE;
  c.wz[i] = (32 + (r >>> 16) % 448) * FX_ONE;
}

function initAir(w: Spk1World, i: number, team: number, serial: number): void {
  const c = w.air.col;
  const r = rng32(w.seed, w.tick, serial, SALT_SPAWN);
  c.team[i] = team;
  c.dead[i] = 0;
  c.hp[i] = AIR_HP;
  c.circle[i] = 0;
  c.yaw[i] = team === 0 ? 0 : 32768;
  c.speed[i] = AIR_MIN_SPEED;
  c.visX[i] = -1;
  c.visZ[i] = -1;
  c.x[i] = (team === 0 ? 24 : 488) * FX_ONE;
  c.z[i] = (96 + (r & 0xffff) % 320) * FX_ONE;
  c.px[i] = c.x[i]!;
  c.pz[i] = c.z[i]!;
  newWaypoint(w, i);
}

/** Initial state at tick 0: both armies in contact along the front, aircraft at their edges. */
export function populate(w: Spk1World): void {
  let serial = 0;
  for (let k = 0; k < GROUND_PER_TEAM * TEAMS; k++) {
    const i = w.ground.alloc();
    const m = (k >> 1) % 5;
    const cat = m === 4 ? Cat.AntiAir : m === 3 ? Cat.Heavy : Cat.Light;
    initGround(w, i, k & 1, cat, serial++, true);
  }
  for (let k = 0; k < AIR_PER_TEAM * TEAMS; k++) {
    const i = w.air.alloc();
    initAir(w, i, k & 1, serial++);
  }
}

// ---- movement -------------------------------------------------------------------------------

function moveGround(w: Spk1World): void {
  const G = w.ground;
  const c = G.col;
  const alive = G.alive;
  const hw = G.highWater;
  const seed = w.seed;
  const tick = w.tick;
  const { x, z, px, pz, tx, tz, yaw, speed, dead, team } = c;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const xi = x[i]!;
    const zi = z[i]!;
    px[i] = xi;
    pz[i] = zi;
    let dx = tx[i]! - xi;
    let dz = tz[i]! - zi;
    let dist = isqrt(dx * dx + dz * dz);
    if (dist <= ARRIVE) {
      frontTarget(seed, tick, i, team[i]!, tmp2);
      tx[i] = tmp2[0]!;
      tz[i] = tmp2[1]!;
      dx = tmp2[0]! - xi;
      dz = tmp2[1]! - zi;
      dist = isqrt(dx * dx + dz * dz);
    }
    const desired = atan2A(dz, dx);
    const y = angRotateTowards(asAng16(yaw[i]!), desired, GROUND_TURN);
    yaw[i] = y;
    const err = Math.abs(angDiff(y, desired));
    const maxV = err >= 16384 ? 0 : Math.floor((GROUND_SPEED * (16384 - err)) / 16384);
    let v = speed[i]!;
    v = v < maxV ? Math.min(v + GROUND_ACCEL, maxV) : Math.max(v - GROUND_ACCEL, maxV);
    speed[i] = v;
    const s = Math.min(v, dist);
    x[i] = clampPos(xi + fxMul(cosA(y), asFx(s)));
    z[i] = clampPos(zi + fxMul(sinA(y), asFx(s)));
  }
  separate(w);
}

/** Gauss-Seidel separation against the center grid of the previous tick (3×3 fine cells). */
function separate(w: Spk1World): void {
  const G = w.ground;
  const c = G.col;
  const alive = G.alive;
  const hw = G.highWater;
  const { x, z, dead } = c;
  const start = w.gCenter.start;
  const items = w.gCenter.items;
  const seed = w.seed;
  const tick = w.tick;
  const min2 = SEP_MIN * SEP_MIN;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const cx = clampCell(x[i]! >> FINE_SHIFT, FINE_DIM);
    const cz = clampCell(z[i]! >> FINE_SHIFT, FINE_DIM);
    let pushes = 0;
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(FINE_DIM - 1, cz + 1) && pushes < SEP_MAX_NEIGHBORS; gz++) {
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(FINE_DIM - 1, cx + 1) && pushes < SEP_MAX_NEIGHBORS; gx++) {
        const cell = gz * FINE_DIM + gx;
        for (let k = start[cell]!; k < start[cell + 1]! && pushes < SEP_MAX_NEIGHBORS; k++) {
          const j = items[k]!;
          if (j === i || alive[j] !== 1 || dead[j] !== 0) continue;
          const ddx = x[i]! - x[j]!;
          const ddz = z[i]! - z[j]!;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= min2) continue;
          const d = isqrt(d2);
          const push = (SEP_MIN - d) >> 1;
          if (d === 0) {
            const a = asAng16(rng32(seed, tick, i, SALT_SEP));
            x[i] = clampPos(x[i]! + fxMul(cosA(a), asFx(push)));
            z[i] = clampPos(z[i]! + fxMul(sinA(a), asFx(push)));
          } else {
            x[i] = clampPos(x[i]! + Math.trunc((ddx * push) / d));
            z[i] = clampPos(z[i]! + Math.trunc((ddz * push) / d));
          }
          pushes++;
        }
      }
    }
  }
}

/** Kinematic aircraft: minimum speed, turn rate, circling at waypoints. */
function moveAir(w: Spk1World): void {
  const A = w.air;
  const c = A.col;
  const alive = A.alive;
  const hw = A.highWater;
  const { x, z, px, pz, wx, wz, yaw, speed, circle, dead, team } = c;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const xi = x[i]!;
    const zi = z[i]!;
    px[i] = xi;
    pz[i] = zi;
    let y = asAng16(yaw[i]!);
    let want = AIR_CRUISE;
    if (circle[i]! > 0) {
      y = asAng16(team[i] === 0 ? y + AIR_TURN : y - AIR_TURN);
      const left = circle[i]! - 1;
      circle[i] = left;
      if (left === 0) newWaypoint(w, i);
    } else {
      const dx = wx[i]! - xi;
      const dz = wz[i]! - zi;
      if (dx * dx + dz * dz <= AIR_ARRIVE2) {
        circle[i] = 30 + (rng32(w.seed, w.tick, i, SALT_AIR_CIRCLE) % 40);
      }
      const desired = atan2A(dz, dx);
      y = angRotateTowards(y, desired, AIR_TURN);
      if (Math.abs(angDiff(y, desired)) > 8192) want = AIR_MIN_SPEED;
    }
    yaw[i] = y;
    let v = speed[i]!;
    v = v < want ? Math.min(v + AIR_ACCEL, want) : Math.max(v - AIR_ACCEL, want);
    if (v < AIR_MIN_SPEED) v = AIR_MIN_SPEED;
    speed[i] = v;
    const nx = xi + fxMul(cosA(y), asFx(v));
    const nz = zi + fxMul(sinA(y), asFx(v));
    const cxp = clampPos(nx);
    const czp = clampPos(nz);
    x[i] = cxp;
    z[i] = czp;
    if (cxp !== nx || czp !== nz) {
      // Hit the map edge: head back to the center.
      circle[i] = 0;
      wx[i] = MAP_MAX >> 1;
      wz[i] = MAP_MAX >> 1;
    }
  }
}

// ---- spatial rebuild (counting sort) --------------------------------------------------------

function sortCenter(g: Grid, shift: number, dim: number, hw: number, alive: Uint8Array, dead: Uint8Array, xs: Int32Array, zs: Int32Array, cursor: Int32Array): void {
  const start = g.start;
  const cells = g.cells;
  start.fill(0);
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const cell = clampCell(zs[i]! >> shift, dim) * dim + clampCell(xs[i]! >> shift, dim);
    start[cell + 1]!++;
  }
  for (let k = 0; k < cells; k++) {
    start[k + 1] = start[k + 1]! + start[k]!;
    cursor[k] = start[k]!;
  }
  const items = g.items;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const cell = clampCell(zs[i]! >> shift, dim) * dim + clampCell(xs[i]! >> shift, dim);
    items[cursor[cell]!++] = i;
  }
}

/** Fine grid with multi-insertion: every cell overlapped by the unit's bounding box. */
function sortFootprint(g: Grid, r: number, hw: number, alive: Uint8Array, dead: Uint8Array, xs: Int32Array, zs: Int32Array, cursor: Int32Array): void {
  const start = g.start;
  start.fill(0);
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      for (let k = 0; k < FINE_CELLS; k++) {
        start[k + 1] = start[k + 1]! + start[k]!;
        cursor[k] = start[k]!;
      }
    }
    for (let i = 0; i < hw; i++) {
      if (alive[i] !== 1 || dead[i] !== 0) continue;
      const x0 = clampCell((xs[i]! - r) >> FINE_SHIFT, FINE_DIM);
      const x1 = clampCell((xs[i]! + r) >> FINE_SHIFT, FINE_DIM);
      const z0 = clampCell((zs[i]! - r) >> FINE_SHIFT, FINE_DIM);
      const z1 = clampCell((zs[i]! + r) >> FINE_SHIFT, FINE_DIM);
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          const cell = gz * FINE_DIM + gx;
          if (pass === 0) start[cell + 1]!++;
          else g.items[cursor[cell]!++] = i;
        }
      }
    }
  }
}

function spatialRebuild(w: Spk1World): void {
  const G = w.ground;
  const gc = G.col;
  const A = w.air;
  const ac = A.col;
  const cur = w.cursor;
  sortCenter(w.gCenter, FINE_SHIFT, FINE_DIM, G.highWater, G.alive, gc.dead, gc.x, gc.z, cur);
  sortFootprint(w.gFine, GROUND_RADIUS, G.highWater, G.alive, gc.dead, gc.x, gc.z, cur);
  sortCenter(w.gCoarse, COARSE_SHIFT, COARSE_DIM, G.highWater, G.alive, gc.dead, gc.x, gc.z, cur);
  sortFootprint(w.aFine, AIR_RADIUS, A.highWater, A.alive, ac.dead, ac.x, ac.z, cur);
  sortCenter(w.aCoarse, COARSE_SHIFT, COARSE_DIM, A.highWater, A.alive, ac.dead, ac.x, ac.z, cur);
}

// ---- vision: row-span delta stamps ----------------------------------------------------------

function addRange(vis: Uint16Array, base: number, a: number, b: number, delta: number): void {
  for (let k = a; k <= b; k++) vis[base + k] = vis[base + k]! + delta;
}

/**
 * Moves a vision disc of radius `r` (row half-widths `span`) from (ox, oz) to (nx, nz) in the
 * team's refcount grid; ox < 0 = not stamped yet, nx < 0 = remove. Per row only the cells in the
 * symmetric difference of the old and the new span are touched.
 */
export function stampDelta(vis: Uint16Array, team: number, span: Int32Array, r: number, ox: number, oz: number, nx: number, nz: number): void {
  const hasOld = ox >= 0;
  const hasNew = nx >= 0;
  if (!hasOld && !hasNew) return;
  const lo = Math.max(0, Math.min(hasOld ? oz - r : SAFE_MAX, hasNew ? nz - r : SAFE_MAX));
  const hi = Math.min(FINE_DIM - 1, Math.max(hasOld ? oz + r : -1, hasNew ? nz + r : -1));
  const teamBase = team * FINE_CELLS;
  for (let row = lo; row <= hi; row++) {
    let a0 = 1;
    let b0 = 0;
    if (hasOld) {
      const dy = Math.abs(row - oz);
      if (dy <= r) {
        const h = span[dy]!;
        a0 = Math.max(0, ox - h);
        b0 = Math.min(FINE_DIM - 1, ox + h);
      }
    }
    let a1 = 1;
    let b1 = 0;
    if (hasNew) {
      const dy = Math.abs(row - nz);
      if (dy <= r) {
        const h = span[dy]!;
        a1 = Math.max(0, nx - h);
        b1 = Math.min(FINE_DIM - 1, nx + h);
      }
    }
    const base = teamBase + row * FINE_DIM;
    if (a0 <= b0) {
      if (a1 > b1) addRange(vis, base, a0, b0, -1);
      else {
        addRange(vis, base, a0, Math.min(b0, a1 - 1), -1);
        addRange(vis, base, Math.max(a0, b1 + 1), b0, -1);
      }
    }
    if (a1 <= b1) {
      if (a0 > b0) addRange(vis, base, a1, b1, 1);
      else {
        addRange(vis, base, a1, Math.min(b1, a0 - 1), 1);
        addRange(vis, base, Math.max(a1, b0 + 1), b1, 1);
      }
    }
  }
}

function visionLayer(vis: Uint16Array, hw: number, alive: Uint8Array, dead: Uint8Array, team: Uint8Array, xs: Int32Array, zs: Int32Array, vx: Int16Array, vz: Int16Array, span: Int32Array, r: number): void {
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || dead[i] !== 0) continue;
    const cx = clampCell(xs[i]! >> FINE_SHIFT, FINE_DIM);
    const cz = clampCell(zs[i]! >> FINE_SHIFT, FINE_DIM);
    if (cx === vx[i] && cz === vz[i]) continue;
    stampDelta(vis, team[i]!, span, r, vx[i]!, vz[i]!, cx, cz);
    vx[i] = cx;
    vz[i] = cz;
  }
}

function vision(w: Spk1World): void {
  const gc = w.ground.col;
  const ac = w.air.col;
  visionLayer(w.vision, w.ground.highWater, w.ground.alive, gc.dead, gc.team, gc.x, gc.z, gc.visX, gc.visZ, SPAN_GROUND, VISION_R_GROUND);
  visionLayer(w.vision, w.air.highWater, w.air.alive, ac.dead, ac.team, ac.x, ac.z, ac.visX, ac.visZ, SPAN_AIR, VISION_R_AIR);
}

/** True if (x, z) is visible to `team`. */
function visible(w: Spk1World, team: number, x: number, z: number): boolean {
  return w.vision[team * FINE_CELLS + clampCell(z >> FINE_SHIFT, FINE_DIM) * FINE_DIM + clampCell(x >> FINE_SHIFT, FINE_DIM)]! > 0;
}

// ---- targeting ------------------------------------------------------------------------------

let bestPrio = 0;
let bestD2 = 0;
let bestIdx = -1;
let bestLayer = 0;

function scanLayer(w: Spk1World, layer: number, wcat: number, team: number, xi: number, zi: number, range: number): void {
  const isAir = layer === 1;
  const g = isAir ? w.aCoarse : w.gCoarse;
  const tab = isAir ? w.air : w.ground;
  const xs = tab.col.x;
  const zs = tab.col.z;
  const teams = tab.col.team;
  const dead = tab.col.dead;
  const cats = isAir ? null : w.ground.col.cat;
  const r2 = range * range;
  const x0 = clampCell((xi - range) >> COARSE_SHIFT, COARSE_DIM);
  const x1 = clampCell((xi + range) >> COARSE_SHIFT, COARSE_DIM);
  const z0 = clampCell((zi - range) >> COARSE_SHIFT, COARSE_DIM);
  const z1 = clampCell((zi + range) >> COARSE_SHIFT, COARSE_DIM);
  const start = g.start;
  const items = g.items;
  for (let gz = z0; gz <= z1; gz++) {
    for (let gx = x0; gx <= x1; gx++) {
      const cell = gz * COARSE_DIM + gx;
      for (let k = start[cell]!; k < start[cell + 1]!; k++) {
        const j = items[k]!;
        if (teams[j] === team || dead[j] !== 0) continue;
        const dx = xs[j]! - xi;
        const dz = zs[j]! - zi;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const prio = PRIO[wcat * 4 + (cats === null ? Cat.Air : cats[j]!)]!;
        if (prio >= 9) continue;
        if (prio > bestPrio || (prio === bestPrio && d2 >= bestD2)) continue;
        if (!visible(w, team, xs[j]!, zs[j]!)) continue;
        bestPrio = prio;
        bestD2 = d2;
        bestIdx = j;
        bestLayer = layer;
      }
    }
  }
}

/** True if the current target still resolves, lives, is in range and visible. */
function targetValid(w: Spk1World, i: number): boolean {
  const c = w.ground.col;
  const h = c.tgt[i]!;
  if (h === HANDLE_NONE) return false;
  const isAir = c.tgtLayer[i] === 1;
  const tab = isAir ? w.air : w.ground;
  const j = tab.resolve(h);
  if (j < 0 || tab.col.dead[j] !== 0) return false;
  const dx = tab.col.x[j]! - c.x[i]!;
  const dz = tab.col.z[j]! - c.z[i]!;
  const range = RANGE[c.cat[i] as 0 | 1 | 2];
  if (dx * dx + dz * dz > range * range) return false;
  return visible(w, c.team[i]!, tab.col.x[j]!, tab.col.z[j]!);
}

function targeting(w: Spk1World): void {
  const G = w.ground;
  const c = G.col;
  const alive = G.alive;
  const hw = G.highWater;
  const phase = w.tick % 3;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || c.dead[i] !== 0) continue;
    const valid = targetValid(w, i);
    if (valid && i % 3 !== phase) continue;
    const wcat = c.cat[i]!;
    bestPrio = 9;
    bestD2 = SAFE_MAX;
    bestIdx = -1;
    bestLayer = 0;
    const range = RANGE[wcat as 0 | 1 | 2];
    if (wcat === Cat.AntiAir) scanLayer(w, 1, wcat, c.team[i]!, c.x[i]!, c.z[i]!, range);
    scanLayer(w, 0, wcat, c.team[i]!, c.x[i]!, c.z[i]!, range);
    if (bestIdx < 0) {
      c.tgt[i] = HANDLE_NONE;
    } else {
      c.tgt[i] = bestLayer === 1 ? w.air.handle(bestIdx) : G.handle(bestIdx);
      c.tgtLayer[i] = bestLayer;
    }
  }
}

// ---- weapons --------------------------------------------------------------------------------

function weapons(w: Spk1World): void {
  const G = w.ground;
  const c = G.col;
  const alive = G.alive;
  const hw = G.highWater;
  const P = w.proj;
  const pc = P.col;
  const seed = w.seed;
  const tick = w.tick;
  let shots = 0;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || c.dead[i] !== 0) continue;
    const cd = c.cooldown[i]!;
    if (cd > 0) {
      c.cooldown[i] = cd - 1;
      continue;
    }
    const h = c.tgt[i]!;
    if (h === HANDLE_NONE || P.count >= PROJ_LIVE_TARGET) continue;
    const isAir = c.tgtLayer[i] === 1;
    const tab = isAir ? w.air : w.ground;
    const j = tab.resolve(h);
    if (j < 0) continue;
    const tc = tab.col;
    const xi = c.x[i]!;
    const zi = c.z[i]!;
    const dx = tc.x[j]! - xi;
    const dz = tc.z[j]! - zi;
    // Lead: target velocity × flight time (whole ticks).
    const t = Math.floor(isqrt(dx * dx + dz * dz) / PROJ_SPEED);
    const ax = dx + (tc.x[j]! - tc.px[j]!) * t;
    const az = dz + (tc.z[j]! - tc.pz[j]!) * t;
    const spread = (rng32(seed, tick, i, SALT_SPREAD) & 511) - 256;
    const a = asAng16(atan2A(az, ax) + spread);
    const row = P.add(i);
    if (row < 0) continue;
    const cat = c.cat[i] as 0 | 1 | 2;
    pc.x[row] = xi;
    pc.z[row] = zi;
    pc.vx[row] = fxMul(cosA(a), asFx(PROJ_SPEED));
    pc.vz[row] = fxMul(sinA(a), asFx(PROJ_SPEED));
    pc.ttl[row] = PROJ_TTL;
    pc.team[row] = c.team[i]!;
    pc.layer[row] = isAir ? 1 : 0;
    pc.dmg[row] = DAMAGE[cat];
    c.cooldown[i] = RELOAD[cat] + (rng32(seed, tick, i, SALT_RELOAD) & 1);
    shots++;
  }
  w.hdr[HDR_SHOTS] = w.hdr[HDR_SHOTS]! + shots;
}

// ---- projectiles: swept segment, DDA over the fine footprint grid ---------------------------

/**
 * Tests the units registered in `cell` against the segment p0→p1 in each unit's own frame
 * (relative motion: p0 − unitPrev → p1 − unitCur). Returns the first hit unit or −1.
 */
function testCell(g: Grid, cell: number, team: number, x0: number, z0: number, x1: number, z1: number, xs: Int32Array, zs: Int32Array, pxs: Int32Array, pzs: Int32Array, teams: Uint8Array, dead: Uint8Array, hitR: number): number {
  const r2 = hitR * hitR;
  const start = g.start;
  const items = g.items;
  for (let k = start[cell]!; k < start[cell + 1]!; k++) {
    const j = items[k]!;
    if (teams[j] === team || dead[j] !== 0) continue;
    const ax = (x0 - pxs[j]!) >> HIT_SHIFT;
    const az = (z0 - pzs[j]!) >> HIT_SHIFT;
    const bx = (x1 - xs[j]!) >> HIT_SHIFT;
    const bz = (z1 - zs[j]!) >> HIT_SHIFT;
    const ddx = bx - ax;
    const ddz = bz - az;
    const den = ddx * ddx + ddz * ddz;
    const num = 0 - (ax * ddx + az * ddz);
    let hit: boolean;
    if (den === 0 || num <= 0) hit = ax * ax + az * az <= r2;
    else if (num >= den) hit = bx * bx + bz * bz <= r2;
    else hit = (ax * ax + az * az) * den - num * num <= r2 * den;
    if (hit) return j;
  }
  return -1;
}

/** Grid DDA (Amanatides–Woo with integer cross-multiplied comparisons) from p0 to p1. */
function sweep(w: Spk1World, air: boolean, team: number, x0: number, z0: number, x1: number, z1: number): number {
  const g = air ? w.aFine : w.gFine;
  const tc = air ? w.air.col : w.ground.col;
  const hitR = air ? HIT_R_AIR : HIT_R_GROUND;
  let cx = clampCell(x0 >> FINE_SHIFT, FINE_DIM);
  let cz = clampCell(z0 >> FINE_SHIFT, FINE_DIM);
  const ex = clampCell(x1 >> FINE_SHIFT, FINE_DIM);
  const ez = clampCell(z1 >> FINE_SHIFT, FINE_DIM);
  const sx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
  const sz = z1 > z0 ? 1 : z1 < z0 ? -1 : 0;
  const adx = Math.abs(x1 - x0);
  const adz = Math.abs(z1 - z0);
  let bx = sx > 0 ? (cx + 1) << FINE_SHIFT : cx << FINE_SHIFT;
  let bz = sz > 0 ? (cz + 1) << FINE_SHIFT : cz << FINE_SHIFT;
  const steps = Math.abs(ex - cx) + Math.abs(ez - cz);
  for (let n = 0; n <= steps; n++) {
    const hit = testCell(g, cz * FINE_DIM + cx, team, x0, z0, x1, z1, tc.x, tc.z, tc.px, tc.pz, tc.team, tc.dead, hitR);
    if (hit >= 0) return hit;
    if (cx === ex && cz === ez) break;
    const tX = sx === 0 ? SAFE_MAX : Math.abs(bx - x0) * adz;
    const tZ = sz === 0 ? SAFE_MAX : Math.abs(bz - z0) * adx;
    if (tX <= tZ && cx !== ex) {
      cx += sx;
      bx += sx << FINE_SHIFT;
    } else if (cz !== ez) {
      cz += sz;
      bz += sz << FINE_SHIFT;
    } else {
      cx += sx;
      bx += sx << FINE_SHIFT;
    }
  }
  return -1;
}

function projectiles(w: Spk1World): void {
  const P = w.proj;
  const pc = P.col;
  let hits = 0;
  let kills = 0;
  let r = 0;
  while (r < P.count) {
    const x0 = pc.x[r]!;
    const z0 = pc.z[r]!;
    const x1 = x0 + pc.vx[r]!;
    const z1 = z0 + pc.vz[r]!;
    const air = pc.layer[r] === 1;
    const j = sweep(w, air, pc.team[r]!, x0, z0, x1, z1);
    if (j >= 0) {
      const tc = air ? w.air.col : w.ground.col;
      const hp = tc.hp[j]! - pc.dmg[r]!;
      tc.hp[j] = hp;
      if (hp <= 0 && tc.dead[j] === 0) {
        tc.dead[j] = 1;
        kills++;
      }
      hits++;
      P.removeAt(r);
      continue;
    }
    const ttl = pc.ttl[r]! - 1;
    if (ttl <= 0 || x1 < 0 || z1 < 0 || x1 > MAP_MAX || z1 > MAP_MAX) {
      P.removeAt(r);
      continue;
    }
    pc.ttl[r] = ttl;
    pc.x[r] = x1;
    pc.z[r] = z1;
    r++;
  }
  w.hdr[HDR_HITS] = w.hdr[HDR_HITS]! + hits;
  w.hdr[HDR_KILLS] = w.hdr[HDR_KILLS]! + kills;
}

// ---- death + respawn ------------------------------------------------------------------------

function cleanup(w: Spk1World): void {
  const G = w.ground;
  const gc = G.col;
  const ghw = G.highWater;
  for (let i = 0; i < ghw; i++) {
    if (G.alive[i] !== 1 || gc.dead[i] === 0) continue;
    stampDelta(w.vision, gc.team[i]!, SPAN_GROUND, VISION_R_GROUND, gc.visX[i]!, gc.visZ[i]!, -1, -1);
    const team = gc.team[i]!;
    const cat = gc.cat[i]!;
    G.free(i);
    const j = G.alloc();
    if (j >= 0) initGround(w, j, team, cat, j, false);
  }
  const A = w.air;
  const ac = A.col;
  const ahw = A.highWater;
  for (let i = 0; i < ahw; i++) {
    if (A.alive[i] !== 1 || ac.dead[i] === 0) continue;
    stampDelta(w.vision, ac.team[i]!, SPAN_AIR, VISION_R_AIR, ac.visX[i]!, ac.visZ[i]!, -1, -1);
    const team = ac.team[i]!;
    A.free(i);
    const j = A.alloc();
    if (j >= 0) initAir(w, j, team, 0x10000 + j);
  }
}

// ---- tick -----------------------------------------------------------------------------------

/** One SPK1 tick. */
export function spk1Step(w: Spk1World, probe: Spk1Probe = NO_PROBE): void {
  const tick = w.hdr[HDR_TICK]! + 1;
  w.hdr[HDR_TICK] = tick;
  probe.begin(Spk1Phase.Movement);
  moveGround(w);
  probe.end(Spk1Phase.Movement);
  probe.begin(Spk1Phase.Air);
  moveAir(w);
  probe.end(Spk1Phase.Air);
  probe.begin(Spk1Phase.Spatial);
  spatialRebuild(w);
  probe.end(Spk1Phase.Spatial);
  probe.begin(Spk1Phase.Vision);
  vision(w);
  probe.end(Spk1Phase.Vision);
  probe.begin(Spk1Phase.Targeting);
  targeting(w);
  probe.end(Spk1Phase.Targeting);
  probe.begin(Spk1Phase.Weapons);
  weapons(w);
  probe.end(Spk1Phase.Weapons);
  probe.begin(Spk1Phase.Projectiles);
  projectiles(w);
  probe.end(Spk1Phase.Projectiles);
  probe.begin(Spk1Phase.Cleanup);
  cleanup(w);
  probe.end(Spk1Phase.Cleanup);
  if (tick % HASH_INTERVAL === 0) {
    probe.begin(Spk1Phase.Hash);
    const h = ruleHash(w.arena, w.hasher);
    probe.end(Spk1Phase.Hash);
    w.hdr[HDR_LAST_HASH_TICK] = tick;
    w.hdrU32[HDR_LAST_HASH] = h;
  }
}

/** Rule hash of the last hash tick. */
export function spk1LastHash(w: Spk1World): number {
  return w.hdrU32[HDR_LAST_HASH]!;
}

export function spk1LastHashTick(w: Spk1World): number {
  return w.hdr[HDR_LAST_HASH_TICK]!;
}

/** Live counters for reports. */
export interface Spk1Counts {
  readonly ground: number;
  readonly air: number;
  readonly projectiles: number;
  readonly shots: number;
  readonly hits: number;
  readonly kills: number;
}

export function spk1Counts(w: Spk1World): Spk1Counts {
  return {
    ground: w.ground.liveCount,
    air: w.air.liveCount,
    projectiles: w.proj.count,
    shots: w.hdr[HDR_SHOTS]!,
    hits: w.hdr[HDR_HITS]!,
    kills: w.hdr[HDR_KILLS]!,
  };
}

/** Sum of all vision refcounts of a team (tests: stamp/unstamp balance). */
export function visionSum(w: Spk1World, team: number): number {
  let s = 0;
  const base = team * FINE_CELLS;
  for (let k = 0; k < FINE_CELLS; k++) s += w.vision[base + k]!;
  return s;
}

/** Recomputes the vision refcounts from scratch (full stamps) into `out` (tests). */
export function visionFromScratch(w: Spk1World, out: Uint16Array): void {
  out.fill(0);
  const layers = [
    { t: w.ground, span: SPAN_GROUND, r: VISION_R_GROUND },
    { t: w.air, span: SPAN_AIR, r: VISION_R_AIR },
  ] as const;
  for (const { t, span, r } of layers) {
    const c = t.col;
    for (let i = 0; i < t.highWater; i++) {
      if (t.alive[i] !== 1 || c.dead[i] !== 0 || c.visX[i]! < 0) continue;
      stampDelta(out, c.team[i]!, span, r, -1, -1, c.visX[i]!, c.visZ[i]!);
    }
  }
}
