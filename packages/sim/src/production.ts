/** Factory queues and rolloff share the economy's exact construction billing. */
import { HANDLE_NONE } from '@faf/heap';
import { hasCategory } from './intel.ts';
import { UnitBits, MoverBits, MoverState } from './constants.ts';
import { clearOrders, pushOrder } from './orders.ts';
import { isActive } from './liveness.ts';
import { spawnUnit } from './unit-storage.ts';
import type { World } from './world.ts';
export function isFactory(w:World,u:number):boolean {return hasCategory(w,w.units.col.bp[u]!,'FACTORY');}
export function clearProduction(w:World,u:number,cancelActive=false):void {
  const U=w.units.col,Q=w.factoryQueue.i32,target=w.units.resolve(U.buildTarget[u]!|0),head=U.productionHead[u]!;
  const keep=!cancelActive&&target>=0&&isActive(w,target)&&(U.flags[target]!&UnitBits.UnderConstruction)!==0&&head>=0;
  let q=keep?Q[head*2+1]!:head;while(q>=0){const next=Q[q*2+1]!;w.factoryQueue.free(q);q=next;}
  if(keep){Q[head*2+1]=-1;U.productionTail[u]=head;U.productionCount[u]=1;U.productionActiveRepeat[u]=0;}
  else{U.productionHead[u]=-1;U.productionTail[u]=-1;U.productionCount[u]=0;U.buildTarget[u]=HANDLE_NONE;}
}
export function queueProduction(w:World,u:number,bp:number,count:number,append:boolean):void {
  const U=w.units.col;if(!append)clearProduction(w,u);
  const Q=w.factoryQueue.i32;for(let k=0;k<count&&U.productionCount[u]!<32;k++){
    const q=w.factoryQueue.alloc();if(q<0)break;Q[q*2]=bp;Q[q*2+1]=-1;const tail=U.productionTail[u]!;
    if(tail<0)U.productionHead[u]=q;else Q[tail*2+1]=q;U.productionTail[u]=q;U.productionCount[u]=U.productionCount[u]!+1;
  }
}
function pop(w:World,u:number):void {
  const U=w.units.col,q=U.productionHead[u]!;if(q<0)return;const bp=w.factoryQueue.i32[q*2]!;
  U.productionHead[u]=w.factoryQueue.i32[q*2+1]!;if(U.productionHead[u]!<0)U.productionTail[u]=-1;
  w.factoryQueue.free(q);U.productionCount[u]=U.productionCount[u]!-1;
  if(U.factoryRepeat[u]===1&&U.productionActiveRepeat[u]===1)queueProduction(w,u,bp,1,true);
}
/** Start before Economy, complete after Construction. Capacity stalls retain their queue. */
export function productionPhase(w:World,complete=false):void {
  const U=w.units.col,B=w.bp;
  for(let u=0;u<w.units.highWater;u++){
    if((U.productionHead[u]!<0&&(U.buildTarget[u]!|0)===-1)||!isActive(w,u)||!isFactory(w,u)||(U.flags[u]!&UnitBits.UnderConstruction)!==0||U.ecoPaused[u]===1)continue;
    let t=w.units.resolve(U.buildTarget[u]!|0);
    if(t>=0&&!isActive(w,t)){U.buildTarget[u]=HANDLE_NONE;pop(w,u);t=-1;}
    if(complete){
      if(t>=0&&(U.flags[t]!&UnitBits.UnderConstruction)===0){
        U.buildTarget[u]=HANDLE_NONE;pop(w,u);const r=U.mover[t]!;
        clearOrders(w,t,r);pushOrder(w,t,r,1,U.rallyX[u]!,U.rallyZ[u]!, -1,0);
      }continue;
    }
    if(t>=0||U.productionHead[u]!<0)continue;
    const bp=w.factoryQueue.i32[U.productionHead[u]!*2]!,baseBp=U.bp[u]!,d=(B.footprintW(baseBp)*2048+B.radiusCol[bp]!+4096);
    let x=U.x[u]!+d,z=U.z[u]!;const cls=Math.max(1,B.sizeClassCol[bp]!);
    const cell=w.nav.nearestPassable(Math.min(3,cls),Math.min(w.mapSizeWu-1,Math.max(0,x>>12)),Math.min(w.mapSizeWu-1,Math.max(0,z>>12)));
    if(cell<0)continue;x=(cell%w.mapSizeWu)*4096+2048;z=Math.floor(cell/w.mapSizeWu)*4096+2048;
    t=spawnUnit(w,bp,U.army[u]!,x,z,U.yaw[u]!);if(t<0)continue;
    U.flags[t]=U.flags[t]!|UnitBits.UnderConstruction;U.buildDone.set(t,0);U.hp[t]=1;U.ecoPriority[t]=U.ecoPriority[u]!;
    U.buildTarget[u]=w.units.handle(t);U.productionActiveRepeat[u]=1;const r=U.mover[t]!;w.movers.col.state[r]=MoverState.Idle;w.movers.col.flags[r]=MoverBits.Asleep;
  }
}

export function editProduction(w:World,u:number,action:number,index:number,bp:number,count:number):void {
 const U=w.units.col,Q=w.factoryQueue.i32,head=U.productionHead[u]!,target=w.units.resolve(U.buildTarget[u]!|0),active=head>=0&&target>=0&&isActive(w,target);
 if(action===0){clearProduction(w,u);return;}
 if(action===1){
  if(index<0||index>=U.productionCount[u]!||(active&&index===0))return;
  let prev=-1,q=head;for(let i=0;i<index&&q>=0;i++){prev=q;q=Q[q*2+1]!;}
  for(let i=0;i<count&&q>=0;i++){const next=Q[q*2+1]!;w.factoryQueue.free(q);U.productionCount[u]=U.productionCount[u]!-1;q=next;}
  if(prev<0)U.productionHead[u]=q;else Q[prev*2+1]=q;if(q<0)U.productionTail[u]=prev;return;
 }
 const after=active?head:-1;const next=after>=0?Q[after*2+1]!:head;let first=-1,last=-1;
 for(let i=0;i<count&&U.productionCount[u]!<32;i++){const q=w.factoryQueue.alloc();if(q<0)break;Q[q*2]=bp;Q[q*2+1]=-1;if(first<0)first=q;else Q[last*2+1]=q;last=q;U.productionCount[u]=U.productionCount[u]!+1;}
 if(first<0)return;Q[last*2+1]=next;if(after<0)U.productionHead[u]=first;else Q[after*2+1]=first;if(next<0)U.productionTail[u]=last;
}
