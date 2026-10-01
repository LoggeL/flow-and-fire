import { defineManager } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { firstWaveFor } from '../../profile.ts';
import { enemyAcuFactor, ownAcuFactor } from '../../threat.ts';
import { cat, dist } from '../shared.ts';
export const platoonManager=defineManager('platoon',()=>{
  let nextId=1,wave=0,quietSince=0;const commanded=new Map<number,string>();const low=new Map<number,number>(),high=new Map<number,number>(),initial=new Map<number,number>();
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb,follow=ctx.opening?.followUp.waves;if(!follow)return;
    const fighters=bb.units.army.filter(u=>!cat(u.blueprint,'SCOUT')&&u.blueprint.threatSurface>0);
    for(const p of bb.platoons)p.units=p.units.filter(h=>bb.units.get(h));
    for(const p of [...bb.platoons]){if(p.units.length===0){bb.platoons=bb.platoons.filter(q=>q!==p);continue;}if(p.units.length<(initial.get(p.id)??p.units.length)*0.5){const target=bb.platoons.find(q=>q!==p&&(q.state==='forming'||q.state==='staging'));if(target){target.units.push(...p.units);p.units=[];bb.platoons=bb.platoons.filter(q=>q!==p);}}}
    let forming=bb.platoons.find(p=>p.state==='forming');const occupied=new Set(bb.platoons.flatMap(p=>p.units));const free=fighters.filter(u=>!occupied.has(u.handle));
    if(free.length){if(!forming){forming={id:nextId++,state:'forming',units:[],x:ctx.analysis.rally.x,z:ctx.analysis.rally.z,ratio:Infinity,target:null,isFirstWave:wave===0&&!bb.platoons.some(p=>p.isFirstWave)};bb.platoons.push(forming);}forming.units.push(...free.map(u=>u.handle));}
    for(const p of bb.platoons){if(!ctx.budget.take(p.units.length+bb.enemy.current.length))break;
      const units=p.units.map(h=>bb.units.get(h)!).filter(Boolean);if(!units.length)continue;p.x=units.reduce((v,u)=>v+u.x,0)/units.length;p.z=units.reduce((v,u)=>v+u.z,0)/units.length;
      const radius=Math.max(...units.map(u=>u.blueprint.rangeMax))+20;let own=0,enemy=0;
      for(const u of fighters)if(dist(u,p)<=radius)own+=u.blueprint.threatSurface*u.hpFrac;
      for(const e of bb.enemy.current){if(dist(e,p)>radius)continue;const b=e.bp>=0?ctx.static.bps.list[e.bp]:undefined;enemy+=(b?.threatSurface??84)*e.hpFrac*(b&&cat(b,'COMMAND')?enemyAcuFactor(bb.enemy.estoreSeen,ctx.tick):1);}
      p.ratio=own/Math.max(1,enemy);const under=p.ratio<(p.state==='raid'?1:ctx.profile.retreatRatio);low.set(p.id,under?(low.get(p.id)??0)+1:0);high.set(p.id,p.ratio>=ctx.profile.attackRatio?(high.get(p.id)??0)+1:0);
      const retreat=():void=>{ctx.emitter.move(p.units,ctx.analysis.rally.x,ctx.analysis.rally.z,Prio.P0);p.state='retreat';bb.telemetry.push({kind:'retreat',tick:ctx.tick,platoon:p.id,ratio:p.ratio});};
      if((p.state==='attack'||p.state==='raid')&&(low.get(p.id)??0)>=2){retreat();continue;}
      if(p.state==='retreat'){if(ctx.view.knownEnemyCount>bb.enemy.current.length)continue;const hp=units.reduce((v,u)=>v+u.hpFrac,0)/units.length;if(p.ratio>=ctx.profile.reentryRatio&&hp>=ctx.profile.reentryHpFrac){p.state='staging';ctx.emitter.move(p.units,ctx.analysis.staging.x,ctx.analysis.staging.z,Prio.P1);}continue;}
      const threshold=firstWaveFor(ctx.profile,follow.first)+wave*follow.grow;
      if(p.state==='forming'){if(p.units.length>=threshold||(p.isFirstWave&&ctx.tick>=(follow.maxS-60)*10)){p.state='staging';initial.set(p.id,p.units.length);ctx.emitter.move(p.units,ctx.analysis.staging.x,ctx.analysis.staging.z,Prio.P1);}else {const key=p.units.join(',');if(commanded.get(p.id)!==key){ctx.emitter.move(p.units,ctx.analysis.rally.x,ctx.analysis.rally.z,Prio.P1);commanded.set(p.id,key);}}}
      if(p.state==='staging'){
        const forced=p.isFirstWave&&ctx.tick>=follow.maxS*10;const staged=dist(p,ctx.analysis.staging)<=25;
        if(forced||(staged&&(high.get(p.id)??0)>=2)){
          let target=ctx.analysis.enemyStart,best=-Infinity;const artillery=units.filter(u=>cat(u.blueprint,'INDIRECTFIRE')).length/units.length;
          for(const e of bb.enemy.current){if(ctx.analysis.zoneAt(e.x,e.z)==='own')continue;const b=e.bp>=0?ctx.static.bps.list[e.bp]:undefined;if(!b)continue;
            const value=cat(b,'MASSEXTRACTION')?100+b.tech*100:cat(b,'ENGINEER')?60:cat(b,'ENERGYPRODUCTION')?40:cat(b,'FACTORY')?80:cat(b,'DEFENSE')?(artillery>=0.25?100:-50):cat(b,'COMMAND')?(p.ratio>=2?300:-100):20;
            const score=value/(1+bb.threat.threatAt('surface',e.x,e.z))/(1+dist(p,e)/200);if(score>best){best=score;target=e;}}
          ctx.emitter.attackMove(p.units,target.x,target.z,Prio.P1);p.state='attack';p.target=target;bb.telemetry.push({kind:'waveAttack',tick:ctx.tick,x:target.x,z:target.z,enemyHalf:ctx.analysis.zoneAt(target.x,target.z)!=='own',units:p.units.length,forced});wave++;}
      }
    }
    for(const r of [...bb.huntRequests.items]){if(!ctx.budget.take(fighters.length))break;const e=bb.enemy.current.find(e=>e.id===r.target);if(!e){bb.huntRequests.remove(r.id);continue;}const hunters=[...fighters].sort((a,b)=>dist(a,e)-dist(b,e)||a.handle-b.handle);const hunter=hunters[0];if(hunter){ctx.emitter.attack([hunter.handle],e.id,Prio.P1);r.hunter=hunter.handle;}}
    const acu=bb.units.commander;if(!acu)return;
    const facs=[...bb.units.factories].sort((a,b)=>dist(a,acu)-dist(b,acu)||a.handle-b.handle);const base=facs[0]??ctx.analysis.ownStart;
    const leash=ctx.profile.name==='hard'?120:60;const pursued=bb.enemy.current.find(e=>e.id===acu.orderTarget);
    if(dist(acu,base)>leash||(acu.order===3&&(!pursued||dist(pursued,base)>leash))){bb.reservations.claimAcu('platoon',ctx.tick,'leash');ctx.emitter.move([acu.handle],base.x,base.z,Prio.P0);return;}
    const enemies=bb.enemy.current.filter(e=>e.bp>=0&&ctx.static.bps.list[e.bp]!.threatSurface>15&&dist(e,base)<=60);
    if(enemies.length===0){if(ctx.tick-quietSince>=150)bb.reservations.releaseAcu('platoon',ctx.tick);return;}quietSince=ctx.tick;
    let enemyStrength=0,dps=0;for(const e of enemies){const b=ctx.static.bps.list[e.bp]!;enemyStrength+=b.threatSurface*e.hpFrac;if(dist(e,acu)<=b.rangeMax+10)dps+=b.dpsSurface;}
    const own=acu.blueprint.threatSurface*acu.hpFrac*ownAcuFactor(ctx.view.eco().energyStored)+fighters.filter(u=>dist(u,acu)<40).reduce((v,u)=>v+u.blueprint.threatSurface*u.hpFrac,0);const ratio=own/Math.max(1,enemyStrength);
    if(acu.hpFrac<0.5||ratio<0.5||(dps>0&&acu.hpFrac*acu.blueprint.hpEff/dps<20)){bb.reservations.claimAcu('platoon',ctx.tick,'retreat');const p={x:base.x-ctx.analysis.forward.x*12,z:base.z-ctx.analysis.forward.z*12};ctx.emitter.move([acu.handle],p.x,p.z,Prio.P0);return;}
    if(ratio>=1){bb.reservations.claimAcu('platoon',ctx.tick,'local-defense');const enemy=[...enemies].sort((a,b)=>dist(a,acu)-dist(b,acu)||a.id-b.id)[0]!;const leash=ctx.profile.name==='hard'&&ratio>=2?120:60;if(dist(enemy,base)<=leash){ctx.emitter.attack([acu.handle],enemy.id,Prio.P0);if(ctx.view.eco().energyStored>=7500&&(enemies.filter(e=>dist(e,enemy)<=2.5).length>=3||ctx.static.bps.list[enemy.bp]!.tech>=2))ctx.emitter.overcharge(acu.handle,enemy.id,Prio.P0);}return;}
    // Local contacts alone must not retain a past combat claim when no combat action is needed.
    bb.reservations.releaseAcu('platoon',ctx.tick);
  });};
});
