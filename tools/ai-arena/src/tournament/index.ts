import { profileFor, type Difficulty } from '@faf/ai';
import { createScenario, runScenario, type ScenarioResult } from '../scenarios/index.ts';
import { loadOpeningsJson } from '../data/design.ts';
import { parseOpenings } from '@faf/ai';
import { pairingSchedule, sampleSide, seedRange, type Pairing } from '../stats/schedule.ts';
import { percentile } from '../stats/percentile.ts';
import { wilson, eloDiff } from '../stats/wilson.ts';
import { NodeAiWorker } from '../host-node/index.ts';
import { PerceptionWriter } from '@faf/ai';
import { writePerception } from '../perception/index.ts';
import { runMatchAsync } from '../match/index.ts';
import type { ArmyMetrics } from '../match/index.ts';
export type Suite='ms9'|'diff'|'quick';
export interface MatchJob extends Pairing {profiles:readonly [Difficulty,Difficulty];maxTicks:number;brainSpec?:string;host?:'sync'|'worker';}
export interface ArmyReport extends ArmyMetrics {opening:string|null;firstWaveTick:number|null;firstWaveUnits:number;opsP99:number;opsCap:number;apmCap:number;timeouts:number;opsByManager:Record<string,number>;}
export interface GameReport {job:MatchJob;hash:number;winner:number|null;endTick:number;armies:ArmyReport[];crash:string|null;}
export function suitePlan(suite:Suite,maps=['setons','hollow-ridge','tessera'],games?:number):MatchJob[]{
  const schedule=(n:number,profiles:readonly [Difficulty,Difficulty],offset=0):MatchJob[]=>pairingSchedule({seeds:seedRange(1,n),maps}).map(p=>({...p,game:p.game+offset,profiles,maxTicks:suite==='quick'?1800:18000}));
  const full=suite==='diff'?[...schedule(30,['normal','easy']),...schedule(30,['hard','normal'],60)]:schedule(suite==='quick'?6:105,['normal','normal']);
  if(games!==undefined){if(!Number.isInteger(games)||games<1)throw new RangeError('games must be positive');if(games>full.length){return schedule(Math.ceil(games/2),['normal','normal']).slice(0,games);}return full.slice(0,games);}return full;
}
export function reportScenario(job:MatchJob,r:ScenarioResult):GameReport {
  const doc=parseOpenings(loadOpeningsJson());
  const armies=r.metrics.armies.map(a=>{const brain=r.brains.get(a.army)!,thinks=r.thinks.get(a.army)??[];const wave=brain.blackboard.telemetry.events.find((e): e is Extract<typeof e,{kind:'waveAttack'}>=>e.kind==='waveAttack'&&e.enemyHalf===true);const p=profileFor(job.profiles[a.army===job.armyA?0:1]!,doc);const by:Record<string,number>={};for(const key of Object.keys(p.budget))by[key]=thinks.length?percentile(thinks.map(t=>t.opsByManager[key]??0),99):0;
    return {...a,opening:brain.opening?.id??null,firstWaveTick:wave?.tick??null,firstWaveUnits:typeof wave?.units==='number'?wave.units:0,opsP99:thinks.length?percentile(thinks.map(t=>t.opsTotal),99):0,opsCap:p.budget.total,apmCap:p.apm.cap,timeouts:thinks.filter(t=>t.aborted).length,opsByManager:by};});
  return {job,hash:r.hash,winner:r.metrics.winner,endTick:r.metrics.endTick,armies,crash:null};
}
export async function playJob(job:MatchJob):Promise<GameReport> {
  try {
    const sides=[{army:job.armyA,profile:job.profiles[0]},{army:job.armyB,profile:job.profiles[1]}];
    let brainFactory: (()=>import('@faf/ai').AiBrain)|undefined;
    if(job.brainSpec){const [specifier,name='createDefaultBrain']=job.brainSpec.split('#');const module=await import(specifier!);brainFactory=module[name];if(typeof brainFactory!=='function')throw new Error('Invalid brain factory');}
    const scenario={map:job.map,seed:job.seed,until:job.maxTicks,sides:sides.map(s=>({...s,...(brainFactory?{brain:brainFactory()}:{})}))};
    if(job.host!=='worker')return reportScenario(job,runScenario(scenario));
    const c=createScenario(scenario),hosts:NodeAiWorker[]=[];
    try {
      const sources=[];
      for(const side of sides){const brain=c.brains.get(side.army)!;const h=await NodeAiWorker.create({static:brain.static,profile:brain.profile,options:{openings:parseOpenings(loadOpeningsJson())},...(job.brainSpec?{brainSpec:job.brainSpec}:{})});hosts.push(h);const writer=new PerceptionWriter();
        sources.push({army:side.army,source:h.source({thinkEvery:brain.profile.thinkEvery,lead:brain.profile.lead,perceive:tick=>writePerception(c.world,side.army,tick,writer),onResult:r=>{c.thinks.get(side.army)!.push({tick:r.tick,commands:[],aborted:r.aborted,opsTotal:r.ops,opsByManager:r.opsByManager,ingestOps:0,dropped:[]});for(const e of r.telemetry??[])brain.blackboard.telemetry.push(e);}})});}
      const r=await runMatchAsync({world:c.world,sides:sources,maxTicks:job.maxTicks,wait:()=>Promise.race(hosts.map(h=>h.wait()))});return reportScenario(job,{...r,brains:c.brains,thinks:c.thinks});
    }finally{await Promise.all(hosts.map(h=>h.close()));}
  }catch(error){return {job,hash:0,winner:null,endTick:0,armies:[],crash:error instanceof Error?error.message:String(error)};}
}
export function aggregate(games:readonly GameReport[]) {
  const sampled=games.flatMap(g=>g.armies.filter(a=>a.army===sampleSide(g.job.seed)));
  const t2=sampled.filter(a=>a.t2Tick!==null&&a.t2Tick<=7200).length,wave=sampled.filter(a=>a.firstWaveTick!==null&&a.firstWaveTick<=4800).length;
  const n=games.length,t2Interval=n?wilson(t2,n):{lo:0,hi:1},waveInterval=n?wilson(wave,n):{lo:0,hi:1};
  const all=games.flatMap(g=>g.armies),crashes=games.filter(g=>g.crash!==null).length;
  const gates={sampleSize:n>=200,t2:t2Interval.lo>=0.90,wave:waveInterval.lo>=0.90,idle:all.every(a=>a.idleEngineerPct<15)&&all.length===n*2,crashes:crashes===0,timeouts:all.every(a=>a.timeouts===0),apm:all.every(a=>a.apmMax<=a.apmCap),ops:all.every(a=>a.opsP99<=a.opsCap)};
  const groups=(key:(g:GameReport,a:ArmyReport)=>string)=>{const out:Record<string,{games:number;t2:number;wave:number;idleMax:number;stall:number}>={};for(const g of games)for(const a of g.armies.filter(a=>a.army===sampleSide(g.job.seed))){const k=key(g,a),v=out[k]??{games:0,t2:0,wave:0,idleMax:0,stall:0};v.games++;v.t2+=a.t2Tick!==null&&a.t2Tick<=7200?1:0;v.wave+=a.firstWaveTick!==null&&a.firstWaveTick<=4800?1:0;v.idleMax=Math.max(v.idleMax,a.idleEngineerPct);v.stall+=a.energyStallPct;out[k]=v;}for(const v of Object.values(out))v.stall/=v.games;return out;};
  const pairings:Record<string,{games:number;wins:number;draws:number;winInterval:ReturnType<typeof wilson>;elo:number}>={};for(const g of games){const key=g.job.profiles.join('-vs-'),v=pairings[key]??{games:0,wins:0,draws:0,winInterval:wilson(0,1),elo:0};v.games++;if(g.winner===g.job.armyA)v.wins++;if(g.winner===null&&!g.crash)v.draws++;pairings[key]=v;}for(const v of Object.values(pairings)){v.winInterval=wilson(v.wins+v.draws*0.5,v.games);v.elo=eloDiff((v.wins+v.draws*0.5)/v.games);}
  const wins=games.filter(g=>g.winner===g.job.armyA).length,draws=games.filter(g=>g.winner===null&&g.crash===null).length;
  return {schema:'faf-ai-arena/1',games:n,crashes,t2:{success:t2,n,interval:t2Interval},wave:{success:wave,n,interval:waveInterval},idleMax:Math.max(0,...all.map(a=>a.idleEngineerPct)),energyStallPct:100*all.reduce((n,a)=>n+a.energyStallTicks,0)/Math.max(1,all.reduce((n,a)=>n+a.observedEnergyTicks,0)),wins,draws,pairings,elo:n?eloDiff((wins+draws*0.5)/n):0,gates,pass:Object.values(gates).every(Boolean),byMap:groups(g=>g.job.map),byOpening:groups((_g,a)=>a.opening??'unknown'),outliers:games.filter(g=>g.crash||g.armies.some(a=>a.t2Tick===null||a.t2Tick>7200||a.energyStallPct>10||a.timeouts>0)).map(g=>({seed:g.job.seed,map:g.job.map,swapped:g.job.swapped,crash:g.crash,armies:g.armies}))};
}
export function markdownReport(report:ReturnType<typeof aggregate>):string {
  const pct=(n:number)=>`${n.toFixed(2)} %`;
  const interval=(i:ReturnType<typeof wilson>)=>`${pct(i.lo*100)} bis ${pct(i.hi*100)}`;
  const groups=(title:string,rows:typeof report.byMap)=>`\n## ${title}\n\n| Gruppe | Spiele | T2 ≤ 720 s | Wilson-Untergrenze | Welle ≤ 480 s | Wilson-Untergrenze | Idle maximal | E-Stall, Mittel der Spiele |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`+
    Object.entries(rows).map(([name,r])=>`| ${name} | ${r.games} | ${r.t2}/${r.games} | ${pct(wilson(r.t2,r.games).lo*100)} | ${r.wave}/${r.games} | ${pct(wilson(r.wave,r.games).lo*100)} | ${pct(r.idleMax)} | ${pct(r.stall)} |`).join('\n')+'\n';
  const pairs=`\n## Paarungen\n\n| Paarung (Seite A) | Spiele | Siege | Remis | Ergebnisquote mit halben Remis | Wilson 95 % | Elo-Differenz |\n|---|---:|---:|---:|---:|---|---:|\n`+
    Object.entries(report.pairings).map(([name,r])=>`| ${name} | ${r.games} | ${r.wins} | ${r.draws} | ${pct(r.winInterval.p*100)} | ${interval(r.winInterval)} | ${r.elo.toFixed(1)} |`).join('\n')+'\n';
  const outliers=`\n## Ausreißer\n\n`+(report.outliers.length?report.outliers.map(r=>`- Seed ${r.seed}, ${r.map}, Seiten getauscht: ${r.swapped}; `+
    (r.crash?`Crash: ${r.crash}`:r.armies.map(a=>`Army ${a.army}: T2 ${a.t2Tick===null?'fehlt':`${(a.t2Tick/10).toFixed(1)} s`}, E-Stall ${pct(a.energyStallPct)}, Timeouts ${a.timeouts}`).join('; '))).join('\n')+'\n':'Keine.\n');
  return `# TRACK-AI Arena-Turnier\n\nSpiele: ${report.games}, Crashes: ${report.crashes}, Remis: ${report.draws}.\n\n| Gate | Messwert | Ergebnis |\n|---|---:|---|\n| T2 <= 720 s | ${report.t2.success}/${report.t2.n}, Wilson-Untergrenze ${pct(report.t2.interval.lo*100)} | ${report.gates.t2} |\n| Welle <= 480 s | ${report.wave.success}/${report.wave.n}, Wilson-Untergrenze ${pct(report.wave.interval.lo*100)} | ${report.gates.wave} |\n| Idle < 15 % | ${pct(report.idleMax)} maximal | ${report.gates.idle} |\n| Energie-Stall (gepoolte tatsächliche Ticks) | ${pct(report.energyStallPct)} | Bericht, kein MS9-Gate |\n\nGates: ${JSON.stringify(report.gates)}\n\nEine Army pro Spiel wird nach Seed-Parität für T2, Welle und Gruppen ausgewählt. Idle, APM, Ops, Timeouts und Energie-Stall berücksichtigen beide Armies. Energie-Stall ist hier eine Berichtszahl; das <=5-%-MS10-Ziel ist kein MS9-Turnier-Gate. Ein niedriger gepoolter Wert beweist nicht, dass jede einzelne Army unter 5 % liegt. Crashes bleiben im Nenner. Ergebnisquoten zählen Remis zur Hälfte.\n${pairs}${groups('Karten',report.byMap)}${groups('Eröffnungen',report.byOpening)}${outliers}\nArena-Ergebnisse sind keine Abnahme der echten Sim. Die Difficulty-Suite liefert nur einen Bericht, die MS9-Gates gelten dort nicht als Abnahmekriterium. Vollständige Spiel-, Seed-, APM-, Ops- und Timeout-Daten stehen im zugehörigen JSON unter tools/ai-arena/results/.\n`;
}
