import { describe,expect,it } from 'vitest';
import { aggregate,suitePlan, type GameReport } from '../../src/tournament/index.ts';
describe('tournament schedule and gates',()=>{
 it('uses 210 mirror, 120 difficulty and 12 quick games with swapped sides',()=>{expect(suitePlan('ms9')).toHaveLength(210);expect(suitePlan('diff')).toHaveLength(120);expect(suitePlan('quick')).toHaveLength(12);const p=suitePlan('ms9');expect(p[1]!.armyA).toBe(1);expect(p[0]!.seed).toBe(p[1]!.seed);});
 it('crashed games stay in Wilson denominator and fail gates',()=>{const jobs=suitePlan('ms9');const reports:GameReport[]=jobs.map(job=>({job,hash:0,winner:null,endTick:0,armies:[],crash:'fixture crash'}));const r=aggregate(reports);expect(r.games).toBe(210);expect(r.t2.n).toBe(210);expect(r.crashes).toBe(210);expect(r.gates.crashes).toBe(false);expect(r.gates.idle).toBe(false);expect(r.pass).toBe(false);});
});
