import { defineManager } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { expandSteps, type OpeningStep } from '../../openings.ts';
import { OrderKind } from '../../types.ts';
import { cat, dist, existing, place, requestUnit, siteFor, type Site } from '../shared.ts';
interface Plan { steps:OpeningStep[];index:number;sites:Map<number,Site>;issued:number;nextTick:number;owner:string; }
export const openingManager=defineManager('opening',init=>{
  init.bb.opening.active=true;let opening=init.opening;const plans=new Map<number,Plan>();const factoryIssued=new Map<number,number>();const factoryLoops=new Map<number,readonly number[]>();let engineerIndex=0;let threatSince=-1;let contactTick=-1000;let stimuli=-1;const losses:number[]=[];
  const selected=new Set<number>();let ecoOrdinal=0;const nearOrdinals=new Map<string,number>();
  const plan=(steps:readonly OpeningStep[],owner:string):Plan=>({steps:expandSteps(steps),index:0,sites:new Map(),issued:-1000,nextTick:0,owner});
  return ctx=>{
    if(!opening)return;
    ctx.step(()=>()=>{
      const bb=ctx.bb,acu=bb.units.commander;
      bb.stimuli.forEachVisible(stimuli,ctx.tick,s=>{if(s.kind==='event'&&s.event.kind==='ownDestroyed'&&cat(ctx.static.bps.list[s.event.bp]!,'STRUCTURE'))losses.push(s.event.tick);if(s.kind==='event'&&s.event.kind==='ownDamaged'&&s.event.unit===acu?.handle)contactTick=ctx.tick;});stimuli=ctx.tick;
      let enemyThreat=0;for(const e of bb.enemy.current){if(!ctx.budget.take(1))break;if(e.bp<0)continue;const b=ctx.static.bps.list[e.bp]!;if(ctx.analysis.zoneAt(e.x,e.z)==='own')enemyThreat+=b.threatSurface;if(b.threatSurface>15&&dist(e,ctx.analysis.ownStart)<=60)contactTick=ctx.tick;}
      const ownThreat=bb.units.army.reduce((v,u)=>v+u.blueprint.threatSurface,0);const dangerous=enemyThreat>=Math.max(160,ownThreat*0.5);if(dangerous&&threatSince<0)threatSince=ctx.tick;if(!dangerous)threatSince=-1;
      if(!bb.opening.defenseMode&&ctx.tick<3000&&((threatSince>=0&&ctx.tick-threatSince>=50)||losses.filter(t=>ctx.tick-t<=300).length>=2||(acu&&acu.hpFrac<0.8))){bb.opening.defenseMode=true;bb.opening.defenseModeTick=ctx.tick;bb.opening.active=false;bb.telemetry.push({kind:'defenseMode',tick:ctx.tick,reason:'base-threat'});for(const p of plans.values())p.index=p.steps.length;for(const sp of bb.reservations.reservedSpots())bb.reservations.releaseSpot(sp);requestUnit(ctx,'tank',1,2,95,'opening-defense');requestUnit(ctx,'bot',1,2,95,'opening-defense');bb.taskBoard.add({kind:'build',role:'pd',site:ctx.analysis.rally,prio:95,source:'opening',key:'opening-defense'},ctx.tick);}
      bb.opening.localDefense=ctx.tick-contactTick<150;
      if(opening!.id==='tech_greed'&&ctx.tick<=2400&&(bb.enemy.landFactories>=2||bb.enemy.current.filter(e=>e.bp>=0&&cat(ctx.static.bps.list[e.bp]!,'MOBILE')&&ctx.static.bps.list[e.bp]!.threatSurface>20).length>=6)){opening=ctx.openings.openings.find(o=>o.id==='eco_standard')!;bb.opening.id=opening.id;}
      if(acu&&!plans.has(acu.handle)){const p=plan(opening!.acu,'opening-acu');plans.set(acu.handle,p);let ring=0;for(let i=0;i<p.steps.length;i++){const s=p.steps[i]!;if(s.do==='build'&&s.at==='ring'){const index=ctx.analysis.ringSpots[ring++];if(index!==undefined){const sp=ctx.static.spots[index]!;p.sites.set(i,{...sp,spot:index});bb.reservations.reserveSpot(index,p.owner,ctx.tick,acu.handle);}}}}
      for(const u of bb.units.engineers){if(selected.has(u.handle))continue;selected.add(u.handle);bb.reservations.claimUnit(u.handle,'opening');const steps=opening!.engineers[engineerIndex++]??[];plans.set(u.handle,plan(steps,`opening-eng-${u.handle}`));}
      for(const [handle,p] of plans){if(!ctx.budget.take(1))break;const u=bb.units.get(handle);if(!u){for(const s of p.sites.values())if(s.spot>=0)bb.reservations.releaseSpot(s.spot);plans.delete(handle);continue;}
        if(p.index>=p.steps.length){const isAcu=handle===acu?.handle;const target=isAcu?bb.opening.handedOffAcu:bb.opening.handedOffEngineers.includes(handle);if(!target){if(isAcu){bb.opening.handedOffAcu=true;bb.reservations.handoverAcu('opening','engineer',ctx.tick);bb.opening.active=false;}else {bb.opening.handedOffEngineers.push(handle);bb.reservations.releaseUnit(handle,'opening');}bb.telemetry.push({kind:'handoff',tick:ctx.tick,what:isAcu?'acu':'engineer',unit:handle});}continue;}
        if(bb.opening.localDefense||(handle===acu?.handle&&bb.reservations.acuOwner!=='opening')||ctx.tick<p.nextTick)continue;
        const s=p.steps[p.index]!;if(s.do!=='build'){p.index++;continue;}
        const bp=ctx.roles.tryResolve(s.role,s.tech);if(!bp){p.index++;continue;}
        let site=p.sites.get(p.index);
        if(!site){const count=s.at==='slot:eco'?ecoOrdinal:(nearOrdinals.get(s.at)??0);const found=siteFor(ctx,s.at,bp,u,p.owner,count);if(!found){if(s.fallback){p.steps.splice(p.index,1,...expandSteps([{do:'build',...s.fallback,fallback:null}]));}else p.index++;continue;}
          const positioned=place(ctx,bp,found);if(!positioned)continue;site={...positioned,spot:found.spot};p.sites.set(p.index,site);if(site.spot>=0)bb.reservations.reserveSpot(site.spot,p.owner,ctx.tick,handle);if(s.at==='slot:eco')ecoOrdinal++;else nearOrdinals.set(s.at,count+1);}
        const built=existing(ctx,bp.index,site);if(built?.complete){if(site.spot>=0)bb.reservations.releaseSpot(site.spot);p.index++;p.nextTick=ctx.tick+ctx.profile.timing.stepDelayS*10;continue;}
        if(u.order!==OrderKind.Idle&&u.order!==OrderKind.Guard)continue;if(ctx.tick-p.issued<15)continue;
        if(!built&&!ctx.view.canPlace(bp.index,site.x,site.z,0)){const replacement=place(ctx,bp,site,1);if(replacement)p.sites.set(p.index,{...replacement,spot:site.spot});else{if(site.spot>=0)bb.reservations.releaseSpot(site.spot);p.sites.delete(p.index);}continue;}
        if(built)ctx.emitter.assist([handle],built.handle,Prio.P2);else ctx.emitter.build(handle,bp.index,site.x,site.z,0,Prio.P2);p.issued=ctx.tick;
      }
      for(const fac of bb.units.factories){if(!ctx.budget.take(1))break;if(bb.opening.handedOffFactories.includes(fac.handle))continue;
        const slot=opening!.factoryOrder.find(name=>dist(fac,ctx.analysis.slots[name]!)<15);const steps=slot?opening!.factories[slot]:undefined;
        if(!steps||ctx.tick>=3000||bb.opening.defenseMode){bb.opening.handedOffFactories.push(fac.handle);continue;}
        if(fac.factoryRepeat){if(ctx.tick>fac.firstSeenTick+20){bb.opening.handedOffFactories.push(fac.handle);bb.telemetry.push({kind:'handoff',tick:ctx.tick,what:'factory',unit:fac.handle});}continue;}
        if(ctx.tick-(factoryIssued.get(fac.handle)??-1000)<20)continue;
        // The game repeat switch repeats the current queue. Finish finite opening jobs first.
        const loop=factoryLoops.get(fac.handle);
        if(loop!==undefined){
          if(fac.factoryBp>=0||fac.queueLength>0)continue;
          if(loop.length)ctx.emitter.factoryRepeat(fac.handle,loop,Prio.P3);
          else bb.opening.handedOffFactories.push(fac.handle);
        }else{
          const items:number[]=[];
          ctx.emitter.group(()=>{let first=true;for(const s of steps){if(s.do==='rally')ctx.emitter.setRally([fac.handle],ctx.analysis.rally.x,ctx.analysis.rally.z,Prio.P4);else if(s.do==='produce'){const b=ctx.roles.bestFor(s.role,s.tech,fac.blueprint);if(b){ctx.emitter.factoryQueue(fac.handle,b.index,s.count,Prio.P3,{queue:!first});first=false;}}else if(s.do==='loop'){items.push(...s.items.map(i=>ctx.roles.bestFor(i.role,i.tech,fac.blueprint)?.index).filter((i):i is number=>i!==undefined));}}});
          factoryLoops.set(fac.handle,items);
        }
        factoryIssued.set(fac.handle,ctx.tick);
      }
    });
  };
});
