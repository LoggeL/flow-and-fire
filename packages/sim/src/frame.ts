import { upgradeTarget } from './upgrade.ts';
/**
 * Output of a frame for a viewer (PLAN §3.6) through the protocol FrameWriter.
 * MS1 has no fog: viewer −1 (observer) and every army see all units. Units that are dead are
 * already released by Cleanup and never appear.
 *
 * MS3 (frame v2): the path statistics of the header (pending requests, requests issued, repaths
 * triggered, expansions of the last PathService phase, stuck give-ups) and the Watch section for
 * `ctl.watch` (≤ 64 handles): per unit its queued order targets and the remaining waypoints of
 * its path. Watch entries are only written for units the viewer may see in detail (observer, own
 * or allied army); stale handles are skipped.
 */
import { MAX_ARMIES, atan2A, isqrt } from '@faf/fixed';
import { PATH_PENDING, WP_LAST } from '@faf/nav';
import { EcoField, EconomyEventFlags, EventType, FlowFlags, FogState, FrameFlags, MAX_PARTS_PER_UNIT, UnitFlags, WATCH_MAX_POINTS, WATCH_MAX_TARGETS, WatchFlags, type FrameWriter } from '@faf/protocol';
import { wreckHandle } from './reclaim.ts';
import { visibleTo, allied,canSeePosition } from './intel.ts';
import { WH_MATCH_END,WH_WINNER,WH_SKIRMISH,WH_FOG } from './schema.ts';
import { MoverBits, MoverState, OrderBits, OrderType, UnitBits, UnitState } from './constants.ts';
import { isActive } from './liveness.ts';
import { offsetX, offsetZ } from './orders.ts';
import {
  HL_LAST_HASH,
  HL_LAST_HASH_TICK,
  ORD_NEXT,
  ORD_OFFSET,
  ORD_TX,
  ORD_TYPE_FLAGS,
  ORD_TZ,
  ORDER_RECORD_WORDS,
  WH_STUCK_GIVEUPS,
  WH_TICK,
} from './schema.ts';
import { SC } from './scratch.ts';
import type { World } from './world.ts';

/** Header fields owned by the host (sequence, timing, speed, paused bit). */
export interface FrameMeta {
  /** Frame sequence number (host counter). */
  seq: number;
  /** Duration of the last tick in µs (host measurement). */
  tickTimeUs: number;
  /** Game speed in ‰ (1000 = 1x). */
  speedPermille: number;
  /** FrameFlags (e.g. Paused). */
  flags: number;
}

const DEFAULT_META: FrameMeta = { seq: 0, tickTimeUs: 0, speedPermille: 1000, flags: 0 };

/** Radar sources considered per frame (scratch, presentation only). */
const MAX_RADAR_SOURCES = 256;
// Raw Fx coordinates and radii (i32); squared distances stay exact integers below 2^53.
const RADAR_X = new Int32Array(MAX_RADAR_SOURCES), RADAR_Z = new Int32Array(MAX_RADAR_SOURCES), RADAR_R = new Int32Array(MAX_RADAR_SOURCES);

/**
 * Radar is frame presentation, not World state: an enemy unit outside the viewer's sight but
 * inside a completed, powered (unpaused, enabled) allied radar is written as a blip — position,
 * heading, army and blueprint index (the renderer culls by its radius and always draws the
 * anonymous blip glyph), full hp/build bytes, no parts, weapon aim or detail flags.
 */
function writeRadarBlips(w: World, viewer: number, writer: FrameWriter): void {
  const h = w.header.i32;
  if (viewer < 0 || h[WH_SKIRMISH] === 0 || h[WH_FOG] === 0) return;
  const units = w.units, U = units.col, radar = w.bp.radarCol, hw = units.highWater;
  let sources = 0;
  for (let s = 0; s < hw && sources < MAX_RADAR_SOURCES; s++) {
    if (units.alive[s] !== 1) continue;
    const range = radar[U.bp[s]!]!;
    if (range <= 0 || (U.flags[s]! & (UnitBits.Dead | UnitBits.UnderConstruction)) !== 0 || U.ecoPaused[s] !== 0 || U.ecoEnabled[s] === 0 || !allied(w, viewer, U.army[s]!)) continue;
    RADAR_X[sources] = U.x[s]!; RADAR_Z[sources] = U.z[s]!; RADAR_R[sources] = range; sources++;
  }
  if (sources === 0) return;
  for (let i = 0; i < hw; i++) {
    if (units.alive[i] !== 1 || (U.flags[i]! & UnitBits.Dead) !== 0 || visibleTo(w, viewer, i) || allied(w, viewer, U.army[i]!)) continue;
    const x = U.x[i]!, z = U.z[i]!;
    let covered = false;
    for (let k = 0; k < sources && !covered; k++) { const dx = x - RADAR_X[k]!, dz = z - RADAR_Z[k]!, r = RADAR_R[k]!; covered = dx * dx + dz * dz <= r * r; }
    if (!covered) continue;
    if (writer.unitCount >= writer.caps.units) return;
    writer.writeUnit(U.px[i]!, U.py[i]!, U.pz[i]!, x, U.y[i]!, z, U.pyaw[i]!, U.yaw[i]!, U.bp[i]!, U.army[i]!, 255, 255, 0, UnitFlags.Blip, units.handle(i), writer.partCount, 0, 0);
  }
}

/** Scales hp to u8: 255 = full, ≥ 1 while alive. */
export function hpToU8(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  if (hp >= maxHp) return 255;
  const v = Math.floor((hp * 255) / maxHp);
  return v < 1 ? 1 : v;
}

const EMPTY_WATCH = new Uint32Array(0);

/**
 * Writes the frame of `viewer` (−1 = all) into `target` and returns its packed byte length.
 * Header: tick, ackSeq of the viewer (0xFFFFFFFF = none/observer), last hash tick + hash, path
 * statistics. `watch[0..watchCount)` are the handles of `ctl.watch` (Watch section).
 */
export function writeFrame(
  w: World,
  viewer: number,
  writer: FrameWriter,
  target: Uint8Array,
  meta: FrameMeta = DEFAULT_META,
  watch: Uint32Array = EMPTY_WATCH,
  watchCount = 0,
): number {
  const h = w.header;
  const ack = viewer >= 0 && viewer < w.armyCount ? w.armies.col.lastAckSeq[viewer]! : -1;
  writer.beginFrame(
    target,
    meta.seq,
    h.i32[WH_TICK]!,
    meta.tickTimeUs,
    meta.speedPermille,
    viewer,
    meta.flags | FrameFlags.FootprintSnapshot,
    // Signed values: beginFrame writes them as u32 (no boxed doubles on the call).
    ack,
    w.hashLog.i32[HL_LAST_HASH_TICK]!,
    w.hashLog.i32[HL_LAST_HASH]!,
  );
  const units = w.units;
  const alive = units.alive;
  const U = units.col;
  const M = w.movers.col;
  const maxHp = w.bp.maxHpCol;
  const hw = units.highWater;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || !visibleTo(w,viewer,i)) continue;
    const f = U.flags[i]!;
    if ((f & UnitBits.Dead) !== 0) continue;
    const bp = U.bp[i]!;
    const hp = U.hp[i]!;
    const mhp = maxHp[bp]!;
    let flags = 0;
    if ((f & UnitBits.NoInterp) !== 0) flags |= UnitFlags.NoInterp;
    const row = U.mover[i]!;
    if (
      U.state[i] === UnitState.Idle &&
      (row < 0 || (M.state[row] === MoverState.Idle && M.speed[row] === 0 && M.orders[row] === 0 && M.nudge[row] === 0))
    ) {
      flags |= UnitFlags.Idle;
    }
    if ((f & UnitBits.Footprint)!==0) flags |= UnitFlags.Building;
    if (U.ecoPaused[i]!==0) flags |= UnitFlags.Paused;
    if (U.ecoRatio[i]!<65536 || U.ecoEnabled[i]===0) flags |= UnitFlags.Stalled;
    if (U.orderHead[i]!>=0 || U.buildTarget[i]!==0xffffffff) flags &= ~UnitFlags.Idle;
    if (hp < mhp) flags |= UnitFlags.Damaged;
    if (writer.unitCount >= writer.caps.units) break;
    // Presentation observations only: the durable weapon arena and body heading stay untouched.
    const partBase = writer.partCount;
    const mountCount = w.bp.mountCountCol[bp]!;
    const count = mountCount < MAX_PARTS_PER_UNIT ? mountCount : MAX_PARTS_PER_UNIT;
    let partCount = 0;
    let mountAimMask = 0;
    for (let k = 0; k < count; k++) {
      const o = (i * 16 + k) * 5;
      const t = units.resolve(w.weapons.i32[o + 1]!);
      let yaw = U.yaw[i]!;
      let pitch = 0;
      // Do not read target coordinates before both privacy checks pass.
      if (isActive(w, t) && (f & UnitBits.UnderConstruction) === 0 && U.fireState[i] !== 0 &&
          visibleTo(w, U.army[i]!, t) && visibleTo(w, viewer, t) && !allied(w, U.army[i]!, U.army[t]!)) {
        yaw = w.weapons.i32[o + 2]! & 65535;
        const dx = U.x[t]! - U.x[i]!;
        const dz = U.z[t]! - U.z[i]!;
        const elevation = atan2A(U.y[t]! + 1024 - U.y[i]! - 2048, isqrt(dx * dx + dz * dz));
        pitch = elevation > 32767 ? elevation - 65536 : elevation;
        mountAimMask |= 1 << k;
      }
      if (writer.writePart(yaw, yaw, pitch, pitch) < 0) break;
      partCount++;
    }
    if (partCount > 0) flags |= UnitFlags.MountAimParts;
    writer.writeUnit(
      U.px[i]!,
      U.py[i]!,
      U.pz[i]!,
      U.x[i]!,
      U.y[i]!,
      U.z[i]!,
      U.pyaw[i]!,
      U.yaw[i]!,
      bp,
      U.army[i]!,
      hpToU8(hp, mhp),
      Math.floor(U.buildDone.get(i)*255/65536),
      U.bank[i]!,
      flags,
      units.handle(i),
      partBase,
      partCount,
      mountAimMask & ((1 << partCount) - 1),
    );
  }
  writeRadarBlips(w, viewer, writer);
  const R=w.wrecks.col;for(let r=0;r<w.wrecks.highWater;r++)if(w.wrecks.isLive(r)&&canSeePosition(w,viewer,R.x[r]!,R.z[r]!))writer.writeUnit(R.x[r]!,R.y[r]!,R.z[r]!,R.x[r]!,R.y[r]!,R.z[r]!,R.yaw[r]!,R.yaw[r]!,R.bp[r]!,255,255,255,0,UnitFlags.Wreck,wreckHandle(w,r),0,0);
  for(let u=0;u<w.units.highWater;u++)if(w.units.isLive(u)&&visibleTo(w,viewer,u)&&U.ecoPaused[u]===0){const handle=U.buildTarget[u]!|0;if(handle===-1)continue;const t=w.units.resolve(handle);if(t>=0&&visibleTo(w,viewer,t))writer.writeBeam(w.units.handle(u),w.units.handle(t),65535,0,0);}
  const nav = w.nav;
  writer.setPathStats(nav.pendingCount, nav.requestsIssued, nav.repathsTriggered, nav.expansionsLastTick, w.header.i32[WH_STUCK_GIVEUPS]!);
  const nw = watchCount < watch.length ? watchCount : watch.length;
  for (let k = 0; k < nw; k++) writeWatch(w, viewer, writer, watch[k]!);
  const P=w.projectiles.col;
  for(let p=0;p<w.projectiles.highWater;p++)if(w.projectiles.isLive(p)){
    if(!canSeePosition(w,viewer,P.x[p]!,P.z[p]!))continue;
    const previousVisible=canSeePosition(w,viewer,P.px[p]!,P.pz[p]!);
    writer.writeProjectile(previousVisible?P.px[p]!:P.x[p]!,previousVisible?P.py[p]!:P.y[p]!,previousVisible?P.pz[p]!:P.z[p]!,P.x[p]!,P.y[p]!,P.z[p]!,w.bp.weaponProjectileCol[P.weapon[p]!]!,P.army[p]!,0);
  }
  const E=w.combatEvents.i32;for(let n=0;n<E[0]!;n++){
    const o=1+n*11;if(E[o]!==5&&viewer>=0&&(E[o+10]!&(1<<viewer))===0)continue;
    const target=E[o]===1?w.units.resolve(E[o+8]!):-1;const aux=E[o]===1&&target>=0&&!visibleTo(w,viewer,target)?-1:E[o+8]!;writer.writeEvent(E[o]!,E[o+1]!,E[o+2]!,E[o+3]!,E[o+4]!,E[o+5]!,E[o+6]!,E[o+7]!,aux,E[o+9]!);
  }
  const winner=w.header.i32[WH_WINNER]!;let winning=0,defeated=0;
  for(let a=0;a<w.armyCount;a++){if(winner>=0&&allied(w,winner,a))winning|=1<<a;if(w.armies.col.defeated[a]===1)defeated|=1<<a;}
  writer.setMatchResult(w.header.i32[WH_MATCH_END]!,winner,winning,defeated);
  const A=w.armies.col;
  for(let a=0;a<w.armyCount;a++){
    if(!seesDetails(w,viewer,a))continue;
    const e=writer.beginEco(a,A.stallFlags[a]!,A.ratioHigh[a]!,A.ratioNormal[a]!,A.ratioLow[a]!);
    if(e<0)continue;
    writer.setEcoValue(e,EcoField.massStored,A.massStored.get(a));
    writer.setEcoValue(e,EcoField.energyStored,A.energyStored.get(a));
    writer.setEcoValue(e,EcoField.massCapacity,A.massCapacity.get(a));
    writer.setEcoValue(e,EcoField.energyCapacity,A.energyCapacity.get(a));
    writer.setEcoValue(e,EcoField.massIncome,A.massIncome.get(a));
    writer.setEcoValue(e,EcoField.energyIncome,A.energyIncome.get(a));
    writer.setEcoValue(e,EcoField.massDemand,A.massDemand.get(a));
    writer.setEcoValue(e,EcoField.energyDemand,A.energyDemand.get(a));
    writer.setEcoValue(e,EcoField.massSpent,A.massSpent.get(a));
    writer.setEcoValue(e,EcoField.energySpent,A.energySpent.get(a));
    writer.setEcoValue(e,EcoField.massOverflow,A.massOverflow.get(a));
    writer.setEcoValue(e,EcoField.energyOverflow,A.energyOverflow.get(a));
  }
  // Full row-run snapshot survives skipped worker frames and replay seek/restore.
  const foot=w.nav.st.foot,size=w.mapSizeWu;
  for(let z=0;z<size;z++)for(let x=0;x<size;){
    const count=foot[z*size+x]!;if(count===0||!canSeePosition(w,viewer,x*4096+2048,z*4096+2048)){x++;continue;}
    const start=x;while(x<size&&foot[z*size+x]===count&&canSeePosition(w,viewer,x*4096+2048,z*4096+2048))x++;
    writer.writeFootprint(start,z,x-start,1,count,0xffffffff);
  }
  writePresentation(w,viewer,writer);
  return writer.endFrame();
}

/** Full frame observations are safe across skipped frames; no arena or order state is changed. */
function writePresentation(w:World,viewer:number,writer:FrameWriter):void {
  const U=w.units.col,observed=w.frameFlowTick===w.tick,O=w.orders.i32;
  if(observed)writer.setFlowTick(w.frameFlowTick);
  for(let u=0;u<w.units.highWater;u++){
    if(!isActive(w,u))continue;
    const army=U.army[u]!,handle=w.units.handle(u),bp=U.bp[u]!;
    if(observed&&army===viewer&&w.frameFlowHandles[u]===handle&&(writer.caps.flow??0)>0){
      const target=w.units.resolve(U.buildTarget[u]!|0),targetHandle=target>=0&&seesDetails(w,viewer,U.army[target]!)?U.buildTarget[u]!:0xffffffff;
      const md=w.frameFlowDemandMass.get(u),ed=w.frameFlowDemandEnergy.get(u),ms=w.frameFlowSpentMass.get(u),es=w.frameFlowSpentEnergy.get(u);
      const power=w.frameFlowPower.get(u),ownPower=w.bp.buildPowerQ16PerTickCol[bp]!;
      let flags=(U.ecoPaused[u]===1?FlowFlags.Paused:0)|(U.ecoEnabled[u]===1?FlowFlags.Enabled:0);
      if(upgradeTarget(w,u)>=0)flags|=FlowFlags.Upgrading;
      const buildSite=(U.flags[u]!&UnitBits.UnderConstruction)!==0;
      if(buildSite)flags|=FlowFlags.BuildSite;
      if(md>0||ed>0||ms>0||es>0||power>0)flags|=FlowFlags.Billed;
      if(w.frameFlowContributor[u]===1)flags|=FlowFlags.Contributing;
      if((flags&FlowFlags.Billed)!==0||targetHandle!==0xffffffff||(buildSite&&U.ecoPaused[u]===1)||(U.ecoPaused[u]===1&&(ownPower>0||w.bp.massUpkeepMilliPerTickCol[bp]!>0||w.bp.energyUpkeepMilliPerTickCol[bp]!>0)))
        writer.writeFlow(handle,bp,army,flags,U.ecoPriority[u]!,targetHandle,md,ed,ms,es,power,ownPower);
    }
    if(!seesDetails(w,viewer,army)||(writer.caps.buildIntents??0)===0)continue;
    let rec=U.orderHead[u]!;
    for(let index=0;rec>=0&&index<32;index++){
      const b=rec*ORDER_RECORD_WORDS;
      if((O[b+ORD_TYPE_FLAGS]!&255)===OrderType.Build){
        const packed=O[b+ORD_OFFSET]!;
        writer.writeBuildIntent(handle,packed&65535,packed>>>16,O[b+ORD_TX]!,O[b+ORD_TZ]!,index,army,index===0?U.buildTarget[u]!:0xffffffff);
      }
      rec=O[b+ORD_NEXT]!;
    }
  }
  if(observed){
    const A=w.armies.col;
    for(let a=0;a<w.armyCount;a++){
      if(!seesDetails(w,viewer,a))continue;
      const events=w.frameEconomyEvents[a]!,ratio=Math.min(A.ratioHigh[a]!,A.ratioNormal[a]!,A.ratioLow[a]!);
      if(events&1)writer.writeEvent(EventType.MassStall,a,w.tick,0,EconomyEventFlags.NoPosition,0,0,0,ratio,0xffffffff);
      if(events&2)writer.writeEvent(EventType.EnergyStall,a,w.tick,0,EconomyEventFlags.NoPosition,0,0,0,ratio,0xffffffff);
      if(events&4)writer.writeEvent(EventType.StorageFull,a,w.tick,0,EconomyEventFlags.NoPosition,0,0,0,Math.min(0xffffffff,A.massOverflow.get(a)),0xffffffff);
      if(events&8)writer.writeEvent(EventType.StorageFull,a,w.tick,0,EconomyEventFlags.NoPosition|EconomyEventFlags.Energy,0,0,0,Math.min(0xffffffff,A.energyOverflow.get(a)),0xffffffff);
    }
  }
  const dim=w.mapSizeWu>>3,cells=w.frameFog;
  if((writer.caps.fogBytes??0)<cells.length)return;
  if(viewer<0||w.header.i32[WH_SKIRMISH]===0||w.header.i32[WH_FOG]===0){cells.fill(FogState.Visible);writer.setFogSnapshot(cells,dim);return;}
  const bit=viewer>=0&&viewer<MAX_ARMIES?1<<viewer:0,E=w.explored.u16;
  for(let i=0;i<cells.length;i++)cells[i]=(E[i]!&bit)!==0?FogState.Explored:FogState.Unexplored;
  for(let u=0;u<w.units.highWater;u++){
    if(!isActive(w,u)||!allied(w,viewer,U.army[u]!)||(U.flags[u]!&UnitBits.UnderConstruction)!==0)continue;
    const x=U.x[u]!,z=U.z[u]!,range=w.bp.visionCol[U.bp[u]!]!;
    const loX=Math.max(0,(x-range)>>15),hiX=Math.min(dim-1,(x+range)>>15),loZ=Math.max(0,(z-range)>>15),hiZ=Math.min(dim-1,(z+range)>>15);
    for(let cz=loZ;cz<=hiZ;cz++)for(let cx=loX;cx<=hiX;cx++){
      const dx=(cx<<15)+16384-x,dz=(cz<<15)+16384-z;
      if(dx*dx+dz*dz<=range*range)cells[cz*dim+cx]=FogState.Visible;
    }
  }
  writer.setFogSnapshot(cells,dim);
}

/** True if `viewer` may see the orders of units of `army` (observer, own or allied). */
function seesDetails(w: World, viewer: number, army: number): boolean {
  if (viewer < 0) return true;
  if (viewer >= MAX_ARMIES) return false;
  return w.alliance.u8[viewer * MAX_ARMIES + army] === 1;
}

/** One WatchRecord: queued order targets and the remaining path points of the unit. */
function writeWatch(w: World, viewer: number, writer: FrameWriter, handle: number): void {
  const idx = w.units.resolve(handle);
  if (idx < 0) return;
  const U = w.units.col;
  if ((U.flags[idx]! & UnitBits.Dead) !== 0 || !seesDetails(w, viewer, U.army[idx]!)) return;
  const r = U.mover[idx]!;
  if (r < 0) {
    writer.beginWatch(handle, 0, 0);
    return;
  }
  const M = w.movers.col;
  const nav = w.nav;
  const mf = M.flags[r]!;
  const p = M.path[r]!;
  const f = U.formation[idx]!;
  const moving = M.state[r] !== MoverState.Idle;
  const own = (mf & MoverBits.OwnPath) !== 0;
  const group = moving && !own && p >= 0 && f >= 0 && w.formations.col.path[f] === p;
  let wf = 0;
  if (moving && (M.streak[r]! > 0 || M.stuck[r]! >= 10 || (mf & MoverBits.Detour) !== 0)) wf |= WatchFlags.Stuck;
  if ((mf & MoverBits.Retargeted) !== 0) wf |= WatchFlags.Retargeted;
  if (moving && p >= 0 && nav.pathState(p) === PATH_PENDING) wf |= WatchFlags.PathPending;
  if (group) wf |= WatchFlags.Group;
  if (writer.beginWatch(handle, M.orders[r]!, wf) < 0) return;
  const buildHandle=U.buildTarget[idx]!|0;const buildTarget=buildHandle===-1?-1:w.units.resolve(buildHandle);
  const upgrade = upgradeTarget(w, idx);
  writer.setWatchFactory(U.factoryRepeat[idx]===1,upgrade>=0?upgrade:buildTarget>=0?U.bp[buildTarget]!:-1,upgrade>=0?U.repairDone.get(idx):buildTarget>=0?U.buildDone.get(buildTarget):0,U.rallyX[idx]!,U.rallyZ[idx]!,buildHandle,U.ecoPaused[idx]===1,U.fireState[idx]!);
  for(let q=U.productionHead[idx]!;q>=0;q=w.factoryQueue.i32[q*2+1]!)writer.addWatchFactoryQueue(w.factoryQueue.i32[q*2]!);
  // Order targets (active move: its slot; queued moves: anchor + offset; stops: their point).
  const O = w.orders.i32;
  let rec = U.orderHead[idx]!;
  for (let n = 0; rec >= 0 && n < WATCH_MAX_TARGETS; n++) {
    const b = rec * ORDER_RECORD_WORDS;
    const tf = O[b + ORD_TYPE_FLAGS]!;
    const type = tf & 0xff;
    if (type === OrderType.Move && ((tf >> 8) & OrderBits.Begun) !== 0) writer.addWatchTarget(type, M.tx[r]!, M.tz[r]!);
    else if (type === OrderType.Move) writer.addWatchTarget(type, O[b + ORD_TX]! + offsetX(O[b + ORD_OFFSET]!), O[b + ORD_TZ]! + offsetZ(O[b + ORD_OFFSET]!));
    else writer.addWatchTarget(type, O[b + ORD_TX]!, O[b + ORD_TZ]!);
    rec = O[b + ORD_NEXT]!;
  }
  if (!moving) return;
  // Remaining route: side-step point, then the path (group: from the unit's own index, shifted by
  // its offset for display), unless the unit is on its final leg.
  let left = WATCH_MAX_POINTS;
  if ((mf & MoverBits.Detour) !== 0) {
    writer.addWatchPoint(M.wx[r]!, M.wz[r]!);
    left--;
  }
  if ((mf & MoverBits.FinalLeg) !== 0 || p < 0) return;
  const s = nav.pathState(p);
  if (s === PATH_PENDING) return;
  let skip = 0;
  let ox = 0;
  let oz = 0;
  if (group) {
    const d = M.wp[r]! - w.formations.col.consumed[f]!;
    skip = d > 0 ? d : 0;
    ox = offsetX(U.groupOffset[idx]!);
    oz = offsetZ(U.groupOffset[idx]!);
  }
  const pts = SC.points;
  const n = nav.remainingPoints(p, pts, left, skip);
  for (let k = 0; k < n; k++) {
    // The final point of the route is the anchor; the unit's own target is its slot (targets).
    const last = k === n - 1 && nav.pointAt(p, skip + k, SC.pt2) === WP_LAST;
    if (last) writer.addWatchPoint(M.tx[r]!, M.tz[r]!);
    else writer.addWatchPoint(pts[2 * k]! + ox, pts[2 * k + 1]! + oz);
  }
}
