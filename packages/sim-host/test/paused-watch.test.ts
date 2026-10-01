import { decodeSimBin } from '@faf/blueprints/simbin';
import { asArmyId, asTick, type Handle } from '@faf/fixed';
import { encodeFactoryQueue, FrameReader, Op, type CommandEnvelope } from '@faf/protocol';
import { fullHash, ruleHash } from '@faf/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { bufferOf, gameSimBin, spawnCmd } from './support/fixtures.ts';
import { makeTestHost, nextFrame, type TestHost } from './support/host.ts';

const open: TestHost[] = [];
afterEach(() => { for (const h of open) h.close(); open.length = 0; });
async function read(h: TestHost): Promise<FrameReader> {
  const r = new FrameReader(); expect(r.reset(await nextFrame(h.consumer))).toBe(true); return r;
}
async function fixture(transport: 'sab' | 'transfer') {
  const bp = decodeSimBin(gameSimBin()), factory = bp.indexOf('core:fac_land_t1');
  const h = makeTestHost({ transport, autoStart: false,
    initialization: { kind: 'skirmish', faction: 0, rules: { unitCap: 30, fog: 'revealed', victory: 'annihilation' } } });
  open.push(h); await read(h);
  h.host.submit(bufferOf([spawnCmd(0, 2, 24, 24, 12, 1, 0, factory), spawnCmd(1, 1, 70, 70, 0, 1, 1, factory)]));
  expect(h.host.runTicks(1)).toBe(1); await read(h);
  const w = h.host.core.world, own: Handle[] = [], foreign: Handle[] = [];
  for (let u = 0; u < w.units.highWater; u++) {
    if (!w.units.isLive(u) || w.units.col.bp[u] !== factory) continue;
    (w.units.col.army[u] === 0 ? own : foreign).push(w.units.handle(u) as Handle);
  }
  expect(own).toHaveLength(2); expect(foreign).toHaveLength(1);
  const queue = (handle: Handle, army: number, type: number, count: number, seq: number): CommandEnvelope => ({
    tick: asTick(0), army: asArmyId(army), seq, op: Op.FactoryQueue, flags: 0, units: [handle],
    payload: encodeFactoryQueue({ bp: type, count }),
  });
  h.host.submit(bufferOf([queue(own[0]!, 0, bp.indexOf('core:eng_t1'), 3, 2),
    queue(own[1]!, 0, bp.indexOf('core:lnd_t1_tank'), 2, 3),
    queue(foreign[0]!, 1, bp.indexOf('core:eng_t1'), 4, 2)]));
  expect(h.host.runTicks(8)).toBe(8); await read(h);
  return { h, w, bp, own, foreign };
}

describe('live paused watch refresh', () => {
  it.each(['sab', 'transfer'] as const)('%s publishes actual factory details at the same paused tick and refreshes private selection/clear', async transport => {
    const { h, w, bp, own, foreign } = await fixture(transport);
    h.host.ctl({ t: 'pause' });
    const paused = await read(h), tick = paused.tick, hashes = [fullHash(w), ruleHash(w)];
    expect(paused.paused).toBe(true); expect(paused.watchCount).toBe(0);
    h.host.handleMessage({ t: 'watch', handles: [own[0]!, foreign[0]!] });
    const selected = await read(h), site = w.units.resolve(selected.watchBuildTarget(0));
    expect(selected.tick).toBe(tick); expect(selected.seq).toBeGreaterThan(paused.seq);
    expect(selected.paused).toBe(true); expect(selected.watchCount).toBe(1); expect(selected.watchHandle(0)).toBe(own[0]);
    expect(selected.watchFactoryQueueCount(0)).toBe(3); expect(selected.watchFactoryBp(0)).toBe(bp.indexOf('core:eng_t1'));
    expect(site).toBeGreaterThanOrEqual(0); expect(selected.watchFactoryProgress(0)).toBe(w.units.col.buildDone.get(site));
    expect(Array.from({ length: selected.unitCount }, (_, i) => selected.unitHandle(i))).toContain(foreign[0]);
    expect([fullHash(w), ruleHash(w)]).toEqual(hashes); expect(h.host.core.tick).toBe(tick);

    h.host.handleMessage({ t: 'watch', handles: [own[1]!] });
    const replaced = await read(h);
    expect(replaced.tick).toBe(tick); expect(replaced.seq).toBeGreaterThan(selected.seq);
    expect(replaced.watchCount).toBe(1); expect(replaced.watchHandle(0)).toBe(own[1]);
    expect(replaced.watchFactoryQueueCount(0)).toBe(2); expect(replaced.watchFactoryBp(0)).toBe(bp.indexOf('core:lnd_t1_tank'));
    h.host.handleMessage({ t: 'watch', handles: [foreign[0]!] });
    const privateOnly = await read(h); expect(privateOnly.watchCount).toBe(0); expect(privateOnly.tick).toBe(tick);
    h.host.handleMessage({ t: 'watch', handles: [] });
    const cleared = await read(h); expect(cleared.watchCount).toBe(0); expect(cleared.tick).toBe(tick);
    expect(cleared.seq).toBeGreaterThan(privateOnly.seq); expect(h.host.watched).toEqual([]);
    h.wake.advance(1000);
    expect(h.host.core.tick).toBe(tick); expect([fullHash(w), ruleHash(w)]).toEqual(hashes);
  });

  it('coalesces running watch interest until the next actual tick', async () => {
    const { h, w, own } = await fixture('sab'), tick = h.host.core.tick;
    const written = h.host.framesWritten, hashes = [fullHash(w), ruleHash(w)];
    expect(h.host.paused).toBe(false);
    h.host.handleMessage({ t: 'watch', handles: [own[0]!] });
    h.host.handleMessage({ t: 'watch', handles: [own[1]!] });
    expect(h.host.framesWritten).toBe(written); expect(h.consumer.poll()).toBeNull();
    expect(h.host.core.tick).toBe(tick); expect([fullHash(w), ruleHash(w)]).toEqual(hashes);
    expect(h.host.runTicks(1)).toBe(1);
    const r = await read(h); expect(r.tick).toBe(tick + 1); expect(r.seq).toBeGreaterThan(written);
    expect(r.watchCount).toBe(1); expect(r.watchHandle(0)).toBe(own[1]);
  });
});
