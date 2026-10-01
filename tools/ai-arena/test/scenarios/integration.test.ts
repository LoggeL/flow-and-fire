import { describe,expect,it } from 'vitest';
import { encodeBatch } from '@faf/protocol';
import { MANAGER_ORDER,PerceptionWriter,SnapshotPerception } from '@faf/ai';
import { runScenario,createScenario } from '../../src/scenarios/index.ts';
import { replayMatch } from '../../src/match/index.ts';
import { writePerception } from '../../src/perception/index.ts';
describe('default managers integration',()=>{
 it('composes all eight managers in the declared order',()=>{const s=createScenario({map:'hollow-ridge',seed:7,until:1});expect(s.brains.get(0)!.managerNames).toEqual(MANAGER_ORDER.filter(m=>m!=='micro'));});
 it('AI-DET-02 half budget repeats the command stream without duplicate sequences',()=>{const scenario={map:'hollow-ridge',seed:7,until:1800,budgetScale:0.5};const a=runScenario(scenario),b=runScenario(scenario);expect(encodeBatch(a.log)).toEqual(encodeBatch(b.log));expect(a.hash).toBe(b.hash);expect(new Set(a.log.map(c=>`${c.army}:${c.seq}`)).size).toBe(a.log.length);});
 it('command replay reproduces the arena hash',()=>{const r=runScenario({map:'hollow-ridge',seed:3,until:1800});const replay=replayMatch(r.world.setup,r.log,r.metrics.endTick);expect(replay.hash).toBe(r.hash);});
 it('AI-PLT-02 stages and attacks with >=8 units before eight minutes',()=>{const r=runScenario({map:'hollow-ridge',seed:7,until:4800,sides:[{army:0,profile:'normal',opening:'eco_standard'},{army:1,profile:'easy',source:{commandsFor:()=>[]}}]});const wave=r.brains.get(0)!.blackboard.telemetry.first('waveAttack');expect(wave).toBeDefined();expect(wave!.tick).toBeLessThanOrEqual(4800);expect(wave!.units).toBeGreaterThanOrEqual(8);expect(wave!.enemyHalf).toBe(true);});
 it('AI-PERC-03 foreign stored energy leaves command stream unchanged',()=>{const setup=()=>createScenario({map:'hollow-ridge',seed:7,until:1800});const a=setup(),b=setup();a.world.tick=b.world.tick=1800;b.world.setStorage(1,0,3900);a.world.setStorage(1,0,0);for(const [army,brain] of a.brains){if(army!==0)continue;const own=[...a.world.units.values()][0]!,other=[...a.world.units.values()][1]!;other.x=own.x+30;other.z=own.z;const bo=[...b.world.units.values()][1]!;bo.x=other.x;bo.z=other.z;a.world.updateVisibility();b.world.updateVisibility();const v=(w:typeof a.world)=>new SnapshotPerception(w.staticFor(0),writePerception(w,0,1800,new PerceptionWriter()));expect(encodeBatch(brain.think(v(a.world)).commands)).toEqual(encodeBatch(b.brains.get(0)!.think(v(b.world)).commands));}});
});
