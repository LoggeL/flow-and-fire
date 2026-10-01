import { describe, expect, it } from 'vitest';
import { createSabConsumer, createSabFrameBuffer, DEFAULT_FRAME_CAPS, encodeFactoryQueue, encodeTogglePause, frameCapacityBytes, FrameReader, MAX_WATCH, Op, type CommandEnvelope, type PortLike } from '@faf/protocol';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { asArmyId, asTick, type Handle } from '@faf/fixed';
import { readRtsReplay, writeRtsReplay } from '@faf/formats';
import { BrowserReplayHost, convertCommandLog, HeadlessSim, ReplayPlayer } from '../src/index.ts';
import { gameSimBin, spawnCmd } from './support/fixtures.ts';

class Port implements PortLike {
  messages: unknown[] = [];
  listeners = new Set<(event: object) => void>();
  postMessage(message: unknown): void { this.messages.push(structuredClone(message)); }
  addEventListener(_type: 'message', cb: (event: object) => void): void { this.listeners.add(cb); }
  removeEventListener(_type: 'message', cb: (event: object) => void): void { this.listeners.delete(cb); }
}
function setup(seed = 7, armyCount = 4) {
  const simBin = gameSimBin(), original = new HeadlessSim({ simBin, seed, armyCount, buildHash: 'browser-build', keyframes: false });
  original.submit([spawnCmd(3, 12, 250, 250, 5, 1)]); original.step(220);
  const replay = convertCommandLog(original.exportLog(), { simBin });
  let now = 0;
  const port = new Port(), host = new BrowserReplayHost({ port, autoStart: false, now: () => now });
  const capacity = frameCapacityBytes(DEFAULT_FRAME_CAPS), sab = createSabFrameBuffer(capacity), consumer = createSabConsumer(sab);
  const init = { t: 'init', simBin: simBin.slice().buffer, seed: 1, armyCount: 2, playerArmy: 0,
    transport: 'sab', frameSab: sab, frameCapacity: capacity, buildHash: 'browser-build' };
  host.handleMessage({ t: 'replay-load', bytes: replay.bytes.slice().buffer }); host.handleMessage(init);
  return { host, port, original, replay, simBin, consumer, init, advance: (ms: number) => { now += ms; host.pump(); } };
}
describe('browser replay host', () => {
  it('uses recorded setup and publishes real simulation frames through the game transport', () => {
    const s = setup();
    expect(s.host.player!.world.seed).toBe(7); expect(s.host.player!.world.armyCount).toBe(4);
    const frame = s.consumer.poll()!; const reader = new FrameReader(); expect(reader.reset(frame)).toBe(true); expect(reader.tick).toBe(0);
    s.host.handleMessage({ t: 'resume' }); s.advance(200);
    reader.reset(s.consumer.poll()!); expect(reader.tick).toBe(2);
    s.host.handleMessage({ t: 'pause' }); s.advance(1000); expect(s.host.player!.tick).toBe(2);
    s.host.handleMessage({ t: 'speed', speed: 5 }); s.host.handleMessage({ t: 'resume' }); s.advance(1000);
    expect(s.host.player!.tick).toBe(52);
    s.host.handleMessage({ t: 'replay-seek', tick: 220 }); expect(s.host.player!.fullHash()).toBe(s.original.fullHash());
    const independent = ReplayPlayer.open(s.replay.bytes, { simBin: s.simBin, keyframes: false }); independent.runUntil(37);
    s.host.handleMessage({ t: 'replay-seek', tick: 37 }); expect(s.host.player!.fullHash()).toBe(independent.fullHash());
    s.host.handleMessage({ t: 'viewer', army: 3 }); reader.reset(s.consumer.poll()!); expect(reader.viewer).toBe(3);
    expect(s.host.player!.result().divergences).toEqual([]);
    s.host.dispose(); s.consumer.close(); expect(s.port.listeners.size).toBe(0);
  });
  it('rejects live commands, invalid speed and missing historical build without advancing', () => {
    const s = setup();
    s.host.handleMessage({ t: 'cmd', batch: new ArrayBuffer(0) }); s.host.handleMessage({ t: 'speed', speed: 100 });
    expect(s.host.player!.tick).toBe(0); expect(s.port.messages.filter((m) => (m as { t: string }).t === 'error')).toHaveLength(2);
    s.host.dispose(); s.consumer.close();
    const port = new Port(), host = new BrowserReplayHost({ port, autoStart: false });
    host.handleMessage({ t: 'replay-load', bytes: s.replay.bytes.slice().buffer }); host.handleMessage({ ...s.init, buildHash: 'different' });
    expect(host.player).toBeNull(); expect(port.messages).toEqual([expect.objectContaining({ t: 'error', replayBuild: 'browser-build', replayRoute: '/b/browser-build/' })]);
    host.dispose();
  });
  it('reports recorded hash divergences and rechecks them after rewind without double-counting rows', () => {
    const s = setup(), hashes = s.replay.input.hashes.hashes.slice(); hashes[4]! ^= 1;
    const bytes = writeRtsReplay({ ...s.replay.input, hashes: { ...s.replay.input.hashes, hashes } });
    const player = ReplayPlayer.open(readRtsReplay(bytes), { simBin: s.simBin }); player.playToEnd();
    expect(player.result().divergences.map((d) => d.tick)).toContain(50);
    const compared = player.result().compared; player.seek(10); player.runUntil(220);
    expect(player.result().compared).toBe(compared); expect(player.result().divergences.filter((d) => d.tick === 50)).toHaveLength(1);
    s.host.dispose(); s.consumer.close();
  });

  it('inspects actual recorded factory controls per perspective while paused and across replay seek', () => {
    const simBin = gameSimBin(), bp = decodeSimBin(simBin), factoryBp = bp.indexOf('core:fac_land_t1');
    const original = new HeadlessSim({ simBin, seed: 31, armyCount: 2, mapSizeWu: 64, buildHash: 'inspection-build', keyframes: false,
      initialization: { kind: 'skirmish', faction: 0, rules: { unitCap: 30, fog: 'revealed', victory: 'annihilation' } } });
    original.submit([spawnCmd(0, 1, 14, 12, 0, 1, 0, factoryBp), spawnCmd(1, 1, 44, 42, 0, 1, 1, factoryBp)]); original.step();
    const factories = [0, 1].map(army => {
      for (let u = 0; u < original.world.units.highWater; u++) if (original.world.units.col.bp[u] === factoryBp && original.world.units.col.army[u] === army) return original.world.units.handle(u);
      throw new Error('Missing recorded factory');
    });
    const command = (army: number, op: Op, payload: Uint8Array, seq: number): CommandEnvelope => ({ tick: asTick(0), army: asArmyId(army), seq, op, flags: 0, units: [factories[army]! as Handle], payload });
    original.submit([command(0, Op.FactoryQueue, encodeFactoryQueue({ bp: bp.indexOf('core:eng_t1'), count: 3 }), 2),
      command(1, Op.FactoryQueue, encodeFactoryQueue({ bp: bp.indexOf('core:lnd_t1_tank'), count: 2 }), 2)]); original.step(8);
    original.submit([command(0, Op.TogglePause, encodeTogglePause(true), 3)]); original.step(5);
    const replay = convertCommandLog(original.exportLog(), { simBin });
    const port = new Port(), host = new BrowserReplayHost({ port, autoStart: false });
    const capacity = frameCapacityBytes(DEFAULT_FRAME_CAPS), sab = createSabFrameBuffer(capacity), consumer = createSabConsumer(sab);
    const read = () => { const reader = new FrameReader(); expect(reader.reset(consumer.poll()!)).toBe(true); return reader; };
    host.handleMessage({ t: 'replay-load', bytes: replay.bytes.slice().buffer });
    host.handleMessage({ t: 'init', simBin: simBin.slice().buffer, seed: 1, armyCount: 2, playerArmy: 0,
      transport: 'sab', frameSab: sab, frameCapacity: capacity, buildHash: 'inspection-build' });
    host.handleMessage({ t: 'replay-seek', tick: 12 }); host.handleMessage({ t: 'viewer', army: 0 });
    expect(read().watchCount).toBe(0);
    const before = host.player!.fullHash();
    host.handleMessage({ t: 'watch', handles: factories });
    const own = read(), site = host.player!.world.units.resolve(own.watchBuildTarget(0));
    expect(own.tick).toBe(12); expect(own.watchCount).toBe(1); expect(own.watchHandle(0)).toBe(factories[0]);
    expect(own.watchFactoryQueueCount(0)).toBe(3); expect(own.watchFactoryBp(0)).toBe(bp.indexOf('core:eng_t1'));
    expect(own.watchPaused(0)).toBe(true); expect(own.watchFactoryProgress(0)).toBe(host.player!.world.units.col.buildDone.get(site));
    expect(host.player!.fullHash()).toBe(before);

    host.handleMessage({ t: 'viewer', army: 1 }); expect(read().watchCount).toBe(0);
    host.handleMessage({ t: 'watch', handles: factories }); const other = read();
    expect(other.watchCount).toBe(1); expect(other.watchHandle(0)).toBe(factories[1]);
    expect(other.watchFactoryBp(0)).toBe(bp.indexOf('core:lnd_t1_tank')); expect(other.watchFactoryQueueCount(0)).toBe(2);
    host.handleMessage({ t: 'viewer', army: -1 }); expect(read().watchCount).toBe(0);
    host.handleMessage({ t: 'watch', handles: factories }); expect(read().watchCount).toBe(2);
    host.handleMessage({ t: 'replay-seek', tick: 0 }); expect(read().watchCount).toBe(0);
    host.handleMessage({ t: 'replay-seek', tick: 12 }); expect(read().watchCount).toBe(2);
    expect(host.player!.fullHash()).toBe(before); expect(host.player!.result().divergences).toEqual([]);

    // Protocol shape, unsigned handles and MAX_WATCH are validated before changing the list.
    for (const handles of [null, 'invalid', [-1], [0.5], [0x100000000], [NaN], new Array(MAX_WATCH + 1).fill(factories[0])])
      host.handleMessage({ t: 'watch', handles });
    expect(port.messages.filter(message => (message as { t: string }).t === 'error')).toHaveLength(7);
    host.handleMessage({ t: 'watch', handles: new Array(MAX_WATCH).fill(factories[0]) }); expect(read().watchCount).toBe(1);
    host.handleMessage({ t: 'cmd', batch: new ArrayBuffer(0) }); host.handleMessage({ t: 'devReload', simBin: simBin.slice().buffer });
    expect(port.messages.filter(message => (message as { t: string }).t === 'error')).toHaveLength(9);
    expect(host.player!.tick).toBe(12); expect(host.player!.fullHash()).toBe(before);
    host.dispose(); consumer.close();
  });
});
