import { beforeAll, expect, test } from 'vitest';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import {  encodeFactoryQueue,encodeFactoryQueueEdit, encodeTarget, encodeTogglePause, encodeMove, FrameReader, FrameWriter, EventType, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, initializeSkirmish, perceive, canSeePosition, hasMatchEnded, matchResult, step, snapshot, restore, fullHash, writeFrame, UnitBits, type World } from '../src/index.ts';
import { spawnUnit, killUnit } from '../src/units.ts';
let bp:SimBpTable;
beforeAll(async()=>{bp=decodeSimBin((await compileContent({includeTest:true})).simBin);});
function world():World {return createWorld({bpTable:bp,seed:73,armyCount:2,mapSizeWu:64});}
function spawn(w:World,id:string,a=0,x=12,z=12):number{return spawnUnit(w,bp.indexOf(id),a,fx(x),fx(z),0);}
let seq=0;
function cmd(w:World,u:number,op:Op,payload:Uint8Array,flags=0,army=w.units.col.army[u]!):CommandEnvelope {return {tick:asTick(0),army:asArmyId(army),seq:++seq,op,flags,units:[w.units.handle(u) as Handle],payload};}
function frame(w:World,viewer=0,watch=new Uint32Array()):FrameReader {const fw=new FrameWriter(),bytes=new Uint8Array(fw.capacityBytes);const n=writeFrame(w,viewer,fw,bytes,{seq:1,tickTimeUs:0,speedPermille:1000,flags:0},watch,watch.length);const fr=new FrameReader();expect(fr.reset(bytes.subarray(0,n))).toBe(true);return fr;}
test('selected starts, teams, cap, AI multiplier and victory become actual arena rules',()=>{
 const w=world();initializeSkirmish(w,{kind:'skirmish',faction:0,slots:[{start:1,team:3,faction:0,controller:'human'},{start:0,team:8,faction:0,controller:'ai',aixFactorQ16:131072}],rules:{unitCap:2,fog:'explore',victory:'assassination'}});
 expect(hasMatchEnded(w)).toBe(false);
 expect(w.units.col.x[0]).toBe(w.mapStarts.i32[4]);expect(w.armies.col.unitCap[0]).toBe(2);step(w);expect(w.armies.col.massIncome.get(1)).toBe(200);
 killUnit(w,1);step(w);expect(hasMatchEnded(w)).toBe(true);expect(matchResult(w)?.winnerArmy).toBe(0);const f=frame(w);expect(f.matchEndTick).toBe(w.tick);step(w);expect(frame(w).matchEndTick).toBe(f.matchEndTick);expect(frame(w).matchWinningMask).toBe(1);
});
test('legacy sandbox weapon-bearing units remain alive without combat optin',()=>{const w=world(),a=spawn(w,'core:lnd_t1_tank'),b=spawn(w,'core:lnd_t1_tank',1,15);for(let i=0;i<80;i++)step(w);expect(w.units.col.hp[a]).toBe(300);expect(w.units.col.hp[b]).toBe(300);expect(w.projectiles.liveCount).toBe(0);});
test('real weapons/projectiles damage visible enemies and replay snapshot continuation exactly',()=>{
 const w=world();initializeSkirmish(w,0);const a=spawn(w,'core:lnd_t1_tank',0,24,20),b=spawn(w,'core:lnd_t1_tank',1,28,20);step(w,[cmd(w,a,Op.Attack,encodeTarget(w.units.handle(b)))]);
 let shot=false,impact=false;for(let i=0;i<22;i++){step(w);const f=frame(w,-1);for(let e=0;e<f.eventCount;e++){shot ||= f.eventType(e)===EventType.Shot;impact ||= f.eventType(e)===EventType.Impact;}}
 expect(shot).toBe(true);expect(impact).toBe(true);expect(w.units.col.hp[b]).toBeLessThan(300);
 const bytes=snapshot(w);for(let i=0;i<20;i++)step(w);const expected=fullHash(w);restore(w,bytes);for(let i=0;i<20;i++)step(w);expect(fullHash(w)).toBe(expected);
});
test('fog filters frames/perception and rejects hidden or allied attack targets',()=>{
 const w=world();initializeSkirmish(w,0);const enemy=spawn(w,'core:lnd_t1_tank',1,58,58);step(w);
 expect(perceive(w,0).visibleEnemies.some(u=>u.handle===w.units.handle(enemy))).toBe(false);expect(canSeePosition(w,0,fx(58),fx(58))).toBe(false);
 const own=0;step(w,[cmd(w,own,Op.Attack,encodeTarget(w.units.handle(enemy)))]);expect(w.units.col.orderHead[own]).toBe(-1);
 const f=frame(w);for(let u=0;u<f.unitCount;u++)expect(f.unitHandle(u)).not.toBe(w.units.handle(enemy));
});
test('perception retains own factory controls and strips visible enemy production details',()=>{
 const w=world(),own=spawn(w,'core:fac_land_t1'),enemy=spawn(w,'core:fac_land_t1',1,50,50),engineer=bp.indexOf('core:eng_t1');
 step(w,[cmd(w,own,Op.FactoryQueue,encodeFactoryQueue({bp:engineer,count:1})),cmd(w,own,Op.FactoryRepeat,new Uint8Array([1])),cmd(w,enemy,Op.FactoryQueue,encodeFactoryQueue({bp:engineer,count:1})),cmd(w,enemy,Op.FactoryRepeat,new Uint8Array([1]))]);
 const observation=perceive(w,0),ownFactory=observation.ownUnits.find(u=>u.handle===w.units.handle(own)),enemyFactory=observation.visibleEnemies.find(u=>u.handle===w.units.handle(enemy));
 expect(ownFactory?.factoryRepeat).toBe(true);expect(ownFactory?.queue).toEqual([engineer]);expect(ownFactory?.producingBp).toBe(engineer);
 expect(enemyFactory?.factoryRepeat).toBe(false);expect(enemyFactory?.queue).toEqual([]);expect(enemyFactory?.producingBp).toBe(-1);expect(enemyFactory?.buildTarget).toBe(0xffffffff);
});
test('factory queue charges economy, pause holds progress, assist speeds production, rally starts movement',()=>{
 const w=world(),acu=spawn(w,'core:cmd_commander',0,10,10),fac=spawn(w,'core:fac_land_t1',0,12,10);w.armies.col.massStored.set(0,650000);w.armies.col.energyStored.set(0,3900000);
 step(w,[cmd(w,fac,Op.SetRally,encodeMove({x:fx(24),y:fx(0),z:fx(10)})),cmd(w,fac,Op.FactoryQueue,encodeFactoryQueue({bp:bp.indexOf('core:eng_t1'),count:2}))]);
 const t=w.units.resolve(w.units.col.buildTarget[fac]!);expect(t).toBeGreaterThan(1);const progress=w.units.col.buildDone.get(t);expect(progress).toBeGreaterThan(0);
 step(w,[cmd(w,fac,Op.TogglePause,encodeTogglePause(true))]);for(let i=0;i<5;i++)step(w);expect(w.units.col.buildDone.get(t)).toBe(progress);
 step(w,[cmd(w,fac,Op.TogglePause,encodeTogglePause(false)),cmd(w,acu,Op.Guard,encodeTarget(w.units.handle(fac)))]);
 for(let i=0;i<150&&(w.units.col.flags[t]!&UnitBits.UnderConstruction)!==0;i++)step(w);
 expect(w.units.col.buildDone.get(t)).toBe(65536);expect(w.units.col.productionCount[fac]).toBe(1);expect(w.units.col.orderHead[t]).toBeGreaterThanOrEqual(0);
 expect(w.armies.col.massStored.get(0)).toBeLessThan(650000);expect(perceive(w,0).ownUnits.find(u=>u.handle===w.units.handle(fac))?.queue.length).toBe(1);
});
test('repair consumes proportional costs and cannot command foreign handles',()=>{
 const w=world(),acu=spawn(w,'core:cmd_commander'),tank=spawn(w,'core:lnd_t1_tank',0,14,12);w.units.col.hp[tank]=150;w.armies.col.massStored.set(0,650000);w.armies.col.energyStored.set(0,3900000);
 step(w,[cmd(w,acu,Op.Repair,encodeTarget(w.units.handle(tank)),0,1)]);expect(w.units.col.orderHead[acu]).toBe(-1);
 step(w,[cmd(w,acu,Op.Repair,encodeTarget(w.units.handle(tank)))]);for(let i=0;i<150;i++)step(w);expect(w.units.col.hp[tank]).toBe(300);expect(w.units.col.repairPaidMass.get(tank)).toBe(28000);
});
test('three victory rules and allied winners remain distinct and persistent',()=>{
 for(const victory of ['assassination','supremacy','annihilation'] as const){const w=world();initializeSkirmish(w,{kind:'skirmish',faction:0,rules:{unitCap:10,fog:'revealed',victory}});const fac=spawn(w,'core:fac_land_t1',1,0,64),tank=spawn(w,'core:lnd_t1_tank',1,0,64);killUnit(w,1);step(w);
 if(victory==='assassination')expect(matchResult(w)?.winnerArmy).toBe(0);else{expect(matchResult(w)).toBeUndefined();killUnit(w,fac);step(w);if(victory==='supremacy')expect(matchResult(w)?.winnerArmy).toBe(0);else{expect(matchResult(w)).toBeUndefined();killUnit(w,tank);step(w);expect(matchResult(w)?.winnerArmy).toBe(0);}}}
 const w=world();initializeSkirmish(w,{kind:'skirmish',faction:0,slots:[{start:0,team:1,faction:0,controller:'human'},{start:1,team:1,faction:0,controller:'human'}]});step(w);expect(frame(w).matchWinningMask).toBe(3);
});
test('hold fire suppresses shots, and queued patrol keeps reversing until stopped',()=>{
 const w=world();initializeSkirmish(w,0);const a=spawn(w,'core:lnd_t1_tank',0,24,20),b=spawn(w,'core:lnd_t1_tank',1,28,20);step(w,[cmd(w,a,Op.FireState,Uint8Array.of(0)),cmd(w,b,Op.FireState,Uint8Array.of(0)),cmd(w,a,Op.Attack,encodeTarget(w.units.handle(b)))]);
 for(let i=0;i<20;i++)step(w);expect(w.projectiles.liveCount).toBe(0);expect(w.units.col.hp[b]).toBe(300);
 step(w,[cmd(w,a,Op.Patrol,encodeMove({x:fx(20),y:fx(0),z:fx(20)}))]);for(let i=0;i<80;i++)step(w);expect(w.units.col.orderHead[a]).toBeGreaterThanOrEqual(0);
 step(w,[cmd(w,a,Op.Stop,new Uint8Array())]);expect(w.units.col.orderHead[a]).toBe(-1);
});
test('replacing pending production retains the paid current product and exact queue',()=>{
 const w=world(),_acu=spawn(w,'core:cmd_commander'),fac=spawn(w,'core:fac_land_t1',0,14,12);w.armies.col.massStored.set(0,650000);w.armies.col.energyStored.set(0,3900000);
 step(w,[cmd(w,fac,Op.FactoryQueue,encodeFactoryQueue({bp:bp.indexOf('core:eng_t1'),count:3}))]);const t=w.units.col.buildTarget[fac]!,site=w.units.resolve(t),progress=w.units.col.buildDone.get(site);
 step(w,[cmd(w,fac,Op.FactoryQueue,encodeFactoryQueue({bp:bp.indexOf('core:lnd_t1_tank'),count:2}))]);expect(w.units.col.buildTarget[fac]).toBe(t);expect(w.units.col.buildDone.get(site)).toBeGreaterThan(progress);expect(perceive(w,0).ownUnits.find(u=>u.handle===w.units.handle(fac))?.queue).toEqual([bp.indexOf('core:eng_t1'),bp.indexOf('core:lnd_t1_tank'),bp.indexOf('core:lnd_t1_tank')]);
});
test('real death creates blueprint-valued wreck and simultaneous reclaim returns exactly its remaining mass',()=>{
 const w=world(),a=spawn(w,'core:cmd_commander',0,10,10),b=spawn(w,'core:eng_t1',0,11,10),tank=spawn(w,'core:lnd_t1_tank',1,12,10);w.armies.col.massStored.set(0,0);w.units.col.hp[tank]=0;step(w);
 expect(w.wrecks.liveCount).toBe(1);const value=w.wrecks.col.remaining.get(0),handle=(w.wrecks.handle(0)|0x00080000)>>>0;
 expect(frame(w).unitCount).toBe(3);step(w,[cmd(w,a,Op.Reclaim,encodeTarget(handle)),cmd(w,b,Op.Reclaim,encodeTarget(handle))]);
 for(let i=0;i<60&&w.wrecks.liveCount>0;i++)step(w);expect(w.wrecks.liveCount).toBe(0);
 // Income is separately authoritative each tick; reclaim payment is full blueprint fraction.
 expect(w.armies.col.massStored.get(0)).toBe(value+w.tick*100);expect(value).toBe(50394);
});
test('queue remove/front/clear preserve paid active job and watched factory state matches the arena',()=>{
 const w=world();spawn(w,'core:cmd_commander');const fac=spawn(w,'core:fac_land_t1',0,14,12);w.armies.col.massStored.set(0,650000);w.armies.col.energyStored.set(0,3900000);
 const engineer=bp.indexOf('core:eng_t1'),tank=bp.indexOf('core:lnd_t1_tank');step(w,[cmd(w,fac,Op.FactoryQueue,encodeFactoryQueue({bp:engineer,count:3}))]);const active=w.units.col.buildTarget[fac]!;
 step(w,[cmd(w,fac,Op.FactoryQueueEdit,encodeFactoryQueueEdit({action:1,index:1,bp:0,count:1})),cmd(w,fac,Op.FactoryQueueEdit,encodeFactoryQueueEdit({action:2,index:0,bp:tank,count:2})),cmd(w,fac,Op.FactoryRepeat,Uint8Array.of(1)),cmd(w,fac,Op.FireState,Uint8Array.of(0)),cmd(w,fac,Op.TogglePause,encodeTogglePause(true))]);
 const f=frame(w,0,Uint32Array.of(w.units.handle(fac)));expect(f.watchFactoryQueueCount(0)).toBe(4);expect([0,1,2,3].map(k=>f.watchFactoryQueueBp(0,k))).toEqual([engineer,tank,tank,engineer]);expect(f.watchBuildTarget(0)).toBe(active);expect(f.watchFactoryRepeat(0)).toBe(true);expect(f.watchPaused(0)).toBe(true);expect(f.watchFireState(0)).toBe(0);expect(f.watchFactoryProgress(0)).toBe(w.units.col.buildDone.get(w.units.resolve(active)));
 step(w,[cmd(w,fac,Op.FactoryQueueEdit,encodeFactoryQueueEdit({action:0,index:0,bp:0,count:0}))]);expect(w.units.col.productionCount[fac]).toBe(1);expect(w.units.col.buildTarget[fac]).toBe(active);
});
test('Overcharge uses the stored-energy formula and recorded cooldown with actual storage',()=>{
 const w=world();initializeSkirmish(w,0);const acu=0,x=w.units.col.x[acu]!/4096,z=w.units.col.z[acu]!/4096;spawn(w,'core:str_t1_estorage',0,10,10);const enemy=spawn(w,'core:lnd_t3_heavy',1,x+8,z);
 step(w,[cmd(w,acu,Op.FireState,Uint8Array.of(0)),cmd(w,1,Op.FireState,Uint8Array.of(0)),cmd(w,enemy,Op.FireState,Uint8Array.of(0))]);w.armies.col.energyStored.set(0,8800000);
 const original=bp.maxHpCol[bp.indexOf('core:lnd_t3_heavy')]!,damage=Math.min(15000,Math.max(1250,original),Math.floor(8802000*9/60000));
 step(w,[cmd(w,acu,Op.Overcharge,encodeTarget(w.units.handle(enemy)))]);expect(w.armies.col.energyStored.get(0)).toBe(8802000-damage*6000);expect(w.units.col.overchargeReadyTick[acu]).toBe(w.tick+33);expect(w.armies.col.energySpent.get(0)).toBe(damage*6000);
 const before=w.projectiles.liveCount;step(w,[cmd(w,acu,Op.Overcharge,encodeTarget(w.units.handle(enemy)))]);expect(w.projectiles.liveCount).toBeLessThanOrEqual(before);
 for(let i=0;i<8;i++)step(w);expect(w.units.col.hp[enemy]).toBe(original-damage);
});
test('commander death weapon is queued for T+1 and has the roster inner/outer damage rings',()=>{
 const w=world();initializeSkirmish(w,{kind:'skirmish',faction:0,rules:{unitCap:20,fog:'revealed',victory:'annihilation'}});const acu=0,x=w.units.col.x[acu]!/4096,z=w.units.col.z[acu]!/4096;
 const inner=spawn(w,'core:lnd_t3_heavy',1,x+15,z),outer=spawn(w,'core:lnd_t3_heavy',1,x+32,z);const original=w.units.col.hp[outer]!;
 step(w,[cmd(w,1,Op.FireState,Uint8Array.of(0)),cmd(w,inner,Op.FireState,Uint8Array.of(0)),cmd(w,outer,Op.FireState,Uint8Array.of(0)),cmd(w,acu,Op.SelfDestruct,new Uint8Array())]);
 expect(w.units.isLive(inner)).toBe(true);expect(w.projectiles.liveCount).toBeGreaterThan(0);step(w);expect(w.units.col.hp[inner]).toBe(original-2000);expect(w.units.col.hp[outer]).toBe(original-500);
});
