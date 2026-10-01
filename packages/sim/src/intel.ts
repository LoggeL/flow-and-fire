import { MAX_ARMIES } from '@faf/fixed';
import { HANDLE_NONE } from '@faf/heap';
import { UnitBits } from './constants.ts';
import { WH_SKIRMISH,WH_FOG } from './schema.ts';
import { isActive } from './liveness.ts';
import type { World } from './world.ts';
export function hasCategory(w:World,bp:number,name:string):boolean { const bit=w.bp.categoryNames.indexOf(name);return bit>=0&&(w.bp.categoryWord(bp,bit>>>5)&(1<<(bit&31)))!==0; }
export function allied(w:World,a:number,b:number):boolean {return w.alliance.u8[a*MAX_ARMIES+b]===1;}
export function visibleTo(w:World,army:number,u:number):boolean {return army<0||w.header.i32[WH_SKIRMISH]===0||w.header.i32[WH_FOG]===0||(w.units.col.visibleMask[u]!&(1<<army))!==0;}
export function event(w:World,type:number,visual:number,u:number,aux=0,flags=0,x?:number,y?:number,z?:number):void {
  const E=w.combatEvents.i32,n=E[0]!;if(n>=4096)return;const o=1+n*11,U=w.units.col;
  E[o]=type;E[o+1]=visual;E[o+2]=w.tick;E[o+3]=0;E[o+4]=flags;E[o+5]=x??U.x[u]??0;E[o+6]=y??U.y[u]??0;E[o+7]=z??U.z[u]??0;E[o+8]=aux;E[o+9]=u>=0?w.units.handle(u):HANDLE_NONE;let mask=u>=0?(U.visibleMask[u]!|(1<<U.army[u]!)):0;for(let a=0;a<w.armyCount;a++)if(canSeePosition(w,a,E[o+5]!,E[o+7]!))mask|=1<<a;E[o+10]=mask;E[0]=n+1;
}
export function unitEventFlags(w:World,bp:number):number {return (hasCategory(w,bp,'STRUCTURE')?1:0)|(hasCategory(w,bp,'AIR')?2:0)|(hasCategory(w,bp,'COMMAND')?4:0);}
export function canSeePosition(w:World,army:number,x:number,z:number):boolean {
 if(army<0||w.header.i32[WH_SKIRMISH]===0||w.header.i32[WH_FOG]===0)return true;const U=w.units.col;
 for(let s=0;s<w.units.highWater;s++)if(isActive(w,s)&&allied(w,army,U.army[s]!)&&(U.flags[s]!&UnitBits.UnderConstruction)===0){const dx=U.x[s]!-x,dz=U.z[s]!-z,range=w.bp.visionCol[U.bp[s]!]!;if(dx*dx+dz*dz<=range*range)return true;}return false;
}
export function intelPhase(w:World):void {
  if(w.header.i32[WH_SKIRMISH]===0)return;
  const U=w.units.col,dim=w.mapSizeWu>>3,E=w.explored.u16;
  for(let u=0;u<w.units.highWater;u++)if(isActive(w,u))U.visibleMask[u]=0;
  for(let s=0;s<w.units.highWater;s++){
    if(!isActive(w,s)||(U.flags[s]!&UnitBits.UnderConstruction)!==0)continue;
    const a=U.army[s]!,range=w.bp.visionCol[U.bp[s]!]!,x=U.x[s]!,z=U.z[s]!;let mask=0;
    for(let b=0;b<w.armyCount;b++)if(allied(w,a,b))mask|=1<<b;
    const loX=Math.max(0,(x-range)>>15),hiX=Math.min(dim-1,(x+range)>>15),loZ=Math.max(0,(z-range)>>15),hiZ=Math.min(dim-1,(z+range)>>15);
    for(let cz=loZ;cz<=hiZ;cz++)for(let cx=loX;cx<=hiX;cx++){const dx=(cx<<15)+16384-x,dz=(cz<<15)+16384-z;if(dx*dx+dz*dz<=range*range)E[cz*dim+cx]=E[cz*dim+cx]!|mask;}
    for(let u=0;u<w.units.highWater;u++)if(isActive(w,u)){const dx=U.x[u]!-x,dz=U.z[u]!-z;if(allied(w,a,U.army[u]!)||dx*dx+dz*dz<=range*range)U.visibleMask[u]=U.visibleMask[u]!|mask;}
  }
}
