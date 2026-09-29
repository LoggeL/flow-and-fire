import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { PortLike } from '../src/index.ts';

// Compile-time checks: browser and Node ports satisfy PortLike structurally (no casts needed).
export function acceptsBrowserPort(p: MessagePort): PortLike {
  return p;
}
export function acceptsBrowserWorker(w: Worker): PortLike {
  return w;
}
export function acceptsNodePort(p: NodeMessagePort): PortLike {
  return p;
}

describe('PortLike', () => {
  it('is structurally satisfied by browser and Node ports (checked by tsc)', () => {
    expect(typeof acceptsBrowserPort).toBe('function');
  });
});
