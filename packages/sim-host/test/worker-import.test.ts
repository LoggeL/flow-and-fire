import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FRAME_CAPS, frameCapacityBytes } from '@faf/protocol';
import { gameSimBinBuffer } from './support/fixtures.ts';

type Listener = (event: object) => void;
type Reply = { t: string; [key: string]: unknown };

/** Isolated dedicated-worker globals, with the real host and protocol implementation. */
const listeners = new Map<string, Set<Listener>>();
const replies: Reply[] = [];

function dispatch(data: unknown): void {
  for (const listener of [...(listeners.get('message') ?? [])]) listener({ data });
}

beforeEach(() => {
  vi.resetModules();
  listeners.clear();
  replies.length = 0;
  vi.stubGlobal('WorkerGlobalScope', class WorkerGlobalScope {});
  vi.stubGlobal('DedicatedWorkerGlobalScope', class DedicatedWorkerGlobalScope {});
  vi.stubGlobal('addEventListener', (type: string, listener: Listener) => {
    let set = listeners.get(type);
    if (set === undefined) listeners.set(type, set = new Set());
    set.add(listener);
  });
  vi.stubGlobal('removeEventListener', (type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  });
  vi.stubGlobal('postMessage', (message: Reply) => replies.push(message));
});

afterEach(() => {
  // A real initialized host must stop its scheduler/transport even if an assertion failed.
  dispatch({ t: 'shutdown' });
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('worker import boundary', () => {
  it('public barrel import leaves a replay worker free of normal SimHost listeners', async () => {
    const api = await import('../src/index.ts');
    expect(typeof api.startSimWorker).toBe('function');
    expect(typeof api.BrowserReplayHost).toBe('function');
    expect([...listeners.values()].reduce((count, set) => count + set.size, 0)).toBe(0);

    dispatch({ t: 'replay-inspect', requestId: 1 });
    expect(replies).toEqual([]);
  });

  it('explicit dedicated entry starts the normal host and processes init/shutdown', async () => {
    const entry = await import('../src/worker.ts');
    expect(typeof entry.startSimWorker).toBe('function');
    expect(listeners.get('message')?.size).toBe(1);
    expect(listeners.get('error')?.size).toBe(1);
    expect(listeners.get('unhandledrejection')?.size).toBe(1);

    dispatch({
      t: 'init', simBin: gameSimBinBuffer(), seed: 5, armyCount: 2, playerArmy: 0,
      transport: 'transfer', frameCapacity: frameCapacityBytes(DEFAULT_FRAME_CAPS),
      buildHash: 'worker-import', startPaused: true, persistentRecording: false,
    });
    expect(replies.find(reply => reply.t === 'ready')).toMatchObject({ transport: 'transfer', tick: 0 });
    expect(replies.some(reply => reply.t === 'frame')).toBe(true);
    expect(replies.find(reply => reply.t === 'status')).toMatchObject({ paused: true });
    expect(replies.filter(reply => reply.t === 'error')).toEqual([]);

    dispatch({ t: 'shutdown' });
    expect(replies.some(reply => reply.t === 'closed')).toBe(true);
    expect(listeners.get('message')?.size).toBe(0);
  });
});
