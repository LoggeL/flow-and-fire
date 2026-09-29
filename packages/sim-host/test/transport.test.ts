/**
 * G14 / MS1 acceptance: SAB and transfer transport deliver byte-identical frames for the same run
 * (host driven tick by tick; the fake clock makes the timing fields deterministic).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { xxHash32 } from '@faf/fixed';
import { FrameReader } from '@faf/protocol';
import { scenarioCommands, bufferOf } from './support/fixtures.ts';
import { makeTestHost, nextFrame, type TestHost } from './support/host.ts';

const TICKS = 200;
const xxHashFrame = (b: Uint8Array): number => xxHash32(b, 0, b.length, 0);
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}
let open: TestHost[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

/** Runs the scenario tick by tick and collects one frame per tick (plus the initial and a paused frame). */
async function collect(transport: 'sab' | 'transfer'): Promise<Uint8Array[]> {
  const h = makeTestHost({ transport, autoStart: false, seed: 99 });
  open.push(h);
  const frames: Uint8Array[] = [await nextFrame(h.consumer)];
  for (let t = 1; t <= TICKS; t++) {
    const cmds = scenarioCommands(h.host.core.world, t);
    if (cmds.length > 0) h.host.submit(bufferOf(cmds));
    expect(h.host.runTicks(1)).toBe(1);
    frames.push(await nextFrame(h.consumer));
    if (t === 120) {
      h.host.ctl({ t: 'pause' });
      frames.push(await nextFrame(h.consumer));
      h.host.ctl({ t: 'viewer', army: 1 });
      frames.push(await nextFrame(h.consumer));
      h.host.ctl({ t: 'resume' });
      frames.push(await nextFrame(h.consumer));
    }
  }
  expect(h.host.producer.dropped).toBe(0);
  return frames;
}

describe('SAB and transfer transport', () => {
  it(`deliver byte-identical frames for ${TICKS} ticks of the same run`, async () => {
    const sab = await collect('sab');
    const transfer = await collect('transfer');
    expect(sab).toHaveLength(TICKS + 4);
    expect(transfer).toHaveLength(sab.length);
    const r = new FrameReader();
    for (let i = 0; i < sab.length; i++) {
      expect(transfer[i]!.length).toBe(sab[i]!.length);
      expect(xxHashFrame(transfer[i]!)).toBe(xxHashFrame(sab[i]!));
      expect(firstDiff(transfer[i]!, sab[i]!)).toBe(-1);
    }
    expect(r.reset(sab.at(-1)!)).toBe(true);
    expect(r.tick).toBe(TICKS);
    expect(r.unitCount).toBe(1000);
    expect(r.viewer).toBe(1);
    // Frames differ from tick to tick (the cubes really move).
    expect(new Set(sab.map(xxHashFrame)).size).toBeGreaterThan(TICKS);
  });
});
