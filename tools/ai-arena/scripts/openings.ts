import { writeFileSync } from 'node:fs';
import { runScenario } from '../src/scenarios/index.ts';
import { loadOpeningsJson } from '../src/data/design.ts';
const args=process.argv.slice(2),outIndex=args.indexOf('--out');
const output=outIndex>=0?args[outIndex+1]!:`tools/ai-arena/results/openings-${new Date().toISOString().slice(0,10)}.json`;
const doc=loadOpeningsJson() as unknown as {readonly openings:readonly {readonly id:string;readonly expect:Readonly<Record<string,Readonly<Record<string,number>>>>}[]};
let markdown='# TRACK-AI Eröffnungs-Timings\n\nNormal, Seed 7, keine gegnerischen Befehle. Sekunden. Referenzwerte unverändert aus ai-openings.json.\n\n| Karte | Eröffnung | Kennzahl | Arena | expect | Delta | ±10 s |\n|---|---|---|---:|---:|---:|---|\n';const rows=[];
for(const map of ['setons','hollow-ridge'])for(const opening of doc.openings.filter(o=>o.id!=='air_opener')){
 const r=runScenario({map,seed:7,until:Math.ceil((opening.expect[map]!['techT2']!+120)*10),sides:[{army:0,profile:'normal',opening:opening.id},{army:1,profile:'easy',source:{commandsFor:()=>[]}}]});
 const a=r.metrics.armies[0]!;for(const metric of ['fac1','eng1','mex4','mex8','techT2'] as const){const tick=metric==='techT2'?a.t2Tick:a[metric],actual=tick===null?null:tick/10,expected=opening.expect[map]![metric]!;const delta=actual===null?null:actual-expected;const within10s=delta!==null&&Math.abs(delta)<=10;rows.push({map,opening:opening.id,metric,actual,expected,delta,within10s});markdown+=`| ${map} | ${opening.id} | ${metric} | ${actual?.toFixed(1)??'nicht erreicht'} | ${expected.toFixed(1)} | ${delta?.toFixed(1)??'offen'} | ${within10s?'erfüllt':'verfehlt'} |\n`;}}
markdown+='\nDie ±10-s-Referenz ist als eigenes Ergebnis ausgewiesen. Die Completion-Regression prüft reale Meilensteine, T2 ≤ 12 min, Welle ≤ 8 min, Timeouts, APM und Operationsbudget. Die Referenzdaten bleiben unverändert.\n';writeFileSync('docs/status/track-ai-openings.md',markdown);writeFileSync(output,JSON.stringify(rows,null,2)+'\n');process.stdout.write(markdown);
