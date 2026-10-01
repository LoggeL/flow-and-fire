import { defineManager } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { OrderKind } from '../../types.ts';
import type { AiBlueprint, OwnUnit } from '../../types.ts';
import { cat, dist, existing, place, siteFor } from '../shared.ts';
export const engineerManager=defineManager('engineer',()=>{
  const issued=new Map<number,number>();let ordinal=8;let stimuli=-1;
  const energyPromises=new Map<number,{bp:number;tick:number;target:number;guard:boolean;energy:number}>();
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb;
    bb.stimuli.forEachVisible(stimuli,ctx.tick,s=>{if(s.kind==='event'&&s.event.kind==='commandRejected'){for(const t of bb.taskBoard.release(s.event.unit)){t.failures++;t.siteHandle=0;if(t.failures>=3){if(t.spot>=0)bb.reservations.releaseSpot(t.spot,ctx.tick+600);bb.taskBoard.fail(t.id);}else if(typeof t.site==='object'&&t.site&&t.bp>=0){const p=place(ctx,ctx.static.bps.list[t.bp]!,t.site,1);if(p)t.site=p;}}issued.delete(s.event.unit);}});stimuli=ctx.tick;
    const builders=[...bb.units.engineers];const acu=bb.units.commander;if(acu&&bb.reservations.acuOwner==='engineer')builders.push(acu);
    // A builder in transit has not reached FlowEconomy's demand yet. Keep its commitment until
    // the order starts, otherwise the next idle builder can spend the same energy buffer again.
    const eco=ctx.view.eco();let energy=eco.energyStored;
    let flow=eco.energyIncome-eco.energyUpkeep-eco.energyDemand*eco.massRatio;
    for(const [handle,promise] of energyPromises){
      if(!ctx.budget.take(1))return;
      const u=bb.units.get(handle);
      if(!u||(ctx.tick-promise.tick>=ctx.profile.lead&&
        (promise.target===0?(u.order!==OrderKind.Build||u.orderBp!==promise.bp):
          (u.order!==(promise.guard?OrderKind.Guard:OrderKind.Assist)||u.orderTarget!==promise.target)))){energyPromises.delete(handle);continue;}
      const target=bb.units.get(promise.target);
      const range=cat(u.blueprint,'COMMAND')?10:u.blueprint.tech>=3?8:u.blueprint.tech===2?7:6;
      const reached=target!==undefined&&dist(u,target)<=range+Math.max(...target.blueprint.footprint)/2+0.01;
      if(ctx.tick-promise.tick>=ctx.profile.lead&&
        (promise.target===0?u.orderTarget>0:reached)){
        energyPromises.delete(handle);continue;
      }
      const bp=ctx.static.bps.list[promise.bp]!;
      energy-=promise.energy;flow-=bp.energy*u.blueprint.buildPower/bp.buildTime;
    }
    // Upgrade commands emitted earlier in this think apply only after the command lead.
    if(bb.eco.startedEnergyTick===ctx.tick)flow-=bb.eco.startedEnergyDemand;
    let promisedEnergy=0;
    const fund=(bp:AiBlueprint,u:OwnUnit,fraction=1,existingPower=0):boolean=>{
      if(!ctx.budget.take(1))return false;
      const power=ctx.static.bps.list[u.bp]!.buildPower,total=existingPower+power;
      if(total<=0||bp.buildTime<=0)return false;
      const duration=bp.buildTime*fraction/total,cost=bp.energy*fraction*power/total;
      const required=Math.max(0,cost-flow*duration)+1;
      const activePower=bb.units.sites.some(s=>cat(s.blueprint,'ENERGYPRODUCTION'))||
        [...energyPromises.values()].some(p=>cat(ctx.static.bps.list[p.bp]!,'ENERGYPRODUCTION'));
      // An already depleted economy must still be able to start its first recovery plant.
      const depleted=eco.energyStored<=1&&eco.energyIncome-eco.energyUpkeep<eco.energyDemand*eco.massRatio;
      if(energy<required&&!(cat(bp,'ENERGYPRODUCTION')&&depleted&&!activePower))return false;
      promisedEnergy=Math.max(0,cost-Math.max(0,flow)*duration);
      energy-=promisedEnergy;
      flow-=bp.energy*power/bp.buildTime;
      return true;
    };
    const assist=(u:typeof builders[number],target:number,guard=false,startingUpgrade=false):boolean=>{
      const site=bb.units.get(target);if(!site)return false;
      const bp=site.upgradingTo>=0?ctx.static.bps.list[site.upgradingTo]!:
        startingUpgrade&&site.blueprint.upgradesTo>=0?ctx.static.bps.list[site.blueprint.upgradesTo]!:
        site.factoryBp>=0?ctx.static.bps.list[site.factoryBp]!:site.blueprint;
      const fraction=site.complete?1:1-site.buildFrac;
      const ownPower=(site.upgradingTo>=0||startingUpgrade||site.factoryBp>=0)?site.blueprint.buildPower:0;
      const existingPower=ownPower+builders.reduce((n,b)=>n+(b.handle!==u.handle&&b.orderTarget===target?b.blueprint.buildPower:0),0);
      if(!fund(bp,u,fraction,existingPower))return false;
      if(guard)ctx.emitter.guard([u.handle],target,Prio.P2);else ctx.emitter.assist([u.handle],target,Prio.P2);
      energyPromises.set(u.handle,{bp:bp.index,tick:ctx.tick,target,guard,energy:promisedEnergy});return true;
    };
    for(const t of bb.taskBoard.ordered()){if(!ctx.budget.take(1))break;
      if(t.kind==='build'&&typeof t.site==='object'&&t.site&&t.bp>=0){const u=existing(ctx,t.bp,t.site);if(u){t.siteHandle=u.handle;if(u.complete){bb.taskBoard.complete(t.id);if(t.spot>=0)bb.reservations.releaseSpot(t.spot);}}
        else if(t.siteHandle>0&&!bb.units.get(t.siteHandle)){const lost=t.siteHandle;t.siteHandle=0;for(const h of [...t.assigned]){const builder=bb.units.get(h);if(builder?.order===OrderKind.Build&&builder.orderTarget===lost)ctx.emitter.stop([h],Prio.P2);bb.taskBoard.release(h);issued.delete(h);energyPromises.delete(h);}}}
      else if(t.kind==='assist'){const target=bb.units.get(t.target);
        // Upgrade/assist tasks are posted before the command lead reaches perception. An idle
        // complete factory in this think is not evidence that its newly issued upgrade is done.
        const pendingUpgrade=(t.source==='tech'||t.source==='economy')&&ctx.tick-t.createdTick<=ctx.profile.lead;
        const upgradeDone=t.bp>=0&&target?.bp===t.bp&&target.upgradingTo<0;
        if(!target||(!pendingUpgrade&&target.complete&&(upgradeDone||(target.upgradingTo<0&&target.factoryBp<0&&target.order!==OrderKind.Build))))bb.taskBoard.complete(t.id);}
      for(const h of [...t.assigned])if(!bb.units.get(h))bb.taskBoard.release(h);
    }
    // Scouts may deny an expansion before a builder reaches it. Hunt from known own-zone contacts.
    for(const e of bb.enemy.current){if(!ctx.budget.take(1))break;if(e.bp>=0&&cat(ctx.static.bps.list[e.bp]!,'SCOUT')&&ctx.static.bps.list[e.bp]!.layer==='land'&&ctx.analysis.zoneAt(e.x,e.z)==='own'&&!bb.huntRequests.find(r=>r.target===e.id))bb.huntRequests.add(id=>({id,target:e.id,x:e.x,z:e.z,source:'engineer',createdTick:ctx.tick,hunter:0}));}
    // Fixed/slot placement sees the same snapshot for every builder. Retrying a site for each
    // engineer can spend the entire budget, even when placement succeeds but funding fails.
    const placements=new Map<string,{x:number;z:number}|null>();
    const pendingSites:{x:number;z:number;footprint:readonly [number,number]}[]=[];
    for(const u of builders){if(!ctx.budget.take(1))break;if(u.handle!==acu?.handle&&bb.reservations.unitOwner(u.handle)==='opening')continue;
      const threat=bb.threat.threatAt('surface',u.x,u.z);const cover=bb.units.army.reduce((v,a)=>v+(dist(a,u)<40?a.blueprint.threatSurface:0),0);
      if((threat>=20&&cover<threat)||(u.lastDamagedTick>=ctx.tick-10&&u.lastDamagedTick>=0)){
        const refuges=[...bb.units.factories,...bb.units.structures.filter(a=>cat(a.blueprint,'DEFENSE'))];refuges.sort((a,b)=>dist(a,u)-dist(b,u)||a.handle-b.handle);const p=refuges[0]??ctx.analysis.ownStart;
        ctx.emitter.move([u.handle],p.x,p.z,Prio.P0);for(const t of bb.taskBoard.release(u.handle)){if(t.spot>=0)bb.reservations.releaseSpot(t.spot,ctx.tick+300);}continue;
      }
      for(const e of bb.enemy.current){if(!ctx.budget.take(1))break;if(e.bp>=0&&cat(ctx.static.bps.list[e.bp]!,'SCOUT')&&ctx.static.bps.list[e.bp]!.layer==='land'&&dist(e,u)<40&&!bb.huntRequests.find(r=>r.target===e.id))bb.huntRequests.add(id=>({id,target:e.id,x:e.x,z:e.z,source:'engineer',createdTick:ctx.tick,hunter:0}));}
      if(u.order!==OrderKind.Idle&&u.order!==OrderKind.Guard&&u.order!==OrderKind.Assist)continue;
      if(ctx.tick-(issued.get(u.handle)??-1000)<15)continue;
      const assigned=bb.taskBoard.tasksOf(u.handle);
      const assistTarget=bb.units.get(u.orderTarget);
      const idleAssist=(u.order===OrderKind.Assist||u.order===OrderKind.Guard)&&(!assistTarget||(assistTarget.complete&&assistTarget.upgradingTo<0&&assistTarget.factoryBp<0&&assistTarget.order!==OrderKind.Build));
      if(assigned.length>0&&u.order!==OrderKind.Idle&&!idleAssist)continue;
      let did=false;
      const tasks=bb.taskBoard.ordered();tasks.sort((a,b)=>b.prio-a.prio||(a.prio===50&&typeof a.site==='object'&&a.site&&typeof b.site==='object'&&b.site?dist(u,a.site)-dist(u,b.site):0)||a.createdTick-b.createdTick||a.id-b.id);
      for(const t of tasks){if(!ctx.budget.take(1))break;if(t.assigned.length>=t.wanted&&!t.assigned.includes(u.handle))continue;
        const bp=t.bp>=0?ctx.static.bps.list[t.bp]:t.role?ctx.roles.tryResolve(t.role,t.tech):null;
        if(t.kind==='build'){
          if(!bp||!ctx.static.bps.canBuild(u.blueprint,bp))continue;if(t.spot>=0&&!bb.reservations.isSpotAvailable(t.spot,ctx.tick,`task-${t.id}`))continue;
          let p=typeof t.site==='string'?siteFor(ctx,t.site,bp,u,`task-${t.id}`,ordinal):t.site;if(!p)continue;
          // A lost base must not pin every emergency recovery plant to the invaded template.
          // Only relocate requests without an active site; use known safe own clusters.
          let recovery=false;
          if(t.role==='pgen'&&bb.eco.emergency&&t.siteHandle===0&&t.assigned.length===0&&bb.threat.threatAt('surface',p.x,p.z)>=20){
            const anchors=[...bb.units.structures.filter(s=>s.complete&&ctx.analysis.zoneAt(s.x,s.z)==='own'&&bb.threat.threatAt('surface',s.x,s.z)<20)];
            anchors.sort((a,b)=>dist(u,a)-dist(u,b)||a.handle-b.handle);
            const anchor=anchors[0];
            if(anchor){p={x:anchor.x+Math.max(...anchor.blueprint.footprint)/2+Math.max(...bp.footprint)/2+2,z:anchor.z};recovery=true;}
            else if(ctx.analysis.zoneAt(u.x,u.z)==='own'&&bb.threat.threatAt('surface',u.x,u.z)<20){p={x:u.x+Math.max(...bp.footprint)/2+2,z:u.z};recovery=true;}
          }
          const placementKey=recovery?`${t.id}:${bp.index}:${p.x}:${p.z}`:typeof t.site==='object'||(typeof t.site==='string'&&(t.site.startsWith('slot:')||t.site.startsWith('near:')||t.site==='kranz'))?`${t.id}:${bp.index}:${ordinal}`:null;
          if(placementKey!==null&&placements.has(placementKey)&&placements.get(placementKey)===null)continue;
          if(!recovery&&t.prio>=60&&ctx.tick-t.createdTick<200&&dist(u,ctx.analysis.ownStart)>80)continue;
          if(t.siteHandle>0){if(!assist(u,t.siteHandle))continue;}
          else{p=placementKey!==null&&placements.has(placementKey)?placements.get(placementKey)!:place(ctx,bp,p,0,c=>(recovery&&(ctx.analysis.zoneAt(c.x,c.z)!=='own'||bb.threat.threatAt('surface',c.x,c.z)>=20))||pendingSites.some(s=>Math.abs(c.x-s.x)<(bp.footprint[0]+s.footprint[0])/2&&Math.abs(c.z-s.z)<(bp.footprint[1]+s.footprint[1])/2));if(placementKey!==null)placements.set(placementKey,p);if(!p||!fund(bp,u))continue;ctx.emitter.build(u.handle,bp.index,p.x,p.z,0,Prio.P2);pendingSites.push({...p,footprint:bp.footprint});for(const [key,value] of placements)if(value!==null)placements.delete(key);energyPromises.set(u.handle,{bp:bp.index,tick:ctx.tick,target:0,guard:false,energy:promisedEnergy});if(typeof t.site==='string')ordinal++;t.site=p;t.bp=bp.index;}
        }else if(t.kind==='assist'||t.kind==='guard'){if(!assist(u,t.target,false,t.createdTick===ctx.tick&&(t.source==='economy'||t.source==='tech')))continue;}
        else if(t.kind==='repair'){ctx.emitter.repair([u.handle],t.target,Prio.P2);}else continue;
        bb.taskBoard.release(u.handle);bb.taskBoard.assign(t.id,u.handle);if(t.spot>=0)bb.reservations.reserveSpot(t.spot,`task-${t.id}`,ctx.tick,u.handle);issued.set(u.handle,ctx.tick);did=true;break;
      }
      if(did)continue;
      const repair=bb.units.structures.find(s=>s.complete&&s.hpFrac<0.7&&dist(s,u)<80&&bb.threat.threatAt('surface',s.x,s.z)===0);if(repair){ctx.emitter.repair([u.handle],repair.handle,Prio.P2);issued.set(u.handle,ctx.tick);continue;}
      const site=ctx.view.eco().massStored/ctx.view.eco().massCapacity>=0.3?bb.units.sites.find(s=>s.blueprint.mass>=150&&dist(s,ctx.analysis.ownStart)<=80&&bb.units.engineers.filter(e=>e.orderTarget===s.handle).length<4):undefined;
      if(site&&assist(u,site.handle)){issued.set(u.handle,ctx.tick);continue;}
      const factories=bb.units.factories.filter(f=>f.factoryBp>=0||f.upgradingTo>=0);factories.sort((a,b)=>dist(a,u)-dist(b,u)||a.handle-b.handle);const f=factories[0];if(f&&assist(u,f.handle,true))issued.set(u.handle,ctx.tick);
    }
    bb.taskBoard.prune();
  });};
});
