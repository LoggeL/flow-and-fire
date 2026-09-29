import { asArmyId, asTick, fx } from '@faf/fixed';
import { CommandBatchEncoder, encodeMove, FrameWriter, Op } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { createWorld, PhaseId, step, unitHandles, writeFrame, type PhaseProbe } from '../src/index.ts';
import { measureAllocation } from './support/alloc.ts';
import { gameTable, spawnCmd } from './support/fixtures.ts';

const gc = (globalThis as { gc?: () => void }).gc;

/** Probe that only counts calls (the sim must call it allocation-free as well). */
class CountingProbe implements PhaseProbe {
  readonly begins = new Int32Array(18);
  readonly ends = new Int32Array(18);
  begin(p: number): void {
    this.begins[p] = this.begins[p]! + 1;
  }
  end(p: number): void {
    this.ends[p] = this.ends[p]! + 1;
  }
}

describe('allocation (PLAN §3.4: warm < 1 MB over 10,000 ticks)', () => {
  it('the measurement detects allocation (canary: 256 B of garbage per tick)', async () => {
    let sink: Float64Array | null = null;
    const m = await measureAllocation((n) => {
      for (let i = 0; i < n; i++) sink = new Float64Array(32);
    }, 10_000);
    expect(sink).not.toBeNull();
    // Either counted directly (≥ 2 MB over the GC-free chunks, scaled) or V8 had to collect.
    const perTick = m.ticks > 0 ? m.bytes / m.ticks : 0;
    expect(perTick >= 200 || m.gcEvents > 0, JSON.stringify(m)).toBe(true);
  });

  it('10,000 warm ticks with 1,000 driving cubes incl. commands, frame writing and hash', async () => {
    expect(gc).toBeTypeOf('function');
    const w = createWorld({ bpTable: gameTable(), seed: 11, armyCount: 2 });
    step(w, [spawnCmd(0, 1000, 256, 256, 80, 0, 0, 1)]);
    const hs = unitHandles(w, 0);
    // Four reusable batches: 10 groups of 100 cubes, each with a new target.
    const batches: Uint8Array[] = [];
    for (let k = 0; k < 4; k++) {
      const e = new CommandBatchEncoder();
      for (let g = 0; g < 10; g++) {
        const a = ((k * 10 + g + 1) * 2654435761) >>> 0;
        e.add({
          tick: asTick(0),
          army: asArmyId(0),
          seq: 2 + k * 10 + g,
          op: Op.Move,
          flags: 0,
          units: hs.slice(g * 100, g * 100 + 100),
          payload: encodeMove({ x: fx(64 + (a % 384)), y: fx(0), z: fx(64 + ((a >>> 9) % 384)) }),
        });
      }
      batches.push(e.view().slice());
    }
    const writer = new FrameWriter();
    const target = new Uint8Array(writer.capacityBytes);
    const probe = new CountingProbe();
    let moving = 0;
    const tickRun = (n: number): void => {
      for (let i = 0; i < n; i++) {
        const t = w.tick;
        step(w, t % 100 === 0 ? batches[(t / 100) % 4]! : null, probe);
        writeFrame(w, 0, writer, target);
        if (t % 1000 === 0) {
          moving = 0;
          for (let r = 0; r < w.movers.count; r++) if (w.movers.col.speed[r]! > 0) moving++;
        }
      }
    };
    tickRun(1000); // warm-up (JIT, DataView caches)
    // Allocation, not retention: heap growth between GCs, chunk by chunk (support/alloc.ts).
    const m = await measureAllocation(tickRun, 10_000);
    gc!();
    const before = process.memoryUsage().heapUsed;
    tickRun(1000);
    gc!();
    const retained = process.memoryUsage().heapUsed - before;
    console.log(
      `[alloc] sim: allocated ${(m.bytes / 1024).toFixed(1)} KiB in ${m.ticks} GC-free warm ticks ` +
        `(${m.chunks - m.chunksWithGc}/${m.chunks} chunks, ${m.gcEvents} GCs inside chunks), retained after 1,000 more ticks ${(retained / 1024).toFixed(1)} KiB, moving cubes at last sample: ${moving}`,
    );
    expect(moving).toBeGreaterThan(300);
    // No GC was needed while ticking, and what was allocated stays below the budget.
    expect(m.gcEvents).toBe(0);
    expect(m.ticks).toBe(10_000);
    expect(m.bytes).toBeLessThan(1024 * 1024);
    expect(retained).toBeLessThan(256 * 1024);
    expect(probe.begins[PhaseId.Movement]).toBe(12_000);
    expect(probe.ends[PhaseId.HashTick]).toBe(1200);
  });
});
