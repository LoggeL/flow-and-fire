/**
 * Rough Node tick benchmark of the cube sim (MS3: every move is pathed; the authoritative multi-engine bench lives in
 * sim-host/headless): 1,000 cubes with new move targets every 100 ticks, p50/p95/p99 per phase.
 * Run: node --expose-gc --import tsx packages/sim/bench/tick.ts [ticks]
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { asArmyId, asTick, fx } from '@faf/fixed';
import { CommandBatchEncoder, encodeCheatSpawn, encodeMove, FrameWriter, Op } from '@faf/protocol';
import { createWorld, PHASE_ID_COUNT, PHASE_NAMES, PhaseId, step, unitHandles, writeFrame, type PhaseProbe } from '../src/index.ts';

// First numeric argument (pnpm forwards `--` and flags like --update-docs of the root bench).
const ticks = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 5000);
const simBin = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../content/generated/sim.bin', import.meta.url))));
const w = createWorld({ simBin, seed: 7, armyCount: 2 });
const enc = new CommandBatchEncoder();
enc.add({ tick: asTick(0), army: asArmyId(0), seq: 1, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp: w.bp.indexOf('core:cube'), army: 0, count: 1000, x: fx(256), z: fx(256), spread: fx(60) }) });
step(w, enc.view().slice());
const handles = unitHandles(w, 0);
// 10 groups of 100 cubes, each with its own target ring.
const batches: Uint8Array[] = [];
for (let k = 0; k < 16; k++) {
  const e = new CommandBatchEncoder();
  for (let g = 0; g < 10; g++) {
    const a = ((k * 10 + g) * 2654435761) >>> 0;
    const x = 64 + (a % 384);
    const z = 64 + ((a >>> 9) % 384);
    e.add({ tick: asTick(0), army: asArmyId(0), seq: k * 10 + g + 2, op: Op.Move, flags: 0, units: handles.slice(g * 100, g * 100 + 100), payload: encodeMove({ x: fx(x), y: fx(0), z: fx(z) }) });
  }
  batches.push(e.view().slice());
}
const N = PHASE_ID_COUNT;
const samples: Float64Array[] = Array.from({ length: N }, () => new Float64Array(ticks));
const total = new Float64Array(ticks);
const t0 = new Float64Array(N);
let cur = 0;
const probe: PhaseProbe = {
  begin(p) { t0[p] = performance.now(); },
  end(p) { samples[p]![cur] = performance.now() - t0[p]!; },
};
const writer = new FrameWriter();
const target = new Uint8Array(writer.capacityBytes);
let frameMs = 0;
for (cur = 0; cur < ticks; cur++) {
  const cmds = cur % 100 === 0 ? batches[(cur / 100) % batches.length]! : null;
  const s = performance.now();
  step(w, cmds, probe);
  total[cur] = performance.now() - s;
  const f = performance.now();
  writeFrame(w, 0, writer, target);
  frameMs += performance.now() - f;
}
const pct = (a: Float64Array, q: number): number => {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const hashTicks = Float64Array.from(samples[PhaseId.HashTick]!.filter((_, i) => (i + 2) % 10 === 0));
const rows: [string, Float64Array][] = [['step total', total]];
for (const p of [1, 2, 3, 7, 8, 15, 16]) rows.push([PHASE_NAMES[p]!, samples[p]!]);
rows.push(['HashTick (hash ticks)', hashTicks]);
console.log(`ticks ${ticks}, units ${w.units.liveCount}, node ${process.version}`);
for (const [name, a] of rows) console.log(`${name.padEnd(24)} p50 ${pct(a, 0.5).toFixed(3)} ms  p95 ${pct(a, 0.95).toFixed(3)} ms  p99 ${pct(a, 0.99).toFixed(3)} ms`);
console.log(`writeFrame avg ${(frameMs / ticks).toFixed(3)} ms`);
