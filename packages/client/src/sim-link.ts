/**
 * SimLink: the main thread's view of the simulation host (PLAN §3.6 "Kanäle").
 *
 * The client never imports `sim` or `sim-host`; it only talks to this interface. The worker-based
 * implementation lives in apps/game (it posts `CmdMessage`/`CtlMessage` to the sim worker and
 * wraps the protocol `FrameConsumer` of the chosen transport). Tests use a fake that writes
 * synthetic frames with the protocol `FrameWriter`.
 */
import type { CtlMessage, FrameConsumer, HostMessage } from '@faf/protocol';

export interface SimLink {
  /**
   * Sends an encoded command batch (tick 0; the host stamps the application tick). The buffer
   * is handed over (transferred) — the caller must not touch it afterwards.
   */
  sendCommands(batch: ArrayBuffer): void;
  /** Sends a control message (pause, resume, speed, step, …). */
  sendCtl(msg: CtlMessage): void;
  /** Copy-on-arrival consumer of the newest frame (SAB triple buffer or transfer ping-pong). */
  readonly frames: FrameConsumer;
  /** Subscribes to host messages (ready, status, stats, log, error); returns the unsubscribe function. */
  onHostMessage(cb: (m: HostMessage) => void): () => void;
}
