import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { playJob,suitePlan,aggregate,markdownReport } from '../tournament/index.ts';
const jobs=suitePlan('ms9').filter(j=>!j.swapped).slice(0,9);
const games=[];for(const job of jobs)games.push(await playJob(job));
const report=aggregate(games),armies=games.flatMap(g=>g.armies);
// tai-p5 calibration uses per-army limits, not the pooled tournament statistic or Wilson/sample gates.
const gates={complete:games.length===9&&armies.length===18,crashes:report.crashes===0,
 t2:armies.every(a=>a.t2Tick!==null&&a.t2Tick<=7200),
 wave:armies.every(a=>a.firstWaveTick!==null&&a.firstWaveTick<=4800),
 idle:armies.every(a=>a.idleEngineerPct<15),energy:armies.every(a=>a.energyStallPct<=5),
 timeouts:armies.every(a=>a.timeouts===0),apm:report.gates.apm,ops:report.gates.ops};
const result={report,calibration:{gates,pass:Object.values(gates).every(Boolean)},reports:games};
const args=process.argv.slice(2),outIndex=args.indexOf('--out');
if(outIndex>=0){const out=args[outIndex+1]!;mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
process.stdout.write(markdownReport(report));process.stdout.write(`\nCalibration per-army gates: ${JSON.stringify(gates)}\n`);
if(!result.calibration.pass)process.exitCode=1;
