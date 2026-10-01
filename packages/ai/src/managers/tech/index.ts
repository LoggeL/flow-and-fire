import { defineManager } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { cat, dist, requestUnit } from '../shared.ts';
export const techManager=defineManager('tech',()=>{
  let lastIssued=-1000;
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb,f=ctx.opening?.followUp.techT2;if(!f)return;
    const factories=bb.units.factories.filter(u=>cat(u.blueprint,'LAND'));factories.sort((a,b)=>dist(a,ctx.analysis.ownStart)-dist(b,ctx.analysis.ownStart)||a.handle-b.handle);
    const done=factories.find(u=>u.blueprint.tech>=2);
    if(done){bb.tech.level=done.blueprint.tech;if(bb.tech.doneTick<0){bb.tech.doneTick=ctx.tick;bb.tech.upgrading=false;bb.telemetry.push({kind:'techDone',tick:ctx.tick,unit:done.handle,tech:2});requestUnit(ctx,'eng',2,f.t2Engineers,90,'tech');}return;}
    const upgrading=factories.find(u=>u.upgradingTo>=0);if(upgrading){bb.tech.upgrading=true;return;}
    if(ctx.tick<(f.minS+ctx.profile.timing.techDelayS)*10||ctx.tick-lastIssued<30)return;
    const eco=ctx.view.eco();const maxIncome=1+ctx.analysis.spots.filter(s=>s.kind==='mass'&&s.zone==='own').length*2;
    if(eco.massIncome<Math.min(f.minMassIncome,0.8*maxIncome)||(eco.energyIncome-eco.energyUpkeep-eco.energyDemand*eco.massRatio<f.minEnergySurplus&&eco.energyStored<2000))return;
    const factory=factories.find(u=>u.blueprint.upgradesTo>=0);if(!factory||!ctx.budget.take(1))return;
    ctx.emitter.upgrade(factory.handle,factory.blueprint.upgradesTo,Prio.P2);lastIssued=ctx.tick;bb.tech.upgrading=true;bb.tech.upgradeHandle=factory.handle;bb.tech.startTick=ctx.tick;bb.telemetry.push({kind:'techStart',tick:ctx.tick,unit:factory.handle,tech:2});
    const target=ctx.static.bps.list[factory.blueprint.upgradesTo]!;bb.eco.startEnergy(target.energy*factory.blueprint.buildPower/target.buildTime,ctx.tick);
    bb.taskBoard.add({kind:'assist',target:factory.handle,bp:target.index,prio:80,wanted:f.assistEngineers,source:'tech',key:'tech-assist'},ctx.tick);
    const acu=bb.units.commander;if(f.acuAssist&&acu&&bb.reservations.acuOwner==='engineer'&&bb.threat.threatAt('surface',acu.x,acu.z)===0)ctx.emitter.assist([acu.handle],factory.handle,Prio.P2);
  });};
});
