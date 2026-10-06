/**
 * AI host protocol (@faf/ai/host): AiStatic wire round trip, message validation, AiHost emergency
 * limit (browser 40 ms / headless 200 ms with an injected clock), in-process worker round trip over
 * a MessageChannel, and the 'pending' semantics of AsyncAiSource (AI-DET-03 unit part).
 */
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { asTick } from '@faf/fixed';
import { encodeBatch, type CommandEnvelope } from '@faf/protocol';
import { profileFor } from '@faf/ai';
import {
  AI_TIMEOUT_MS,
  AI_WORKER_PROTOCOL,
  AiHost,
  AsyncAiSource,
  ManualClock,
  fromAiStaticWire,
  parseAiFromWorkerMessage,
  parseAiToWorkerMessage,
  runAiWorker,
  toAiStaticWire,
  type AiFromWorkerMessage,
  type MessagePortLike,
} from '@faf/ai/host';
import { ArenaPerceiver, ArenaWorld } from '../../src/index.ts';
import { arenaOpeningsDoc, arenaOpeningsJson, arenaRosterJson, nodePortLike } from '../../src/host-node/index.ts';
import { createFixtureBrain, createFixtureBrainWithStall } from './fixtures/brains.ts';

function setonsWorld(seed = 7): ArenaWorld {
  return ArenaWorld.create({ map: 'setons', seed, armies: [{ army: 0, startIndex: 0 }, { army: 1, startIndex: 1 }] });
}

async function until(cond: () => boolean, maxTurns = 10_000): Promise<void> {
  for (let i = 0; i < maxTurns && !cond(); i++) await new Promise<void>((r) => setImmediate(r));
  if (!cond()) throw new Error('condition not reached');
}

describe('AiStatic wire format', () => {
  it('survives structured cloning and rebuilds the identical blueprint table', () => {
    const w = setonsWorld();
    const s = new ArenaPerceiver(w, 1).static;
    const wire = structuredClone(toAiStaticWire(s, { kind: 'roster', roster: arenaRosterJson() }));
    const back = fromAiStaticWire(wire);
    expect(back.army).toBe(1);
    expect(back.gameSeed).toBe(s.gameSeed);
    expect(back.map).toEqual(s.map);
    expect(back.spots).toEqual(s.spots);
    expect(back.starts).toEqual(s.starts);
    expect(back.armyStart).toEqual(s.armyStart);
    expect(back.activeArmies).toEqual(s.activeArmies);
    expect(back.passDim).toBe(s.passDim);
    expect(Buffer.from(back.passLowRes).equals(Buffer.from(s.passLowRes))).toBe(true);
    expect(Array.from(back.heightLowRes)).toEqual(Array.from(s.heightLowRes));
    expect(Array.from(back.components)).toEqual(Array.from(s.components));
    expect(back.sectors).toBeNull();
    expect(back.bps.list.map((b) => b.id)).toEqual(s.bps.list.map((b) => b.id));
    expect(back.bps.list.map((b) => b.threatSurface)).toEqual(s.bps.list.map((b) => b.threatSurface));
    expect(() => fromAiStaticWire({ ...wire, bps: { kind: 'bundle' } as never })).toThrow(/unknown blueprint source/);
  });
});

describe('message validation', () => {
  it('accepts well-formed and rejects malformed messages', () => {
    expect(parseAiToWorkerMessage({ type: 'perceive', tick: 5, bytes: new Uint8Array(4) })?.type).toBe('perceive');
    expect(parseAiToWorkerMessage({ type: 'perceive', tick: -1, bytes: new Uint8Array(4) })).toBeNull();
    expect(parseAiToWorkerMessage({ type: 'perceive', tick: 5, bytes: [1, 2] })).toBeNull();
    expect(parseAiToWorkerMessage({ type: 'shutdown' })).toEqual({ type: 'shutdown' });
    expect(parseAiToWorkerMessage({ type: 'init', protocol: 'x' })).toBeNull();
    const init = {
      type: 'init',
      protocol: AI_WORKER_PROTOCOL,
      static: { bps: { kind: 'roster', roster: {} } },
      profileName: 'normal',
      gameSeed: 3,
      openings: {},
      brainSpec: '@faf/ai#createDefaultBrain',
    };
    expect(parseAiToWorkerMessage(init)?.type).toBe('init');
    expect(parseAiToWorkerMessage({ ...init, profileName: 'insane' })).toBeNull();
    expect(parseAiToWorkerMessage({ ...init, env: 'mars' })).toBeNull();
    expect(parseAiToWorkerMessage({ ...init, brainSpec: '' })).toBeNull();
    expect(parseAiToWorkerMessage(null)).toBeNull();
    expect(parseAiFromWorkerMessage({ type: 'error', tick: -1, message: 'x' })?.type).toBe('error');
    expect(parseAiFromWorkerMessage({ type: 'result', tick: 1, batch: new Uint8Array(3), aborted: false, ops: 1, opsByManager: {}, telemetry: [] })?.type).toBe(
      'result',
    );
    expect(parseAiFromWorkerMessage({ type: 'result', tick: 1, batch: 'x', aborted: false })).toBeNull();
    expect(parseAiFromWorkerMessage({ type: 'ready', opening: null, managers: [] })?.type).toBe('ready');
  });
});

describe('AiHost emergency limit', () => {
  const openings = arenaOpeningsDoc();

  function hostWith(env: 'browser' | 'headless', advance: number): { host: AiHost; world: ArenaWorld; perceiver: ArenaPerceiver } {
    const world = setonsWorld();
    const perceiver = new ArenaPerceiver(world, 0);
    const clock = new ManualClock();
    const brain = createFixtureBrainWithStall({ stallAt: 0, stall: () => clock.advance(advance) });
    const host = new AiHost({ brain, static: perceiver.static, profile: profileFor('normal', openings), openings, env, clock });
    return { host, world, perceiver };
  }

  it('limits are 40 ms (browser) and 200 ms (headless)', () => {
    expect(AI_TIMEOUT_MS).toEqual({ browser: 40, headless: 200 });
    expect(hostWith('browser', 0).host.timeoutMs).toBe(40);
    expect(hostWith('headless', 0).host.timeoutMs).toBe(200);
  });

  it('a 50-ms stall aborts in the browser, not headless; the mark and telemetry carry the tick', () => {
    const b = hostWith('browser', 50);
    const rb = b.host.thinkBytes(b.perceiver.bytes(0));
    expect(rb.aborted).toBe(true);
    expect(b.host.marks).toEqual([{ kind: 'aiTimeout', tick: 0, elapsedMs: 50 }]);
    expect(rb.telemetry.map((e) => e.kind)).toEqual(['openingSelected', 'aiTimeout']);
    expect(b.host.brain.blackboard.telemetry.count('aiTimeout')).toBe(1);

    const h = hostWith('headless', 50);
    const rh = h.host.thinkBytes(h.perceiver.bytes(0));
    expect(rh.aborted).toBe(false);
    expect(h.host.marks).toEqual([]);
    expect(rh.elapsedMs).toBe(50);
    // the aborted think lost exactly the stalled step (its commander recall) and what followed
    expect(rb.commands.length).toBeLessThan(rh.commands.length);
  });

  it('refuses an initialised brain', () => {
    const w = setonsWorld();
    const p = new ArenaPerceiver(w, 0);
    const brain = createFixtureBrain();
    const opts = { brain, static: p.static, profile: profileFor('normal', openings), openings };
    new AiHost(opts);
    expect(() => new AiHost(opts)).toThrow(/already initialised/);
  });
});

describe('worker round trip (in-process MessageChannel)', () => {
  it('perceive → result equals the synchronous host; commands arrive after pending', async () => {
    const openings = arenaOpeningsDoc();
    const world = setonsWorld(11);
    const perceiver = new ArenaPerceiver(world, 0);
    const bytes0 = perceiver.bytes(0);
    // reference: synchronous host on the same bytes
    const ref = new AiHost({ brain: createFixtureBrain(), static: perceiver.static, profile: profileFor('normal', openings), openings });
    const refCmds = ref.thinkBytes(bytes0.slice()).commands;
    expect(refCmds.length).toBeGreaterThan(0);

    const ch = new MessageChannel();
    const served = runAiWorker(nodePortLike(ch.port2), () => createFixtureBrain());
    const source = new AsyncAiSource({
      port: nodePortLike(ch.port1),
      init: {
        static: toAiStaticWire(perceiver.static, { kind: 'roster', roster: arenaRosterJson() }),
        profileName: 'normal',
        gameSeed: world.seed,
        openings: arenaOpeningsJson(),
        brainSpec: 'fixture',
      },
      perceiveBytes: () => bytes0.slice(),
    });
    expect(source.thinkEvery).toBe(5);
    expect(source.lead).toBe(3);
    expect(source.commandsFor(asTick(0))).toEqual([]);
    expect(source.outstandingThinks).toEqual([0]);
    expect(source.commandsFor(asTick(1))).toEqual([]);
    expect(source.commandsFor(asTick(2))).toEqual([]);
    // tick 3 is due, the worker has not answered yet (no event-loop turn so far)
    expect(source.commandsFor(asTick(3))).toBe('pending');
    expect(source.commandsFor(asTick(3))).toBe('pending');
    expect(source.pendingCount).toBe(2);
    await until(() => source.results === 1);
    const got = source.commandsFor(asTick(3));
    expect(got).not.toBe('pending');
    expect(encodeBatch(got as CommandEnvelope[])).toEqual(encodeBatch(refCmds));
    expect(source.ready?.opening).toBe(ref.openingId);
    expect(source.ready?.managers).toEqual(['opening', 'factory', 'platoon']);
    expect(source.telemetry.map((e) => e.kind)).toContain('openingSelected');
    expect(source.outstandingThinks).toEqual([]);
    source.shutdown();
    await served;
    ch.port1.close();
    ch.port2.close();
  });

  it('a failing brain factory surfaces as an error on the next commandsFor', async () => {
    const world = setonsWorld();
    const perceiver = new ArenaPerceiver(world, 0);
    const ch = new MessageChannel();
    void runAiWorker(nodePortLike(ch.port2), () => {
      throw new Error('no such brain');
    });
    const source = new AsyncAiSource({
      port: nodePortLike(ch.port1),
      init: {
        static: toAiStaticWire(perceiver.static, { kind: 'roster', roster: arenaRosterJson() }),
        profileName: 'easy',
        gameSeed: 1,
        openings: arenaOpeningsJson(),
        brainSpec: 'missing',
      },
      perceiveBytes: (t) => perceiver.bytes(t),
    });
    expect(source.thinkEvery).toBe(10);
    await until(() => source.error !== null);
    expect(() => source.commandsFor(asTick(0))).toThrow(/no such brain/);
    ch.port1.close();
    ch.port2.close();
  });
});

describe('AsyncAiSource pending semantics (fake worker port)', () => {
  it('pending until the result of think N arrives; results out of order are matched by tick', () => {
    const posted: unknown[] = [];
    let handler: (d: unknown) => void = () => undefined;
    const port: MessagePortLike = {
      postMessage: (m) => posted.push(m),
      onMessage: (h) => {
        handler = h;
      },
    };
    const source = new AsyncAiSource({
      port,
      init: {
        static: {} as never,
        profileName: 'normal',
        gameSeed: 1,
        openings: {},
        brainSpec: 'x',
      },
      perceiveBytes: (t) => new Uint8Array([t]),
    });
    expect((posted[0] as { type: string }).type).toBe('init');
    const env = (tick: number, seq: number): CommandEnvelope => ({
      tick: asTick(tick),
      army: 0 as CommandEnvelope['army'],
      seq,
      op: 1 as CommandEnvelope['op'],
      flags: 0,
      units: [],
      payload: new Uint8Array([seq]),
    });
    const result = (tick: number, cmds: CommandEnvelope[], aborted = false): AiFromWorkerMessage => ({
      type: 'result',
      tick,
      batch: encodeBatch(cmds),
      aborted,
      ops: 10,
      ingestOps: 1,
      opsByManager: {},
      dropped: 0,
      ms: 1,
      telemetry: aborted ? [{ kind: 'aiTimeout', tick }] : [],
    });
    for (let t = 0; t < 3; t++) expect(source.commandsFor(asTick(t))).toEqual([]);
    expect(source.commandsFor(asTick(3))).toBe('pending');
    handler(result(0, [env(3, 1)]));
    const at3 = source.commandsFor(asTick(3));
    expect(at3).not.toBe('pending');
    expect((at3 as CommandEnvelope[]).map((e) => e.seq)).toEqual([1]);
    expect(source.commandsFor(asTick(4))).toEqual([]);
    expect(source.commandsFor(asTick(5))).toEqual([]); // think 5 requested
    expect(source.commandsFor(asTick(6))).toEqual([]);
    expect(source.commandsFor(asTick(7))).toEqual([]);
    expect(source.commandsFor(asTick(8))).toBe('pending');
    handler(result(5, [env(8, 2), env(8, 3)], true));
    expect((source.commandsFor(asTick(8)) as CommandEnvelope[]).map((e) => e.seq)).toEqual([2, 3]);
    expect(source.marks).toEqual([{ kind: 'aiTimeout', tick: 5, elapsedMs: 1 }]);
    expect(source.telemetry).toEqual([{ kind: 'aiTimeout', tick: 5 }]);
    const perceives = posted.filter((m) => (m as { type: string }).type === 'perceive') as { tick: number; bytes: Uint8Array }[];
    expect(perceives.map((m) => m.tick)).toEqual([0, 5]);
    expect(Array.from(perceives[1]!.bytes)).toEqual([5]);
    // a result for a think that was never requested is a protocol error
    handler(result(40, []));
    expect(() => source.commandsFor(asTick(9))).toThrow(/not requested/);
  });
});
