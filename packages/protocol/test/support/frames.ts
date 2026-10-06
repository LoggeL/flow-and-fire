import { FrameWriter, type FrameCaps } from '../../src/index.ts';

/** Small caps for tests (keeps buffers tiny). */
export const TEST_CAPS: FrameCaps = { units: 64, parts: 128, projectiles: 32, beams: 8, events: 16, debugBytes: 64 };
/** TEST_CAPS plus a small watch section (v2). */
export const TEST_CAPS_WATCH: FrameCaps = { ...TEST_CAPS, watch: 4 };

/**
 * Writes a deterministic pseudo-random frame number `n` into `target`; returns its byte length.
 * Content (counts, values) varies with n so frames of a sequence differ in size and bytes.
 */
export function writeTestFrame(w: FrameWriter, target: Uint8Array, n: number): number {
  let s = (n * 0x9e3779b1) >>> 0;
  const rnd = (m: number): number => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s % m;
  };
  w.beginFrame(target, n, n * 3, 1000 + n, 1000, n & 1 ? -1 : 0, n & 2 ? 1 : 0, n, n - (n % 10), n * 7919);
  const units = rnd(w.caps.units + 1);
  for (let i = 0; i < units; i++) {
    const pc = rnd(3);
    const base = w.partCount;
    for (let k = 0; k < pc; k++) w.writePart(rnd(65536), rnd(65536), rnd(65536) - 32768, rnd(65536) - 32768);
    w.writeUnit(
      rnd(1 << 20) - (1 << 19), rnd(4096), rnd(1 << 20), rnd(1 << 20), rnd(4096), rnd(1 << 20) - 5,
      rnd(65536), rnd(65536), rnd(65536), rnd(16), rnd(256), rnd(256), rnd(256) - 128, rnd(1 << 11),
      rnd(0x100000000), base, pc,
    );
  }
  const proj = rnd(w.caps.projectiles + 1);
  for (let i = 0; i < proj; i++) w.writeProjectile(rnd(1e6), rnd(1e4), -rnd(1e6), rnd(1e6), rnd(1e4), rnd(1e6), rnd(65536), rnd(16), rnd(256));
  const beams = rnd(w.caps.beams + 1);
  for (let i = 0; i < beams; i++) w.writeBeam(rnd(0x100000000), rnd(0x100000000), rnd(65536), rnd(8), rnd(256));
  const events = rnd(w.caps.events + 1);
  for (let i = 0; i < events; i++) {
    w.writeEvent(rnd(65536), rnd(65536), n, rnd(256), rnd(256), -rnd(1e6), rnd(1e6), rnd(1e6), rnd(0x100000000), rnd(0x100000000));
  }
  const watch = rnd((w.caps.watch ?? 0) + 1);
  for (let i = 0; i < watch; i++) {
    w.beginWatch(rnd(0x100000000), rnd(40), rnd(16));
    const nt = rnd(20);
    for (let k = 0; k < nt; k++) w.addWatchTarget(1 + rnd(2), rnd(1 << 24), -rnd(1 << 24));
    const np = rnd(20);
    for (let k = 0; k < np; k++) w.addWatchPoint(rnd(1 << 24), rnd(1 << 24));
  }
  if (rnd(3) === 1) w.setPathStats(rnd(100), rnd(1e6), rnd(1e4), rnd(1e5), rnd(100));
  if (rnd(2) === 1) {
    const dbg = new Uint8Array(rnd(w.caps.debugBytes + 1));
    for (let i = 0; i < dbg.length; i++) dbg[i] = rnd(256);
    w.setDebugSection(dbg);
  }
  w.setFogRect(rnd(1024), rnd(1024), rnd(1024), rnd(1024));
  w.setFootprintDeltaCount(rnd(100));
  return w.endFrame();
}
