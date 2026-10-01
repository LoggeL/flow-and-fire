import { performance } from 'node:perf_hooks';
import { createHudModel } from '../src/model/index.ts';
import { seedHud, snapshotOf } from '../src/demo/hud.ts';
import { HudScheduler } from '../src/scheduler/index.ts';
const source = createHudModel(), target = createHudModel();
seedHud(source, 'dichtester Fall');
let now = 0;
const scheduler = new HudScheduler(target, { now: () => now, requestFrame: () => 1, cancelFrame: () => { } }), times: number[] = [];
for (let i = 0; i < 12000; i++) {
    now = i * 100;
    source.eco.mass.stored.value = i % 1000;
    source.match.timeS.value = i / 10;
    const snapshot = snapshotOf(source, 1);
    const start = performance.now();
    scheduler.push(snapshot, i, 3);
    scheduler.flush();
    if (i >= 2000)
        times.push(performance.now() - start);
    performance.clearMeasures('hud-flush');
}
scheduler.dispose();
times.sort((a, b) => a - b);
console.log(JSON.stringify({ kind: 'scheduler-no-dom', samples: times.length, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1), signalWrites: scheduler.writes }, null, 2));
