/**
 * Sim-side CommandSource of an AI running in a worker (PLAN §3.1/§3.10, ai.md §2.1): built on
 * `PendingAiSource`. At a think tick N it snapshots the perception of N and posts `perceive`; the
 * commands of think N are due at N + lead, and until the worker's `result` for N has arrived
 * `commandsFor(t ≥ N + lead)` answers 'pending' — the sim waits (SP sim lag), nothing is dropped.
 *
 * `result` batches are validated and kept as bytes: the byte form (`pending(t)`/`batchFor(t)`,
 * structurally sim-host's TickSource) hands the worker's batch to the sim unchanged, the envelope
 * form (`commandsFor`) decodes it lazily with protocol `decodeBatch`. The envelopes are stamped
 * N + lead by the brain's emitter, exactly as in the synchronous host, so both hosts yield the same
 * command stream (AI-DET-01). Timeout marks and telemetry of the worker are collected for the
 * recorder and tournaments. A worker `error` makes the next `commandsFor`/`pending`/`batchFor`
 * throw (the match fails loudly instead of waiting forever).
 */
import type { Tick } from '@faf/fixed';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import type { TelemetryEvent } from '../blackboard.ts';
import { PROFILES } from '../profile.ts';
import { PendingAiSource } from '../source.ts';
import type { AiTimeoutMark } from './ai-host.ts';
import {
  AI_WORKER_PROTOCOL,
  parseAiFromWorkerMessage,
  type AiInitMessage,
  type AiPerceiveMessage,
  type AiReadyMessage,
  type AiResultMessage,
} from './protocol.ts';
import type { MessagePortLike } from './worker.ts';

export type AiInitSpec = Omit<AiInitMessage, 'type' | 'protocol'>;

export interface AsyncAiSourceOptions {
  /** Sim side of the channel to the AI worker. */
  readonly port: MessagePortLike;
  /** Init message content (posted immediately). */
  readonly init: AiInitSpec;
  /**
   * Perception snapshot of the AI's army at tick N, called synchronously at the think tick (before
   * the sim steps N). The bytes are transferred to the worker: return a fresh copy.
   */
  readonly perceiveBytes: (tick: number) => Uint8Array;
  /** Default: thinkEvery of the profile. */
  readonly thinkEvery?: number;
  /** Default: lead of the profile. */
  readonly lead?: number;
  /** Called for every result (statistics); runs before the commands become available. */
  readonly onResult?: (r: AiResultMessage) => void;
  /** Called for every aborted think (MARK aiTimeout). */
  readonly onTimeout?: (mark: AiTimeoutMark) => void;
}

export class AsyncAiSource implements CommandSource {
  readonly thinkEvery: number;
  readonly lead: number;
  /** Timeout marks reported by the worker, in think order. */
  readonly marks: AiTimeoutMark[] = [];
  /** Telemetry forwarded by the worker, in order. */
  readonly telemetry: TelemetryEvent[] = [];
  private readonly port: MessagePortLike;
  private readonly queue: PendingAiSource;
  private readonly perceiveBytes: (tick: number) => Uint8Array;
  private readonly onResult: ((r: AiResultMessage) => void) | undefined;
  private readonly onTimeout: ((mark: AiTimeoutMark) => void) | undefined;
  private readyMsg: AiReadyMessage | null = null;
  private failure: Error | null = null;
  private resultCount = 0;

  constructor(o: AsyncAiSourceOptions) {
    const base = PROFILES[o.init.profileName];
    this.thinkEvery = o.thinkEvery ?? base.thinkEvery;
    this.lead = o.lead ?? base.lead;
    this.port = o.port;
    this.perceiveBytes = o.perceiveBytes;
    this.onResult = o.onResult;
    this.onTimeout = o.onTimeout;
    this.queue = new PendingAiSource({
      thinkEvery: this.thinkEvery,
      lead: this.lead,
      request: (tick) => this.request(tick),
    });
    o.port.onMessage((data) => this.receive(data));
    const init: AiInitMessage = { type: 'init', protocol: AI_WORKER_PROTOCOL, ...o.init };
    o.port.postMessage(init);
  }

  /** The worker's ready message (null until received). */
  get ready(): AiReadyMessage | null {
    return this.readyMsg;
  }

  /** Error reported by the worker (null if none). */
  get error(): Error | null {
    return this.failure;
  }

  /** Number of 'pending' answers given so far. */
  get pendingCount(): number {
    return this.queue.pendingCount;
  }

  /** Results received so far. */
  get results(): number {
    return this.resultCount;
  }

  /** Thinks requested but not yet answered. */
  get outstandingThinks(): readonly number[] {
    return this.queue.outstandingThinks;
  }

  /**
   * Commands due at `tick`, or 'pending'. Idempotent for the current tick: asking the same tick
   * again returns the same commands (a sim loop that polls several sources and retries a tick
   * because ANOTHER source was pending must not lose this source's commands).
   */
  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    if (this.failure !== null) throw this.failure;
    return this.queue.commandsFor(tick);
  }

  /** TickSource form: true while the worker's result for a due think is missing (consumes nothing). */
  pending(tick: number): boolean {
    if (this.failure !== null) throw this.failure;
    return this.queue.pending(tick);
  }

  /** TickSource form: the worker's command batch due at `tick` (unchanged bytes), or null. */
  batchFor(tick: number): Uint8Array | null {
    if (this.failure !== null) throw this.failure;
    return this.queue.batchFor(tick);
  }

  /** Asks the worker to stop serving (it answers nothing after this). */
  shutdown(): void {
    this.port.postMessage({ type: 'shutdown' });
  }

  private request(tick: number): void {
    const bytes = this.perceiveBytes(tick);
    const msg: AiPerceiveMessage = { type: 'perceive', tick, bytes };
    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    if (whole) this.port.postMessage(msg, [bytes.buffer as ArrayBuffer]);
    else this.port.postMessage(msg);
  }

  private receive(data: unknown): void {
    const m = parseAiFromWorkerMessage(data);
    if (m === null) {
      this.failure ??= new Error('AI worker sent a malformed message');
      return;
    }
    switch (m.type) {
      case 'ready':
        this.readyMsg = m;
        return;
      case 'error':
        this.failure ??= new Error(`AI worker error at tick ${m.tick}: ${m.message}`);
        return;
      case 'result': {
        this.resultCount++;
        for (const e of m.telemetry) this.telemetry.push(e);
        if (m.aborted) {
          const mark: AiTimeoutMark = { kind: 'aiTimeout', tick: m.tick, elapsedMs: m.ms };
          this.marks.push(mark);
          this.onTimeout?.(mark);
        }
        this.onResult?.(m);
        try {
          this.queue.deliverBatch(m.tick, m.batch);
        } catch (e) {
          this.failure ??= e instanceof Error ? e : new Error(String(e));
        }
        return;
      }
    }
  }
}
