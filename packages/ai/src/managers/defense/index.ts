import { defineManager } from '../../brain.ts';
import { cat, dist } from '../shared.ts';
export const defenseManager=defineManager('defense',()=>{
  let since=-1;
  return ctx=>{ctx.step(()=>()=>{
    const bb=ctx.bb;bb.stimuli.forEachVisible(since,ctx.tick,s=>{
      if(!ctx.budget.take(1)||s.kind!=='event'||s.event.kind!=='ownDamaged')return;
      if(ctx.tick<1800&&!bb.opening.defenseMode)return;const damaged=bb.units.get(s.event.unit);if(!damaged||!cat(damaged.blueprint,'MASSEXTRACTION'))return;
      const attacker=s.event.attackerBp>=0?ctx.static.bps.list[s.event.attackerBp]:undefined;if(!attacker||attacker.layer==='air'||attacker.dpsSurface===0)return;
      const cluster=bb.units.structures.filter(u=>cat(u.blueprint,'MASSEXTRACTION')&&dist(u,damaged)<=30);if(cluster.length<2)return;
      cluster.sort((a,b)=>a.handle-b.handle);const key=`cluster-${cluster[0]!.handle}`;if(bb.defense.clusterDefense.has(key))return;
      const center={x:cluster.reduce((v,u)=>v+u.x,0)/cluster.length,z:cluster.reduce((v,u)=>v+u.z,0)/cluster.length};
      if(ctx.analysis.zoneAt(center.x,center.z)==='contested'&&!bb.platoons.some(p=>dist(p,center)<40&&p.ratio>=1))return;
      const bp=ctx.roles.tryResolve('pd',1);if(!bp)return;bb.defense.spend=bb.defense.spend.filter(s=>ctx.tick-s.tick<1800);const spent=bb.defense.spend.reduce((v,s)=>v+s.mass,0);
      if(!bb.opening.defenseMode&&spent+bp.mass>ctx.view.eco().massIncome*180*0.15)return;
      const attackerHandle=s.event.attacker;const threat=bb.enemy.current.find(e=>e.id===attackerHandle);const dx=(threat?.x??center.x+ctx.analysis.forward.x)-center.x,dz=(threat?.z??center.z+ctx.analysis.forward.z)-center.z,len=Math.sqrt(dx*dx+dz*dz)||1;
      const task=bb.taskBoard.add({kind:'build',role:'pd',site:{x:center.x+dx/len*6,z:center.z+dz/len*6},prio:95,source:'defense',key},ctx.tick);bb.defense.clusterDefense.set(key,task.id);bb.defense.spend.push({tick:ctx.tick,mass:bp.mass});
    });since=ctx.tick;
  });};
});
