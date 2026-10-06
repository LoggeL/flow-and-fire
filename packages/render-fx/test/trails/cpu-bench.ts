/**
 * CPU cost of the beam/trail/shield packing (Node, fake GL – measures the JS side only):
 * `node --import tsx packages/render-fx/test/trails/cpu-bench.ts`. Not part of the vitest suite.
 */
import { BeamPass, ShieldPass, TrailPass, VARKAN_BEAM_STYLES, VARKAN_TRAIL_STYLES } from '../../src/index.ts';
import { fakeFx } from './support.ts';

const BEAMS = 4096;
const TRAILS = 8192;
const SHIELDS = 20;
const ROUNDS = 300;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

const { dev, bindings } = fakeFx();
const beams = new BeamPass(dev, bindings, { capacity: BEAMS });
const trails = new TrailPass(dev, bindings, { capacity: TRAILS });
const shields = new ShieldPass(dev, bindings);
const a = new Int32Array(3);
const b = new Int32Array(3);
const styles = [VARKAN_BEAM_STYLES.laser, VARKAN_BEAM_STYLES.buildStream, VARKAN_BEAM_STYLES.reclaimStream, VARKAN_BEAM_STYLES.lightning];
const tStyles = [VARKAN_TRAIL_STYLES.tracer, VARKAN_TRAIL_STYLES.cannon, VARKAN_TRAIL_STYLES.missile];
const center = new Int32Array(3);
for (let k = 0; k < SHIELDS; k++) {
  center[0] = k * 40 * 4096;
  shields.set(k, { centerRaw: center, radiusWu: 12, color: [0.35, 0.75, 1.3], hpFrac: 1, upFrac: 1 });
}

const tb: number[] = [];
const tt: number[] = [];
const ts: number[] = [];
for (let r = 0; r < ROUNDS; r++) {
  let t0 = performance.now();
  beams.begin();
  for (let i = 0; i < BEAMS; i++) {
    a[0] = i * 4096;
    a[1] = r * 64;
    a[2] = 0;
    b[0] = a[0] + 40960;
    b[1] = 4096;
    b[2] = i * 512;
    beams.add(a, b, styles[i & 3]!);
  }
  let enc = dev.beginPass({ label: 'bench' });
  beams.encode(enc);
  enc.end();
  tb.push(performance.now() - t0);

  t0 = performance.now();
  trails.begin();
  for (let i = 0; i < TRAILS; i++) {
    a[0] = i * 4096;
    a[1] = r * 64;
    a[2] = 0;
    b[0] = a[0] + 2048;
    b[1] = a[1];
    b[2] = 1024;
    trails.add(a, b, tStyles[i % 3]!);
  }
  enc = dev.beginPass({ label: 'bench' });
  trails.encode(enc);
  enc.end();
  tt.push(performance.now() - t0);

  t0 = performance.now();
  const now = r / 60;
  for (let k = 0; k < SHIELDS; k++) {
    center[0] = k * 40 * 4096;
    shields.set(k, { centerRaw: center, radiusWu: 12, color: [0.35, 0.75, 1.3], hpFrac: 0.8, upFrac: 1 });
    shields.hit(k, center, now);
  }
  shields.update(now);
  enc = dev.beginPass({ label: 'bench' });
  shields.encode(enc);
  enc.end();
  ts.push(performance.now() - t0);
}
const warm = (v: number[]): number[] => v.slice(ROUNDS / 3);
console.log(
  `CPU p50 (fake GL): ${BEAMS} beams ${median(warm(tb)).toFixed(3)} ms | ${TRAILS} trails ${median(warm(tt)).toFixed(3)} ms | ${SHIELDS} shields (set+hit+update+encode) ${median(warm(ts)).toFixed(3)} ms`,
);
beams.destroy();
trails.destroy();
shields.destroy();
