/**
 * Worker side of the AI host (PLAN §3.10 "AI-Worker"): `runAiWorker(port, brainFactory)` serves the
 * protocol of `protocol.ts` on any message port — a browser DedicatedWorkerGlobalScope or
 * MessagePort (MS9), a Node worker_threads parentPort (tools/ai-arena host-node), or an in-process
 * MessageChannel (tests, sim-worker fallback with ≤ 2 cores).
 *
 * Messages are handled strictly in arrival order (a promise chain): perceive messages that arrive
 * while the brain factory is still loading wait for init. Every perceive gets exactly one result.
 */
import { encodeBatch } from '@faf/protocol';
import type { AiBrain } from '../brain.ts';
import { parseOpenings } from '../openings.ts';
import { profileFor } from '../profile.ts';
import { AiHost } from './ai-host.ts';
import type { AiClock } from './clock.ts';
import {
  fromAiStaticWire,
  parseAiToWorkerMessage,
  type AiErrorMessage,
  type AiFromWorkerMessage,
  type AiInitMessage,
  type AiReadyMessage,
  type AiResultMessage,
} from './protocol.ts';

/**
 * Minimal message port: `postMessage` with an optional transfer list and a single message handler
 * that receives the message DATA. Adapters: `eventTargetPort` (DOM-style), and the Node adapter in
 * tools/ai-arena (`nodePortLike`).
 */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  onMessage(handler: (data: unknown) => void): void;
}

/** DOM-style port shape (Worker, MessagePort, DedicatedWorkerGlobalScope) without DOM typings. */
export interface EventTargetPort {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (ev: { readonly data: unknown }) => void): void;
  /** MessagePort needs start() when used with addEventListener. */
  start?(): void;
}

/** Wraps a DOM-style port (browser AI worker, MS9). */
export function eventTargetPort(p: EventTargetPort): MessagePortLike {
  return {
    postMessage: (m, t) => (t === undefined ? p.postMessage(m) : p.postMessage(m, t)),
    onMessage: (h) => {
      p.addEventListener('message', (ev) => h(ev.data));
      p.start?.();
    },
  };
}

/** Creates the brain for a brain specifier ('module#export'); may load code asynchronously. */
export type BrainFactory = (spec: string) => AiBrain | Promise<AiBrain>;

export interface RunAiWorkerOptions {
  /** Clock of the emergency stop (default: performance.now). */
  readonly clock?: AiClock;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** A copy of `bytes` with its own buffer (safe to transfer). */
function ownBuffer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/**
 * Serves the AI worker protocol on `port`. Returns a promise that resolves after a `shutdown`
 * message has been handled (the caller may then close the port / end the worker).
 */
export function runAiWorker(port: MessagePortLike, brainFactory: BrainFactory, opts: RunAiWorkerOptions = {}): Promise<void> {
  let host: AiHost | null = null;
  let failed = false;
  let chain: Promise<void> = Promise.resolve();
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });
  const send = (m: AiFromWorkerMessage, transfer?: ArrayBuffer[]): void => {
    if (transfer === undefined) port.postMessage(m);
    else port.postMessage(m, transfer);
  };
  const fail = (tick: number, e: unknown): void => {
    failed = true;
    const msg: AiErrorMessage = { type: 'error', tick, message: errorText(e) };
    send(msg);
  };

  const init = async (m: AiInitMessage): Promise<void> => {
    if (host !== null) throw new Error('AI worker: init received twice');
    const openings = parseOpenings(m.openings);
    const profile = profileFor(m.profileName, openings);
    const brain = await brainFactory(m.brainSpec);
    host = new AiHost({
      brain,
      static: fromAiStaticWire(m.static),
      profile,
      openings,
      gameSeed: m.gameSeed,
      ...(m.openingId !== undefined ? { openingId: m.openingId } : {}),
      ...(m.maxMs !== undefined ? { maxMs: m.maxMs } : {}),
      ...(m.env !== undefined ? { env: m.env } : {}),
      ...(m.timeoutMs !== undefined ? { timeoutMs: m.timeoutMs } : {}),
      ...(m.budgetScale !== undefined ? { budgetScale: m.budgetScale } : {}),
      ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    });
    const ready: AiReadyMessage = {
      type: 'ready',
      opening: host.openingId,
      managers: [...brain.managerNames],
      timeoutMs: host.timeoutMs,
    };
    send(ready);
  };

  const perceive = (tick: number, bytes: Uint8Array): void => {
    if (host === null) throw new Error('AI worker: perceive before init');
    const r = host.thinkBytes(bytes);
    const batch = ownBuffer(encodeBatch(r.commands));
    const res: AiResultMessage = {
      type: 'result',
      tick,
      batch,
      aborted: r.aborted,
      ops: r.opsTotal,
      ingestOps: r.ingestOps,
      opsByManager: { ...r.opsByManager },
      dropped: r.dropped.length,
      ms: r.elapsedMs,
      telemetry: r.telemetry,
    };
    send(res, [batch.buffer as ArrayBuffer]);
  };

  port.onMessage((data) => {
    const m = parseAiToWorkerMessage(data);
    chain = chain.then(async () => {
      if (m === null) {
        fail(-1, new Error('AI worker: malformed message'));
        return;
      }
      if (m.type === 'shutdown') {
        resolveDone();
        return;
      }
      if (failed) {
        // After a failure every further request is answered with an error (the sim stops).
        if (m.type === 'perceive') fail(m.tick, new Error('AI worker: host failed earlier'));
        return;
      }
      if (m.type === 'init') {
        try {
          await init(m);
        } catch (e) {
          fail(-1, e);
        }
        return;
      }
      try {
        perceive(m.tick, m.bytes);
      } catch (e) {
        fail(m.tick, e);
      }
    });
  });
  return done;
}
