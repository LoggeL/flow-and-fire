/**
 * AI command sources: idempotency per tick (a loop that retries a tick because ANOTHER source was
 * pending must not lose commands — AI-DET-03 "kein Command verworfen") and the byte form
 * (`pending`/`batchFor`, structurally sim-host's TickSource).
 */
import { describe, expect, it } from 'vitest';
import { asTick, type Tick } from '@faf/fixed';
import { decodeBatch, encodeBatch, type CommandEnvelope, type CommandSource } from '@faf/protocol';
import { AiCommandSource, createBrain, defineManager, PendingAiSource, Prio, profileFor, type AiBrain } from '../src/index.ts';
import { FakeWorld, flatStatic } from '../src/testing/index.ts';
import { loadOpenings, loadRoster } from './support/fixtures.ts';

const doc = loadOpenings();
const T = loadRoster();

function moveBrain(): AiBrain {
  const m = defineManager('platoon', () => (ctx) => ctx.emitter.move([1 + ctx.k], ctx.tick, 0, Prio.P1));
  const brain = createBrain({ managers: [m] });
  brain.init(flatStatic({ bps: T, sizeWu: 256, spots: [{ kind: 'mass', x: 70, z: 64 }] }), profileFor('normal', doc), { openings: doc });
  return brain;
}

function aiSource(): AiCommandSource {
  const brain = moveBrain();
  const w = new FakeWorld(brain.static);
  return new AiCommandSource({
    brain,
    perceive: (t) => {
      w.tick = t;
      return w.perceive();
    },
  });
}

/**
 * The multi-source loop of `runMatchAsync`/sim-host: collect every source; if one is pending, retry
 * the whole tick later. Returns the commands applied per tick.
 */
function pollLoop(sources: readonly CommandSource[], ticks: number, onPending: (t: number) => void): Map<number, CommandEnvelope[]> {
  const applied = new Map<number, CommandEnvelope[]>();
  for (let t = 0; t < ticks; t++) {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 10) throw new Error(`tick ${t} stuck`);
      const out: CommandEnvelope[] = [];
      let pending = false;
      for (const s of sources) {
        const r = s.commandsFor(t as Tick);
        if (r === 'pending') {
          pending = true;
          break;
        }
        out.push(...r);
      }
      if (!pending) {
        if (out.length > 0) applied.set(t, out);
        break;
      }
      onPending(t);
    }
  }
  return applied;
}

describe('AI sources are idempotent per tick', () => {
  it('PendingAiSource: a retry of the same tick returns the same commands (review TRACK-AI)', () => {
    const src = new PendingAiSource({ thinkEvery: 5, lead: 3, request: () => {} });
    src.commandsFor(asTick(0));
    const cmds = moveBrain().think(new FakeWorld(moveBrain().static).perceive()).commands;
    src.deliver(0, cmds);
    const first = src.commandsFor(asTick(3));
    expect(first).toHaveLength(1);
    expect(src.commandsFor(asTick(3))).toEqual(first);
    expect(src.commandsFor(asTick(3))).toEqual(first);
    expect(src.commandsFor(asTick(4))).toEqual([]);
    expect(() => src.commandsFor(asTick(3))).toThrow(/asked after/);
  });

  it('AiCommandSource beside a pending source: retried ticks lose nothing', () => {
    // Reference: the AI source alone.
    const alone = pollLoop([aiSource()], 31, () => {});
    // Mixed: a second source is pending once at every tick ≡ 3 (mod 5) — exactly the AI's due ticks.
    let late: PendingAiSource | null = null;
    const pendingOnce = new Set<number>();
    const lateSrc = new PendingAiSource({ thinkEvery: 5, lead: 3, request: () => {} });
    late = lateSrc;
    const mixed = pollLoop([aiSource(), lateSrc], 31, (t) => {
      pendingOnce.add(t);
      late!.deliver(late!.outstandingThinks[0]!, []);
    });
    expect([...pendingOnce]).toEqual([3, 8, 13, 18, 23, 28]);
    expect([...mixed.keys()]).toEqual([...alone.keys()]);
    for (const [t, cmds] of alone) expect(mixed.get(t)).toEqual(cmds);
    expect(alone.size).toBe(6);
  });

  it('PendingAiSource as the FIRST of two sources keeps its delivered commands on a retry', () => {
    const cmds = moveBrain().think(new FakeWorld(moveBrain().static).perceive()).commands;
    const a = new PendingAiSource({ thinkEvery: 5, lead: 3, request: () => {} });
    const b = new PendingAiSource({ thinkEvery: 5, lead: 3, request: () => {} });
    let deliveredA = false;
    const applied = pollLoop([a, b], 10, (t) => {
      if (!deliveredA) {
        a.deliver(0, cmds);
        deliveredA = true;
        return;
      }
      // a has served tick t already; b is still late
      for (const n of [...b.outstandingThinks]) if (n + 3 <= t) b.deliver(n, []);
      for (const n of [...a.outstandingThinks]) if (n + 3 <= t) a.deliver(n, []);
    });
    expect(applied.get(3)).toEqual(cmds);
  });
});

describe('byte form (TickSource shape)', () => {
  it('AiCommandSource: pending() is always false and consumes nothing; batchFor = encodeBatch(commandsFor)', () => {
    const env = aiSource();
    const bytes = aiSource();
    for (let t = 0; t < 21; t++) {
      expect(bytes.pending(t)).toBe(false);
      expect(bytes.pending(t)).toBe(false);
      const b = bytes.batchFor(t);
      const e = env.commandsFor(asTick(t));
      if (e.length === 0) expect(b).toBeNull();
      else {
        expect(b).not.toBeNull();
        expect(Array.from(b!)).toEqual(Array.from(encodeBatch(e)));
        // idempotent for the current tick, in both forms
        expect(bytes.batchFor(t)).toBe(b);
        expect(bytes.commandsFor(asTick(t))).toEqual(e);
      }
    }
  });

  it('PendingAiSource.deliverBatch: the delivered bytes are handed out unchanged; commandsFor decodes lazily', () => {
    const requested: number[] = [];
    const src = new PendingAiSource({ thinkEvery: 5, lead: 3, request: (t) => requested.push(t) });
    expect(src.pending(0)).toBe(false);
    expect(requested).toEqual([0]);
    expect(src.batchFor(0)).toBeNull();
    expect(src.pending(1)).toBe(false);
    expect(src.batchFor(1)).toBeNull();
    expect(src.pending(2)).toBe(false);
    expect(src.batchFor(2)).toBeNull();
    expect(src.pending(3)).toBe(true);
    expect(src.pending(3)).toBe(true);
    expect(() => src.batchFor(3)).toThrow(/while pending/);
    const cmds = moveBrain().think(new FakeWorld(moveBrain().static).perceive()).commands;
    const batch = encodeBatch(cmds);
    src.deliverBatch(0, batch);
    expect(src.pending(3)).toBe(false);
    expect(src.batchFor(3)).toBe(batch);
    expect(decodeBatch(src.batchFor(3)!)).toEqual(cmds);
    expect(src.commandsFor(asTick(3))).toEqual(cmds);
    expect(() => src.deliverBatch(5, new Uint8Array([9, 9]))).toThrow(RangeError);
  });
});
