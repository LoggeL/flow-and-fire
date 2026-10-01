/** Wreck handle namespace: index bit19 marks Wrecks; all12 generation bits are preserved. */
import { mulDiv } from '@faf/rules';
import { hasCategory } from './intel.ts';
import { isActive } from './liveness.ts';
import type { World } from './world.ts';
export const WRECK_HANDLE_BIT=0x00080000;
export function wreckHandle(w:World,r:number):number{return (w.wrecks.handle(r)|WRECK_HANDLE_BIT)>>>0;}
export function resolveWreck(w:World,h:number):number{return (h&WRECK_HANDLE_BIT)!==0?w.wrecks.resolve(h&~WRECK_HANDLE_BIT):-1;}
const DEMAND=new Int32Array(4096),REQUEST=new Int32Array(8192),TARGET=new Int32Array(8192);
export function reclaimPhase(w:World):void {
 DEMAND.fill(0);REQUEST.fill(0);TARGET.fill(-1);const U=w.units.col;
 for(let u=0;u<w.units.highWater;u++){
  if(!isActive(w,u)||U.ecoPaused[u]===1||!hasCategory(w,U.bp[u]!,'RECLAIM')||U.orderHead[u]!<0)continue;
  const rec=U.orderHead[u]!*8;if((w.orders.i32[rec]!&255)!==11)continue;
  const r=resolveWreck(w,w.orders.i32[rec+6]!>>>0);if(r<0)continue;
  const dx=U.x[u]!-w.wrecks.col.x[r]!,dz=U.z[u]!-w.wrecks.col.z[r]!,range=w.bp.buildRangeRawCol[U.bp[u]!]!;if(dx*dx+dz*dz>range*range)continue;
  const amount=mulDiv(w.bp.buildPowerQ16PerTickCol[U.bp[u]!]!,1000,65536);REQUEST[u]=amount;TARGET[u]=r;DEMAND[r]=DEMAND[r]!+amount;
 }
 // Demand is collected before any resources are removed; all builders receive proportional shares.
 for(let r=0;r<w.wrecks.highWater;r++)if(w.wrecks.isLive(r)&&DEMAND[r]!>0){
  const remaining=w.wrecks.col.remaining.get(r),total=Math.min(remaining,DEMAND[r]!);let paid=0;
  for(let u=0;u<w.units.highWater;u++)if(TARGET[u]===r){const amount=mulDiv(REQUEST[u]!,total,DEMAND[r]!);REQUEST[u]=amount;paid+=amount;}
  let residue=total-paid;for(let u=0;u<w.units.highWater&&residue>0;u++)if(TARGET[u]===r){REQUEST[u]=REQUEST[u]!+1;residue--;}
  for(let u=0;u<w.units.highWater;u++)if(TARGET[u]===r){const a=U.army[u]!,A=w.armies.col,amount=REQUEST[u]!,sum=A.massStored.get(a)+amount;A.massOverflow.set(a,A.massOverflow.get(a)+Math.max(0,sum-A.massCapacity.get(a)));A.massStored.set(a,Math.min(A.massCapacity.get(a),sum));}
  w.wrecks.col.remaining.set(r,remaining-total);if(remaining===total)w.wrecks.free(r);
 }
}
