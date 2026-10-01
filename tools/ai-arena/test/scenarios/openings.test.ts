import { describe,expect,it } from 'vitest';
import { runScenario } from '../../src/scenarios/index.ts';
import { loadOpeningsJson } from '../../src/data/design.ts';
const doc=loadOpeningsJson() as unknown as {readonly openings:readonly {readonly id:string;readonly expect:Readonly<Record<string,Readonly<Record<string,number>>>>}[]};
// Consolidation added this test; the archived Claude track did not contain arena opening tests.
// TRACK-AI acceptance permits explained ecosim timing differences while preserving design expect.
// Full timing deltas and the original ±10 s result are reported by scripts/openings.ts.
const cases=['setons','hollow-ridge'].flatMap(map=>['eco_standard','land_rush','tech_greed'].map(id=>({map,id})));
describe('AI-OPEN-01/02 real opening completion and runtime contracts',()=>{
 it.each(cases)('$map/$id completes all milestones and obeys the plan gates',({map,id})=>{
  const opening=doc.openings.find(o=>o.id===id)!,reference=opening.expect[map]!;
  const until=Math.ceil((reference['techT2']!+120)*10);
  const result=runScenario({map,seed:7,until,sides:[{army:0,profile:'normal',opening:id},{army:1,profile:'easy',source:{commandsFor:()=>[]}}]});
  const army=result.metrics.armies[0]!,brain=result.brains.get(0)!,thinks=result.thinks.get(0)!;
  for(const metric of ['fac1','eng1','mex4','mex8','techT2'] as const){
   const actual=metric==='techT2'?army.t2Tick:army[metric];
   expect(actual,metric).not.toBeNull();expect(actual!,metric).toBeLessThanOrEqual(until);
  }
  // ai.md §9 and TRACK-AI tournament acceptance: T2 <=12 min, first enemy-half wave <=8 min.
  expect(army.t2Tick!).toBeLessThanOrEqual(7200);
  const wave=brain.blackboard.telemetry.events.find(e=>e.kind==='waveAttack'&&e.enemyHalf);
  expect(wave).toBeDefined();expect(wave!.tick).toBeLessThanOrEqual(4800);
  // TRACK-AI runtime gates; thrown arena/brain errors already fail runScenario above.
  expect(thinks.every(t=>!t.aborted)).toBe(true);
  expect(thinks.every(t=>t.opsTotal<=brain.profile.budget.total)).toBe(true);
  expect(army.apmMax).toBeLessThanOrEqual(brain.profile.apm.cap);
 });
});
