import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeMap, encodeFactoryRepeat, parseOpenings, SnapshotPerception, type KnownUnit, type OwnUnit } from '@faf/ai';
import type { MessagePortLike, WorkerRequest, WorkerResponse } from '@faf/ai/host';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { createRtsMap } from '@faf/formats';
import { asArmyId, asTick, fx } from '@faf/fixed';
import { CmdFlags, decodeBatch, decodeBuild, decodeFactoryQueue, encodeBatch, encodeBuild, Op, type SkirmishInitialization } from '@faf/protocol';
import { canPlace, PlacementVerdict } from '@faf/rules';
import { matchResult, perceive, placementWorld, unitHandles } from '@faf/sim';
import { killUnit } from '@faf/sim';
import { compileContent } from '@faf/blueprints/content';
import { replayLog, Scheduler, SimCore } from '../src/index.ts';
import { createGameAiSources, GameAiPerception, gameAiStatic, gameAiCommands, gameBlueprints, startGameAiWorker, type GameAiPort } from '../src/ai/index.ts';
import { DEFAULT_OPENINGS_JSON } from '../src/ai/default-openings.ts';
import { FakeClock, FakeWakeup } from './support/fake-time.ts';

let simBin:Uint8Array;
beforeAll(async()=>{simBin=(await compileContent({includeTest:true})).simBin;});
const openings=parseOpenings(JSON.parse(DEFAULT_OPENINGS_JSON));
const setup:SkirmishInitialization={kind:'skirmish',faction:0,slots:[{start:0,team:0,faction:0,controller:'human'},{start:1,team:1,faction:0,controller:'ai',difficulty:'easy'}],rules:{unitCap:100,fog:'explore',victory:'annihilation'}};
function map(){return createRtsMap({sizeWu:64,name:'real-ai-test',starts:[{army:0,x:fx(8),z:fx(8)},{army:1,x:fx(56),z:fx(56)}],spots:[{kind:'mass',x:fx(16),z:fx(8)},{kind:'mass',x:fx(8),z:fx(16)},{kind:'mass',x:fx(48),z:fx(56)},{kind:'mass',x:fx(56),z:fx(48)}]});}
function core(){return new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false});}
function own(view:SnapshotPerception):OwnUnit[]{const out:OwnUnit[]=[];view.forEachOwn(null,u=>out.push({...u}));return out;}
function known(view:SnapshotPerception):KnownUnit[]{const out:KnownUnit[]=[];view.forEachKnownEnemy(null,u=>out.push({...u}));return out;}

/** Delays only transport delivery. The actual worker brain and serialization run unchanged. */
function workerPair(){
  let workerCallback:((m:WorkerRequest|WorkerResponse)=>void)|undefined,hostCallback:((m:WorkerRequest|WorkerResponse)=>void)|undefined;
  const replies:WorkerResponse[]=[],requests:WorkerRequest[]=[];
  const workerPort:MessagePortLike={postMessage(message){replies.push(structuredClone(message) as WorkerResponse);},onMessage(callback){workerCallback=callback;}};
  startGameAiWorker(workerPort);
  let disposed=false;
  const port:GameAiPort={postMessage(message){const copy=structuredClone(message) as WorkerRequest;requests.push(copy);workerCallback!(copy);},onMessage(callback){hostCallback=callback;},dispose(){disposed=true;}};
  return {port,requests,replies,get disposed(){return disposed;},async flush(){await new Promise<void>(r=>setImmediate(r));while(replies.length)hostCallback!(replies.shift()!);}};
}
async function advance(c:SimCore,to:number,wire:ReturnType<typeof workerPair>){while(c.tick<to){if(!c.runTick())await wire.flush();}await wire.flush();}

describe('actual game AI boundary',()=>{
  it.each([
    {name:'browser default',timeoutMs:undefined,expected:40},
    {name:'finite override',timeoutMs:7,expected:7},
    {name:'immediate-abort override',timeoutMs:0,expected:0},
    {name:'disabled-timeout override',timeoutMs:Infinity,expected:Infinity},
  ])('passes the $name to the actual child worker initialization',({timeoutMs,expected})=>{
    const wire=workerPair(),ai=createGameAiSources({initialization:setup,createPort:()=>wire.port,...(timeoutMs===undefined?{}:{timeoutMs})});
    try {
      const c=new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false,localSource:ai.local,sources:ai.sources});ai.bind(c);
      expect(wire.requests.filter(request=>request.type==='init')).toHaveLength(1);
      expect(wire.requests.find(request=>request.type==='init')).toMatchObject({timeoutMs:expected,profile:{lead:3,thinkEvery:10},options:{maxMs:9}});
      expect(wire.requests.filter(request=>request.type==='perceive').map(request=>request.tick)).toEqual([0]);
    }finally{ai.dispose();}
    expect(wire.disposed).toBe(true);
  });

  it('embeds the exact design openings and resolves only compiled blueprint IDs and rates',()=>{
    expect(JSON.parse(DEFAULT_OPENINGS_JSON)).toEqual(JSON.parse(readFileSync(new URL('../../../docs/design/ai-openings.json',import.meta.url),'utf8')));
    const table=decodeSimBin(simBin),ai=gameBlueprints(table,openings);
    expect(ai.list.map(b=>b.id)).toEqual(table.ids);
    const acu=ai.byId('core:cmd_commander')!,mex=ai.byId('core:str_t1_mex')!;
    expect(ai.canBuild(acu,mex)).toBe(true);expect(mex.index).toBe(table.indexOf(mex.id));
    expect(acu.buildPower).toBe(table.buildPowerQ16PerTickCol[acu.index]!*10/65536);
    expect(mex.massPerSec).toBe(2);expect(ai.byId('varkan:naval_t3_battleship')).toBeUndefined();
  });

  it('filters hidden opponents and unknown occupied spots, retains observed structures and clears ghosts only on re-observation',()=>{
    const c=core(),w=c.world,st=gameAiStatic(c,0,openings),feed=new GameAiPerception(w,0),mex=w.bp.indexOf('core:str_t1_mex');
    c.local.push(encodeBatch([{tick:asTick(0),army:asArmyId(1),seq:0,op:Op.Build,flags:0,units:[unitHandles(w,1)[0]!],payload:encodeBuild({bp:mex,yaw:0,x:fx(48),z:fx(56)})}]));
    for(let n=0;n<50;n++)c.runTick();
    const enemy=w.units.resolve(perceive(w,1).ownUnits.find(u=>u.bp===mex)!.handle),enemyHandle=w.units.handle(enemy);
    const hash=c.fullHash();let view=new SnapshotPerception(st,feed.snapshot());
    expect(c.fullHash()).toBe(hash);expect(known(view)).toEqual([]);expect(own(view).map(u=>u.handle)).toEqual(unitHandles(w,0));
    expect(view.eco().massCapacity).toBe(650);
    const request={x:fx(48),z:fx(56),w:2,h:2,yaw:0,maxSlopeRaw:w.bp.maxSlopeCol[mex]!,spotKind:0};
    expect(canPlace(placementWorld(w),request)).toBe(PlacementVerdict.Occupied);
    expect(view.canPlace(mex,48,56,0)).toBe(true);
    expect(view.freeMassSpots().some(p=>p.x===48&&p.z===56)).toBe(true);
    const acu=w.units.resolve(unitHandles(w,0)[0]!);w.units.col.x[acu]=fx(44);w.units.col.z[acu]=fx(50);c.runTick();
    view=new SnapshotPerception(st,feed.snapshot());expect(known(view).find(u=>u.id===enemyHandle)?.kind).toBe('visible');
    expect(view.canPlace(mex,48,56,0)).toBe(false);
    w.units.col.x[acu]=fx(8);w.units.col.z[acu]=fx(8);c.runTick();view=new SnapshotPerception(st,feed.snapshot());
    expect(known(view).find(u=>u.id===enemyHandle)?.kind).toBe('ghost');
    killUnit(w,enemy);c.runTick();view=new SnapshotPerception(st,feed.snapshot());expect(known(view).some(u=>u.kind==='ghost')).toBe(true);
    w.units.col.x[acu]=fx(44);w.units.col.z[acu]=fx(50);c.runTick();view=new SnapshotPerception(st,feed.snapshot());expect(known(view).some(u=>u.id===enemyHandle)).toBe(false);
  });

  it('uses public teams for targets and known allied footprints without granting control of allied units',()=>{
    const initialization:SkirmishInitialization={...setup,slots:[{start:0,team:0,faction:0,controller:'human'},{start:1,team:0,faction:0,controller:'ai'},{start:2,team:1,faction:0,controller:'ai'}]};
    const m=createRtsMap({sizeWu:64,name:'team-ai',starts:[{army:0,x:fx(8),z:fx(8)},{army:1,x:fx(10),z:fx(8)},{army:2,x:fx(56),z:fx(56)}],spots:[{kind:'mass',x:fx(16),z:fx(8)}]});
    const c=new SimCore({simBin,map:m,initialization,seed:1,armyCount:3,keyframes:false}),w=c.world,st=gameAiStatic(c,0,openings),mex=w.bp.indexOf('core:str_t1_mex');
    expect(analyzeMap(st,openings).enemyArmy).toBe(2);
    c.local.push(encodeBatch([{tick:asTick(0),army:asArmyId(1),seq:0,op:Op.Build,flags:0,units:[unitHandles(w,1)[0]!],payload:encodeBuild({bp:mex,yaw:0,x:fx(16),z:fx(8)})}]));
    for(let n=0;n<50;n++)c.runTick();
    const view=new SnapshotPerception(st,new GameAiPerception(w,0).snapshot());expect(view.knownEnemyCount).toBe(0);expect(known(view)).toEqual([]);
    expect(own(view).map(u=>u.handle)).toEqual(unitHandles(w,0));expect(view.canPlace(mex,16,8,0)).toBe(false);
  });

  it('reflects recorded AIx income in both current economy and blueprint forecasts',()=>{
    const initialization:SkirmishInitialization={...setup,slots:[setup.slots![0]!,{...setup.slots![1]!,difficulty:'hard',aixFactorQ16:98304}]};
    const c=new SimCore({simBin,map:map(),initialization,seed:1,armyCount:2,keyframes:false}),st=gameAiStatic(c,1,openings);
    const view=new SnapshotPerception(st,new GameAiPerception(c.world,1).snapshot());expect(view.eco().massIncome).toBe(1.5);expect(view.eco().energyIncome).toBe(30);
    expect(st.bps.byId('core:str_t1_mex')!.massPerSec).toBe(3);
    const ai=createGameAiSources({initialization,createPort:()=>workerPair().port});expect(ai.status.map(s=>s.difficulty)).toEqual(['hard']);ai.dispose();
  });

  it('expands a repeat plan into actual queue commands and the one-byte switch before recording',()=>{
    let seq=10;
    const bytes=encodeBatch([{tick:asTick(3),army:asArmyId(1),seq:0,op:Op.FactoryRepeat,flags:0,units:[],payload:encodeFactoryRepeat(true,[2,3,2])}]);
    const commands=decodeBatch(gameAiCommands(bytes,1,3,()=>seq++));expect(commands.map(c=>c.op)).toEqual([Op.FactoryQueue,Op.FactoryQueue,Op.FactoryQueue,Op.FactoryRepeat]);
    expect(commands.map(c=>c.seq)).toEqual([10,11,12,13]);expect(commands.slice(0,3).map(c=>decodeFactoryQueue(c.payload))).toEqual([{bp:2,count:1},{bp:3,count:1},{bp:2,count:1}]);
    expect(commands[0]!.flags&CmdFlags.Queue).toBe(0);expect(commands[1]!.flags&CmdFlags.Queue).toBe(CmdFlags.Queue);expect(commands[3]!.payload).toEqual(Uint8Array.of(1));
  });

  it('uses shared grid/slope rules including odd-sized factory centers without observing hidden footprints',()=>{
    const c=core(),st=gameAiStatic(c,0,openings),view=new SnapshotPerception(st,new GameAiPerception(c.world,0).snapshot()),fac=c.world.bp.indexOf('core:fac_land_t1');
    expect(view.canPlace(fac,20,20,0)).toBe(false);expect(view.canPlace(fac,20.5,20.5,0)).toBe(true);
    const place=st.placement!;place.terrain.heights[20*65+20]=1000;
    expect(view.canPlace(fac,20.5,20.5,0)).toBe(false);
  });

  it('blocks the real scheduler at N+lead until the actual browser-worker result is delivered',async()=>{
    const wire=workerPair(),ai=createGameAiSources({initialization:setup,createPort:()=>wire.port,timeoutMs:Infinity});
    const c=new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false,localSource:ai.local,sources:ai.sources});ai.bind(c);
    const clock=new FakeClock(),wake=new FakeWakeup(clock),scheduler=new Scheduler({advance:()=>c.runTick(),sliceEnd(){}},{clock,wakeup:wake});scheduler.start();
    wake.advance(400);expect(c.tick).toBe(2);expect(scheduler.pendingWaits).toBeGreaterThan(0);
    expect(wire.requests.filter(r=>r.type==='perceive').map(r=>r.tick)).toEqual([0]);
    await wire.flush();expect(ai.status[0]!.error).toBeNull();wake.advance(1);expect(c.tick).toBeGreaterThanOrEqual(3);
    expect(ai.status[0]!.thinks).toBe(1);expect(c.acceptsLocal).toBe(true);scheduler.dispose();ai.dispose();expect(wire.disposed).toBe(true);
  });

  it('builds real sites from a real brain and replays the recorded commands without invoking AI again',async()=>{
    const wire=workerPair(),ai=createGameAiSources({initialization:setup,createPort:()=>wire.port,timeoutMs:Infinity});
    const c=new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false,localSource:ai.local,sources:ai.sources});ai.bind(c);
    await advance(c,900,wire);expect(ai.status[0]!.error).toBeNull();expect(ai.status[0]!.thinks).toBeGreaterThan(20);
    const log=new Uint8Array(c.recorder!.export(c.tick)),results=wire.requests.length,end=c.fullHash();ai.dispose();
    const replay=replayLog(log,{simBin,map:map(),keyframes:false});expect(replay.mismatches).toEqual([]);expect(replay.sim.fullHash()).toBe(end);expect(wire.requests.length).toBe(results);
    const commands=replay.log.commands.flatMap(entry=>decodeBatch(replay.log.bytes.subarray(entry.offset,entry.offset+entry.length)));
    const build=commands.filter(command=>command.op===Op.Build);expect(build.length).toBeGreaterThan(0);
    for(const command of build){expect(command.army).toBe(1);expect(command.payload.length).toBe(12);expect(decodeBuild(command.payload).bp).toBeLessThan(c.world.bp.count);}
    expect(commands.every(command=>command.op!==Op.Cheat)).toBe(true);
    const sites=perceive(c.world,1).ownUnits.filter(u=>u.bp===c.world.bp.indexOf('core:fac_land_t1'));expect(sites.length).toBeGreaterThan(0);expect(sites[0]!.buildDone).toBe(65536);expect(commands.some(command=>command.op===Op.FactoryQueue)).toBe(true);expect(perceive(c.world,1).ownUnits.some(u=>u.bp===c.world.bp.indexOf('core:eng_t1'))).toBe(true);
  });

  it.each([false,true])('drains real commander-death projectiles after match end without waiting for AI (delivered early: %s)',async(deliveredEarly)=>{
    const wire=workerPair(),ai=createGameAiSources({initialization:setup,createPort:()=>wire.port,timeoutMs:Infinity});
    const c=new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false,localSource:ai.local,sources:ai.sources});ai.bind(c);
    if(deliveredEarly)await wire.flush();
    c.local.push(encodeBatch([{tick:asTick(0),army:asArmyId(0),seq:0,op:Op.SelfDestruct,flags:0,units:unitHandles(c.world,0),payload:new Uint8Array(0)}]));
    expect(c.runTick()).toBe(true);expect(matchResult(c.world)).toBeDefined();expect(c.world.projectiles.liveCount).toBeGreaterThan(0);
    const endedHash=c.fullHash(),thinks=ai.status[0]!.thinks;
    expect(c.pending()).toBe(false);expect(c.fullHash()).toBe(endedHash);expect(wire.disposed).toBe(true);
    await wire.flush();expect(ai.status[0]!.thinks).toBe(thinks);expect(ai.status[0]!.pending).toBe(0);expect(ai.status[0]!.error).toBeNull();
    for(let tick=2;tick<=15;tick++)expect(c.runTick()).toBe(true);
    expect(c.world.projectiles.liveCount).toBe(0);
    expect(wire.requests.filter(request=>request.type==='perceive').map(request=>request.tick)).toEqual([0]);
    const log=new Uint8Array(c.recorder!.export(c.tick)),replay=replayLog(log,{simBin,map:map(),keyframes:false});
    const commands=replay.log.commands.flatMap(entry=>decodeBatch(replay.log.bytes.subarray(entry.offset,entry.offset+entry.length)));
    expect(commands.map(command=>({army:command.army,op:command.op}))).toEqual([{army:0,op:Op.SelfDestruct}]);
    expect(replay.mismatches).toEqual([]);expect(replay.sim.fullHash()).toBe(c.fullHash());ai.dispose();
  });

  it('records the committed timeout result and never falls back to a different live decision during replay',async()=>{
    const wire=workerPair(),ai=createGameAiSources({initialization:setup,createPort:()=>wire.port,timeoutMs:0});
    const c=new SimCore({simBin,map:map(),initialization:setup,seed:9,armyCount:2,keyframes:false,localSource:ai.local,sources:ai.sources});ai.bind(c);await advance(c,15,wire);
    expect(ai.status[0]!.timeouts).toBeGreaterThan(0);expect(ai.status[0]!.error).toBeNull();const log=new Uint8Array(c.recorder!.export(c.tick));ai.dispose();
    expect(replayLog(log,{simBin,map:map(),keyframes:false}).sim.fullHash()).toBe(c.fullHash());
  });
});
