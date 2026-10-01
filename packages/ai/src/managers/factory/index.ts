import { defineManager, type ManagerContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import type { AiBlueprint } from '../../types.ts';
import { cat } from '../shared.ts';
export interface MixEntry {role:string;tech:number;weight:number;}
/** Counter shares derive exclusively from the reacted perception memory. */
export function productionMix(ctx:ManagerContext,tech:number):MixEntry[]{
  let tank=0.45,arty=0.2,bot=0.2,aa=0;
  if(ctx.profile.counterMode!=='off'){
    const share=(expr:string):number=>{const e=ctx.static.bps.compile(expr);return ctx.bb.enemy.categoryShare(bp=>ctx.static.bps.matches(bp,e));};
    if(share('LAND & MOBILE & BOT - SNIPER')>=0.35){tank+=0.2;arty+=0.1;bot-=0.1;}
    if(share('LAND & MOBILE & TANK')>=0.35){tank+=0.05;arty+=0.15;}
    if(share('LAND & MOBILE & INDIRECTFIRE')>=0.35)bot+=0.2;
    if(share('STRUCTURE & DEFENSE & DIRECTFIRE')>=0.35)arty+=0.25;
    if(share('SHIELD')>=0.35){tank+=0.15;arty-=0.1;}
    if(share('SNIPER')>=0.35){tank+=0.15;bot+=0.15;}
    if(share('AIR & (BOMBER | GUNSHIP)')>=0.2||ctx.bb.enemy.categoryCount(b=>cat(b,'AIR'))>=5)aa=0.3;
    if(tech>=2&&ctx.profile.counterMode==='immediatePredict'&&ctx.bb.enemy.t2LandFactorySeen)tank+=0.1;
  }
  const sum=tank+arty+bot+aa;return [{role:'tank',tech,weight:tank/sum},{role:'arty',tech,weight:arty/sum},{role:'bot',tech:1,weight:bot/sum},{role:'aa',tech,weight:aa/sum}];
}
export const factoryManager=defineManager('factory',()=>{
  const lastIssue=new Map<number,number>(),mixKeys=new Map<number,string>();let scoutTick=-1800;
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb;let pendingEngineers=bb.units.factories.reduce((n,f)=>n+f.queueLength+(f.factoryBp>=0&&cat(ctx.static.bps.list[f.factoryBp]!,'ENGINEER')?1:0),0);
    for(const fac of bb.units.factories){if(!ctx.budget.take(1))break;if(fac.upgradingTo>=0||(!bb.opening.handedOffFactories.includes(fac.handle)&&ctx.tick<3000))continue;
      if(ctx.tick-(lastIssue.get(fac.handle)??-1000)<30)continue;
      let special:AiBlueprint|null=null;
      const requests=[...bb.productionRequests.items].sort((a,b)=>b.prio-a.prio||a.id-b.id);const request=requests.find(r=>ctx.roles.bestFor(r.role,r.tech,fac.blueprint));
      if(request)special=ctx.roles.bestFor(request.role,request.tech,fac.blueprint);
      else if(bb.units.engineers.length+pendingEngineers<bb.engineerTarget){special=ctx.roles.bestFor('eng',1,fac.blueprint);pendingEngineers++;}
      else if(!bb.units.army.some(u=>cat(u.blueprint,'SCOUT'))&&ctx.tick-scoutTick>=1800){special=ctx.roles.bestFor('scout',1,fac.blueprint);if(special)scoutTick=ctx.tick;}
      if(special){ctx.emitter.factoryQueue(fac.handle,special.index,1,Prio.P3,{queue:true});lastIssue.set(fac.handle,ctx.tick);if(request&&--request.count<=0)bb.productionRequests.remove(request.id);continue;}
      const tech=Math.min(2,fac.blueprint.tech);const mix=productionMix(ctx,tech);
      const key=mix.map(m=>`${m.role}:${m.tech}:${m.weight}`).join('|');if(mixKeys.get(fac.handle)===key&&fac.factoryRepeat)continue;
      const entries=mix.map(m=>({...m,bp:ctx.roles.bestFor(m.role,m.tech,fac.blueprint),mass:0})).filter((m):m is typeof m&{bp:AiBlueprint}=>m.bp!==null&&m.weight>0);
      for(const u of bb.units.army){if(!ctx.budget.take(1))break;const item=entries.find(m=>ctx.roles.isRole(u.blueprint,m.role));if(item)item.mass+=u.blueprint.mass;}
      const loop:number[]=[];for(let n=0;n<6;n++){if(!ctx.budget.take(entries.length))break;const total=entries.reduce((v,m)=>v+m.mass,0);const ranked=entries.map((m,i)=>({m,i,deficit:m.weight-(total>0?m.mass/total:0)})).sort((a,b)=>b.deficit-a.deficit||a.i-b.i);if(ranked.length===0)break;const choice=ctx.rng.chance(ctx.profile.errorRate)?ctx.rng.nextInt(Math.min(ctx.profile.errorTopK,ranked.length)):0;const m=ranked[choice]!.m;loop.push(m.bp.index);m.mass+=m.bp.mass;}
      if(loop.length){ctx.emitter.factoryRepeat(fac.handle,loop,Prio.P3);mixKeys.set(fac.handle,key);lastIssue.set(fac.handle,ctx.tick);}
      const rally=bb.platoons.some(p=>p.state==='staging'&&p.ratio>=1)?ctx.analysis.staging:ctx.analysis.rally;ctx.emitter.setRally([fac.handle],rally.x,rally.z,Prio.P4);
    }
  });};
});
