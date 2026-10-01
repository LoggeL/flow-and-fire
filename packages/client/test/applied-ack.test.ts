import { describe, expect, it } from 'vitest';
import { GameClient } from '../src/client.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget } from './support/fakes.ts';

function setup() {
  const clock = new Clock(1000), link = new FakeSimLink({ units: 1, enemyUnits: 0 }), renderer = new FakeRenderer();
  const client = new GameClient({ canvas: new FakeCanvas(1280, 720), renderer, link, visuals: [{ spec: { hull: 'box', size: [1, 1, 1] } }], playerArmy: 0, keyTarget: new FakeTarget(), now: clock.now, focusProbe: () => null });
  client.frame(clock.t);
  return { client, clock, link, renderer };
}

describe('applied command ACK arrival independent of presentation', () => {
  it('confirms a committed sequence immediately without advancing the frame or waiting for RAF', () => {
    const { client, clock, link, renderer } = setup();
    client.setFrameCap(30);
    const seq = client.moveTo(220 * 4096, 220 * 4096, [0]);
    clock.advance(62); link.advance(100);
    const tick = client.lastFrame!.tick, renders = renderer.calls;
    link.emitHost({ t: 'ack', army: 0, tick: link.tick, ackSeq: link.ackSeq });
    expect(link.ackSeq).toBe(seq); expect(client.commands.isPending(seq)).toBe(false);
    expect(client.lastFrame!.tick).toBe(tick); expect(renderer.calls).toBe(renders);
    expect(client.metrics.snapshot().clickToAckMs).toMatchObject({ count: 1, p95: 62 });
    clock.advance(1); client.frame(clock.t);
    expect(client.metrics.snapshot().clickToAckMs.count).toBe(1);
    client.dispose();
  });

  it('ignores other armies, observer sentinels and regressing snapshots', () => {
    const { client, clock, link } = setup();
    const first = client.moveTo(220 * 4096, 220 * 4096, [0]);
    link.emitHost({ t: 'ack', army: 1, tick: 1, ackSeq: first });
    expect(client.commands.isPending(first)).toBe(true);
    link.emitHost({ t: 'ack', army: 0, tick: 1, ackSeq: 0xffffffff });
    expect(client.commands.isPending(first)).toBe(true);
    clock.advance(50); link.advance(100);
    link.emitHost({ t: 'ack', army: 0, tick: link.tick, ackSeq: first });
    const second = client.moveTo(230 * 4096, 230 * 4096, [0]);
    clock.advance(50); link.advance(100);
    link.emitHost({ t: 'ack', army: 0, tick: link.tick, ackSeq: second });
    link.emitHost({ t: 'ack', army: 0, tick: 1, ackSeq: first });
    expect(client.commands.lastAckSeq).toBe(second);
    expect(client.metrics.snapshot().clickToAckMs.count).toBe(2);
    client.dispose();
  });

  it('accepts serial wrap and retains frame fallback for hosts without notifications', () => {
    const { client, link } = setup();
    link.emitHost({ t: 'ack', army: 0, tick: 1, ackSeq: 65535 });
    link.emitHost({ t: 'ack', army: 0, tick: 2, ackSeq: 1 });
    link.emitHost({ t: 'ack', army: 0, tick: 1, ackSeq: 65535 });
    expect(client.commands.lastAckSeq).toBe(1);
    client.dispose();
    const fallback = setup();
    const seq = fallback.client.moveTo(220 * 4096, 220 * 4096, [0]);
    fallback.link.advance(100); fallback.clock.advance(100); fallback.client.frame(fallback.clock.t);
    expect(fallback.client.commands.isPending(seq)).toBe(false);
    expect(fallback.client.metrics.snapshot().clickToAckMs.count).toBe(1);
    fallback.client.dispose();
  });

  it('does not regress when a previously published frame is polled after the newer commit ACK', () => {
    const { client, clock, link } = setup();
    const first = client.moveTo(220 * 4096, 220 * 4096, [0]);
    link.advance(100);
    const older = new Uint8Array(link.frames.poll()!);
    const second = client.moveTo(230 * 4096, 230 * 4096, [0]);
    link.advance(100); clock.advance(100);
    link.emitHost({ t: 'ack', army: 0, tick: link.tick, ackSeq: link.ackSeq });
    link.frames.deliver(older, 100);
    client.frame(clock.t);
    expect(client.lastFrame!.ackSeq).toBe(first);
    expect(client.commands.lastAckSeq).toBe(second);
    expect(client.metrics.snapshot().clickToAckMs.count).toBe(2);
    client.dispose();
  });
});
