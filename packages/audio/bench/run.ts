import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { makeEngineRig } from '../test/engine/rig.ts';
import { BattleScenario, battleVisualName, runBattle } from './scenario.ts';
import { SOUND_CATEGORIES } from '../src/types.ts';
const runs = [];
for (const shots of [200, 400]) for (let run = 0; run < 3; run++) {
  const rig = makeEngineRig({ engine: { visualName: battleVisualName, timer: () => performance.now() } }); await rig.engine.unlock();
  const scenario = new BattleScenario({ seconds: 20, fps: 60, shotsPerSecond: shots, seed: run + 1 });
  let maxVoices = 0; const maxByCategory = Object.fromEntries(SOUND_CATEGORIES.map(c => [c, 0]));
  runBattle(rig.engine, scenario, { advance: ms => rig.ctx.advance(ms), now: () => rig.ctx.nowMs, onFrame: () => { const st = rig.engine.stats(); maxVoices = Math.max(maxVoices, st.voices); for (const c of SOUND_CATEGORIES) maxByCategory[c] = Math.max(maxByCategory[c]!, st.voicesByCategory[c]); } });
  const stats = rig.engine.stats(); if (maxVoices > rig.manifest.maxVoices) throw new Error('Global voice budget exceeded'); for (const c of SOUND_CATEGORIES) if (maxByCategory[c]! > rig.manifest.categories[c].maxVoices) throw new Error(`${c} voice budget exceeded`); if (stats.played === 0 || stats.dropped.notLoaded > 0) throw new Error('Incomplete audio workload'); runs.push({ shots, run: run + 1, stats, maxVoices, maxByCategory, counts: scenario.counts }); await rig.engine.dispose();
}
const result = { measuredAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, context: 'FakeAudioContext; real engine and manifest; JS timing only', runs };
const dir = resolve(import.meta.dirname, '../results'); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, `${Date.now()}.json`), JSON.stringify(result, null, 2));
const table = ['| Schüsse/s | Lauf | p50 ms | p95 ms | p99 ms | Stimmen | Drops | Steals |', '|---|---|---|---|---|---|---|---|', ...runs.map(r => `| ${r.shots} | ${r.run} | ${r.stats.mainJs.p50.toFixed(4)} | ${r.stats.mainJs.p95.toFixed(4)} | ${r.stats.mainJs.p99.toFixed(4)} | ${r.maxVoices} | ${Object.values(r.stats.dropped).reduce((a,b) => a+b,0)} | ${r.stats.stolen} |`)].join('\n');
console.log(table);
if (process.argv.includes('--update-docs')) { const path = resolve(import.meta.dirname, '../../../docs/status/track-audioeng.md'); const s = readFileSync(path, 'utf8'); writeFileSync(path, s.replace(/<!-- bench:audio-node:start -->[\s\S]*?<!-- bench:audio-node:end -->/, `<!-- bench:audio-node:start -->\n${table}\n<!-- bench:audio-node:end -->`)); }
if (process.env['FAF_AUDIO_PERF_GATE'] === '1' && runs.some(r => r.shots === 200 && r.stats.mainJs.p95 > .5)) throw new Error('Audio engine Node p95 exceeds 0.5 ms');
