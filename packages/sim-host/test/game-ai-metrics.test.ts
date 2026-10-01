import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AiBudgetMetrics, createGameAiSources, startGameAiWorker, type GameAiPort, type GameAiWorkerResult } from '../src/ai/index.ts';
import type { WorkerRequest, WorkerResponse } from '@faf/ai/host';
import { SimCore } from '../src/index.ts';
import { makeTestHost } from './support/host.ts';
import type { SkirmishInitialization } from '@faf/protocol';

const setup:SkirmishInitialization={kind:'skirmish',faction:0,slots:[{start:0,team:0,faction:0,controller:'human'},{start:1,team:1,faction:0,controller:'ai',difficulty:'normal'}],rules:{unitCap:1000,fog:'explore',victory:'annihilation'}};
const simBin=()=>new Uint8Array(readFileSync(new URL('../../../content/generated/sim.bin',import.meta.url)));

/** Real brain/runtime; only reply delivery is held so one deadline can be retried. */
function delayedWorker(clock?:()=>number) {
  let request:((message:WorkerRequest|WorkerResponse)=>void)|undefined;
  let response:((message:WorkerRequest|WorkerResponse)=>void)|undefined;
  const replies:WorkerResponse[]=[],requests:WorkerRequest[]=[];
  startGameAiWorker({postMessage:m=>replies.push(structuredClone(m) as WorkerResponse),onMessage:cb=>{request=cb;}},clock);
  const port:GameAiPort={execution:'custom',postMessage:m=>{requests.push(m as WorkerRequest);request!(structuredClone(m));},onMessage:cb=>{response=cb;},dispose(){}};
  return {port,replies,requests,async deliver(){await new Promise<void>(resolve=>setImmediate(resolve));for(const reply of replies.splice(0))response!(reply);}};
}

describe('native game AI observations',()=>{
  it('counts one refused Sim tick despite scheduler retries, then the next decision deadline separately',async()=>{
    const wire=delayedWorker(),test=makeTestHost({initialization:setup,host:{ai:{createPort:()=>wire.port},keyframes:false}});
    try {
      test.wake.advance(500);
      expect(test.host.tick).toBe(2);
      const first=test.host.aiDiagnostics()!;
      expect(first.waitingTickIds).toEqual([3]);expect(first.distinctWaitingTicks).toBe(1);
      expect(first.waitRetries).toBeGreaterThan(1);
      await wire.deliver();test.wake.advance(600);
      const second=test.host.aiDiagnostics()!;
      expect(second.waitingTickIds).toEqual([3,8]);expect(second.distinctWaitingTicks).toBe(2);
      expect(second.armies[0]!.budget.measured).toBe(1);
      expect(second.samples[0]!.samples[0]).toMatchObject({tick:0,aborted:false});
      expect(second.samples[0]!.samples[0]!.thinkMs).toBeGreaterThanOrEqual(0);
      expect(test.host.status().ai!.distinctWaitingTicks).toBe(2);
    }finally{test.close();}
  });

  it('times actual brain execution in its clock domain and keeps the 40 ms emergency default',async()=>{
    let time=100;const wire=delayedWorker(()=>{const value=time;time+=4;return value;});
    const ai=createGameAiSources({initialization:setup,createPort:()=>wire.port});
    const c=new SimCore({simBin:simBin(),seed:7,armyCount:2,initialization:setup,localSource:ai.local,sources:ai.sources,keyframes:false});
    try {
      ai.bind(c);expect(wire.requests[0]).toMatchObject({type:'init',timeoutMs:40,options:{maxMs:9}});
      await new Promise<void>(resolve=>setImmediate(resolve));
      expect((wire.replies.find(r=>r.type==='result') as GameAiWorkerResult).thinkMs).toBe(4);
      time+=10000;await wire.deliver();
      expect(ai.status[0]!.budget).toMatchObject({measured:1,missingTiming:0,thinkP95Ms:4});
      expect(ai.samples[0]!.samples).toHaveLength(1);
    }finally{ai.dispose();}
  });

  it('uses the real inline runtime on two cores and honors an explicit port override',async()=>{
    const ai=createGameAiSources({initialization:setup,hardwareConcurrency:2});
    const c=new SimCore({simBin:simBin(),seed:7,armyCount:2,initialization:setup,localSource:ai.local,sources:ai.sources,keyframes:false});
    try {
      ai.bind(c);await new Promise<void>(resolve=>setImmediate(resolve));
      expect(ai.status[0]).toMatchObject({execution:'inline',hardwareConcurrency:2,thinks:1,error:null,timeouts:0});
      expect(ai.status[0]!.budget.measured).toBe(1);
      expect(c.runTick()).toBe(true);expect(c.runTick()).toBe(true);expect(c.runTick()).toBe(true);
      expect(c.recorder!.byteLength).toBeGreaterThan(0);
    }finally{ai.dispose();}
    const wire=delayedWorker(),override=createGameAiSources({initialization:setup,hardwareConcurrency:2,createPort:()=>wire.port,timeoutMs:7});
    const other=new SimCore({simBin:simBin(),seed:7,armyCount:2,initialization:setup,localSource:override.local,sources:override.sources,keyframes:false});
    try {override.bind(other);expect(override.status[0]!.execution).toBe('custom');expect(wire.requests[0]).toMatchObject({timeoutMs:7});}
    finally{override.dispose();}
  });

  it('exposes absent timing and overwritten samples instead of treating them as zero-cost passes',()=>{
    const metrics=new AiBudgetMetrics(2);
    const base:Extract<WorkerResponse,{type:'result'}>={type:'result',tick:0,batch:new Uint8Array(),aborted:false,ops:9,opsByManager:{}};
    metrics.record(base);metrics.record({...base,thinkMs:NaN} as GameAiWorkerResult);
    for(let tick=1;tick<=3;tick++)metrics.record({...base,tick,ops:tick*10,thinkMs:tick} as GameAiWorkerResult);
    expect(metrics.summary()).toEqual({measured:3,missingTiming:2,dropped:1,thinkP95Ms:3,opsP99:30,opsMax:30});
    expect(metrics.samples().map(s=>s.tick)).toEqual([2,3]);
  });
});
