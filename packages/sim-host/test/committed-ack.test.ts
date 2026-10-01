import { describe, expect, it } from 'vitest';
import { createSabFrameBuffer, type HostMessage, type CommandEnvelope, type SkirmishInitialization } from '@faf/protocol';
import { PhaseId, lastHashTick, unitHandles } from '@faf/sim';
import type { WorkerRequest, WorkerResponse } from '@faf/ai/host';
import { SimCore, SimHost, parseCommandLog, replayLog } from '../src/index.ts';
import { startGameAiWorker, type GameAiPort } from '../src/ai/index.ts';
import { FRAME_CAP } from './support/host.ts';
import { FakeClock } from './support/fake-time.ts';
import { bufferOf, gameSimBin, gameSimBinBuffer, killCmd, moveCmd, spawnCmd, stopCmd } from './support/fixtures.ts';

function create(options:{post?:(message:HostMessage)=>void;initialization?:SkirmishInitialization;aiPort?:GameAiPort;keyframes?:{intervalTicks:number}}={}){
  const clock=new FakeClock(),messages:HostMessage[]=[];
  const host=new SimHost({post:message=>{options.post?.(message);messages.push(structuredClone(message));},clock,autoStart:false,opfs:null,
    ...(options.aiPort===undefined?{}:{ai:{createPort:()=>options.aiPort!}}),...(options.keyframes===undefined?{}:{keyframes:options.keyframes})});
  host.init({t:'init',simBin:gameSimBinBuffer(),seed:71,armyCount:2,playerArmy:0,transport:'sab',frameSab:createSabFrameBuffer(FRAME_CAP),frameCapacity:FRAME_CAP,buildHash:'committed-ack-test',
    ...(options.initialization===undefined?{}:{initialization:options.initialization})});
  return {host,clock,messages,acks:()=>messages.filter((m):m is Extract<HostMessage,{t:'ack'}>=>m.t==='ack')};
}

describe('ACK after authoritative Cleanup, before derived Output',()=>{
  it('confirms final cleanup before a deliberately delayed real hash, forwarding every probe phase once',()=>{
    let observed:{tick:number;live:number;lastHashTick:number;time:number}|undefined;
    const h=create({post:m=>{if(m.t==='ack'&&m.ackSeq===2)observed={tick:h.host.tick,live:h.host.core.world.units.liveCount,lastHashTick:lastHashTick(h.host.core.world),time:h.clock.now()};}});
    try {
      h.host.submit(bufferOf([spawnCmd(0,4,120,120,3,1)]));for(let n=0;n<9;n++)expect(h.host.advance()).toBe(true);
      const handles=unitHandles(h.host.core.world,0);expect(handles).toHaveLength(4);
      h.host.submit(bufferOf([killCmd(0,handles,2)]));
      const phases:string[]=[],begin=h.host.probe.begin.bind(h.host.probe),end=h.host.probe.end.bind(h.host.probe);
      h.host.probe.begin=phase=>{
        phases.push(`begin:${phase}`);
        if(phase===PhaseId.HashTick){expect(observed).toEqual({tick:10,live:0,lastHashTick:0,time:0});h.clock.t+=50;}
        begin(phase);
      };
      h.host.probe.end=phase=>{phases.push(`end:${phase}`);end(phase);};
      expect(h.host.advance()).toBe(true);
      expect(phases.indexOf(`end:${PhaseId.Cleanup}`)).toBeLessThan(phases.indexOf(`begin:${PhaseId.Output}`));
      expect(phases.filter(p=>p===`end:${PhaseId.Cleanup}`)).toHaveLength(1);
      expect(phases.filter(p=>p===`begin:${PhaseId.HashTick}`)).toHaveLength(1);
      expect(phases.filter(p=>p===`end:${PhaseId.HashTick}`)).toHaveLength(1);
      for(const phase of new Set(phases.map(p=>p.split(':')[1]))) {
        expect(phases.filter(p=>p===`begin:${phase}`)).toHaveLength(1);expect(phases.filter(p=>p===`end:${phase}`)).toHaveLength(1);
      }
      expect(h.clock.now()).toBe(50);expect(lastHashTick(h.host.core.world)).toBe(10);
      expect(h.host.core.hashTrail()).toHaveLength(1);expect(parseCommandLog(h.host.core.recorder!.export(10)).hashes).toHaveLength(1);
      expect(h.acks().map(m=>[m.tick,m.ackSeq])).toEqual([[1,1],[10,2]]);
    }finally{h.host.dispose();}
  });

  it('preserves full Arena bytes, hash/log/replay parity, keyframes and dedup across sequence wrap',()=>{
    const h=create(),reference=new SimCore({simBin:gameSimBin(),seed:71,armyCount:2,playerArmy:0,buildHash:'committed-ack-test'});
    try {
      for(let tick=1;tick<=600;tick++){
        let commands:CommandEnvelope[]=[];
        if(tick===1)commands=[spawnCmd(0,4,120,120,3,65534)];
        if(tick===2)commands=[moveCmd(0,unitHandles(h.host.core.world,0),180,180,65535)];
        if(tick===10)commands=[moveCmd(0,unitHandles(h.host.core.world,0),160,180,1)];
        if(tick===11)commands=[stopCmd(0,unitHandles(h.host.core.world,0),2)];
        if(tick===12)commands=[spawnCmd(1,1,380,380,0,77)];
        if(commands.length){h.host.submit(bufferOf(commands));reference.local.push(new Uint8Array(bufferOf(commands)));}
        expect(h.host.advance()).toBe(true);expect(reference.runTick()).toBe(true);
      }
      expect(h.acks().map(m=>[m.tick,m.army,m.ackSeq])).toEqual([[1,0,65534],[2,0,65535],[10,0,1],[11,0,2]]);
      expect(Buffer.compare(h.host.core.world.arena.bytes,reference.world.arena.bytes)).toBe(0);
      expect([h.host.core.fullHash(),h.host.core.ruleHash()]).toEqual([reference.fullHash(),reference.ruleHash()]);
      expect(h.host.core.hashTrail()).toEqual(reference.hashTrail());
      const bytes=h.host.core.recorder!.export(600),expected=reference.recorder!.export(600);
      expect(Buffer.compare(new Uint8Array(bytes),new Uint8Array(expected))).toBe(0);
      expect(h.host.core.keyframes!.count).toBe(2);
      expect(Buffer.compare(h.host.core.keyframes!.bytesAt(1),reference.keyframes!.bytesAt(1))).toBe(0);
      const replay=replayLog(bytes,{simBin:gameSimBin()});expect(replay.mismatches).toEqual([]);
      expect(Buffer.compare(replay.sim.world.arena.bytes,h.host.core.world.arena.bytes)).toBe(0);
      h.messages.length=0;h.host.core.seek(0);expect(h.host.core.replaying).toBe(true);
      for(let tick=1;tick<=600;tick++)expect(h.host.advance()).toBe(true);
      expect(h.acks()).toEqual([]);expect(h.host.core.mismatches).toEqual([]);
      expect(h.host.core.fullHash()).toBe(reference.fullHash());
    }finally{h.host.dispose();}
  });

  it('finishes derived hash/log/trail/keyframes and counters before surfacing an ACK transport error',()=>{
    const failure=new Error('ACK transport unavailable');let shouldFail=true;
    const h=create({keyframes:{intervalTicks:1},post:m=>{if(m.t==='ack'&&shouldFail)throw failure;}});
    try {
      for(let n=0;n<9;n++)expect(h.host.advance()).toBe(true);
      h.host.submit(bufferOf([spawnCmd(0,1,120,120,0,1)]));
      expect(()=>h.host.advance()).toThrow(failure);
      expect(h.host.tick).toBe(10);expect(lastHashTick(h.host.core.world)).toBe(10);
      expect(h.host.core.hashTrail()).toHaveLength(1);expect(h.host.core.recordedEnd).toBe(10);
      expect(h.host.core.keyframes!.indexOf(10)).toBeGreaterThanOrEqual(0);
      const log=parseCommandLog(h.host.core.recorder!.export(10));expect(log.commands).toHaveLength(1);expect(log.hashes).toHaveLength(1);
      expect(h.acks()).toHaveLength(0);
      const replay=replayLog(log,{simBin:gameSimBin()});expect(replay.mismatches).toEqual([]);
      expect(replay.sim.fullHash()).toBe(h.host.core.fullHash());
      shouldFail=false;expect(h.host.advance()).toBe(true);expect(h.acks().map(m=>m.ackSeq)).toEqual([1]);
      expect(h.host.advance()).toBe(true);expect(h.acks()).toHaveLength(1);
    }finally{h.host.dispose();}
  });

  it('never confirms a partially applied tick whose authoritative phase failed before Cleanup',()=>{
    const h=create();
    try {
      h.host.submit(bufferOf([spawnCmd(0,1,120,120,0,1)]));
      const begin=h.host.probe.begin.bind(h.host.probe);
      h.host.probe.begin=phase=>{if(phase===PhaseId.Movement)throw new Error('authoritative phase failed');begin(phase);};
      expect(()=>h.host.advance()).toThrow('authoritative phase failed');
      expect(h.host.core.world.armies.col.lastAckSeq[0]).toBe(1);expect(h.acks()).toEqual([]);
      expect(h.host.core.recordedEnd).toBe(0);
    }finally{h.host.dispose();}
  });

  it('does not ACK a local command while an actual AI source holds its due tick pending',async()=>{
    let workerReceive:((m:WorkerRequest|WorkerResponse)=>void)|undefined,hostReceive:((m:WorkerRequest|WorkerResponse)=>void)|undefined;
    const replies:WorkerResponse[]=[];
    startGameAiWorker({postMessage:m=>replies.push(structuredClone(m) as WorkerResponse),onMessage:cb=>{workerReceive=cb;}});
    const port:GameAiPort={postMessage:m=>workerReceive!(structuredClone(m)),onMessage:cb=>{hostReceive=cb;},dispose(){}};
    const initialization:SkirmishInitialization={kind:'skirmish',faction:0,slots:[{start:0,team:0,faction:0,controller:'human'},{start:1,team:1,faction:0,controller:'ai',difficulty:'normal'}]};
    const h=create({initialization,aiPort:port});
    try {
      expect(h.host.advance()).toBe(true);expect(h.host.advance()).toBe(true);
      h.host.submit(bufferOf([moveCmd(0,unitHandles(h.host.core.world,0),80,80,1)]));
      expect(h.host.advance()).toBe(false);expect(h.host.advance()).toBe(false);expect(h.host.tick).toBe(2);expect(h.acks()).toEqual([]);
      await new Promise<void>(resolve=>setImmediate(resolve));for(const reply of replies.splice(0))hostReceive!(reply);
      expect(h.host.advance()).toBe(true);expect(h.acks().map(m=>[m.tick,m.ackSeq])).toEqual([[3,1]]);
    }finally{h.host.dispose();}
  });
});
