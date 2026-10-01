import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayLibrary } from '../src/replay/library.ts';
import { ReplayController } from '../src/replay/controller.ts';
import type { WorkerLike } from '../src/worker-link.ts';

class WorkerStub implements WorkerLike {
  readonly messages: unknown[] = [];
  readonly events = new Map<string, Set<(event: object) => void>>();
  terminated = false;
  postMessage(message: unknown, transfer: Transferable[] = []): void { this.messages.push(structuredClone(message, { transfer })); }
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: object) => void): void {
    const group = this.events.get(type) ?? new Set(); group.add(listener); this.events.set(type, group);
  }
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: object) => void): void { this.events.get(type)?.delete(listener); }
  terminate(): void { this.terminated = true; }
  emit(type: string, data: unknown): void { for (const listener of this.events.get(type) ?? []) listener({ data }); }
}
afterEach(() => vi.useRealTimers());
describe('replay browser clients', () => {
  it('copies transferred assets and rejects pending work on disposal without detaching caller data', async () => {
    const worker = new WorkerStub(), library = new ReplayLibrary(worker);
    const bytes = Uint8Array.of(1, 2, 3).buffer, simBin = Uint8Array.of(4, 5).buffer, map = Uint8Array.of(6, 7);
    const task = library.convert(bytes, { simBin, map });
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]); expect([...new Uint8Array(simBin)]).toEqual([4, 5]); expect([...map]).toEqual([6, 7]);
    const rejected = expect(task).rejects.toThrow('closed'); library.dispose(); await rejected;
    expect(worker.terminated).toBe(true); expect([...worker.events.values()].every((group) => group.size === 0)).toBe(true);
    await expect(library.list()).rejects.toThrow('closed');
  });
  it('matches out-of-order replies and handles storage errors without swallowing them', async () => {
    const worker = new WorkerStub(), library = new ReplayLibrary(worker);
    const first = library.list(), second = library.list();
    const requests = worker.messages as { id: number }[];
    worker.emit('message', { t: 'replay-task-result', id: requests[1]!.id, value: [] }); expect(await second).toEqual([]);
    const rejected = expect(first).rejects.toThrow('SecurityError');
    worker.emit('message', { t: 'replay-task-result', id: requests[0]!.id, error: 'SecurityError' }); await rejected; library.dispose();
  });
  it('surfaces compatibility failures and leaves game-owned worker termination to the game', () => {
    const worker = new WorkerStub(), controller = new ReplayController(worker, Uint8Array.of(82, 84, 83, 82));
    controller.seek(100); expect(controller.seeking.value).toBe(true);
    worker.emit('message', { t: 'error', message: 'Old build', replayBuild: 'old', replayRoute: '/b/old/' });
    expect(controller.failure.value).toEqual({ message: 'Old build', buildHash: 'old', route: '/b/old/' }); expect(controller.seeking.value).toBe(false);
    controller.dispose(); expect(worker.terminated).toBe(false); expect([...worker.events.values()].every((group) => group.size === 0)).toBe(true);
  });
});
