/**
 * Host determinism in the arena (ai.md §9):
 * - AI-DET-01 analogue: Setons, seed 7, AI against AI for 10 min game time, once with synchronous
 *   hosts and once with both brains in Node worker threads ⇒ identical command stream (xxHash32 per
 *   600 ticks) and identical world hash trail; with the scripted fixture brain and createDefaultBrain.
 * - AI-DET-03: the worker answers late — (a) deterministically: every result is held back for two
 *   waiting rounds of the sim (in-process channel), (b) in a real worker thread that blocks 70 ms
 *   every 20th think (two ticks at 3x) ⇒ runMatchAsync waits, no command is dropped (stream =
 *   synchronous stream), replay of the command log is bit-exact.
 * - AI-DET-04: a wall-clock stall in the middle of a manager step ⇒ aborted think, aiTimeout mark
 *   and telemetry, only completed steps take effect, replay bit-exact (sync host with an injected
 *   clock, worker host with the real 200-ms headless limit).
 * AI-DET-03 and AI-DET-04 run with the scripted fixture brain and with createDefaultBrain (the stall
 * then hits the first command-emitting step of the real PlatoonManager from 4:00).
 */
import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { AsyncAiSource, ManualClock, runAiWorker, toAiStaticWire, type MessagePortLike } from '@faf/ai/host';
import { ArenaPerceiver, replayMatch, runMatch, runMatchAsync, type MatchResult, type RunMatchOptions } from '../../src/index.ts';
import {
  DEFAULT_BRAIN_SPEC,
  arenaOpeningsJson,
  arenaRosterJson,
  WorldHashTrail,
  closeAiSides,
  commandTrail,
  createAiSide,
  loadBrainFactory,
  type AiSide,
  type AiSideOptions,
  type HostKind,
  type LoadedBrainFactory,
} from '../../src/host-node/index.ts';
import { createDefaultBrain, type ThinkResult } from '@faf/ai';
import {
  DEFAULT_STALL_AFTER,
  STALL_TICK,
  createDefaultBrainWithPlatoonStall,
  createFixtureBrain,
  createFixtureBrainWithStall,
  platoonStalls,
  stallCommits,
} from './fixtures/brains.ts';

const FIXTURES = new URL('./fixtures/brains.ts', import.meta.url).href;
const FIXTURE_SPEC = `${FIXTURES}#createFixtureBrain`;
/**
 * Emergency limit of the AI-DET-01/03 runs: an abort may change the stream by definition (ai.md
 * §2.3), so these tests switch it off (a freeze of the loaded test machine must not flip them);
 * AI-DET-04 tests the abort with the real 200-ms limit.
 */
const NO_EMERGENCY_MS = 60_000;

interface Played {
  readonly result: MatchResult;
  readonly trail: WorldHashTrail;
  readonly sides: AiSide[];
  readonly pendingWaits: number;
  readonly ticksWaited: number;
}

async function play(
  host: HostKind,
  spec: string,
  factory: LoadedBrainFactory | undefined,
  maxTicks: number,
  extra: Partial<AiSideOptions> = { timeoutMs: NO_EMERGENCY_MS },
  seed = 7,
): Promise<Played> {
  const trail = new WorldHashTrail();
  const sides: AiSide[] = [];
  const opts: RunMatchOptions = {
    map: 'setons',
    seed,
    maxTicks,
    onTick: trail.onTick,
    sides: [0, 1].map((army) => ({
      army,
      source: (ctx) => {
        const s = createAiSide(ctx.world, {
          army,
          profile: 'normal',
          host,
          brainSpec: spec,
          ...(factory !== undefined ? { brainFactory: factory } : {}),
          ...extra,
        });
        sides.push(s);
        return s.source;
      },
    })),
  };
  try {
    if (host === 'sync') return { result: runMatch(opts), trail, sides, pendingWaits: 0, ticksWaited: 0 };
    const r = await runMatchAsync(opts);
    return { result: r, trail, sides, pendingWaits: r.pendingWaits, ticksWaited: r.ticksWaited };
  } finally {
    await closeAiSides(sides);
  }
}

function expectSameStream(a: Played, b: Played): void {
  const ta = commandTrail(a.result.log.commands, a.result.log.endTick);
  const tb = commandTrail(b.result.log.commands, b.result.log.endTick);
  expect(tb).toEqual(ta);
  expect(b.result.log.commands.length).toBe(a.result.log.commands.length);
  expect(b.trail.hashes).toEqual(a.trail.hashes);
  expect(b.result.hash).toBe(a.result.hash);
  expect(b.result.log.endTick).toBe(a.result.log.endTick);
}

describe('AI-DET-01 analogue: synchronous host = worker host', () => {
  it('fixture brain, Setons seed 7, 10 min: identical command stream and hash trail', async () => {
    const sync = await play('sync', FIXTURE_SPEC, () => createFixtureBrain(), 6000);
    const worker = await play('worker', FIXTURE_SPEC, undefined, 6000);
    expect(sync.result.log.commands.length).toBeGreaterThan(50);
    expect(sync.trail.hashes.length).toBe(10);
    expectSameStream(sync, worker);
    expect(worker.sides[0]!.stats.thinks).toBe(sync.sides[0]!.stats.thinks);
    expect(worker.sides[0]!.stats.ops).toEqual(sync.sides[0]!.stats.ops);
  });

  it('createDefaultBrain, Setons seed 7, 10 min: identical command stream and hash trail', async () => {
    const factory = await loadBrainFactory(DEFAULT_BRAIN_SPEC);
    const sync = await play('sync', DEFAULT_BRAIN_SPEC, factory, 6000);
    const worker = await play('worker', DEFAULT_BRAIN_SPEC, undefined, 6000);
    expect(sync.result.log.commands.length).toBeGreaterThan(100);
    expectSameStream(sync, worker);
    expect(worker.sides.map((s) => s.openingId())).toEqual(sync.sides.map((s) => s.openingId()));
    expect(worker.sides[1]!.telemetry).toEqual(sync.sides[1]!.telemetry);
  });
});

/**
 * In-process channel whose worker → sim `result` messages are delivered only after `lag` waiting
 * rounds of the sim (runMatchAsync yieldFn); all other messages pass immediately. Messages are
 * structured-cloned like a real channel.
 */
class LaggedChannel {
  rounds = 0;
  private readonly held: { due: number; data: unknown }[] = [];
  private simHandler: (d: unknown) => void = () => undefined;
  private workerHandler: (d: unknown) => void = () => undefined;
  constructor(private readonly lag: number) {}
  readonly sim: MessagePortLike = {
    postMessage: (m) => this.workerHandler(structuredClone(m)),
    onMessage: (h) => {
      this.simHandler = h;
    },
  };
  readonly worker: MessagePortLike = {
    postMessage: (m) => {
      const d = structuredClone(m);
      if ((d as { type?: unknown }).type === 'result') this.held.push({ due: this.rounds + this.lag, data: d });
      else this.simHandler(d);
    },
    onMessage: (h) => {
      this.workerHandler = h;
    },
  };
  readonly yieldFn = async (): Promise<void> => {
    await new Promise<void>((r) => setImmediate(r));
    this.rounds++;
    while (this.held.length > 0 && this.held[0]!.due <= this.rounds) this.simHandler(this.held.shift()!.data);
  };
}

describe('AI-DET-03: the worker answers late', () => {
  it('deterministic lag: every result 2 waiting rounds late ⇒ exactly 2 waits per think, same stream, replay bit-exact', async () => {
    const maxTicks = 1500;
    const factory = (): ReturnType<typeof createFixtureBrain> => createFixtureBrain();
    const sync = await play('sync', FIXTURE_SPEC, factory, maxTicks);
    const lc = new LaggedChannel(2);
    const sides: AiSide[] = [];
    let lagged: AsyncAiSource | null = null;
    const r = await runMatchAsync({
      map: 'setons',
      seed: 7,
      maxTicks,
      yieldFn: lc.yieldFn,
      sides: [
        {
          army: 0,
          source: (ctx) => {
            const perceiver = new ArenaPerceiver(ctx.world, 0);
            void runAiWorker(lc.worker, () => createFixtureBrain());
            lagged = new AsyncAiSource({
              port: lc.sim,
              init: {
                static: toAiStaticWire(perceiver.static, { kind: 'roster', roster: arenaRosterJson() }),
                profileName: 'normal',
                gameSeed: ctx.world.seed,
                openings: arenaOpeningsJson(),
                brainSpec: 'fixture',
                timeoutMs: NO_EMERGENCY_MS,
              },
              perceiveBytes: (t) => perceiver.bytes(t),
            });
            return lagged;
          },
        },
        {
          army: 1,
          source: (ctx) => {
            const s = createAiSide(ctx.world, { army: 1, profile: 'normal', host: 'sync', brainSpec: FIXTURE_SPEC, brainFactory: factory, timeoutMs: NO_EMERGENCY_MS });
            sides.push(s);
            return s.source;
          },
        },
      ],
    });
    // thinks of army 0 at 0, 5, …, 1495; the results of those due before 1500 (N + 3 < 1500) are awaited
    const due = Math.floor((maxTicks - 3 - 1) / 5) + 1;
    expect(r.pendingWaits).toBe(2 * due);
    expect(r.ticksWaited).toBe(due);
    expect(r.maxWaitsPerTick).toBe(2);
    expect(lagged!.results).toBeGreaterThanOrEqual(due);
    const ta = commandTrail(sync.result.log.commands, sync.result.log.endTick);
    expect(commandTrail(r.log.commands, r.log.endTick)).toEqual(ta);
    expect(r.hash).toBe(sync.result.hash);
    expect(replayMatch(r.log.setup, r.log).hash).toBe(r.hash);
    lagged!.shutdown();
  });

  it('real worker thread blocking 70 ms every 20th think: the sim waits, no command is dropped, the replay is bit-exact', async () => {
    const sync = await play('sync', FIXTURE_SPEC, () => createFixtureBrain(), 1500);
    const late = await play('worker', `${FIXTURES}#createLateBrain`, undefined, 1500);
    // 1500 ticks / 5 = 300 thinks per side, every 20th blocks 70 ms ⇒ the sim must wait
    expect(late.pendingWaits).toBeGreaterThan(0);
    expect(late.ticksWaited).toBeGreaterThanOrEqual(15);
    expectSameStream(sync, late);
    const re = replayMatch(late.result.log.setup, late.result.log);
    expect(re.hash).toBe(late.result.hash);
  });

  it('createDefaultBrain, deterministic lag of 2 waiting rounds: same stream as synchronous, replay bit-exact', async () => {
    const maxTicks = 1500;
    const factory = await loadBrainFactory(DEFAULT_BRAIN_SPEC);
    const sync = await play('sync', DEFAULT_BRAIN_SPEC, factory, maxTicks);
    const lc = new LaggedChannel(2);
    const sides: AiSide[] = [];
    let lagged: AsyncAiSource | null = null;
    try {
      const r = await runMatchAsync({
        map: 'setons',
        seed: 7,
        maxTicks,
        yieldFn: lc.yieldFn,
        sides: [
          {
            army: 0,
            source: (ctx) => {
              const perceiver = new ArenaPerceiver(ctx.world, 0);
              void runAiWorker(lc.worker, () => createDefaultBrain());
              lagged = new AsyncAiSource({
                port: lc.sim,
                init: {
                  static: toAiStaticWire(perceiver.static, { kind: 'roster', roster: arenaRosterJson() }),
                  profileName: 'normal',
                  gameSeed: ctx.world.seed,
                  openings: arenaOpeningsJson(),
                  brainSpec: DEFAULT_BRAIN_SPEC,
                  timeoutMs: NO_EMERGENCY_MS,
                },
                perceiveBytes: (t) => perceiver.bytes(t),
              });
              return lagged;
            },
          },
          {
            army: 1,
            source: (ctx) => {
              const s = createAiSide(ctx.world, { army: 1, profile: 'normal', host: 'sync', brainSpec: DEFAULT_BRAIN_SPEC, brainFactory: factory, timeoutMs: NO_EMERGENCY_MS });
              sides.push(s);
              return s.source;
            },
          },
        ],
      });
      const due = Math.floor((maxTicks - 3 - 1) / 5) + 1;
      expect(r.pendingWaits).toBe(2 * due);
      expect(r.ticksWaited).toBe(due);
      expect(sync.result.log.commands.length).toBeGreaterThan(30);
      expect(commandTrail(r.log.commands, r.log.endTick)).toEqual(commandTrail(sync.result.log.commands, sync.result.log.endTick));
      expect(r.log.commands.length).toBe(sync.result.log.commands.length);
      expect(r.hash).toBe(sync.result.hash);
      expect(replayMatch(r.log.setup, r.log).hash).toBe(r.hash);
    } finally {
      (lagged as AsyncAiSource | null)?.shutdown();
      await closeAiSides(sides);
    }
  });

  it('createDefaultBrain in a real worker thread blocking 70 ms every 20th think: waits, nothing dropped, replay bit-exact', async () => {
    const factory = await loadBrainFactory(DEFAULT_BRAIN_SPEC);
    const sync = await play('sync', DEFAULT_BRAIN_SPEC, factory, 1500);
    const late = await play('worker', `${FIXTURES}#createLateDefaultBrain`, undefined, 1500);
    expect(late.pendingWaits).toBeGreaterThan(0);
    expect(late.ticksWaited).toBeGreaterThanOrEqual(15);
    expectSameStream(sync, late);
    expect(replayMatch(late.result.log.setup, late.result.log).hash).toBe(late.result.hash);
  });
});

describe('AI-DET-04: emergency stop in the middle of a manager step', () => {
  const recallAt = (r: MatchResult, army: number, acu: number): number =>
    r.log.commands.filter((c) => c.tick === STALL_TICK + 3 && (c.env.army as number) === army && c.env.op === Op.Move && c.env.units.includes(acu as never)).length;

  it('sync host with an injected clock: aborted, aiTimeout mark, the stalled step never commits, replay bit-exact', async () => {
    stallCommits.length = 0;
    const clocks = [new ManualClock(), new ManualClock()];
    const trail = new WorldHashTrail();
    const sides: AiSide[] = [];
    const r = runMatch({
      map: 'setons',
      seed: 7,
      maxTicks: 1200,
      onTick: trail.onTick,
      sides: [0, 1].map((army) => ({
        army,
        source: (ctx) => {
          const clock = clocks[army]!;
          const s = createAiSide(ctx.world, {
            army,
            profile: 'normal',
            host: 'sync',
            brainSpec: 'fixture#stall',
            // army 0 stalls 250 ms (> 200 ms headless limit), army 1 only 150 ms (no abort)
            brainFactory: () => createFixtureBrainWithStall({ stallAt: STALL_TICK, stall: () => clock.advance(army === 0 ? 250 : 150) }),
            clock,
          });
          sides.push(s);
          return s.source;
        },
      })),
    });
    const [a, b] = sides as [AiSide, AiSide];
    expect(a.marks.map((m) => m.tick)).toEqual([STALL_TICK]);
    expect(a.marks[0]!.elapsedMs).toBe(250);
    expect(a.telemetry.filter((e) => e.kind === 'aiTimeout')).toEqual([{ kind: 'aiTimeout', tick: STALL_TICK }]);
    expect(a.stats.aborted).toBe(1);
    expect(b.marks).toEqual([]);
    // only army 1 committed its stall step; army 0's recall command was rolled back
    expect(stallCommits).toEqual([STALL_TICK]);
    const acu0 = commanderHandle(r, 0);
    const acu1 = commanderHandle(r, 1);
    expect(recallAt(r, 0, acu0)).toBe(0);
    expect(recallAt(r, 1, acu1)).toBe(1);
    // the next think runs normally again
    expect(a.stats.ticks.includes(STALL_TICK + 5)).toBe(true);
    const re = replayMatch(r.log.setup, r.log);
    expect(re.hash).toBe(r.hash);
  });

  it('worker host with the real headless limit (200 ms): aborted think reported, replay bit-exact', async () => {
    const played = await play('worker', `${FIXTURES}#createStallBrain`, undefined, 1200, {});
    for (const s of played.sides) {
      expect(s.marks.map((m) => m.tick)).toEqual([STALL_TICK]);
      expect(s.marks[0]!.elapsedMs).toBeGreaterThan(200);
      expect(s.telemetry.some((e) => e.kind === 'aiTimeout' && e.tick === STALL_TICK)).toBe(true);
    }
    const r = played.result;
    expect(recallAt(r, 0, commanderHandle(r, 0))).toBe(0);
    expect(recallAt(r, 1, commanderHandle(r, 1))).toBe(0);
    const re = replayMatch(r.log.setup, r.log);
    expect(re.hash).toBe(r.hash);
  });

  it('createDefaultBrain, sync host with an injected clock: the stalled PlatoonManager step is rolled back, replay bit-exact', async () => {
    platoonStalls.length = 0;
    const maxTicks = 3600;
    const factory = await loadBrainFactory(DEFAULT_BRAIN_SPEC);
    const undisturbed = await play('sync', DEFAULT_BRAIN_SPEC, factory, maxTicks);
    const clock = new ManualClock();
    const results: ThinkResult[] = [];
    const trail = new WorldHashTrail();
    const sides: AiSide[] = [];
    const r = runMatch({
      map: 'setons',
      seed: 7,
      maxTicks,
      onTick: trail.onTick,
      sides: [0, 1].map((army) => ({
        army,
        source: (ctx) => {
          const s = createAiSide(ctx.world, {
            army,
            profile: 'normal',
            host: 'sync',
            brainSpec: army === 0 ? 'default#platoon-stall' : DEFAULT_BRAIN_SPEC,
            brainFactory:
              army === 0
                ? () => createDefaultBrainWithPlatoonStall({ stallAfter: DEFAULT_STALL_AFTER, stall: () => clock.advance(250), onResult: (t) => results.push(t) })
                : factory,
            clock,
          });
          sides.push(s);
          return s.source;
        },
      })),
    });
    await closeAiSides(sides);
    const [a, b] = sides as [AiSide, AiSide];
    expect(platoonStalls).toHaveLength(1);
    const rec = platoonStalls[0]!;
    expect(rec.tick).toBeGreaterThanOrEqual(DEFAULT_STALL_AFTER);
    expect(rec.tick).toBeLessThan(maxTicks - 10);
    expect(rec.emitted).toBeGreaterThan(0);
    expect(rec.committed).toBe(false);
    expect(a.marks.map((m) => m.tick)).toEqual([rec.tick]);
    expect(a.marks[0]!.elapsedMs).toBe(250);
    expect(a.telemetry.filter((e) => e.kind === 'aiTimeout')).toEqual([{ kind: 'aiTimeout', tick: rec.tick }]);
    expect(a.stats.aborted).toBe(1);
    expect(b.marks).toEqual([]);
    // exactly the commands of the stalled step were rolled back; the next think runs normally
    const stalled = results.find((t) => t.tick === rec.tick)!;
    expect(stalled.aborted).toBe(true);
    expect(stalled.dropped.filter((d) => d.reason === 'aborted')).toHaveLength(rec.emitted);
    expect(results.find((t) => t.tick === rec.tick + 5)?.aborted).toBe(false);
    // up to the stalled think the stream equals the undisturbed game
    const before = (cmds: MatchResult['log']['commands']): string =>
      JSON.stringify(cmds.filter((c) => c.tick < rec.tick + 3).map((c) => [c.tick, c.env.army, c.env.op, c.env.seq, [...c.env.units]]));
    expect(before(r.log.commands)).toBe(before(undisturbed.result.log.commands));
    expect(replayMatch(r.log.setup, r.log).hash).toBe(r.hash);
  });

  it('createDefaultBrain in worker threads with the real headless limit: aborted think reported, replay bit-exact', async () => {
    const played = await play('worker', `${FIXTURES}#createDefaultStallBrain`, undefined, 3600, {});
    for (const s of played.sides) {
      expect(s.marks).toHaveLength(1);
      expect(s.marks[0]!.tick).toBeGreaterThanOrEqual(DEFAULT_STALL_AFTER);
      expect(s.marks[0]!.elapsedMs).toBeGreaterThan(200);
      expect(s.stats.aborted).toBe(1);
      expect(s.telemetry.some((e) => e.kind === 'aiTimeout' && e.tick === s.marks[0]!.tick)).toBe(true);
    }
    const r = played.result;
    expect(replayMatch(r.log.setup, r.log).hash).toBe(r.hash);
  });
});

/** Commander handle of an army as logged in its first build command (the opening's factory). */
function commanderHandle(r: MatchResult, army: number): number {
  const first = r.log.commands.find((c) => (c.env.army as number) === army && c.env.op === Op.Build);
  if (first === undefined) throw new Error(`no build command of army ${army}`);
  return first.env.units[0] as number;
}
