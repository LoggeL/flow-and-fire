/** MS4 deterministic flow and construction; all durable state is held by the arena. */
import { completeUpgrade, upgradeCostBp, upgradeTarget } from './upgrade.ts';
import { EventType, validateSkirmishInitialization, type SkirmishInitialization } from '@faf/protocol';
import { event, unitEventFlags, intelPhase } from './intel.ts';
import { WH_SKIRMISH,WH_FOG,WH_VICTORY,WH_WINNER } from './schema.ts';
import { SafeIntColumn } from '@faf/heap';
import { canPlace, cumulativeCost, ECO_ONE, footprintHeight, footprintWidth, footprintX, mulDiv, stallRatio, type PlacementRequest, type PlacementWorld } from '@faf/rules';
import { CAP_UNITS, NO_REF, UnitBits } from './constants.ts';
import { MT_SPOT_COUNT, ORD_OFFSET, ORD_TX, ORD_TZ, ORDER_RECORD_WORDS, WH_TICK } from './schema.ts';
import { setUnitPosition } from './terrain.ts';
import { isActive } from './liveness.ts';
import { spawnUnit } from './unit-storage.ts';
import type { World } from './world.ts';
// Reused scratch: recomputed from the arena each tick, never required for restore.
function scratchColumn(capacity:number):SafeIntColumn {const column=new SafeIntColumn();column.bindTo(new ArrayBuffer(capacity*8),0,capacity);return column;}
const BP = scratchColumn(CAP_UNITS), NEXT = new Int32Array(CAP_UNITS);
const DM = scratchColumn(16 * 3), DE = scratchColumn(16 * 3);
const ALLOC = scratchColumn(2);
const ACTIVE_TIERS = new Uint8Array(48);
const PM = scratchColumn(CAP_UNITS), PE = scratchColumn(CAP_UNITS), UM=scratchColumn(CAP_UNITS), UE=scratchColumn(CAP_UNITS);
const PLACE: PlacementWorld & {
    terrain: World['terrain'];
    waterLevelRaw: number | null;
    terrainCells: Uint8Array;
    footprints: Uint8Array;
    spots: Int32Array;
    spotCount: number;
} = {
    terrain: { sizeWu: 64, dim: 65, heights: new Uint16Array(0), heightScaleRaw: 1 }, waterLevelRaw: null, terrainCells: new Uint8Array(0), footprints: new Uint8Array(0), spots: new Int32Array(0), spotCount: 0,
};
const REQUEST: PlacementRequest & {
    x: number;
    z: number;
    w: number;
    h: number;
    yaw: number;
    maxSlopeRaw: number;
    spotKind: number;
} = { x: 0, z: 0, w: 1, h: 1, yaw: 0, maxSlopeRaw: 0, spotKind: -1 };
export function placementWorld(w: World): PlacementWorld {
    PLACE.terrain = w.terrain;
    PLACE.waterLevelRaw = w.hasWater ? w.waterLevel : null;
    PLACE.terrainCells = w.navTerrain;
    PLACE.footprints = w.nav.st.foot;
    PLACE.spots = w.mapSpots.i32;
    PLACE.spotCount = w.mapTerrain.i32[MT_SPOT_COUNT]!;
    return PLACE;
}
export function placementVerdict(w: World, bp: number, x: number, z: number, yaw: number): number {
    const t = w.bp;
    REQUEST.x = x;
    REQUEST.z = z;
    REQUEST.w = t.footprintWCol[bp]!;
    REQUEST.h = t.footprintHCol[bp]!;
    REQUEST.yaw = yaw;
    REQUEST.maxSlopeRaw = t.maxSlopeCol[bp]!;
    REQUEST.spotKind = t.spotKindCol[bp]!;
    return canPlace(placementWorld(w), REQUEST);
}
/** Finds a resumable, owned structure with the identical blueprint and footprint. */
export function buildSite(w: World, army: number, bp: number, x: number, z: number, yaw: number): number {
    const U = w.units.col;
    for (let i = 0; i < w.units.highWater; i++)
        if (isActive(w, i) && U.army[i] === army && U.bp[i] === bp && U.x[i] === x && U.z[i] === z && U.yaw[i] === yaw)
            return i;
    return NO_REF;
}
export function startBuildSite(w: World, builder: number, rec: number): number {
    const U = w.units.col, O = w.orders.i32, b = rec * ORDER_RECORD_WORDS, packed = O[b + ORD_OFFSET]!, bp = packed & 65535, yaw = packed >>> 16, x = O[b + ORD_TX]!, z = O[b + ORD_TZ]!, army = U.army[builder]!;
    let site = buildSite(w, army, bp, x, z, yaw);
    if (site >= 0)
        return site;
    if (placementVerdict(w, bp, x, z, yaw) !== 0)
        return NO_REF;
    site = spawnUnit(w, bp, army, x, z, yaw);
    if (site < 0)
        return NO_REF;
    const fw = footprintWidth(w.bp.footprintWCol[bp]!, w.bp.footprintHCol[bp]!, yaw), fh = footprintHeight(w.bp.footprintWCol[bp]!, w.bp.footprintHCol[bp]!, yaw), fx = footprintX(x, fw), fz = footprintX(z, fh);
    U.buildDone.set(site, 0);
    U.hp[site] = 1;
    U.ecoPriority[site] = U.ecoPriority[builder]!;
    U.flags[site] = U.flags[site]! | UnitBits.UnderConstruction | UnitBits.Footprint;
    U.footX[site] = fx;
    U.footZ[site] = fz;
    U.footW[site] = fw;
    U.footH[site] = fh;
    w.nav.stampFootprint(fx, fz, fw, fh, 1);
    const E = w.footprintEvents.i32, n = E[0]!;
    if (n < CAP_UNITS) {
        const o = 1 + n * 6;
        E[o] = fx;
        E[o + 1] = fz;
        E[o + 2] = fw;
        E[o + 3] = fh;
        E[o + 4] = 1;
        E[o + 5] = w.units.handle(site);
        E[0] = n + 1;
    }
    // A builder standing inside a newly stamped footprint must leave it immediately.
    for (let i = 0; i < w.units.highWater; i++) {
        if (i === site || !isActive(w, i) || w.bp.speed[U.bp[i]!]! === 0)
            continue;
        const cx = U.x[i]! >> 12, cz = U.z[i]! >> 12;
        if (cx >= fx && cx < fx + fw && cz >= fz && cz < fz + fh) {
            const c = w.nav.nearestPassable(1, cx, cz);
            if (c >= 0)
                setUnitPosition(w, i, (c % w.mapSizeWu) * 4096 + 2048, Math.floor(c / w.mapSizeWu) * 4096 + 2048);
        }
    }
    return site;
}
function inRange(w: World, builder: number, site: number): boolean {
    const U = w.units.col, dx = U.x[builder]! - U.x[site]!, dz = U.z[builder]! - U.z[site]!, r = w.bp.buildRangeRawCol[U.bp[builder]!]!;
    return U.productionHead[builder]!>=0 || dx * dx + dz * dz <= r * r;
}
function repairing(w:World,i:number):boolean{return (w.units.col.flags[i]!&UnitBits.UnderConstruction)===0;}
function done(w:World,i:number):number{return repairing(w,i)?w.units.col.repairDone.get(i):w.units.col.buildDone.get(i);}
function limit(w:World,i:number):number{if(upgradeTarget(w,i)>=0)return 65536;const U=w.units.col;return repairing(w,i)?done(w,i)+Math.floor(((w.bp.maxHpCol[U.bp[i]!]!-U.hp[i]!)*65536+w.bp.maxHpCol[U.bp[i]!]!-1)/w.bp.maxHpCol[U.bp[i]!]!):65536;}
function paidM(w:World,i:number):number{return repairing(w,i)?w.units.col.repairPaidMass.get(i):w.units.col.buildPaidMass.get(i);}
function paidE(w:World,i:number):number{return repairing(w,i)?w.units.col.repairPaidEnergy.get(i):w.units.col.buildPaidEnergy.get(i);}
/** Construction bills the site; self upgrades bill the added module or successor while retaining old stats. */
function workBp(w: World, i: number): number { const target = upgradeTarget(w, i); return target >= 0 ? upgradeCostBp(w, w.units.col.bp[i]!, target) : w.units.col.bp[i]!; }
/** Preview tier billing before mutation; cumulative rounding cannot overdraw a bank. */
function tierCost(w: World, army: number, priority: number, ratio: number): void {
    const U = w.units.col, t = w.bp;
    let m = 0, e = 0;
    for (let i = 0; i < w.units.highWater; i++) {
        if (!isActive(w, i) || U.army[i] !== army || U.ecoPriority[i] !== priority)
            continue;
        const bp = workBp(w, i);
        if (BP.get(i) > 0) {
            const rate = mulDiv(BP.get(i), ratio, ECO_ONE), num = rate + U.buildRemainder.get(i), time = t.buildTimeCol[bp]!;
            const inc = Math.min(limit(w,i) - done(w,i), Math.floor(num / time));
            m += cumulativeCost(t.massCostCol[bp]! * 1000, done(w,i) + inc) - paidM(w,i)+mulDiv(UM.get(i),ratio,ECO_ONE);
            e += cumulativeCost(t.energyCostCol[bp]! * 1000, done(w,i) + inc) - paidE(w,i)+mulDiv(UE.get(i),ratio,ECO_ONE);
        }
        else if ((t.ecoFlagsCol[bp]! & 1) === 0 || ratio === ECO_ONE) {
            m += mulDiv(PM.get(i), ratio, ECO_ONE);
            e += mulDiv(PE.get(i), ratio, ECO_ONE);
        }
    }
    ALLOC.set(0, m);
    ALLOC.set(1, e);
}
export function economyPhase(w: World): void {
    const U = w.units.col, A = w.armies.col, t = w.bp, tick = w.header.i32[WH_TICK]!;
    for(let i=0;i<CAP_UNITS;i++){BP.zero(i);PM.zero(i);PE.zero(i);}
    NEXT.fill(0);
    w.frameFlowTick = tick;
    for(let i=0;i<w.units.highWater;i++){w.frameFlowSpentMass.zero(i);w.frameFlowSpentEnergy.zero(i);}
    w.frameFlowContributor.fill(0);w.frameFlowHandles.fill(0);
    w.frameEconomyEvents.fill(0);
    ACTIVE_TIERS.fill(0);
    for(let i=0;i<48;i++){DM.zero(i);DE.zero(i);}
    for (let a = 0; a < w.armyCount; a++) {
        w.framePreviousStall[a] = A.stallFlags[a]!;
        w.framePreviousOverflow[a] = (A.massOverflow.get(a)>0?1:0)|(A.energyOverflow.get(a)>0?2:0);
        A.massCapacity.set(a, 0);
        A.energyCapacity.set(a, 0);
        A.massIncome.set(a, 0);
        A.energyIncome.set(a, 0);
        A.massDemand.set(a, 0);
        A.energyDemand.set(a, 0);
        A.massSpent.set(a, 0);
        A.energySpent.set(a, 0);
        A.massOverflow.set(a, 0);
        A.energyOverflow.set(a, 0);
    }
    for (let i = 0; i < w.units.highWater; i++) {
        if (!isActive(w, i))
            continue;
        const bp = U.bp[i]!, a = U.army[i]!;
        const previousRatio=U.ecoRatio[i]!;
        U.ecoRatio[i] = ECO_ONE;
        if ((U.flags[i]! & UnitBits.UnderConstruction) === 0) {
            A.massCapacity.set(a, A.massCapacity.get(a) + t.massStorageMilliCol[bp]!);
            A.energyCapacity.set(a, A.energyCapacity.get(a) + t.energyStorageMilliCol[bp]!);
            if (U.ecoPaused[i] === 0 && (U.ecoEnabled[i] !== 0 || tick >= U.ecoOffUntil[i]!)) {
                U.ecoEnabled[i] = 1;
                A.massIncome.set(a, A.massIncome.get(a) + mulDiv(t.massIncomeMilliPerTickCol[bp]!, (t.massUpkeepMilliPerTickCol[bp]!>0||t.energyUpkeepMilliPerTickCol[bp]!>0)?previousRatio:ECO_ONE, ECO_ONE));
                A.energyIncome.set(a, A.energyIncome.get(a) + mulDiv(t.energyIncomeMilliPerTickCol[bp]!, (t.massUpkeepMilliPerTickCol[bp]!>0||t.energyUpkeepMilliPerTickCol[bp]!>0)?previousRatio:ECO_ONE, ECO_ONE));
                PM.set(i, t.massUpkeepMilliPerTickCol[bp]!);
                PE.set(i, t.energyUpkeepMilliPerTickCol[bp]!);
            }
        }
        if (U.ecoPaused[i] !== 0 || t.buildPowerQ16PerTickCol[bp] === 0)
            continue;
        const upgrade = upgradeTarget(w, i);
        if (upgrade >= 0) {
            BP.set(i, t.buildPowerQ16PerTickCol[bp]!);
            w.frameFlowContributor[i] = 1;
            continue;
        }
        const target = w.units.resolve(U.buildTarget[i]!|0);
        if (target >= 0 && isActive(w, target) && upgradeTarget(w, target) < 0 && ((U.flags[target]! & UnitBits.UnderConstruction) !== 0 || (U.orderHead[i]!>=0&&(w.orders.i32[U.orderHead[i]!*8]!&255)===9&&U.hp[target]!<t.maxHpCol[U.bp[target]!]!)) && U.ecoPaused[target]===0 && inRange(w, i, target)) {
            BP.set(target, BP.get(target) + t.buildPowerQ16PerTickCol[bp]!);
            w.frameFlowContributor[i] = 1;
        }
    }
    for (let i = 0; i < w.units.highWater; i++) {
        if (!isActive(w, i))
            continue;
        const bp = workBp(w, i), a = U.army[i]!, k = a * 3 + U.ecoPriority[i]!;
        UM.set(i,PM.get(i));UE.set(i,PE.get(i));
        if (BP.get(i) > 0) {
            const numerator = BP.get(i) + U.buildRemainder.get(i), time = t.buildTimeCol[bp]!;
            const increment = Math.min(limit(w,i) - done(w,i), Math.floor(numerator / time));
            NEXT[i] = increment;
            PM.set(i, Math.max(cumulativeCost(t.massCostCol[bp]! * 1000, done(w,i) + increment) - paidM(w,i), mulDiv(t.massCostCol[bp]! * 1000, BP.get(i), time * ECO_ONE))+UM.get(i));
            PE.set(i, Math.max(cumulativeCost(t.energyCostCol[bp]! * 1000, done(w,i) + increment) - paidE(w,i), mulDiv(t.energyCostCol[bp]! * 1000, BP.get(i), time * ECO_ONE))+UE.get(i));
        }
        w.frameFlowHandles[i] = w.units.handle(i);
        w.frameFlowDemandMass.set(i,PM.get(i));w.frameFlowDemandEnergy.set(i,PE.get(i));
        w.frameFlowPower.set(i,BP.get(i));
        if(BP.get(i)>0||PM.get(i)>0||PE.get(i)>0)ACTIVE_TIERS[k]=1;
        DM.set(k, DM.get(k) + PM.get(i));
        DE.set(k, DE.get(k) + PE.get(i));
    }
    for (let a = 0; a < w.armyCount; a++) {
        // Income can be used during this tick even when storage is full. Overflow is after spending.
        A.massIncome.set(a,mulDiv(A.massIncome.get(a),A.incomeFactor[a]!,65536));
        A.energyIncome.set(a,mulDiv(A.energyIncome.get(a),A.incomeFactor[a]!,65536));
        let mass = A.massStored.get(a) + A.massIncome.get(a), energy = A.energyStored.get(a) + A.energyIncome.get(a);
        let md = 0, ed = 0, massShort = false, energyShort = false;
        for (let p = 0; p < 3; p++) {
            const k = a * 3 + p;
            md += DM.get(k);
            ed += DE.get(k);
            if (mass < DM.get(k))
                massShort = true;
            if (energy < DE.get(k))
                energyShort = true;
            if(ACTIVE_TIERS[k]===0){
                if(p===0)A.ratioHigh[a]=ECO_ONE;else if(p===1)A.ratioNormal[a]=ECO_ONE;else A.ratioLow[a]=ECO_ONE;
                continue;
            }
            let ratio = Math.min(stallRatio(mass, DM.get(k)), stallRatio(energy, DE.get(k)));
            tierCost(w, a, p, ratio);
            if (ALLOC.get(0) > mass || ALLOC.get(1) > energy) {
                let low = 0, high = ratio;
                while (low < high) {
                    const mid = Math.floor((low + high + 1) / 2);
                    tierCost(w, a, p, mid);
                    if (ALLOC.get(0) <= mass && ALLOC.get(1) <= energy)
                        low = mid;
                    else
                        high = mid - 1;
                }
                ratio = low;
            }
            if (p === 0)
                A.ratioHigh[a] = ratio;
            else if (p === 1)
                A.ratioNormal[a] = ratio;
            else
                A.ratioLow[a] = ratio;
            // Sum consumer allocations, rather than rounding the aggregate once (no slot-order preference).
            let spentM = 0, spentE = 0;
            for (let i = 0; i < w.units.highWater; i++) {
                if (!isActive(w, i) || U.army[i] !== a || U.ecoPriority[i] !== p)
                    continue;
                U.ecoRatio[i] = BP.get(i)>0||PM.get(i)>0||PE.get(i)>0?ratio:ECO_ONE;
                const bp = workBp(w, i);
                if (BP.get(i) > 0) {
                    const rate = mulDiv(BP.get(i), ratio, ECO_ONE), num = rate + U.buildRemainder.get(i), time = t.buildTimeCol[bp]!;
                    const inc = Math.min(limit(w,i) - done(w,i), Math.floor(num / time));
                    NEXT[i] = inc;
                    U.buildRemainder.set(i, num % time);
                    PM.set(i, cumulativeCost(t.massCostCol[bp]! * 1000, done(w,i) + inc) - paidM(w,i)+mulDiv(UM.get(i),ratio,ECO_ONE));
                    PE.set(i, cumulativeCost(t.energyCostCol[bp]! * 1000, done(w,i) + inc) - paidE(w,i)+mulDiv(UE.get(i),ratio,ECO_ONE));
                }
                else if ((t.ecoFlagsCol[bp]! & 1) !== 0 && (PM.get(i) > 0 || PE.get(i) > 0) && ratio < ECO_ONE) {
                    U.ecoEnabled[i] = 0;
                    U.ecoOffUntil[i] = tick + 30;
                    PM.set(i, 0);
                    PE.set(i, 0);
                }
                else {
                    PM.set(i, mulDiv(PM.get(i), ratio, ECO_ONE));
                    PE.set(i, mulDiv(PE.get(i), ratio, ECO_ONE));
                }
                w.frameFlowSpentMass.set(i,PM.get(i));w.frameFlowSpentEnergy.set(i,PE.get(i));
                spentM += PM.get(i);
                spentE += PE.get(i);
            }
            mass -= spentM;
            energy -= spentE;
            A.massSpent.set(a, A.massSpent.get(a) + spentM);
            A.energySpent.set(a, A.energySpent.get(a) + spentE);
        }
        if (mass < 0 || energy < 0)
            throw new RangeError('economy overspend');
        A.massDemand.set(a, md);
        A.energyDemand.set(a, ed);
        A.massOverflow.set(a, Math.max(0, mass - A.massCapacity.get(a)));
        A.energyOverflow.set(a, Math.max(0, energy - A.energyCapacity.get(a)));
        A.massStored.set(a, Math.min(mass, A.massCapacity.get(a)));
        A.energyStored.set(a, Math.min(energy, A.energyCapacity.get(a)));
        if (massShort) {
            A.stallFlags[a] = A.stallFlags[a]! | 1;
            A.massStallUntil[a] = tick + 30;
        }
        else if (tick >= A.massStallUntil[a]!)
            A.stallFlags[a] = A.stallFlags[a]! & ~1;
        if (energyShort) {
            A.stallFlags[a] = A.stallFlags[a]! | 2;
            A.energyStallUntil[a] = tick + 30;
        }
        else if (tick >= A.energyStallUntil[a]!)
            A.stallFlags[a] = A.stallFlags[a]! & ~2;
        w.frameEconomyEvents[a] = (A.stallFlags[a]! & ~w.framePreviousStall[a]!) |
          (A.massOverflow.get(a)>0&&(w.framePreviousOverflow[a]!&1)===0?4:0) |
          (A.energyOverflow.get(a)>0&&(w.framePreviousOverflow[a]!&2)===0?8:0);
    }
}
export function constructionPhase(w: World): void {
    const U = w.units.col, t = w.bp;
    for (let i = 0; i < w.units.highWater; i++) {
        if (!isActive(w, i) || BP.get(i) === 0)
            continue;
        const upgrade = upgradeTarget(w, i), bp = upgrade >= 0 ? upgradeCostBp(w, U.bp[i]!, upgrade) : U.bp[i]!;
        if (upgrade >= 0) {
            const after = U.repairDone.get(i) + NEXT[i]!;
            U.repairDone.set(i, after);
            U.repairPaidMass.set(i, cumulativeCost(t.massCostCol[bp]! * 1000, after));
            U.repairPaidEnergy.set(i, cumulativeCost(t.energyCostCol[bp]! * 1000, after));
            if (after === ECO_ONE) completeUpgrade(w, i, upgrade);
            continue;
        }
        if(repairing(w,i)){
          const before=U.repairDone.get(i),after=before+NEXT[i]!;U.repairDone.set(i,after);
          U.hp[i]=Math.min(t.maxHpCol[bp]!,U.hp[i]!+mulDiv(t.maxHpCol[bp]!,after,65536)-mulDiv(t.maxHpCol[bp]!,before,65536));
          U.repairPaidMass.set(i,cumulativeCost(t.massCostCol[bp]!*1000,after));U.repairPaidEnergy.set(i,cumulativeCost(t.energyCostCol[bp]!*1000,after));continue;
        }
        const previousHp=mulDiv(t.maxHpCol[bp]!,U.buildDone.get(i),ECO_ONE);
        U.buildDone.set(i, U.buildDone.get(i) + NEXT[i]!);
        U.buildPaidMass.set(i, U.buildPaidMass.get(i) + PM.get(i));
        U.buildPaidEnergy.set(i, U.buildPaidEnergy.get(i) + PE.get(i));
        const currentHp=mulDiv(t.maxHpCol[bp]!,U.buildDone.get(i),ECO_ONE);
        U.hp[i]=Math.max(1,Math.min(currentHp,U.hp[i]!+currentHp-previousHp));
        if (U.buildDone.get(i) === ECO_ONE) {
            U.flags[i] = U.flags[i]! & ~UnitBits.UnderConstruction;
            event(w,EventType.BuildComplete,bp,i,0,unitEventFlags(w,bp));
            U.buildRemainder.set(i, 0);
        }
    }
    // A builder displays the allocation of its shared site, including paused/stalled builders.
    for (let i = 0; i < w.units.highWater; i++)
        if (isActive(w, i)) {
            const target = w.units.resolve(U.buildTarget[i]!|0);
            if (target >= 0)
                U.ecoRatio[i] = U.ecoRatio[target]!;
        }
}
/** Initial spawn is opt-in; legacy/headless movement worlds remain empty. */
export function initializeSkirmish(w: World, input: number | SkirmishInitialization = 0): void {
  if(w.tick!==0||w.units.liveCount!==0)throw new RangeError('skirmish setup requires an empty tick-zero world');
  const setup:SkirmishInitialization=typeof input==='number'?{kind:'skirmish',faction:input}:input;
  validateSkirmishInitialization(setup,w.armyCount);
  const starts=w.mapStarts.i32,indices:number[]=[],bps:number[]=[],teams:number[]=[];
  for(let a=0;a<w.armyCount;a++){
    const slot=setup.slots?.[a];let index=slot?.start??-1;
    if(slot===undefined)for(let i=0;i<w.mapTerrain.i32[5]!;i++)if(starts[i*3]===a){index=i;break;}
    if(index<0||index>=w.mapTerrain.i32[5]!)throw new RangeError(`missing start for army ${a}`);
    const bp=w.bp.factionStartUnitCol[slot?.faction??setup.faction];if(bp===undefined||bp>=w.bp.count)throw new RangeError('unknown faction');
    indices.push(index);bps.push(bp);teams.push(slot?.team??a);
  }
  const H=w.header.i32;H[WH_SKIRMISH]=1;H[WH_FOG]=setup.rules?.fog==='revealed'?0:1;
  H[WH_VICTORY]=setup.rules?.victory==='annihilation'?2:setup.rules?.victory==='supremacy'?1:0;H[WH_WINNER]=-1;
  for(let a=0;a<w.armyCount;a++){
    const bp=bps[a]!,o=indices[a]!*3,A=w.armies.col;
    A.team[a]=teams[a]!;A.unitCap[a]=setup.rules?.unitCap??A.unitCap[a]!;A.incomeFactor[a]=setup.slots?.[a]?.aixFactorQ16??65536;
    for(let b=0;b<w.armyCount;b++)w.alliance.u8[a*16+b]=teams[a]===teams[b]?1:0;
    const u=spawnUnit(w,bp,a,starts[o+1]!,starts[o+2]!,a===0?0:32768);if(u<0)throw new RangeError('commander spawn failed');
    A.massStored.set(a,w.bp.massStorageMilliCol[bp]!);A.energyStored.set(a,w.bp.energyStorageMilliCol[bp]!);
    A.massIncome.set(a,mulDiv(w.bp.massIncomeMilliPerTickCol[bp]!,A.incomeFactor[a]!,65536));A.energyIncome.set(a,mulDiv(w.bp.energyIncomeMilliPerTickCol[bp]!,A.incomeFactor[a]!,65536));
    A.massCapacity.set(a,w.bp.massStorageMilliCol[bp]!);A.energyCapacity.set(a,w.bp.energyStorageMilliCol[bp]!);
  }
  intelPhase(w);
}
