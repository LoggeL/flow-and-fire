import type { ManagerContext } from '../brain.ts';
import type { OwnRecord } from '../blackboard.ts';
import type { AiBlueprint, Vec2 } from '../types.ts';
export function distSq(a:Vec2,b:Vec2):number{const dx=a.x-b.x,dz=a.z-b.z;return dx*dx+dz*dz;}
export function dist(a:Vec2,b:Vec2):number{return Math.sqrt(distSq(a,b));}
export function cat(bp:AiBlueprint,name:string):boolean{return bp.categoryNames.includes(name);}
export function existing(ctx:ManagerContext,bp:number,p:Vec2):OwnRecord|undefined{return ctx.bb.units.structures.find(u=>(u.bp===bp||u.blueprint.upgradeFrom===bp)&&distSq(u,p)<1);}
export function requestUnit(ctx:ManagerContext,role:string,tech:number,count:number,prio:number,source:string):void{
  if(count<=0)return;const hit=ctx.bb.productionRequests.find(r=>r.source===source&&r.role===role&&r.tech===tech);if(hit){hit.count=Math.max(hit.count,count);return;}
  ctx.bb.productionRequests.add(id=>({id,role,tech,count,prio,source,createdTick:ctx.tick}));
}
export interface Site { x:number;z:number;spot:number; }
export function siteFor(ctx:ManagerContext,selector:string,bp:AiBlueprint,builder:Vec2,owner:string,ordinal=0):Site|null{
  if(selector==='ring'||selector==='mex:next'||selector==='hydro:next'){
    const kind=selector==='hydro:next'?'hydro':'mass';const free=kind==='mass'?ctx.view.freeMassSpots():ctx.view.freeHydroSpots();
    let best:Site|null=null,score=Infinity;
    for(const sp of free){if(!ctx.budget.take(1))break;const si=ctx.analysis.spots[sp.index];if(!si||si.zone==='unreachable'||si.zone==='enemy')continue;if(selector==='ring'&&!ctx.analysis.ringSpots.includes(sp.index))continue;
      if(si.zone==='contested'&&ctx.tick<3600&&ctx.bb.tech.level<2)continue;if(!ctx.bb.reservations.isSpotAvailable(sp.index,ctx.tick,owner))continue;
      const threat=ctx.bb.threat.threatAt('surface',sp.x,sp.z);if(threat>=20)continue;
      const value=dist(builder,sp)+0.5*si.dOwn;
      if(value<score||(value===score&&sp.index<(best?.spot??Infinity))){score=value;best={...sp,spot:sp.index};}}
    return best;
  }
  let point:Vec2;
  if(selector==='slot:eco')point=ctx.analysis.ecoRingSlot(ordinal);
  else if(selector==='kranz'||selector.startsWith('near:')){
    const slot=selector==='kranz'?'estore':selector.slice(5);const center=ctx.analysis.slots[slot]??ctx.analysis.slots['fac1']!;
    const axes=[ctx.analysis.forward,ctx.analysis.side,{x:-ctx.analysis.forward.x,z:-ctx.analysis.forward.z},{x:-ctx.analysis.side.x,z:-ctx.analysis.side.z}];const axis=axes[ordinal%4]!;
    const r=(center.footprint+Math.max(...bp.footprint))/2+2*Math.floor(ordinal/4);point={x:center.x+axis.x*r,z:center.z+axis.z*r};
  }else{const name=selector.replace('slot:','');point=ctx.analysis.slots[name]??(name.startsWith('fac')?ctx.analysis.factorySlot(Number(name.slice(3))):ctx.analysis.rally);}
  return {...point,spot:-1};
}
/** Bounded placement search, preserving a fixed candidate order. */
export function place(ctx:ManagerContext,bp:AiBlueprint,p:Vec2,offset=0,occupied?:(candidate:Vec2)=>boolean):Vec2|null{
  const cost=4+Math.ceil(bp.footprint[0]*bp.footprint[1]/16);
  const candidates:Vec2[]=[p];for(let r=2;r<=12&&candidates.length<24;r+=2){for(const [dx,dz] of [[r,0],[r,r],[0,r],[-r,r],[-r,0],[-r,-r],[0,-r],[r,-r]]){candidates.push({x:p.x+dx!,z:p.z+dz!});if(candidates.length>=24)break;}}
  for(let i=offset;i<candidates.length;i++){if(!ctx.budget.take(cost))return null;const raw=candidates[i]!;const c=ctx.static.placement===undefined?raw:{x:Math.round(raw.x-bp.footprint[0]/2)+bp.footprint[0]/2,z:Math.round(raw.z-bp.footprint[1]/2)+bp.footprint[1]/2};if(!occupied?.(c)&&ctx.view.canPlace(bp.index,c.x,c.z,0))return c;}return null;
}
