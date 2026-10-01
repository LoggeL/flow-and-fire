/** Read-only filtered observations for host AI. Allocated only at scheduled AI ticks. */
import { visibleTo } from './intel.ts';
import { isActive } from './liveness.ts';
import { placementWorld } from './economy.ts';
import { canPlace, type PlacementRequest } from '@faf/rules';
import type { World } from './world.ts';
export interface PerceivedOrder { readonly kind:number;readonly x:number;readonly z:number;readonly target:number;readonly bp:number; }
export interface PerceivedUnit {
 readonly handle:number;readonly bp:number;readonly army:number;readonly x:number;readonly y:number;readonly z:number;readonly hp:number;readonly maxHp:number;
 readonly buildDone:number;readonly flags:number;readonly paused:boolean;readonly priority:number;readonly buildTarget:number;
 readonly orders:readonly PerceivedOrder[];readonly queue:readonly number[];readonly producingBp:number;readonly buildables:readonly number[]; readonly factoryRepeat:boolean;readonly producingProgress:number;
}
export interface SimPerception {
 readonly tick:number;readonly army:number;readonly ownUnits:readonly PerceivedUnit[];readonly visibleEnemies:readonly PerceivedUnit[];readonly knownAllies:readonly PerceivedUnit[];
 readonly spots:readonly {kind:number;x:number;z:number;explored:boolean}[];
 readonly economy:{massStored:number;energyStored:number;massCapacity:number;energyCapacity:number;massIncome:number;energyIncome:number;massDemand:number;energyDemand:number;massSpent:number;energySpent:number};
}
function unit(w:World,u:number,details:boolean):PerceivedUnit {
 const U=w.units.col,bp=U.bp[u]!,orders:PerceivedOrder[]=[],queue:number[]=[],buildables:number[]=[];
 if(details){for(let o=U.orderHead[u]!;o>=0;o=w.orders.i32[o*8+5]!){const b=o*8,kind=w.orders.i32[b]!&255,packed=w.orders.i32[b+6]!;orders.push({kind,x:w.orders.i32[b+1]!,z:w.orders.i32[b+2]!,target:kind===4||kind===5||kind===9||kind===10?packed>>>0:0xffffffff,bp:kind===3?packed&65535:-1});}
 for(let q=U.productionHead[u]!;q>=0;q=w.factoryQueue.i32[q*2+1]!)queue.push(w.factoryQueue.i32[q*2]!);
 for(let target=0;target<w.bp.count;target++)if(w.bp.canBuild(bp,target))buildables.push(target);}
 const target=details?w.units.resolve(U.buildTarget[u]!):-1;
 return {handle:w.units.handle(u),bp,army:U.army[u]!,x:U.x[u]!,y:U.y[u]!,z:U.z[u]!,hp:U.hp[u]!,maxHp:w.bp.maxHpCol[bp]!,buildDone:U.buildDone.get(u),flags:U.flags[u]!,paused:U.ecoPaused[u]===1,priority:details?U.ecoPriority[u]!:1,buildTarget:details?U.buildTarget[u]!:0xffffffff,orders,queue,producingBp:target>=0?U.bp[target]!:-1,producingProgress:target>=0?U.buildDone.get(target):0,factoryRepeat:details&&U.factoryRepeat[u]===1,buildables};
}
export function perceive(w:World,army:number):SimPerception {
 if(!Number.isInteger(army)||army<0||army>=w.armyCount)throw new RangeError('invalid perception army');
 const ownUnits:PerceivedUnit[]=[],visibleEnemies:PerceivedUnit[]=[],knownAllies:PerceivedUnit[]=[];
 for(let u=0;u<w.units.highWater;u++)if(isActive(w,u)){if(w.units.col.army[u]===army)ownUnits.push(unit(w,u,true));else if(visibleTo(w,army,u)){if(w.alliance.u8[army*16+w.units.col.army[u]!]===1)knownAllies.push(unit(w,u,false));else visibleEnemies.push(unit(w,u,false));}}
 const spots:{kind:number;x:number;z:number;explored:boolean}[]=[],dim=w.mapSizeWu>>3;
 for(let i=0;i<w.mapTerrain.i32[6]!;i++){const o=i*3,x=w.mapSpots.i32[o+1]!,z=w.mapSpots.i32[o+2]!,cell=Math.min(dim-1,z>>15)*dim+Math.min(dim-1,x>>15);spots.push({kind:w.mapSpots.i32[o]!,x,z,explored:w.header.i32[15]===0||(w.explored.u16[cell]!&(1<<army))!==0});}
 const A=w.armies.col;return {tick:w.tick,army,ownUnits,visibleEnemies,knownAllies,spots,economy:{massStored:A.massStored.get(army),energyStored:A.energyStored.get(army),massCapacity:A.massCapacity.get(army),energyCapacity:A.energyCapacity.get(army),massIncome:A.massIncome.get(army),energyIncome:A.energyIncome.get(army),massDemand:A.massDemand.get(army),energyDemand:A.energyDemand.get(army),massSpent:A.massSpent.get(army),energySpent:A.energySpent.get(army)}};
}
/** Authoritative placement check. AI must construct filtered occupancy from perceive instead. */
export function canPlaceForArmy(w:World,army:number,request:PlacementRequest):number {if(!Number.isInteger(army)||army<0||army>=w.armyCount)throw new RangeError('invalid placement army');return canPlace(placementWorld(w),request);}
