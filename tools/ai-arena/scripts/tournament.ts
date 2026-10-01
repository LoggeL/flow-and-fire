import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { runPool } from '../src/stats/pool.ts';
import { aggregate,markdownReport,suitePlan,type GameReport,type MatchJob,type Suite } from '../src/tournament/index.ts';
const args=process.argv.slice(2).filter(a=>a!=='--');
function arg(name:string):string|undefined {const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const suite=(arg('--suite')??'ms9') as Suite;if(!['ms9','diff','quick'].includes(suite))throw new Error('Unknown suite');
const games=arg('--games'),maps=arg('--maps')?.split(',');const host=arg('--host')??'sync';if(!['sync','worker'].includes(host))throw new Error('Unknown host');
const jobs=suitePlan(suite,maps,games?Number(games):undefined).map(j=>({...j,host:host as 'sync'|'worker',...(arg('--brain')?{brainSpec:arg('--brain')!}:{})}));
const pool=await runPool<MatchJob,GameReport>(jobs,new URL('../src/tournament/bootstrap.mjs',import.meta.url),{workers:host==='worker'?1:Number(arg('--workers')??4),onResult:(_r,done,total)=>{if(done%10===0||done===total)process.stderr.write(`Arena ${done}/${total}\n`);}});
const reports=pool.results.map((r,i)=>r.ok?r.value:{job:jobs[i]!,hash:0,winner:null,endTick:0,armies:[],crash:r.error});
const report=aggregate(reports),out=resolve(arg('--out')??`tools/ai-arena/results/${suite}-${new Date().toISOString().slice(0,10)}.json`);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({report,reports,pool:{spawned:pool.workersSpawned,exited:pool.workersExited}},null,2)+'\n');
const md=markdownReport(report);process.stdout.write(md);if(arg('--md'))writeFileSync(resolve(arg('--md')!),md);
if(suite==='ms9'&&!report.pass)process.exitCode=1;if(report.crashes)process.exitCode=1;
