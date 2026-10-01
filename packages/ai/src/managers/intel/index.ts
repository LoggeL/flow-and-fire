import { defineManager } from '../../brain.ts';
import type { ThreatQuery, ThreatQueryLayer } from '../../blackboard.ts';
import { Prio } from '../../commands/emitter.ts';
import { decayFactor } from '../../det.ts';
import { cat, dist } from '../shared.ts';
export class ThreatGrid implements ThreatQuery {
  readonly dim:number;readonly surface:Float64Array;readonly air:Float64Array;readonly antiair:Float64Array;readonly lastSeen:Int32Array;readonly stamp:Int32Array;
  readonly structure:Float64Array;tick=0;
  constructor(sizeWu:number){this.dim=Math.ceil(sizeWu/16);const n=this.dim*this.dim;this.surface=new Float64Array(n);this.air=new Float64Array(n);this.antiair=new Float64Array(n);this.structure=new Float64Array(n);this.lastSeen=new Int32Array(n).fill(-1);this.stamp=new Int32Array(n);}
  index(x:number,z:number):number{return Math.max(0,Math.min(this.dim-1,Math.floor(z/16)))*this.dim+Math.max(0,Math.min(this.dim-1,Math.floor(x/16)));}
  threatAt(layer:ThreatQueryLayer,x:number,z:number):number{const i=this.index(x,z);const v=layer==='surface'?this.surface:layer==='air'?this.air:this.antiair;return v[i]!*decayFactor((this.tick-this.stamp[i]!)/10)+(layer==='surface'?this.structure[i]!:0);}
}
export const intelManager=defineManager('intel',init=>{
  const grid=new ThreatGrid(init.static.map.sizeWu);init.bb.threat=grid;
  let cursor=0;let cycle: {x:number;z:number;r:number;s:number;a:number;aa:number;structure:boolean}[]=[];
  let live=new Map<number,{s:number;a:number;aa:number;structure:number}>();let scoutRouteTick=-1800;let seenBase=false;
  return ctx=>{grid.tick=ctx.tick;
    if(cursor===0){cycle=ctx.bb.enemy.current.map(e=>{const b=e.bp>=0?ctx.static.bps.list[e.bp]:undefined;return{x:e.x,z:e.z,r:(b?.rangeMax??24)+8,s:(b?.threatSurface??84)*e.hpFrac,a:b?.layer==='air'?Math.max(b.threatSurface,b.threatAir)*e.hpFrac:0,aa:(b?.threatAir??0)*e.hpFrac,structure:b?.isStructure??false};});live=new Map();}
    while(cursor<cycle.length){const e=cycle[cursor]!;const cells:number[]=[];for(let z=Math.max(0,Math.floor((e.z-e.r)/16));z<=Math.min(grid.dim-1,Math.floor((e.z+e.r)/16));z++)for(let x=Math.max(0,Math.floor((e.x-e.r)/16));x<=Math.min(grid.dim-1,Math.floor((e.x+e.r)/16));x++){const dx=(x+0.5)*16-e.x,dz=(z+0.5)*16-e.z;if(dx*dx+dz*dz<=e.r*e.r)cells.push(z*grid.dim+x);}
      if(!ctx.budget.take(1+cells.length))return;
      if(!ctx.step(()=>()=>{for(const i of cells){const x=(i%grid.dim+0.5)*16,z=(Math.floor(i/grid.dim)+0.5)*16;const f=dist({x,z},e)<=e.r-8?1:0.5;const v=live.get(i)??{s:0,a:0,aa:0,structure:0};if(e.structure)v.structure+=e.s*f;else v.s+=e.s*f;v.a+=e.a*f;v.aa+=e.aa*f;live.set(i,v);}cursor++;}))return;
    }
    ctx.step(()=>()=>{
      grid.structure.fill(0);
      const visible=new Set<number>();for(const u of ctx.bb.units.all){if(!ctx.budget.take(1))break;const r=u.blueprint.vision;for(let z=Math.max(0,Math.floor((u.z-r)/16));z<=Math.min(grid.dim-1,Math.floor((u.z+r)/16));z++)for(let x=Math.max(0,Math.floor((u.x-r)/16));x<=Math.min(grid.dim-1,Math.floor((u.x+r)/16));x++){if(!ctx.budget.take(1))break;const i=z*grid.dim+x;if(dist({x:(x+0.5)*16,z:(z+0.5)*16},u)<=r)visible.add(i);}}
      for(const i of visible){grid.lastSeen[i]=ctx.tick;if(!live.has(i)){grid.surface[i]=0;grid.air[i]=0;grid.antiair[i]=0;grid.stamp[i]=ctx.tick;}}
      for(const [i,v] of live){const decay=decayFactor((ctx.tick-grid.stamp[i]!)/10);grid.surface[i]=Math.max(v.s,visible.has(i)?0:grid.surface[i]!*decay);grid.air[i]=Math.max(v.a,visible.has(i)?0:grid.air[i]!*decay);grid.antiair[i]=Math.max(v.aa,visible.has(i)?0:grid.antiair[i]!*decay);grid.structure[i]=v.structure;grid.stamp[i]=ctx.tick;}cursor=0;
      const scout=ctx.bb.units.army.find(u=>cat(u.blueprint,'SCOUT'));
      if(scout){if(!seenBase&&dist(scout,ctx.analysis.enemyStart)<=scout.blueprint.vision){seenBase=true;ctx.bb.telemetry.push({kind:'scoutSeenEnemyBase',tick:ctx.tick});}
        if(ctx.tick-scoutRouteTick>=1800||scout.order===0){let target=ctx.analysis.enemyStart;if(seenBase){const spots=ctx.analysis.spots.filter(s=>s.zone==='enemy'||s.zone==='contested');spots.sort((a,b)=>grid.lastSeen[grid.index(a.x,a.z)]!-grid.lastSeen[grid.index(b.x,b.z)]!||a.index-b.index);target=spots[0]??target;}ctx.emitter.move([scout.handle],target.x,target.z,Prio.P1);scoutRouteTick=ctx.tick;}}
    });
  };
});
