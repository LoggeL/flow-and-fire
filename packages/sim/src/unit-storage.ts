/**
 * Unit lifecycle: spawn (slot alloc + mover), kill (mark) and release (Cleanup phase).
 */
import { HANDLE_NONE } from '@faf/heap';
import { MoverState, NO_BEST_DIST, NO_REF, UnitBits, UnitState } from './constants.ts';
import { surfaceY, terrainHeight } from './terrain.ts';
import type { World } from './world.ts';

/**
 * Spawns a unit of blueprint `bp` for `army` at (x, z) with `yaw`, standing on the terrain
 * (y = surface height of its layer). Returns the slot or −1 if the unit table, the mover pool or
 * the army's unit cap is exhausted. Caller validates bp/army and the position (deep water).
 */
export function spawnUnit(w: World, bp: number, army: number, x: number, z: number, yaw: number): number {
  const A = w.armies.col;
  if (A.unitCount[army]! >= A.unitCap[army]!) return -1;
  const units = w.units;
  const idx = units.alloc();
  if (idx < 0) return -1;
  const row = w.movers.add(idx);
  if (row < 0) {
    units.free(idx);
    return -1;
  }
  const U = units.col;
  const t = w.bp;
  // alloc() zeroed the row; set every non-zero default explicitly.
  U.bp[idx] = bp;
  U.army[idx] = army;
  U.layer[idx] = t.layerCol[bp]!;
  U.state[idx] = UnitState.Idle;
  U.flags[idx] = UnitBits.NoInterp | UnitBits.Fresh;
  const y = surfaceY(w, t.layerCol[bp]!, terrainHeight(w, x, z));
  U.x[idx] = x;
  U.y[idx] = y;
  U.z[idx] = z;
  U.px[idx] = x;
  U.py[idx] = y;
  U.pz[idx] = z;
  U.yaw[idx] = yaw;
  U.pyaw[idx] = yaw;
  U.hp[idx] = t.maxHpCol[bp]!;
  U.lastHitBy[idx] = HANDLE_NONE;
  U.attackTarget[idx] = HANDLE_NONE;U.overchargeTarget[idx]=HANDLE_NONE;U.overchargeReadyTick[idx]=0; U.visibleMask[idx]=0; U.fireState[idx]=2;
  U.productionHead[idx]=-1;U.productionTail[idx]=-1;U.productionCount[idx]=0;U.factoryRepeat[idx]=0;U.productionActiveRepeat[idx]=1;
  U.rallyX[idx]=x;U.rallyZ[idx]=z;
  w.weapons.i32.fill(0,idx*80,(idx+1)*80);
  U.buildDone.set(idx, 65536);
  U.repairDone.set(idx,0);U.repairPaidMass.set(idx,0);U.repairPaidEnergy.set(idx,0);
  U.buildTarget[idx] = HANDLE_NONE;
  U.ecoRatio[idx] = 65536; U.ecoPriority[idx] = 1; U.ecoEnabled[idx] = 1;
  U.orderHead[idx] = NO_REF;
  U.orderTail[idx] = NO_REF;
  U.formation[idx] = NO_REF;
  U.groupOffset[idx] = NO_REF;
  U.mover[idx] = row;
  U.air[idx] = NO_REF;
  U.builder[idx] = NO_REF;
  U.factory[idx] = NO_REF;
  U.shield[idx] = NO_REF;
  U.intel[idx] = NO_REF;
  U.eco[idx] = NO_REF;
  // add() zeroed the row; set every non-zero default explicitly (and the rest for clarity).
  const M = w.movers.col;
  M.tx[row] = x;
  M.tz[row] = z;
  M.ax[row] = x;
  M.az[row] = z;
  M.wx[row] = x;
  M.wz[row] = z;
  M.speed[row] = 0;
  M.state[row] = MoverState.Idle;
  M.flags[row] = 0;
  M.best[row] = NO_BEST_DIST;
  M.stuck[row] = 0;
  M.streak[row] = 0;
  M.sbest[row] = NO_BEST_DIST;
  M.path[row] = NO_REF;
  M.wp[row] = 0;
  M.pgen[row] = 0;
  M.launch[row] = 0;
  M.nudge[row] = 0;
  M.ndx[row] = 0;
  M.ndz[row] = 0;
  M.pushTick[row] = 0;
  M.orders[row] = 0;
  A.unitCount[army] = A.unitCount[army]! + 1;
  return idx;
}

/**
 * Phase 15 Cleanup: releases every dead unit in ascending slot order (slot free → gen++,
 * FIFO reuse; mover swap-remove with back-pointer fix; army unit count).
 */
export function cleanupPhase(w: World): void {
  const units = w.units;
  const U = units.col;
  const flags = U.flags;
  const alive = units.alive;
  const hw = units.highWater;
  const A = w.armies.col;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || (flags[i]! & UnitBits.Dead) === 0) continue;
    const row = U.mover[i]!;
    if (row >= 0) {
      const moved = w.movers.removeAt(row);
      if (moved >= 0) U.mover[moved] = row;
      U.mover[i] = NO_REF;
    }
    if ((flags[i]! & UnitBits.Footprint) !== 0) {
      w.nav.stampFootprint(U.footX[i]!, U.footZ[i]!, U.footW[i]!, U.footH[i]!, -1);
      const E = w.footprintEvents.i32, n = E[0]!;
      if (n < 8192) { const o = 1+n*6; E[o]=U.footX[i]!; E[o+1]=U.footZ[i]!; E[o+2]=U.footW[i]!; E[o+3]=U.footH[i]!; E[o+4]=-1; E[o+5]=units.handle(i); E[0]=n+1; }
    }
    const army = U.army[i]!;
    A.unitCount[army] = A.unitCount[army]! - 1;
    let q=U.productionHead[i]!;while(q>=0){const next=w.factoryQueue.i32[q*2+1]!;w.factoryQueue.free(q);q=next;}
    units.free(i);
  }
}
