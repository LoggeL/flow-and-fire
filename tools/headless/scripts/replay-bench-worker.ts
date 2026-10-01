/** A fresh Node process receives prewritten fixtures; no recording or conversion runs here. */
import { readFileSync } from 'node:fs';
import { benchmarkPreparedReplay, type ReplayBenchmarkBaseline } from '../src/replay/replay-bench.ts';
import { loadMaps, loadSimBin } from './lib.ts';
const [mode, replayPath, baselinePath] = process.argv.slice(2);
if ((mode !== 'cold' && mode !== 'warm') || replayPath === undefined || baselinePath === undefined)
  throw new Error('replay-bench-worker <cold|warm> <replay> <baseline>');
const bytes = new Uint8Array(readFileSync(replayPath));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as ReplayBenchmarkBaseline;
const assets = { simBin: loadSimBin(), maps: loadMaps() };
const result = benchmarkPreparedReplay(bytes, baseline, assets, { mode, clock: () => performance.now() });
console.log(JSON.stringify({ pid: process.pid, ...result }));
