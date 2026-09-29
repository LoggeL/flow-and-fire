/**
 * Worker entry against a Node MessageChannel standing in for the worker scope (real clock,
 * MessageChannel self-ping scheduler, transfer transport — the path used without COOP/COEP).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTransferConsumer, DEFAULT_FRAME_CAPS, FrameReader, frameCapacityBytes, messageData, type HostMessage } from '@faf/protocol';
import { MarkKind, parseCommandLog, startSimWorker, type HostStatusMsg, type SimHost } from '../src/index.ts';
import { bufferOf, gameSimBinBuffer, spawnCmd } from './support/fixtures.ts';

const CAP = frameCapacityBytes(DEFAULT_FRAME_CAPS);
let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

async function until<T>(get: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (performance.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('startSimWorker', () => {
  it('init → ready → frames; cmd/ctl/exportLog over the port; errors as messages', async () => {
    const ch = new MessageChannel();
    let host: SimHost | null = null;
    cleanup.push(() => {
      host?.dispose();
      ch.port1.close();
      ch.port2.close();
    });
    host = startSimWorker(ch.port1, { opfs: null });
    const main = ch.port2;
    const msgs: HostMessage[] = [];
    main.addEventListener('message', (ev) => {
      const d = messageData(ev) as HostMessage | { t: 'frame' };
      if (d.t !== 'frame') msgs.push(d as HostMessage);
    });
    const consumer = createTransferConsumer(main, CAP);
    cleanup.push(() => consumer.close());
    const simBin = gameSimBinBuffer();
    main.postMessage({ t: 'init', simBin, seed: 5, armyCount: 2, playerArmy: 0, transport: 'transfer', frameCapacity: CAP, buildHash: 'wt' }, [simBin]);
    const ready = await until(() => msgs.find((m) => m.t === 'ready'));
    expect(ready.t === 'ready' && ready.transport).toBe('transfer');
    main.postMessage({ t: 'speed', speed: 3 });
    const batch = bufferOf([spawnCmd(0, 10, 100, 100, 5, 1)]);
    main.postMessage({ t: 'cmd', batch }, [batch]);
    const reader = new FrameReader();
    await until(() => {
      const f = consumer.poll();
      return f !== null && reader.reset(f) && reader.unitCount === 10 ? true : undefined;
    });
    expect(reader.ackSeq).toBe(1);
    const tickBefore = reader.tick;
    await until(() => {
      const f = consumer.poll();
      return f !== null && reader.reset(f) && reader.tick >= tickBefore + 3 ? true : undefined;
    });
    main.postMessage({ t: 'pause' });
    const st = (await until(() => msgs.find((m) => m.t === 'status' && m.paused))) as HostStatusMsg;
    expect(st.speed).toBe(3);
    main.postMessage({ t: 'exportLog' });
    const log = await until(() => msgs.find((m) => m.t === 'log'));
    const parsed = parseCommandLog(log.t === 'log' ? log.bytes : new ArrayBuffer(0));
    expect(parsed.commands).toHaveLength(1);
    expect(parsed.marks.map((m) => m.kind)).toEqual([MarkKind.Speed, MarkKind.Cheat, MarkKind.Pause]);
    main.postMessage({ t: 'nonsense' });
    const err = await until(() => msgs.find((m) => m.t === 'error'));
    expect(err.t === 'error' && err.message).toMatch(/invalid message/);
    expect(host.tick).toBe(parsed.lastTick);
  });
});
