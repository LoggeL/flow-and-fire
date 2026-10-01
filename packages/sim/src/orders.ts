/**
 * G7 order queue (PLAN §3.4 phase 2 "Orders", §3.5 "OrderPool"): 32-byte order records linked
 * per unit (Units.orderHead → … → orderTail, Movers.orders = count), group records (Formations,
 * one per Move command / queue entry) that own the single path request of a group, the path
 * ownership table and the Orders phase with its OrderBehaviors {begin, tick, complete} for Move
 * and Stop, including the stuck chain (1. repath, 2. side-step / nearest reachable point,
 * 3. give up) and slot assignment for group moves (offset preservation, PLAN §3.8 "Gruppen").
 *
 * Everything is integer math on arena state; no allocation.
 */
import { clearUpgradeWork, upgradeTarget } from './upgrade.ts';
import { resolveWreck } from './reclaim.ts';
import { visibleTo, allied } from './intel.ts';
import { isActive } from './liveness.ts';
import { HANDLE_NONE } from '@faf/heap';
import { buildSite, placementVerdict, startBuildSite } from './economy.ts';
import { angToDir, asAng16 } from '@faf/fixed';
import { NAV_COMP_OVERFLOW, navClassOf, PATH_F_RETARGETED, spiralSearch, SPIRAL_LABEL, SPIRAL_PASSABLE } from '@faf/nav';
import {
  FormationState,
  MAX_ORDERS_PER_UNIT,
  MOVE_LAUNCH_TICKS,
  MoverBits,
  MoverState,
  NO_BEST_DIST,
  NO_REF,
  OFFSET_QUANT_SHIFT,
  OrderBits,
  SIDESTEP_DISTANCE,
  SLOT_SEARCH_MAX_RADIUS,
  UnitBits,
  UnitState,
} from './constants.ts';
import {
  ORD_FORMATION,
  ORD_NEXT,
  ORD_OFFSET,
  ORD_PATH,
  ORD_TICK,
  ORD_TX,
  ORD_TYPE_FLAGS,
  ORD_TZ,
  ORDER_RECORD_WORDS,
  PATH_OWNER_NONE,
  WH_ORDERS_DROPPED,
  WH_REQUESTS_FAILED,
  WH_STUCK_GIVEUPS,
  WH_TICK,
} from './schema.ts';
import { navCellOf } from './terrain.ts';
import type { World } from './world.ts';

// ---- small helpers ------------------------------------------------------------------------------

/** Nav class of a unit (PLAN §3.8, rule of @faf/nav: size class 0 → 1, > 3 → 3). */
export function unitClass(w: World, u: number): number {
  return navClassOf(w.bp.sizeClassCol[w.units.col.bp[u]!]!);
}

/** Packs an offset (Fx) into the 32-bit group-offset word (1/16 WU per axis, i16, clamped). */
export function packOffset(ox: number, oz: number): number {
  // Round to 1/16 WU (arithmetic shift = floor division, stays an int32: no boxing in cold code).
  let qx = (ox + 128) >> 8;
  let qz = (oz + 128) >> 8;
  qx = qx < -32767 ? -32767 : qx > 32767 ? 32767 : qx;
  qz = qz < -32767 ? -32767 : qz > 32767 ? 32767 : qz;
  return (qx & 0xffff) | (qz << 16);
}

/** x component (Fx) of a packed offset. */
export function offsetX(packed: number): number {
  return ((packed << 16) >> 16) << OFFSET_QUANT_SHIFT;
}

/** z component (Fx) of a packed offset. */
export function offsetZ(packed: number): number {
  return (packed >> 16) << OFFSET_QUANT_SHIFT;
}

function clampMap(w: World, v: number): number {
  return v < 0 ? 0 : v > w.mapMax ? w.mapMax : v;
}

// ---- paths ------------------------------------------------------------------------------------

/**
 * Issues a path request for owner `owner` (formation f ≥ 0 or −2 − unit slot) and registers the
 * owner; returns the path id or −1 (path table full; counted).
 */
export function requestPath(w: World, owner: number, entity: number, cls: number, sx: number, sz: number, tx: number, tz: number): number {
  const p = w.nav.request(entity, w.header.i32[WH_TICK]!, cls, sx, sz, tx, tz);
  if (p < 0) {
    const h = w.header.i32;
    h[WH_REQUESTS_FAILED] = (h[WH_REQUESTS_FAILED]! + 1) | 0;
    return -1;
  }
  w.pathOwner[p] = owner;
  return p;
}

/** Releases a path slot and its owner entry. */
export function releasePath(w: World, p: number): void {
  if (p < 0) return;
  w.nav.release(p);
  w.pathOwner[p] = PATH_OWNER_NONE;
}

// ---- formations -------------------------------------------------------------------------------

/** Drops one order reference of formation f; frees it (and its path) at 0. */
export function releaseFormationRef(w: World, f: number): void {
  if (f < 0 || !w.formations.isLive(f)) return;
  const F = w.formations.col;
  const refs = F.refs[f]! - 1;
  F.refs[f] = refs;
  if (refs > 0) return;
  releasePath(w, F.path[f]!);
  F.path[f] = NO_REF;
  w.formations.free(f);
}

// ---- order records ------------------------------------------------------------------------------

/**
 * Appends an order to unit u's queue. Returns false (and counts WH_ORDERS_DROPPED) if the unit's
 * queue holds MAX_ORDERS_PER_UNIT orders or the pool is full.
 */
export function pushOrder(w: World, u: number, r: number, type: number, tx: number, tz: number, f: number, offset: number): boolean {
  const M = w.movers.col;
  const h = w.header.i32;
  if (M.orders[r]! >= MAX_ORDERS_PER_UNIT) {
    h[WH_ORDERS_DROPPED] = (h[WH_ORDERS_DROPPED]! + 1) | 0;
    return false;
  }
  const pool = w.orders;
  const rec = pool.alloc();
  if (rec < 0) {
    h[WH_ORDERS_DROPPED] = (h[WH_ORDERS_DROPPED]! + 1) | 0;
    return false;
  }
  const O = pool.i32;
  const b = rec * ORDER_RECORD_WORDS;
  O[b + ORD_TYPE_FLAGS] = type;
  O[b + ORD_TX] = tx;
  O[b + ORD_TZ] = tz;
  O[b + ORD_FORMATION] = f;
  O[b + ORD_PATH] = NO_REF;
  O[b + ORD_NEXT] = NO_REF;
  O[b + ORD_OFFSET] = offset;
  O[b + ORD_TICK] = h[WH_TICK]!;
  const U = w.units.col;
  const tail = U.orderTail[u]!;
  if (tail < 0) U.orderHead[u] = rec;
  else O[tail * ORDER_RECORD_WORDS + ORD_NEXT] = rec;
  U.orderTail[u] = rec;
  M.orders[r] = M.orders[r]! + 1;
  return true;
}

/** Frees one order record (own path, formation reference, slab record). */
function freeOrderRecord(w: World, rec: number): void {
  const O = w.orders.i32;
  const b = rec * ORDER_RECORD_WORDS;
  releasePath(w, O[b + ORD_PATH]!);
  releaseFormationRef(w, O[b + ORD_FORMATION]!);
  w.orders.free(rec);
}

/** Removes the head order of unit u (after complete()). */
function popOrder(w: World, u: number, r: number): void {
  const U = w.units.col;
  const head = U.orderHead[u]!;
  if (head < 0) return;
  const next = w.orders.i32[head * ORDER_RECORD_WORDS + ORD_NEXT]!;
  freeOrderRecord(w, head);
  U.orderHead[u] = next;
  if (next < 0) U.orderTail[u] = NO_REF;
  const M = w.movers.col;
  M.orders[r] = M.orders[r]! - 1;
}

/**
 * Clears unit u's whole queue (Move without Queue flag, Stop, death): releases own paths and
 * formation references. The active movement state is left to the next order / Orders phase.
 */
export function clearOrders(w: World, u: number, r: number): void {
  const U = w.units.col;
  const O = w.orders.i32;
  if (upgradeTarget(w, u) >= 0) clearUpgradeWork(w, u);
  let rec = U.orderHead[u]!;
  while (rec >= 0) {
    const next = O[rec * ORDER_RECORD_WORDS + ORD_NEXT]!;
    freeOrderRecord(w, rec);
    rec = next;
  }
  U.buildTarget[u] = HANDLE_NONE; U.attackTarget[u]=HANDLE_NONE;
  U.orderHead[u] = NO_REF;
  U.orderTail[u] = NO_REF;
  U.formation[u] = NO_REF;
  if (r >= 0) {
    const M = w.movers.col;
    M.orders[r] = 0;
    M.path[r] = NO_REF;
    M.flags[r] = M.flags[r]! & ~(MoverBits.OwnPath | MoverBits.Arrived | MoverBits.Stuck | MoverBits.Detour | MoverBits.SlotPending | MoverBits.WpCached);
  }
}

// ---- slots --------------------------------------------------------------------------------------

/**
 * Final slot of unit u (mover r) in formation f: effective anchor + offset; a slot that is not
 * passable for the unit's class or lies in another component than the unit ⇒ the nearest cell of
 * the unit's component (PLAN §3.8, Nav spiral search, at most SLOT_SEARCH_MAX_RADIUS rings; else
 * the anchor). Clears SlotPending.
 */
export function finalizeSlot(w: World, u: number, r: number, f: number, packed: number): void {
  const M = w.movers.col;
  const F = w.formations.col;
  const nav = w.nav;
  const cls = unitClass(w, u);
  let sx = clampMap(w, F.gx[f]! + offsetX(packed));
  let sz = clampMap(w, F.gz[f]! + offsetZ(packed));
  let flags = M.flags[r]! & ~MoverBits.SlotPending;
  const fp = F.path[f]!;
  if (fp >= 0 && (nav.pathFlags(fp) & PATH_F_RETARGETED) !== 0) flags |= MoverBits.Retargeted;
  const U = w.units.col;
  const uc = navCellOf(w, U.x[u]!, U.z[u]!);
  const sc = navCellOf(w, sx, sz);
  const shift = w.navShift;
  const mask = w.mapSizeWu - 1;
  const ok = w.navClear[sc]! >= cls && (w.navClear[uc]! < cls || nav.componentAt(cls, uc & mask, uc >> shift) === nav.componentAt(cls, sc & mask, sc >> shift));
  if (!ok) {
    // Nearest cell of the unit's component around the slot (bounded spiral: blocked slots lie
    // next to reachable ground, the anchor itself is reachable), else the anchor.
    const L = w.navClear[uc]! >= cls ? nav.componentAt(cls, uc & mask, uc >> shift) : 0;
    const c =
      L !== 0 && L !== NAV_COMP_OVERFLOW
        ? spiralSearch(nav.st, cls, sc, SPIRAL_LABEL, L, SLOT_SEARCH_MAX_RADIUS)
        : spiralSearch(nav.st, cls, sc, SPIRAL_PASSABLE, 0, SLOT_SEARCH_MAX_RADIUS);
    if (c >= 0) {
      sx = ((c & mask) << 12) + 2048;
      sz = ((c >> shift) << 12) + 2048;
    } else {
      sx = F.gx[f]!;
      sz = F.gz[f]!;
    }
    flags |= MoverBits.Retargeted;
  }
  M.tx[r] = sx;
  M.tz[r] = sz;
  M.flags[r] = flags;
}

// ---- behaviors ----------------------------------------------------------------------------------

const RUNNING = 0;
const DONE = 1;

/** OrderBehavior (PLAN §3.4 phase 2): begin once, tick every Orders phase until DONE, complete. */
interface OrderBehavior {
  begin(w: World, u: number, r: number, rec: number): void;
  tick(w: World, u: number, r: number, rec: number): number;
  complete(w: World, u: number, r: number, rec: number): void;
}

/** Sets a mover idle (no order): brakes, keeps the slot memory as given. */
function setIdle(w: World, u: number, r: number, keepSlot: boolean): void {
  const M = w.movers.col;
  const U = w.units.col;
  M.state[r] = MoverState.Idle;
  U.state[u] = UnitState.Idle;
  M.path[r] = NO_REF;
  M.stuck[r] = 0;
  M.streak[r] = 0;
  M.best[r] = NO_BEST_DIST;
  let f = M.flags[r]! & ~(MoverBits.Arrived | MoverBits.OwnPath | MoverBits.FinalLeg | MoverBits.SlotPending | MoverBits.Detour | MoverBits.Stuck | MoverBits.Retargeted | MoverBits.WpCached);
  if (keepSlot) f |= MoverBits.HasSlot;
  else f &= ~MoverBits.HasSlot;
  M.flags[r] = f;
  U.formation[u] = NO_REF;
}

const MoveBehavior: OrderBehavior = {
  begin(w, u, r, rec) {
    const O = w.orders.i32;
    const b = rec * ORDER_RECORD_WORDS;
    const M = w.movers.col;
    const U = w.units.col;
    const F = w.formations.col;
    const f = O[b + ORD_FORMATION]!;
    const packed = O[b + ORD_OFFSET]!;
    U.formation[u] = f;
    U.groupOffset[u] = packed;
    U.state[u] = UnitState.Moving;
    M.state[r] = MoverState.Moving;
    M.ax[r] = O[b + ORD_TX]!;
    M.az[r] = O[b + ORD_TZ]!;
    M.best[r] = NO_BEST_DIST;
    M.sbest[r] = NO_BEST_DIST;
    M.stuck[r] = 0;
    M.streak[r] = 0;
    M.launch[r] = MOVE_LAUNCH_TICKS;
    M.nudge[r] = 0;
    M.flags[r] =
      M.flags[r]! &
      ~(MoverBits.Asleep | MoverBits.Arrived | MoverBits.OwnPath | MoverBits.FinalLeg | MoverBits.Detour | MoverBits.Stuck | MoverBits.HasSlot | MoverBits.Retargeted | MoverBits.SlotPending | MoverBits.WpCached);
    if (f < 0) {
      M.path[r] = NO_REF;
      M.tx[r] = O[b + ORD_TX]!;
      M.tz[r] = O[b + ORD_TZ]!;
      M.flags[r] = M.flags[r]! | MoverBits.FinalLeg;
    } else {
      if (F.state[f] === FormationState.Waiting) {
        // Exactly one request per group record, issued when its first member begins the order.
        const p = requestPath(w, f, u, F.cls[f]!, F.sx[f]!, F.sz[f]!, F.tx[f]!, F.tz[f]!);
        F.path[f] = p;
        F.consumed[f] = 0;
        F.state[f] = p >= 0 ? FormationState.Requested : FormationState.Ready;
      }
      M.path[r] = F.path[f]!;
      M.wp[r] = F.consumed[f]!;
      M.pgen[r] = F.gen[f]!;
      if (F.state[f] === FormationState.Ready) finalizeSlot(w, u, r, f, packed);
      else {
        M.tx[r] = clampMap(w, F.gx[f]! + offsetX(packed));
        M.tz[r] = clampMap(w, F.gz[f]! + offsetZ(packed));
        M.flags[r] = M.flags[r]! | MoverBits.SlotPending;
      }
      if (M.path[r]! < 0) M.flags[r] = M.flags[r]! | MoverBits.FinalLeg;
    }
    M.wx[r] = M.tx[r]!;
    M.wz[r] = M.tz[r]!;
  },
  tick(w, u, r, rec) {
    const M = w.movers.col;
    const f = M.flags[r]!;
    if ((f & MoverBits.Arrived) !== 0) return DONE;
    if ((f & MoverBits.Stuck) !== 0) return stuckChain(w, u, r, rec);
    return RUNNING;
  },
  complete(w, u, r, rec) {
    const arrived = (w.movers.col.flags[r]! & MoverBits.Arrived) !== 0;
    const O = w.orders.i32;
    const b = rec * ORDER_RECORD_WORDS;
    releasePath(w, O[b + ORD_PATH]!);
    O[b + ORD_PATH] = NO_REF;
    setIdle(w, u, r, arrived);
  },
};

const StopBehavior: OrderBehavior = {
  begin(w, u, r) {
    const M = w.movers.col;
    const U = w.units.col;
    setIdle(w, u, r, false);
    M.tx[r] = U.x[u]!;
    M.tz[r] = U.z[u]!;
    M.flags[r] = M.flags[r]! & ~MoverBits.Asleep;
  },
  tick() {
    return DONE;
  },
  complete() {},
};

const BuildBehavior: OrderBehavior = {
  begin(w,u,r,rec) {
    MoveBehavior.begin(w,u,r,rec);
    const O=w.orders.i32,b=rec*ORDER_RECORD_WORDS,M=w.movers.col;
    const p=requestPath(w,-2-u,u,unitClass(w,u),w.units.col.x[u]!,w.units.col.z[u]!,O[b+ORD_TX]!,O[b+ORD_TZ]!);
    O[b+ORD_PATH]=p;M.path[r]=p;M.wp[r]=0;
    if(p>=0)M.flags[r]=(M.flags[r]!|MoverBits.OwnPath)&~MoverBits.FinalLeg;
  },
  tick(w,u,r,rec) {
    const U=w.units.col,O=w.orders.i32,b=rec*ORDER_RECORD_WORDS,packed=O[b+ORD_OFFSET]!,bp=packed&65535,yaw=packed>>>16,x=O[b+ORD_TX]!,z=O[b+ORD_TZ]!;
    const dx=U.x[u]!-x,dz=U.z[u]!-z,range=w.bp.buildRangeRawCol[U.bp[u]!]!;
    let site=w.units.resolve(U.buildTarget[u]!);
    if(site>=0 && ((U.flags[site]!&UnitBits.Dead)!==0 || U.army[site]!==U.army[u]))site=-1;
    if(site>=0 && (U.flags[site]!&UnitBits.UnderConstruction)===0)return DONE;
    if(dx*dx+dz*dz>range*range){
      if((w.movers.col.flags[r]!&MoverBits.Stuck)!==0)return stuckChain(w,u,r,rec);
      if((w.movers.col.flags[r]!&MoverBits.Arrived)!==0)return DONE;
      // Separation or an idle nudge can push a working builder out of range after its
      // path was released. Resume this same head/site instead of sleeping forever.
      if(w.movers.col.state[r]===MoverState.Idle)directBegin(w,u,r,rec);
      return RUNNING;
    }
    if(site<0){
      site=buildSite(w,U.army[u]!,bp,x,z,yaw);
      if(site<0 && placementVerdict(w,bp,x,z,yaw)!==0)return DONE;
      site=startBuildSite(w,u,rec);if(site<0)return DONE;
      U.buildTarget[u]=w.units.handle(site);
    }
    releasePath(w,O[b+ORD_PATH]!);O[b+ORD_PATH]=NO_REF;
    setIdle(w,u,r,false);w.movers.col.speed[r]=0;U.vx[u]=0;U.vz[u]=0;
    return RUNNING;
  },
  complete(w,u,r,rec) { Uclear(w,u);MoveBehavior.complete(w,u,r,rec); },
};
function Uclear(w:World,u:number):void {w.units.col.buildTarget[u]=HANDLE_NONE;}


function directBegin(w:World,u:number,r:number,rec:number):void {
  MoveBehavior.begin(w,u,r,rec);const O=w.orders.i32,b=rec*8;
  releasePath(w,O[b+ORD_PATH]!);const p=requestPath(w,-2-u,u,unitClass(w,u),w.units.col.x[u]!,w.units.col.z[u]!,O[b+ORD_TX]!,O[b+ORD_TZ]!);
  O[b+ORD_PATH]=p;w.movers.col.path[r]=p;w.movers.col.wp[r]=0;
  if(p>=0)w.movers.col.flags[r]=(w.movers.col.flags[r]!|MoverBits.OwnPath)&~MoverBits.FinalLeg;
}
const FollowBehavior:OrderBehavior={
  begin:directBegin,
  tick(w,u,r,rec){
    const U=w.units.col,O=w.orders.i32,b=rec*8,type=O[b]!&255,t=w.units.resolve(O[b+ORD_OFFSET]!>>>0);
    if(t<0||!isActive(w,t))return DONE;
    if(type===4){
      if(allied(w,U.army[u]!,U.army[t]!))return DONE;U.attackTarget[u]=w.units.handle(t);
      let range=0;const bp=U.bp[u]!;for(let m=0;m<w.bp.mountCount(bp);m++)range=Math.max(range,w.bp.weaponRangeCol[w.bp.mountWeaponCol[w.bp.firstMount(bp)+m]!]!);
      if(visibleTo(w,U.army[u]!,t)){
        const dx=U.x[t]!-U.x[u]!,dz=U.z[t]!-U.z[u]!;
        if(dx*dx+dz*dz<=range*range){setIdle(w,u,r,false);return RUNNING;}
        O[b+ORD_TX]=U.x[t]!;O[b+ORD_TZ]=U.z[t]!;
      }
    }else{
      if(!allied(w,U.army[u]!,U.army[t]!))return DONE;
      let target=t;if((U.flags[t]!&UnitBits.UnderConstruction)===0){const active=w.units.resolve(U.buildTarget[t]!);if(active>=0&&isActive(w,active))target=active;else if(type===5)return DONE;}
      O[b+ORD_TX]=U.x[target]!;O[b+ORD_TZ]=U.z[target]!;
      const dx=U.x[target]!-U.x[u]!,dz=U.z[target]!-U.z[u]!,range=w.bp.buildRangeRawCol[U.bp[u]!]!;
      if(dx*dx+dz*dz<=range*range){
        setIdle(w,u,r,false);U.buildTarget[u]=(U.flags[target]!&UnitBits.UnderConstruction)!==0||type===9?w.units.handle(target):HANDLE_NONE;
        if(type===9&&U.hp[target]!>=w.bp.maxHpCol[U.bp[target]!]!)return DONE;
        return RUNNING;
      }U.buildTarget[u]=HANDLE_NONE;
    }
    if(w.movers.col.state[r]!==MoverState.Moving||w.tick%5===u%5)directBegin(w,u,r,rec);
    if((w.movers.col.flags[r]!&MoverBits.Stuck)!==0)return stuckChain(w,u,r,rec);return RUNNING;
  },
  complete(w,u,r,rec){w.units.col.attackTarget[u]=HANDLE_NONE;Uclear(w,u);MoveBehavior.complete(w,u,r,rec);}
};
const PatrolBehavior:OrderBehavior={begin:directBegin,tick(w,u,r,rec){
  if((w.movers.col.flags[r]!&MoverBits.Arrived)!==0){const O=w.orders.i32,b=rec*8,x=O[b+ORD_TX]!,z=O[b+ORD_TZ]!;O[b+ORD_TX]=O[b+ORD_TICK]!;O[b+ORD_TZ]=O[b+ORD_OFFSET]!;O[b+ORD_TICK]=x;O[b+ORD_OFFSET]=z;directBegin(w,u,r,rec);}
  if((w.movers.col.flags[r]!&MoverBits.Stuck)!==0)return stuckChain(w,u,r,rec);return RUNNING;
},complete:MoveBehavior.complete};
const GroundBehavior:OrderBehavior={begin(w,u,r){setIdle(w,u,r,false);},tick(){return RUNNING;},complete(){}};
const ReclaimBehavior:OrderBehavior={begin:directBegin,tick(w,u,r,rec){const O=w.orders.i32,b=rec*8,t=resolveWreck(w,O[b+ORD_OFFSET]!>>>0);if(t<0)return DONE;const U=w.units.col,dx=U.x[u]!-w.wrecks.col.x[t]!,dz=U.z[u]!-w.wrecks.col.z[t]!,range=w.bp.buildRangeRawCol[U.bp[u]!]!;if(dx*dx+dz*dz<=range*range){setIdle(w,u,r,false);return RUNNING;}if((w.movers.col.flags[r]!&MoverBits.Stuck)!==0)return stuckChain(w,u,r,rec);return RUNNING;},complete:MoveBehavior.complete};
const UpgradeBehavior: OrderBehavior = {
  begin(w, u, r) {
    clearUpgradeWork(w, u);
    Uclear(w, u);
    setIdle(w, u, r, false);
    w.movers.col.speed[r] = 0;
    w.units.col.vx[u] = 0; w.units.col.vz[u] = 0;
  },
  tick(w, u) { return upgradeTarget(w, u) >= 0 ? RUNNING : DONE; },
  complete(w, u) { clearUpgradeWork(w, u); },
};

/** Behaviors by OrderType (index 0 unused). */
const BEHAVIORS: readonly (OrderBehavior | null)[] = [null, MoveBehavior, StopBehavior, BuildBehavior,FollowBehavior,FollowBehavior,PatrolBehavior,MoveBehavior,GroundBehavior,FollowBehavior,FollowBehavior,ReclaimBehavior,UpgradeBehavior];

// ---- stuck chain ----------------------------------------------------------------------------------

/** Replaces/creates the own path of order `rec` from (sx, sz) to the unit's slot. */
function repathOwn(w: World, u: number, r: number, rec: number, sx: number, sz: number): void {
  const O = w.orders.i32;
  const b = rec * ORDER_RECORD_WORDS;
  const M = w.movers.col;
  const old = O[b + ORD_PATH]!;
  const tick = w.header.i32[WH_TICK]!;
  let p = old;
  if (old >= 0) w.nav.repath(old, sx, sz, tick);
  else {
    p = requestPath(w, -2 - u, u, unitClass(w, u), sx, sz, M.tx[r]!, M.tz[r]!);
    O[b + ORD_PATH] = p;
  }
  M.path[r] = p;
  M.wp[r] = 0;
  let fl = M.flags[r]! & ~(MoverBits.FinalLeg | MoverBits.Detour | MoverBits.WpCached);
  fl = p >= 0 ? fl | MoverBits.OwnPath : (fl & ~MoverBits.OwnPath) | MoverBits.FinalLeg;
  M.flags[r] = fl;
  M.wx[r] = M.tx[r]!;
  M.wz[r] = M.tz[r]!;
}

const DIR = new Int32Array(2);

/**
 * Stuck chain (PLAN §3.8, SPK2): 1st stuck ⇒ repath (own path from the current position);
 * 2nd in a row ⇒ side-step SIDESTEP_DISTANCE to the side with more clearance and repath from
 * there, or — if neither side is passable — the nearest reachable point becomes the slot;
 * 3rd ⇒ give up (order DONE, WH_STUCK_GIVEUPS). Progress resets the chain (Movement).
 */
function stuckChain(w: World, u: number, r: number, rec: number): number {
  const M = w.movers.col;
  const U = w.units.col;
  const streak = M.streak[r]! + 1;
  M.flags[r] = M.flags[r]! & ~MoverBits.Stuck;
  M.stuck[r] = 0;
  M.best[r] = NO_BEST_DIST;
  if (streak >= 3) {
    const h = w.header.i32;
    h[WH_STUCK_GIVEUPS] = (h[WH_STUCK_GIVEUPS]! + 1) | 0;
    return DONE;
  }
  M.streak[r] = streak;
  const x = U.x[u]!;
  const z = U.z[u]!;
  if (streak === 1) {
    repathOwn(w, u, r, rec, x, z);
    return RUNNING;
  }
  // Side-step: perpendicular to the heading, the side with more clearance (passable for the class).
  const cls = unitClass(w, u);
  angToDir(asAng16(U.yaw[u]!), DIR, 0);
  const hx = DIR[0]!;
  const hz = DIR[1]!;
  const d = SIDESTEP_DISTANCE;
  const lx = clampMap(w, x - ((hz * d) >> 12));
  const lz = clampMap(w, z + ((hx * d) >> 12));
  const rx = clampMap(w, x + ((hz * d) >> 12));
  const rz = clampMap(w, z - ((hx * d) >> 12));
  const cl = w.navClear[navCellOf(w, lx, lz)]!;
  const cr = w.navClear[navCellOf(w, rx, rz)]!;
  // Alternate the preferred side with the unit slot so neighbours split.
  const preferLeft = cl > cr || (cl === cr && (u & 1) === 0);
  const px = preferLeft ? lx : rx;
  const pz = preferLeft ? lz : rz;
  const pc = preferLeft ? cl : cr;
  if (pc >= cls) {
    repathOwn(w, u, r, rec, px, pz);
    M.wx[r] = px;
    M.wz[r] = pz;
    M.flags[r] = M.flags[r]! | MoverBits.Detour;
    return RUNNING;
  }
  // Neither side is free: settle for the nearest point of the unit's component to its slot.
  const uc = navCellOf(w, x, z);
  const sc = navCellOf(w, M.tx[r]!, M.tz[r]!);
  const mask = w.mapSizeWu - 1;
  const shift = w.navShift;
  if (w.navClear[uc]! >= cls) {
    const c = w.nav.nearestReachable(cls, uc & mask, uc >> shift, sc & mask, sc >> shift);
    if (c >= 0) {
      M.tx[r] = ((c & mask) << 12) + 2048;
      M.tz[r] = ((c >> shift) << 12) + 2048;
      M.flags[r] = M.flags[r]! | MoverBits.Retargeted;
    }
  }
  repathOwn(w, u, r, rec, x, z);
  return RUNNING;
}

// ---- phase 2 --------------------------------------------------------------------------------------

/**
 * Phase 2 Orders: per mover (dense order) the head order is begun once, ticked and — when done —
 * completed and popped; the next order begins in the same tick (at most 4 transitions per unit
 * and tick). A unit without orders is idle (it sleeps once at rest, see Movement).
 */
export function ordersPhase(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const U = w.units.col;
  const O = w.orders.i32;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    if ((U.flags[u]! & UnitBits.Dead) !== 0) continue;
    for (let guard = 0; guard < 4; guard++) {
      const head = U.orderHead[u]!;
      if (head < 0) break;
      const b = head * ORDER_RECORD_WORDS;
      const tf = O[b + ORD_TYPE_FLAGS]!;
      const beh = BEHAVIORS[tf & 0xff] ?? null;
      if (beh === null) {
        popOrder(w, u, r);
        continue;
      }
      if (((tf >> 8) & OrderBits.Begun) === 0) {
        O[b + ORD_TYPE_FLAGS] = tf | (OrderBits.Begun << 8);
        beh.begin(w, u, r, head);
      }
      if (beh.tick(w, u, r, head) === RUNNING) break;
      beh.complete(w, u, r, head);
      popOrder(w, u, r);
    }
    // Queue emptied without a completing order (replaced by a dropped command): stand still.
    if (U.orderHead[u]! < 0 && w.movers.col.state[r] === MoverState.Moving) setIdle(w, u, r, false);
  }
}

/** Length of unit u's queue (tools; walks the list). */
export function queueLength(w: World, u: number): number {
  let n = 0;
  const O = w.orders.i32;
  for (let rec = w.units.col.orderHead[u]!; rec >= 0; rec = O[rec * ORDER_RECORD_WORDS + ORD_NEXT]!) n++;
  return n;
}
