/** Deterministic combat/intel state. Legacy movement worlds never enter these phases. */
import { angDiff, angToDir, angRotateTowards, asAng16, atan2A, isqrt } from '@faf/fixed';
import { HANDLE_NONE } from '@faf/heap';
import { mulDiv } from '@faf/rules';
import { EventType } from '@faf/protocol';
import { UnitBits } from './constants.ts';
import { WH_SKIRMISH, WH_VICTORY, WH_MATCH_END, WH_WINNER } from './schema.ts';
import { terrainHeight } from './terrain.ts';
import { isActive } from './liveness.ts';
import { killUnit } from './lifecycle.ts';
import { allied,visibleTo,hasCategory,event,unitEventFlags } from './intel.ts';
import type { World } from './world.ts';
const HOMING_DIR=new Int32Array(2);
function segmentRatio(dot:number,length:number):number {return length<=0||dot<=0?0:dot>=length?65536:mulDiv(dot,65536,length);}
function validTarget(w:World,u:number,t:number,mount:number):boolean {
  const U=w.units.col;if(t<0||!isActive(w,t)||allied(w,U.army[u]!,U.army[t]!)||!visibleTo(w,U.army[u]!,t))return false;
  return (w.bp.mountLayerMaskCol[mount]!&(1<<U.layer[t]!))!==0;
}
function priority(w:World,bp:number,mount:number):number {const B=w.bp,start=B.mountPriorityFirstCol[mount]!,count=B.mountPriorityCountCol[mount]!;for(let i=0;i<count;i++)if(B.unitMatchesExpr(bp,B.priorityList[start+i]!))return i;return count;}
function chooseTarget(w:World,u:number,mount:number,weapon:number):number {
  const U=w.units.col,W=w.bp;let t=w.units.resolve(U.attackTarget[u]!);
  if(validTarget(w,u,t,mount))return t;
  if(U.fireState[u]===0)return -1;
  if(U.fireState[u]===1){t=w.units.resolve(U.lastHitBy[u]!);return validTarget(w,u,t,mount)?t:-1;}
  let best=-1,bestP=65535,bestD=Number.MAX_SAFE_INTEGER;const range=W.weaponRangeCol[weapon]!,min=W.weaponMinRangeCol[weapon]!;
  for(let v=0;v<w.units.highWater;v++)if(validTarget(w,u,v,mount)){
    const dx=U.x[v]!-U.x[u]!,dz=U.z[v]!-U.z[u]!,d=dx*dx+dz*dz;if(d>range*range||d<min*min)continue;
    const p=priority(w,U.bp[v]!,mount);if(p<bestP||(p===bestP&&d<bestD)){best=v;bestP=p;bestD=d;}
  }return best;
}
export function weaponsPhase(w:World):void {
  if(w.header.i32[WH_SKIRMISH]===0||w.header.i32[WH_MATCH_END]!>0)return;
  const U=w.units.col,B=w.bp,S=w.weapons.i32;
  for(let u=0;u<w.units.highWater;u++){
    const target=w.units.resolve(U.overchargeTarget[u]!);if(isActive(w,u)&&target>=0&&isActive(w,target)){
      const army=U.army[u]!,energy=w.armies.col.energyStored.get(army),dx=U.x[target]!-U.x[u]!,dz=U.z[target]!-U.z[u]!;let weapon=-1;
      for(let wi=0;wi<B.weaponCount;wi++)if((B.weaponFlagsCol[wi]!&1)!==0){weapon=wi;break;}
      if(weapon>=0&&energy>=7500000&&dx*dx+dz*dz<=B.weaponRangeCol[weapon]!*B.weaponRangeCol[weapon]!) {
        const p=w.projectiles.alloc();if(p>=0){const P=w.projectiles.col;let health=1250;
          for(let v=0;v<w.units.highWater;v++)if(isActive(w,v)&&hasCategory(w,U.bp[v]!,'MOBILE')&&!hasCategory(w,U.bp[v]!,'COMMAND')){const ex=U.x[v]!-U.x[target]!,ez=U.z[v]!-U.z[target]!;if(ex*ex+ez*ez<=11059*11059)health=Math.max(health,B.maxHpCol[U.bp[v]!]!);}
          const amount=Math.min(15000,Math.max(1250,health),Math.floor(energy*9/60000));const actual=hasCategory(w,U.bp[target]!,'COMMAND')?400:hasCategory(w,U.bp[target]!,'STRUCTURE')?800:amount;
          w.armies.col.energyStored.set(army,energy-actual*6000);w.armies.col.energySpent.set(army,w.armies.col.energySpent.get(army)+actual*6000);w.armies.col.energyDemand.set(army,w.armies.col.energyDemand.get(army)+actual*6000);U.overchargeReadyTick[u]=w.tick+B.weaponReloadTicksCol[weapon]!;
          const duration=Math.max(1,Math.floor((isqrt(dx*dx+dz*dz)+B.weaponMuzzleVelocityCol[weapon]!-1)/B.weaponMuzzleVelocityCol[weapon]!));P.weapon[p]=weapon;P.damageOverride[p]=amount;P.army[p]=army;P.source[p]=w.units.handle(u);P.target[p]=w.units.handle(target);
          P.x[p]=P.px[p]=P.sx[p]=U.x[u]!;P.y[p]=P.py[p]=P.sy[p]=U.y[u]!+2048;P.z[p]=P.pz[p]=P.sz[p]=U.z[u]!;P.tx[p]=U.x[target]!;P.ty[p]=U.y[target]!+1024;P.tz[p]=U.z[target]!;
          P.vx[p]=Math.trunc(dx/duration);P.vy[p]=Math.trunc((P.ty[p]!-P.y[p]!)/duration);P.vz[p]=Math.trunc(dz/duration);P.age[p]=0;P.duration[p]=duration;P.ttl[p]=B.projectileLifetimeCol[B.weaponProjectileCol[weapon]!]!;event(w,EventType.Shot,weapon,u,w.units.handle(target));
        }
      }
    }U.overchargeTarget[u]=HANDLE_NONE;
    if(!isActive(w,u)||(U.flags[u]!&UnitBits.UnderConstruction)!==0||U.fireState[u]===0)continue;
    const bp=U.bp[u]!,first=B.firstMount(bp),count=B.mountCount(bp);
    for(let k=0;k<count;k++){
      const mount=first+k,weapon=B.mountWeaponCol[mount]!,o=(u*16+k)*5,t=chooseTarget(w,u,mount,weapon);
      S[o+1]=t>=0?w.units.handle(t):HANDLE_NONE;
      const ground=U.orderHead[u]!>=0&&(w.orders.i32[U.orderHead[u]!*8]!&255)===8;
      if(t<0&&!ground)continue;
      const tx=t>=0?U.x[t]!:w.orders.i32[U.orderHead[u]!*8+1]!,tz=t>=0?U.z[t]!:w.orders.i32[U.orderHead[u]!*8+2]!,dx=tx-U.x[u]!,dz=tz-U.z[u]!,d=dx*dx+dz*dz,range=B.weaponRangeCol[weapon]!,min=B.weaponMinRangeCol[weapon]!;
      if(d>range*range||d<min*min)continue;
      const aim=atan2A(dz,dx),yaw=angRotateTowards(asAng16(S[o+2]!),aim,B.mountYawRateCol[mount]!);S[o+2]=yaw;
      if(Math.abs(angDiff(asAng16(U.yaw[u]!),aim))>B.mountHalfArcCol[mount]!||Math.abs(angDiff(yaw,aim))>512||S[o]!>w.tick)continue;
      const p=w.projectiles.alloc();if(p<0)continue;const P=w.projectiles.col,prj=B.weaponProjectileCol[weapon]!,speed=B.weaponMuzzleVelocityCol[weapon]!,duration=Math.max(1,Math.floor((isqrt(d)+Math.max(1,speed)-1)/Math.max(1,speed)));
      P.damageOverride[p]=0;P.weapon[p]=weapon;P.army[p]=U.army[u]!;P.source[p]=w.units.handle(u);P.target[p]=t>=0?w.units.handle(t):HANDLE_NONE;
      P.x[p]=P.px[p]=P.sx[p]=U.x[u]!;P.y[p]=P.py[p]=P.sy[p]=U.y[u]!+2048;P.z[p]=P.pz[p]=P.sz[p]=U.z[u]!;
      P.tx[p]=tx+(t>=0?U.vx[t]!*duration:0);P.tz[p]=tz+(t>=0?U.vz[t]!*duration:0);P.ty[p]=t>=0?U.y[t]!+1024:terrainHeight(w,tx,tz);
      P.vx[p]=Math.trunc((P.tx[p]!-P.x[p]!)/duration);P.vz[p]=Math.trunc((P.tz[p]!-P.z[p]!)/duration);P.vy[p]=Math.trunc((P.ty[p]!-P.y[p]!)/duration);
      P.age[p]=0;P.duration[p]=duration;P.ttl[p]=B.projectileLifetimeCol[prj]!;
      const remaining=S[o+3]!>0?S[o+3]!:B.weaponSalvoCol[weapon]!;S[o+3]=remaining-1;
      S[o]=w.tick+(remaining>1?Math.max(1,B.weaponSalvoIntervalCol[weapon]!):B.weaponReloadTicksCol[weapon]!);
      event(w,EventType.Shot,weapon,u,t>=0?w.units.handle(t):HANDLE_NONE);
    }
  }
}
function damage(w:World,v:number,amount:number,source:number):void {
  if(!isActive(w,v))return;const U=w.units.col;U.hp[v]=U.hp[v]!-amount;U.lastHitBy[v]=source;
}
function impact(w:World,p:number,hit:number,wreck=-1):void {
  const P=w.projectiles.col,U=w.units.col,B=w.bp,weapon=P.weapon[p]!,radius=B.weaponDamageRadiusCol[weapon]!,source=P.source[p]!;
  if(radius===0){if(hit>=0)damage(w,hit,P.damageOverride[p]!>0?P.damageOverride[p]!:B.weaponDamageCol[weapon]!,source);}
  else for(let v=0;v<w.units.highWater;v++)if(isActive(w,v)){const dx=U.x[v]!-P.x[p]!,dz=U.z[v]!-P.z[p]!;if(dx*dx+dz*dz<=radius*radius){let amount=P.damageOverride[p]!>0?P.damageOverride[p]!:B.weaponDamageCol[weapon]!;const flags=B.weaponFlagsCol[weapon]!;
      if((flags&1)!==0){if(hasCategory(w,U.bp[v]!,'COMMAND'))amount=400;else if(hasCategory(w,U.bp[v]!,'STRUCTURE'))amount=800;}
      if((flags&2)!==0){const inner=(flags>>>16)*64;if(dx*dx+dz*dz>inner*inner)amount=Math.floor(amount/4);}damage(w,v,amount,source);}
}
  if(wreck>=0&&w.wrecks.isLive(wreck)){w.wrecks.col.hp[wreck]=w.wrecks.col.hp[wreck]!-B.weaponDamageCol[weapon]!;if(w.wrecks.col.hp[wreck]!<=0)w.wrecks.free(wreck);}
  const surface=wreck>=0?1:hit>=0?(hasCategory(w,U.bp[hit]!,'STRUCTURE')?4:1):(w.hasWater&&P.y[p]!<=w.waterLevel?2:0);
  event(w,EventType.Impact,weapon,hit,surface,0,P.x[p]!,P.y[p]!,P.z[p]!);w.projectiles.free(p);
}
/** Swept segment tests each unit in slot order; nearest hit wins, including friendly blockers. */
export function projectilesPhase(w:World):void {
  const P=w.projectiles.col,U=w.units.col,B=w.bp;
  for(let p=0;p<w.projectiles.highWater;p++){
    if(!w.projectiles.isLive(p))continue;const weapon=P.weapon[p]!,prj=B.weaponProjectileCol[weapon]!,kind=B.projectileKindCol[prj]!,age=P.age[p]!+1,duration=P.duration[p]!;
    P.px[p]=P.x[p]!;P.py[p]=P.y[p]!;P.pz[p]=P.z[p]!;
    if(kind===2){const t=w.units.resolve(P.target[p]!);if(t>=0&&isActive(w,t)){const dx=U.x[t]!-P.x[p]!,dz=U.z[t]!-P.z[p]!,dist=Math.max(1,isqrt(dx*dx+dz*dz)),speed=B.projectileSpeedCol[prj]!;const yaw=angRotateTowards(atan2A(P.vz[p]!,P.vx[p]!),atan2A(dz,dx),B.projectileTurnRateCol[prj]!);angToDir(yaw,HOMING_DIR);P.vx[p]=Math.trunc(HOMING_DIR[0]!*speed/4096);P.vz[p]=Math.trunc(HOMING_DIR[1]!*speed/4096);P.vy[p]=Math.trunc((U.y[t]!+1024-P.y[p]!)*speed/dist);}}
    P.x[p]=P.x[p]!+P.vx[p]!;P.z[p]=P.z[p]!+P.vz[p]!;
    if(kind===1){const a=Math.min(age,duration);P.y[p]=P.sy[p]!+Math.trunc((P.ty[p]!-P.sy[p]!)*a/duration)+Math.trunc(B.projectileGravityCol[prj]!*a*(duration-a)/2);}else P.y[p]=P.y[p]!+P.vy[p]!;
    P.age[p]=age;const ax=P.px[p]!,az=P.pz[p]!,dx=P.x[p]!-ax,dz=P.z[p]!-az,len=dx*dx+dz*dz;let hit=-1,wreck=-1,best=65537;
    for(let v=0;v<w.units.highWater;v++)if(isActive(w,v)&&w.units.handle(v)!==P.source[p]){
      const rx=U.px[v]!-ax,rz=U.pz[v]!-az,rdx=dx-(U.x[v]!-U.px[v]!),rdz=dz-(U.z[v]!-U.pz[v]!),relativeLen=rdx*rdx+rdz*rdz,q=relativeLen>0?segmentRatio(rx*rdx+rz*rdz,relativeLen):0;
      const cx=ax+Math.trunc(dx*q/65536),cz=az+Math.trunc(dz*q/65536),cy=P.py[p]!+Math.trunc((P.y[p]!-P.py[p]!)*q/65536),ex=cx-(U.px[v]!+Math.trunc((U.x[v]!-U.px[v]!)*q/65536)),ez=cz-(U.pz[v]!+Math.trunc((U.z[v]!-U.pz[v]!)*q/65536)),r=B.radiusCol[U.bp[v]!]!;
      if(q<best&&ex*ex+ez*ez<=r*r&&cy>=U.y[v]!-1024&&cy<=U.y[v]!+Math.max(2048,B.hitbox(U.bp[v]!,1))){hit=v;wreck=-1;best=q;}
    }
    const R=w.wrecks.col;
    for(let r=0;r<w.wrecks.highWater;r++)if(w.wrecks.isLive(r)){
      const rx=R.x[r]!-ax,rz=R.z[r]!-az,q=len>0?segmentRatio(rx*dx+rz*dz,len):0;
      const cx=ax+Math.trunc(dx*q/65536),cz=az+Math.trunc(dz*q/65536),cy=P.py[p]!+Math.trunc((P.y[p]!-P.py[p]!)*q/65536),ex=cx-R.x[r]!,ez=cz-R.z[r]!,radius=B.radiusCol[R.bp[r]!]!;
      if(q<best&&ex*ex+ez*ez<=radius*radius&&cy>=R.y[r]!-1024&&cy<=R.y[r]!+Math.max(2048,B.hitbox(R.bp[r]!,1))){best=q;hit=-1;wreck=r;}
    }
    // Terrain cells are sampled at half-cell intervals, preventing tunnelling through ridges.
    const samples=Math.max(1,Math.floor((Math.max(Math.abs(dx),Math.abs(dz))+2047)/2048));let ground=65537;
    for(let s=1;s<=samples;s++){const q=Math.trunc(s*65536/samples),x=ax+Math.trunc(dx*q/65536),z=az+Math.trunc(dz*q/65536),y=P.py[p]!+Math.trunc((P.y[p]!-P.py[p]!)*q/65536);if(x<0||z<0||x>w.mapMax||z>w.mapMax||y<=terrainHeight(w,x,z)){ground=q;break;}}
    if(ground<=65536&&ground<=best){P.x[p]=ax+Math.trunc(dx*ground/65536);P.z[p]=az+Math.trunc(dz*ground/65536);P.y[p]=P.py[p]!+Math.trunc((P.y[p]!-P.py[p]!)*ground/65536);impact(w,p,-1);}
    else if(hit>=0||wreck>=0){P.x[p]=ax+Math.trunc(dx*best/65536);P.z[p]=az+Math.trunc(dz*best/65536);impact(w,p,hit,wreck);}
    else if(age>=P.ttl[p]!||(kind!==2&&age>=duration))impact(w,p,-1);
  }
}
export function deathPhase(w:World):void {
  const U=w.units.col;for(let u=0;u<w.units.highWater;u++)if(w.units.isLive(u)&&(U.hp[u]!<=0||(U.flags[u]!&UnitBits.Dead)!==0)&&(U.flags[u]!&UnitBits.DeathProcessed)===0){
    U.flags[u]=U.flags[u]!|UnitBits.DeathProcessed;
    event(w,EventType.UnitDeath,U.bp[u]!,u,Math.min(3,w.bp.sizeClassCol[U.bp[u]!]!),unitEventFlags(w,U.bp[u]!));
    const b=U.bp[u]!,fraction=w.bp.wreckMassCol[b]!;
    if(fraction>0&&(U.flags[u]!&UnitBits.UnderConstruction)===0){const r=w.wrecks.alloc();if(r>=0){const R=w.wrecks.col;R.bp[r]=b;R.x[r]=U.x[u]!;R.y[r]=U.y[u]!;R.z[r]=U.z[u]!;R.yaw[r]=U.yaw[u]!;R.hp[r]=mulDiv(w.bp.maxHpCol[b]!,w.bp.wreckHpCol[b]!,4096);const mass=mulDiv(w.bp.massCostCol[b]!*1000,fraction,4096);R.mass.set(r,mass);R.remaining.set(r,mass);}}
    const credit=w.units.resolve(U.lastHitBy[u]!);if(credit>=0&&isActive(w,credit)&&!allied(w,U.army[u]!,U.army[credit]!)){U.vetMass.set(credit,U.vetMass.get(credit)+w.bp.massCostCol[U.bp[u]!]!);U.vet[credit]=Math.min(5,Math.floor(U.vetMass.get(credit)/Math.max(1,w.bp.massCostCol[U.bp[credit]!]!*2)));}
    const weapon=w.bp.deathWeaponCol[U.bp[u]!]!;
    if(weapon>=0){const p=w.projectiles.alloc();if(p>=0){const P=w.projectiles.col;P.damageOverride[p]=0;P.weapon[p]=weapon;P.army[p]=U.army[u]!;P.source[p]=w.units.handle(u);P.target[p]=HANDLE_NONE;P.x[p]=P.px[p]=P.sx[p]=P.tx[p]=U.x[u]!;P.y[p]=P.py[p]=P.sy[p]=P.ty[p]=U.y[u]!;P.z[p]=P.pz[p]=P.sz[p]=P.tz[p]=U.z[u]!;P.vx[p]=P.vy[p]=P.vz[p]=0;P.age[p]=0;P.duration[p]=P.ttl[p]=1;}}
    killUnit(w,u);
  }
}
export function matchPhase(w:World):void {
  const H=w.header.i32;if(H[WH_SKIRMISH]===0||H[WH_MATCH_END]!>0)return;
  const U=w.units.col,A=w.armies.col;let mask=0;
  for(let a=0;a<w.armyCount;a++){
    if(A.defeated[a]===1)continue;let survives=false;
    for(let u=0;u<w.units.highWater;u++)if(isActive(w,u)&&U.army[u]===a){const bp=U.bp[u]!;if(H[WH_VICTORY]===2||(hasCategory(w,bp,'COMMAND'))||(H[WH_VICTORY]===1&&hasCategory(w,bp,'FACTORY'))){survives=true;break;}}
    if(!survives){A.defeated[a]=1;for(let u=0;u<w.units.highWater;u++)if(isActive(w,u)&&U.army[u]===a)killUnit(w,u);}
    else mask|=1<<a;
  }
  let winner=-1,enemy=false;for(let a=0;a<w.armyCount;a++)if((mask&(1<<a))!==0){if(winner<0)winner=a;else if(!allied(w,winner,a))enemy=true;}
  if(!enemy){H[WH_MATCH_END]=w.tick;H[WH_WINNER]=winner;event(w,EventType.MatchEnd,winner<0?65535:winner,-1,w.tick);}
}
export interface MatchResult { readonly endTick:number;readonly winnerArmy:number;readonly defeated:readonly boolean[] }
/** Scalar query for scheduler hot paths. Never allocates a result or callback context. */
export function hasMatchEnded(w:World):boolean {return w.header.i32[WH_MATCH_END]!>0;}
/** Result snapshot for menus/tests; allocates only after a match ended. */
export function matchResult(w:World):MatchResult|undefined {
 if(!hasMatchEnded(w))return undefined;
 const defeated:boolean[]=[];for(let a=0;a<w.armyCount;a++)defeated.push(w.armies.col.defeated[a]===1);
 return {endTick:w.header.i32[WH_MATCH_END]!,winnerArmy:w.header.i32[WH_WINNER]!,defeated};
}
