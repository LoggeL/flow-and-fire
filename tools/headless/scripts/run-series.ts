/**
 * Node reference runner: executes one cold/warm series in this fresh process (JIT cold on the
 * first run) and prints the SeriesResult as JSON on stdout.
 * Usage: node --import tsx scripts/run-series.ts '<job json>'
 */
import { engineInfo, runJob, type Job } from '../src/jobs.ts';
import { runSeries } from '../src/series.ts';
import { loadMaps, loadReplays, loadSimBin, loadXxh32Wasm } from './lib.ts';

const job = JSON.parse(process.argv[2] ?? '') as Job;
const clock = (): number => performance.now();
const assets = { simBin: loadSimBin(), xxh32Wasm: loadXxh32Wasm(), maps: loadMaps(), replays: loadReplays() };
const info = engineInfo('node', clock);
const env = { clock, info };
const result = await runSeries(job, info, (j, mode) => runJob(j, mode, assets, env));
process.stdout.write(JSON.stringify(result) + '\n');
