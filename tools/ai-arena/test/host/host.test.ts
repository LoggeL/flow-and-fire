import { describe,expect,it } from 'vitest';
import { asTick } from '@faf/fixed';
import { encodeBatch,Op } from '@faf/protocol';
import { AiCommandSource,createBrain,defineManager,PerceptionWriter,Prio,SnapshotPerception } from '@faf/ai';
import { AiHost,packStatic,unpackStatic } from '@faf/ai/host';
import { createScenario } from '../../src/scenarios/index.ts';
import { NodeAiWorker } from '../../src/host-node/index.ts';
import { runMatch,runMatchAsync,replayMatch } from '../../src/match/index.ts';
import { writePerception } from '../../src/perception/index.ts';
import { loadOpeningsJson } from '../../src/data/design.ts';
import { parseOpenings } from '@faf/ai';
describe('AI host',()=>{
 it('static wire clone rebuilds functional blueprint methods',()=>{const c=createScenario({map:'hollow-ridge',seed:7,until:1});const s=c.world.staticFor(0),r=unpackStatic(structuredClone(packStatic(s)));expect(r.bps.byId(s.bps.list[0]!.id)?.index).toBe(0);expect(r.bps.compile('COMMAND').source).toBe('COMMAND');expect(r.passLowRes).toEqual(s.passLowRes);});
 it('AI-DET-01 Node worker and synchronous default brain have identical stream and replay',async()=>{
  const scenario={map:'setons',seed:7,until:6000};const syncSetup=createScenario(scenario),syncHashes:number[]=[],asyncHashes:number[]=[];const sync=runMatch({world:syncSetup.world,sides:syncSetup.sides,maxTicks:6000,onTick:w=>{if(w.tick%600===0)syncHashes.push(w.hash());}}),c=createScenario(scenario),hosts:NodeAiWorker[]=[];
  try {const sides=[];for(const [army,brain] of c.brains){const host=await NodeAiWorker.create({static:brain.static,profile:brain.profile,options:{openings:parseOpenings(loadOpeningsJson())}});hosts.push(host);const writer=new PerceptionWriter();sides.push({army,source:host.source({thinkEvery:brain.profile.thinkEvery,lead:brain.profile.lead,perceive:tick=>writePerception(c.world,army,tick,writer)})});}
   const asyncResult=await runMatchAsync({world:c.world,sides,maxTicks:6000,onTick:w=>{if(w.tick%600===0)asyncHashes.push(w.hash());},wait:()=>Promise.race(hosts.map(h=>h.wait()))});expect(encodeBatch(asyncResult.log)).toEqual(encodeBatch(sync.log));expect(asyncResult.hash).toBe(sync.hash);expect(asyncHashes).toEqual(syncHashes);expect(replayMatch(c.world.setup,asyncResult.log,asyncResult.metrics.endTick).hash).toBe(sync.hash);
  }finally{await Promise.all(hosts.map(h=>h.close()));}
 },20000);
 it('AI-DET-03 a two-tick-late result holds due tick and keeps command',async()=>{const c=createScenario({map:'hollow-ridge',seed:7,until:1}),brain=c.brains.get(0)!,host=await NodeAiWorker.create({static:brain.static,profile:brain.profile,options:{openings:parseOpenings(loadOpeningsJson())}});try{const writer=new PerceptionWriter(),source=host.source({thinkEvery:5,lead:3,perceive:tick=>writePerception(c.world,0,tick,writer)});expect(source.commandsFor(asTick(0))).toEqual([]);expect(source.commandsFor(asTick(3))).toBe('pending');await host.wait();const commands=source.commandsFor(asTick(3));expect(commands).not.toBe('pending');if(typeof commands==='string')throw new Error('AI command result is still pending');expect(commands).toHaveLength(1);expect(commands[0]!.tick).toBe(3);expect(commands[0]!.op).toBe(Op.Build);}finally{await host.close();}});

 it('AI-DET-04 default-brain emergency stop records timeout and replays its emitted log',()=>{const c=createScenario({map:'hollow-ridge',seed:7,until:100}),brain=c.brains.get(0)!;let time=0;const host=new AiHost(brain,{clock:()=>time++,timeoutMs:1}),writer=new PerceptionWriter();const source=new AiCommandSource({brain,perceive:tick=>new SnapshotPerception(brain.static,writePerception(c.world,0,tick,writer)),think:view=>host.think(view)});const r=runMatch({world:c.world,sides:[{army:0,source}],maxTicks:100});expect(brain.blackboard.telemetry.count('aiTimeout')).toBeGreaterThan(0);expect(replayMatch(c.world.setup,r.log,r.metrics.endTick).hash).toBe(r.hash);});
 it('AI-DET-04 interrupted work rolls back its command and emits timeout mark',()=>{const c=createScenario({map:'hollow-ridge',seed:7,until:1}),original=c.brains.get(0)!;let clock=0,committed=0;const manager=defineManager('platoon',()=>ctx=>{ctx.step(()=>{ctx.emitter.move([ctx.bb.units.commander!.handle],20,20,Prio.P1);clock=201;return ()=>{committed++;};});});const brain=createBrain({managers:[manager]});brain.init(original.static,original.profile,{openings:parseOpenings(loadOpeningsJson())});const host=new AiHost(brain,{clock:()=>clock,timeoutMs:200});const view=new SnapshotPerception(brain.static,writePerception(c.world,0,0,new PerceptionWriter()));const r=host.think(view);expect(r.aborted).toBe(true);expect(r.commands).toHaveLength(0);expect(committed).toBe(0);expect(brain.blackboard.telemetry.first('aiTimeout')?.tick).toBe(0);});
});
