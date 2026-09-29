/**
 * Phase 1 CommandApply (PLAN §3.4): applies the staged commands of this tick in (army, seq)
 * order. Validation: army active, handle generation (stale handles are ignored), ownership
 * (a foreign army cannot command units), unit cap, payload shape. Unknown ops and malformed
 * payloads are dropped. Every command of an active army advances its lastAckSeq.
 *
 * MS1 ops: Move (replaces the order; the Queue flag is treated like replace until shift-queues
 * arrive with G7 in MS3), Stop, Cheat Spawn, Cheat Kill (cheats may target any army's units).
 */
import { angToDir, asAng16, asFx, fxMul, isqrt, rng32, rngRange } from '@faf/fixed';
import { CheatSub, MOVE_PAYLOAD_BYTES, CHEAT_KILL_PAYLOAD_BYTES, CHEAT_SPAWN_PAYLOAD_BYTES, Op } from '@faf/protocol';
import {
  MoverBits,
  MoverState,
  SALT_SPAWN_ANGLE,
  SALT_SPAWN_RADIUS,
  SALT_SPAWN_YAW,
  UnitBits,
  UnitState,
} from './constants.ts';
import { WH_SEED, WH_SPAWN_SERIAL, WH_TICK } from './schema.ts';
import { killUnit, spawnUnit } from './units.ts';
import type { World } from './world.ts';

/** Scratch for angToDir (module-level, reused). */
const DIR = new Int32Array(2);

function clampMap(w: World, v: number): number {
  return v < 0 ? 0 : v > w.mapMax ? w.mapMax : v;
}

/** Resolves a handle to a slot the given army may command, or −1. */
function ownedSlot(w: World, handle: number, army: number): number {
  const idx = w.units.resolve(handle);
  if (idx < 0) return -1;
  const U = w.units.col;
  if ((U.flags[idx]! & UnitBits.Dead) !== 0) return -1;
  return U.army[idx] === army ? idx : -1;
}

function applyMove(w: World, i: number): void {
  const s = w.stage;
  if (s.payLen[i] !== MOVE_PAYLOAD_BYTES) return;
  const dv = s.dv;
  const po = s.payStart[i]!;
  const tx = clampMap(w, dv.getInt32(po, true));
  const tz = clampMap(w, dv.getInt32(po + 8, true));
  const army = s.army[i]!;
  const U = w.units.col;
  const M = w.movers.col;
  const us = s.unitStart[i]!;
  const uc = s.unitCount[i]!;
  for (let k = 0; k < uc; k++) {
    const idx = ownedSlot(w, s.units[us + k]!, army);
    if (idx < 0) continue;
    const row = U.mover[idx]!;
    if (row < 0) continue;
    M.tx[row] = tx;
    M.tz[row] = tz;
    M.state[row] = MoverState.Moving;
    M.flags[row] = M.flags[row]! & ~MoverBits.Asleep;
    U.state[idx] = UnitState.Moving;
  }
}

function applyStop(w: World, i: number): void {
  const s = w.stage;
  const army = s.army[i]!;
  const U = w.units.col;
  const M = w.movers.col;
  const us = s.unitStart[i]!;
  const uc = s.unitCount[i]!;
  for (let k = 0; k < uc; k++) {
    const idx = ownedSlot(w, s.units[us + k]!, army);
    if (idx < 0) continue;
    const row = U.mover[idx]!;
    if (row >= 0) {
      M.state[row] = MoverState.Idle;
      M.tx[row] = U.x[idx]!;
      M.tz[row] = U.z[idx]!;
    }
    U.state[idx] = UnitState.Idle;
  }
}

function applyCheatSpawn(w: World, i: number, tick: number): void {
  const s = w.stage;
  const dv = s.dv;
  const po = s.payStart[i]!;
  const bp = dv.getUint16(po + 1, true);
  const army = dv.getUint8(po + 3);
  const count = dv.getUint16(po + 4, true);
  const cx = clampMap(w, dv.getInt32(po + 6, true));
  const cz = clampMap(w, dv.getInt32(po + 10, true));
  const spread = dv.getInt32(po + 14, true);
  if (bp >= w.bp.count || army >= w.armyCount || spread < 0) return;
  const h = w.header.i32;
  const seed = w.header.u32[WH_SEED]!;
  for (let n = 0; n < count; n++) {
    const serial = h[WH_SPAWN_SERIAL]!;
    h[WH_SPAWN_SERIAL] = (serial + 1) | 0;
    // Uniform point in the disc of radius `spread` around (cx, cz): angle from one draw,
    // radius = spread · sqrt(u) with u uniform in [0, 1] (as 16.16 fixed point).
    const ang = rng32(seed, tick, serial, SALT_SPAWN_ANGLE) & 0xffff;
    const u = rngRange(rng32(seed, tick, serial, SALT_SPAWN_RADIUS), 65537);
    const r = Math.floor((spread * isqrt(u * 65536)) / 65536);
    angToDir(asAng16(ang), DIR, 0);
    const x = clampMap(w, cx + fxMul(asFx(DIR[0]!), asFx(r)));
    const z = clampMap(w, cz + fxMul(asFx(DIR[1]!), asFx(r)));
    const yaw = rng32(seed, tick, serial, SALT_SPAWN_YAW) & 0xffff;
    if (spawnUnit(w, bp, army, x, z, yaw) < 0) return; // cap reached
  }
}

function applyCheatKill(w: World, i: number): void {
  const s = w.stage;
  const us = s.unitStart[i]!;
  const uc = s.unitCount[i]!;
  const U = w.units.col;
  for (let k = 0; k < uc; k++) {
    const idx = w.units.resolve(s.units[us + k]!);
    if (idx < 0 || (U.flags[idx]! & UnitBits.Dead) !== 0) continue;
    killUnit(w, idx);
  }
}

/** Applies the staged, sorted commands. */
export function commandApplyPhase(w: World): void {
  const s = w.stage;
  const n = s.count;
  if (n === 0) return;
  const ack = w.armies.col.lastAckSeq;
  s.sortByArmySeq(ack);
  const tick = w.header.i32[WH_TICK]!;
  const armyCount = w.armyCount;
  const order = s.order;
  for (let o = 0; o < n; o++) {
    const i = order[o]!;
    const army = s.army[i]!;
    if (army < 0 || army >= armyCount) continue;
    ack[army] = s.seq[i]!;
    switch (s.op[i]) {
      case Op.Move:
        applyMove(w, i);
        break;
      case Op.Stop:
        applyStop(w, i);
        break;
      case Op.Cheat: {
        const len = s.payLen[i]!;
        if (len < 1) break;
        const sub = s.payload[s.payStart[i]!]!;
        if (sub === CheatSub.Spawn && len === CHEAT_SPAWN_PAYLOAD_BYTES) applyCheatSpawn(w, i, tick);
        else if (sub === CheatSub.Kill && len === CHEAT_KILL_PAYLOAD_BYTES) applyCheatKill(w, i);
        break;
      }
      default:
        // Unknown or not-yet-implemented op: dropped (still acknowledged).
        break;
    }
  }
}
