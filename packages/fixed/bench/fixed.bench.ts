/**
 * L6 micro-benchmark of @faf/fixed (Node/V8). Prints ns/op per primitive and the
 * xxHash32 throughput over a 20 MB arena-sized buffer (SPK5 JS baseline, Node only).
 * Writes bench-results/fixed.json (gitignored) for later comparison.
 *
 * Usage: pnpm --filter @faf/fixed bench
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Ang16,
  type Fx,
  type FxSmall,
  XxHash32,
  atan2A,
  fxDiv,
  fxMul,
  fxMulSmall,
  isqrt,
  rng32,
  sinA,
  xxHash32,
} from '../src/index.ts';

type Result = { name: string; nsPerOp: number };

const N = 2_000_000;
const inputs = new Int32Array(4096);
for (let i = 0; i < inputs.length; i++) inputs[i] = (rng32(1, 0, i, 0) >> 6) | 1;

function bench(name: string, fn: (i: number) => number): Result {
  let sink = 0;
  for (let i = 0; i < 200_000; i++) sink ^= fn(i); // warm-up
  const samples: number[] = [];
  for (let s = 0; s < 5; s++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) sink ^= fn(i);
    samples.push(Number(process.hrtime.bigint() - t0) / N);
  }
  samples.sort((a, b) => a - b);
  if (sink === 0x7fffffff) console.log('');
  return { name, nsPerOp: samples[2]! };
}

const results: Result[] = [
  bench('fxMul', (i) => fxMul(inputs[i & 4095]! as Fx, inputs[(i + 7) & 4095]! as Fx)),
  bench('fxMulSmall', (i) => fxMulSmall((inputs[i & 4095]! & 0x3fff) as FxSmall, (inputs[(i + 7) & 4095]! & 0x3fff) as FxSmall)),
  bench('fxDiv', (i) => fxDiv(inputs[i & 4095]! as Fx, inputs[(i + 7) & 4095]! as Fx)),
  bench('isqrt', (i) => isqrt((inputs[i & 4095]! >>> 0) * 1024)),
  bench('sinA', (i) => sinA((i & 0xffff) as Ang16)),
  bench('atan2A', (i) => atan2A(inputs[i & 4095]!, inputs[(i + 7) & 4095]!)),
  bench('rng32', (i) => rng32(42, i, i & 1023, 3)),
];

const arena = new Uint8Array(20 * 1024 * 1024);
for (let i = 0; i < arena.length; i += 97) arena[i] = i & 0xff;
const times: number[] = [];
const hasher = new XxHash32();
for (let r = 0; r < 7; r++) {
  const t0 = process.hrtime.bigint();
  if (r & 1) hasher.reset(0).update(arena, 0, arena.length).digest();
  else xxHash32(arena, 0, arena.length, 0);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
times.sort((a, b) => a - b);
const hashMs = times[3]!;

for (const r of results) console.log(`${r.name.padEnd(12)} ${r.nsPerOp.toFixed(2).padStart(7)} ns/op`);
console.log(`xxHash32 20 MB  ${hashMs.toFixed(2)} ms (median of 7, ${(20 / 1024 / (hashMs / 1000)).toFixed(2)} GB/s)`);

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../bench-results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, 'fixed.json'),
  JSON.stringify({ engine: `node ${process.version}`, results, xxHash32_20MB_ms: hashMs }, null, 2) + '\n',
);
