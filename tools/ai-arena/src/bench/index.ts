import { performance } from 'node:perf_hooks';
import { AiCommandSource, PerceptionWriter, SnapshotPerception, type Difficulty } from '@faf/ai';
import { AiHost } from '@faf/ai/host';
import { createScenario } from '../scenarios/index.ts';
import { writePerception } from '../perception/index.ts';
import { runMatch,runMatchAsync } from '../match/index.ts';
import { NodeAiWorker } from '../host-node/index.ts';
import { loadOpeningsJson } from '../data/design.ts';
import { parseOpenings } from '@faf/ai';
import { percentile } from '../stats/percentile.ts';
const quantiles=(values:number[])=>({p50:percentile(values,50),p95:percentile(values,95),p99:percentile(values,99)});
export function thinkBench(profile:Difficulty,ticks:number,units=0) {
  const c=createScenario({map:'setons',seed:7,until:ticks,sides:[{army:0,profile},{army:1,profile}]});
  if(units){const bp=c.world.setup.bps.list.find(b=>b.categoryNames.includes('TANK')&&b.tech===1)!;for(const army of [0,1]){const p=c.world.static.starts[army]!;for(let n=0;n<units;n++)c.world.spawn(army,bp.id,p.x+10+n%20,p.z+10+Math.floor(n/20));}c.world.updateVisibility();}
  const times:number[]=[],ops:number[]=[],tickTimes:number[]=[],managerOps:Record<string,number[]>={};let timeouts=0;
  const sides=[...c.brains].map(([army,brain])=>{const writer=new PerceptionWriter(),host=new AiHost(brain);return {army,source:new AiCommandSource({brain,perceive:tick=>new SnapshotPerception(brain.static,writePerception(c.world,army,tick,writer)),think:view=>{const start=performance.now(),r=host.think(view);times.push(performance.now()-start);ops.push(r.opsTotal);if(r.aborted)timeouts++;for(const [name,n] of Object.entries(r.opsByManager))(managerOps[name]??=[]).push(n);return r;}})};});
  const step=c.world.step.bind(c.world);c.world.step=()=>{const start=performance.now();step();tickTimes.push(performance.now()-start);};
  const start=performance.now(),r=runMatch({world:c.world,sides,maxTicks:ticks}),elapsed=performance.now()-start;
  let withoutAiTickMs:ReturnType<typeof quantiles>|undefined;
  if(units){const baseline=createScenario({map:'setons',seed:7,until:ticks,sides:[{army:0,profile},{army:1,profile}]}),bp=baseline.world.setup.bps.list.find(b=>b.categoryNames.includes('TANK')&&b.tech===1)!;
    for(const army of [0,1]){const p=baseline.world.static.starts[army]!;for(let n=0;n<units;n++)baseline.world.spawn(army,bp.id,p.x+10+n%20,p.z+10+Math.floor(n/20));}baseline.world.updateVisibility();
    const samples:number[]=[];const byTick=new Map<number,typeof r.log>();for(const command of r.log){const at=byTick.get(command.tick)??[];at.push(command);byTick.set(command.tick,at);}
    while(baseline.world.tick<r.metrics.endTick){baseline.world.apply(byTick.get(baseline.world.tick)??[]);const before=performance.now();baseline.world.step();samples.push(performance.now()-before);}if(baseline.world.hash()!==r.hash)throw new Error('Battle baseline replay diverged');withoutAiTickMs=quantiles(samples);
  }
  return {...(withoutAiTickMs?{withoutAiTickMs}:{}),profile,ticks:r.metrics.endTick,unitsPerSide:units,thinkMs:quantiles(times),tickMs:quantiles(tickTimes),ticksPerSecond:r.metrics.endTick/(elapsed/1000),opsP99:percentile(ops,99),opsCap:c.brains.get(0)!.profile.budget.total,managerOpsP99:Object.fromEntries(Object.entries(managerOps).map(([k,v])=>[k,percentile(v,99)])),timeouts};
}
export async function schedulerBench(ticks:number) {
  const c=createScenario({map:'hollow-ridge',seed:7,until:ticks}),hosts:NodeAiWorker[]=[],waits:number[]=[];let nextSlice=performance.now(),sliceTicks=0;
  try {const sides=[];for(const [army,brain] of c.brains){const host=await NodeAiWorker.create({static:brain.static,profile:brain.profile,options:{openings:parseOpenings(loadOpeningsJson())}});hosts.push(host);const writer=new PerceptionWriter();sides.push({army,source:host.source({thinkEvery:brain.profile.thinkEvery,lead:brain.profile.lead,perceive:tick=>writePerception(c.world,army,tick,writer)})});}
    // Three ticks per 100 ms slice, 10-Hz game at 3x. The pending result never gets dropped.
    let yields=0;
    const r=await runMatchAsync({world:c.world,sides,maxTicks:ticks,wait:async()=>{const start=performance.now();await Promise.race(hosts.map(h=>h.wait()));waits.push(performance.now()-start);},onTick:()=>{},beforeTick:async()=>{if(sliceTicks===0){const remaining=nextSlice-performance.now();if(remaining>0)await new Promise<void>(resolve=>setTimeout(resolve,remaining));nextSlice+=100;yields++;}sliceTicks=(sliceTicks+1)%3;}});
    return {ticks:r.metrics.endTick,waitTicks:r.metrics.waitTicks,pendingPct:r.metrics.waitTicks/r.metrics.endTick*100,waitMsP95:waits.length?percentile(waits,95):0,slices:yields,pass:r.metrics.waitTicks/r.metrics.endTick<0.01};
  }finally{await Promise.all(hosts.map(h=>h.close()));}
}
export async function runBench(quick=false) {const think=(['easy','normal','hard'] as const).map(p=>thinkBench(p,quick?900:9000));const battle=thinkBench('hard',quick?100:600,300);const scheduler=await schedulerBench(quick?150:3000);return {schema:'faf-ai-arena/1',quick,think,battle,scheduler,gates:{normalThink:think.find(t=>t.profile==='normal')!.thinkMs.p95<=8,ops:[...think,battle].every(t=>t.opsP99<=t.opsCap),timeouts:[...think,battle].every(t=>t.timeouts===0),scheduler:scheduler.pass}};}
