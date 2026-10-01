import { defineManager } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { horizonFor } from '../../profile.ts';
import { cat, dist } from '../shared.ts';
export const economyManager=defineManager('economy',()=>{
  let surplusSince=-1;let serial=0;let engineerBonus=0;const upgrades=new Map<number,number>();
  const surplus: {tick:number;rate:number}[]=[];
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb,f=ctx.opening?.followUp;if(!f)return;const e=ctx.view.eco();bb.eco.decayOneSecond();
    const horizon=horizonFor(ctx.profile,f.energy.horizonS),effective=e.energyDemand*e.massRatio,net=e.energyIncome-e.energyUpkeep;
    bb.eco.energyEmptyInS=effective>net?e.energyStored/(effective-net):Infinity;bb.eco.emergency=bb.eco.energyEmptyInS<=10;
    bb.eco.deficitE=Math.max(1.1*(effective+bb.eco.reservedE)-net-Math.max(0,e.energyStored-f.energy.reserveE)/60,(f.energy.reserveE-(e.energyStored+(net-effective-bb.eco.reservedE)*horizon))/horizon);
    const live=bb.taskBoard.ordered();const inflight=live.filter(t=>t.role==='pgen').length+bb.units.sites.filter(u=>cat(u.blueprint,'ENERGYPRODUCTION')).length;
    // A balance task may outlive a sudden loss of power. The inflight cap must not prevent
    // that existing request from becoming the highest-priority emergency recovery task.
    for(const t of live){if(!ctx.budget.take(1))break;if(t.role==='pgen')t.prio=bb.eco.emergency?100:90;}
    const t2=bb.units.engineers.some(u=>u.blueprint.tech>=2);const powerTech=t2&&bb.eco.deficitE>=150?2:1;
    const power=ctx.roles.tryResolve('pgen',powerTech);const count=power?Math.min(Math.max(0,Math.ceil(bb.eco.deficitE/power.energyPerSec)-inflight),Math.max(0,f.energy.maxInflight+Math.floor(net/100)-inflight)):0;
    for(let i=0;i<count&&i<4;i++){if(!ctx.budget.take(1))break;bb.taskBoard.add({kind:'build',role:'pgen',tech:powerTech,site:'slot:eco',prio:bb.eco.emergency?100:90,wanted:1,source:'economy',key:`power-${serial++}`},ctx.tick);}
    if(ctx.tick>=f.estore.atS*10&&!bb.units.structures.some(u=>cat(u.blueprint,'ENERGYSTORAGE')))bb.taskBoard.add({kind:'build',role:'estore',site:'slot:estore',prio:70,source:'economy',key:'estore'},ctx.tick);
    const free=ctx.view.freeMassSpots();let ownFree=0;
    for(const sp of free){if(!ctx.budget.take(1))break;const si=ctx.analysis.spots[sp.index]!;if(si.zone==='own')ownFree++;const eligible=si.zone==='own'||(si.zone==='contested'&&(ctx.tick>=3600||bb.tech.level>=2)&&bb.platoons.some(p=>p.ratio>=1&&dist(p,ctx.analysis.staging)<60));if(!eligible||!bb.reservations.isSpotAvailable(sp.index,ctx.tick)||bb.threat.threatAt('surface',sp.x,sp.z)>=20)continue;
      bb.taskBoard.add({kind:'build',role:'mex',site:sp,spot:sp.index,prio:50,source:'economy',key:`mex-${sp.index}`},ctx.tick);}
    for(const sp of ctx.view.freeHydroSpots()){if(!ctx.budget.take(1))break;if(ctx.analysis.spots[sp.index]!.zone!=='own'||!bb.reservations.isSpotAvailable(sp.index,ctx.tick)||!bb.units.engineers.some(u=>dist(u,sp)<=120))continue;bb.taskBoard.add({kind:'build',role:'hydro',site:sp,spot:sp.index,prio:92,source:'economy',key:`hydro-${sp.index}`},ctx.tick);}
    let cap=f.engineers.cap[0]![1];for(const [time,n] of f.engineers.cap)if(ctx.tick>=time*10)cap=n;
    const baseEngineers=Math.max(1,Math.floor(Math.min(cap*ctx.profile.timing.engineerCapFactor,f.engineers.base+Math.ceil(ownFree/f.engineers.perFreeSpots))));
    bb.engineerTarget=baseEngineers+engineerBonus;
    const saturated=ownFree===0&&ctx.tick>=f.mexUpgrade.saturatedS*10;
    let energyFree=net-effective+Math.max(0,e.energyStored-f.energy.reserveE)/90-bb.eco.reservedE;
    const mexes=bb.units.structures.filter(u=>cat(u.blueprint,'MASSEXTRACTION'));const running=mexes.filter(u=>u.upgradingTo>=0).length;
    const max=bb.tech.upgrading?1:Math.min(f.mexUpgrade.maxParallel,1+Math.floor(e.massIncome/15));
    let mexIssued=false,energyBlocked=false;
    if((saturated||(ctx.tick>=f.mexUpgrade.minS*10&&bb.tech.level>=2))&&running<max){
      const candidates=mexes.filter(u=>u.complete&&u.blueprint.tech===1&&u.blueprint.upgradesTo>=0&&u.upgradingTo<0&&ctx.analysis.zoneAt(u.x,u.z)==='own'&&bb.threat.threatAt('surface',u.x,u.z)===0&&ctx.tick-(upgrades.get(u.handle)??-1000)>30);candidates.sort((a,b)=>ctx.analysis.dOwnAt(a.x,a.z)-ctx.analysis.dOwnAt(b.x,b.z)||a.handle-b.handle);
      for(const u of candidates){if(!ctx.budget.take(1))break;if(energyFree<60){if(bb.eco.reservedE<60)bb.eco.reserve(60);energyBlocked=true;break;}
        ctx.emitter.upgrade(u.handle,u.blueprint.upgradesTo,Prio.P2);upgrades.set(u.handle,ctx.tick);bb.eco.reserve(60);bb.eco.startEnergy(60,ctx.tick);energyFree-=60;mexIssued=true;bb.telemetry.push({kind:'mexUpgradeStart',tick:ctx.tick,unit:u.handle});bb.taskBoard.add({kind:'assist',target:u.handle,bp:u.blueprint.upgradesTo,prio:40,wanted:f.mexUpgrade.assistEngineers,source:'economy',key:`mex-assist-${u.handle}`},ctx.tick);break;}
    }
    // Sample actual flow, not just the full-store flag. Committed factory tasks subtract their
    // future production sink until they complete, so a delayed builder cannot duplicate orders.
    surplus.push({tick:ctx.tick,rate:e.massIncome-e.massDemand*Math.min(e.massRatio,e.energyRatio)});
    while(surplus.length&&surplus[0]!.tick<ctx.tick-f.extraFactory.forS*10)surplus.shift();
    if(e.massStored/e.massCapacity>=f.extraFactory.massStoreFrac){if(surplusSince<0)surplusSince=ctx.tick;}else surplusSince=-1;
    bb.eco.sinks=bb.eco.sinks.filter(s=>{const t=bb.taskBoard.get(s.taskId);return t!==undefined&&(t.state==='open'||t.state==='assigned');});
    if(surplusSince>=0&&ctx.tick-surplusSince>=f.extraFactory.forS*10&&!energyBlocked){
      // A higher target is also a commitment. Before the new engineer reaches production it
      // has no measured demand yet, so subtract its planned sink instead of ordering it again.
      const buildingEngineers=bb.units.factories.filter(u=>u.factoryBp>=0&&cat(ctx.static.bps.list[u.factoryBp]!,'ENGINEER')).length;
      const promisedEngineers=Math.max(0,Math.min(engineerBonus,baseEngineers+engineerBonus-bb.units.engineers.length)-buildingEngineers);
      let remaining=surplus.reduce((n,s)=>n+s.rate,0)/surplus.length-bb.eco.sinkMass-promisedEngineers*3-(mexIssued?10:0);
      let measures=mexIssued?1:0;
      let pending=live.filter(t=>t.role==='fac_land').length;
      const facs=bb.units.structures.filter(u=>cat(u.blueprint,'FACTORY')&&(u.complete||!live.some(t=>t.siteHandle===u.handle)));
      while(remaining>0&&measures<4&&ctx.tick>=f.extraFactory.minS*10&&facs.length+pending<1+Math.floor(e.massIncome/6)){
        if(!ctx.budget.take(1))break;
        const n=facs.length+pending+1;
        const t=bb.taskBoard.add({kind:'build',role:'fac_land',site:`slot:fac${n}`,prio:60,source:'economy',key:`factory-${n}`},ctx.tick);
        bb.eco.addSink({kind:'factory',massPerSec:3.7,energyPerSec:19,taskId:t.id,tick:ctx.tick});
        bb.eco.reserve(19);energyFree-=19;remaining-=3.7;pending++;measures++;
      }
      if(remaining>0&&measures<4&&bb.tech.level>=2){
        const candidates=bb.units.factories.filter(u=>u.complete&&u.blueprint.tech===1&&u.blueprint.upgradesTo>=0&&u.upgradingTo<0&&ctx.tick-(upgrades.get(u.handle)??-1000)>30);
        candidates.sort((a,b)=>dist(a,ctx.analysis.ownStart)-dist(b,ctx.analysis.ownStart)||a.handle-b.handle);
        for(const u of candidates){
          if(remaining<=0||measures>=4||!ctx.budget.take(1))break;
          if(energyFree<96){if(bb.eco.reservedE<96)bb.eco.reserve(96);energyBlocked=true;break;}
          ctx.emitter.upgrade(u.handle,u.blueprint.upgradesTo,Prio.P2);upgrades.set(u.handle,ctx.tick);
          bb.eco.reserve(96);bb.eco.startEnergy(96,ctx.tick);energyFree-=96;remaining-=12.2;measures++;
          bb.taskBoard.add({kind:'assist',target:u.handle,bp:u.blueprint.upgradesTo,prio:40,wanted:4,source:'economy',key:`factory-assist-${u.handle}`},ctx.tick);
        }
      }
      while(remaining>0&&measures<4&&engineerBonus<6&&!energyBlocked){
        if(!ctx.budget.take(1))break;
        const next=Math.max(engineerBonus+1,bb.units.engineers.length+1-baseEngineers);
        if(next>6)break;
        // The FactoryManager runs later in this same cycle and may begin this engineer at once.
        // Treat its production like other immediate consumers: power must precede the request.
        if(energyFree<25){if(bb.eco.reservedE<25)bb.eco.reserve(25);break;}
        engineerBonus=next;bb.engineerTarget=baseEngineers+engineerBonus;
        bb.eco.reserve(25);energyFree-=25;remaining-=3;measures++;
      }
    }
    if(bb.eco.emergency&&bb.units.commander&&bb.reservations.acuOwner==='opening'){const u=bb.units.commander;const task=bb.taskBoard.ordered().find(t=>t.role==='pgen'&&t.assigned.length===0);if(task&&u.order!==4){bb.reservations.handoverAcu('opening','engineer',ctx.tick);}}
  });};
});
