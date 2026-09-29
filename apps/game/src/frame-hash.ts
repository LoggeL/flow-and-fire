/**
 * Frame fingerprint for the transport byte-equality check (E2E "transports", G14/S4).
 *
 * xxHash32 over the frame bytes with the wall-clock-dependent parts neutralised:
 * - `tickTimeUs` (header offset 16) is the measured step duration → zeroed;
 * - the debug section (phase times, also wall clock) is cut off and its header fields zeroed.
 * Everything else — including the host frame counter `seq`, ackSeq, hashes and every UnitRecord —
 * is part of the fingerprint, so equal fingerprints at every tick mean byte-identical frames.
 */
import { xxHash32 } from '@faf/fixed';
import { FH_DEBUG_BYTES, FH_DEBUG_OFFSET, FH_TICK, FH_TICK_TIME_US, FRAME_HEADER_BYTES } from '@faf/protocol';

export interface FrameFingerprint {
  readonly tick: number;
  readonly hash: number;
  readonly byteLength: number;
}

export class FrameHasher {
  private scratch = new Uint8Array(64 * 1024);

  /** Fingerprint of `bytes` (a complete frame). */
  hash(bytes: Uint8Array): FrameFingerprint {
    if (bytes.length < FRAME_HEADER_BYTES) return { tick: -1, hash: xxHash32(bytes, 0, bytes.length, 0), byteLength: bytes.length };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tick = dv.getUint32(FH_TICK, true);
    const debugOffset = dv.getUint32(FH_DEBUG_OFFSET, true);
    const debugBytes = dv.getUint32(FH_DEBUG_BYTES, true);
    const len = debugBytes > 0 && debugOffset >= FRAME_HEADER_BYTES && debugOffset <= bytes.length ? debugOffset : bytes.length;
    if (this.scratch.length < len) this.scratch = new Uint8Array(Math.max(len, this.scratch.length * 2));
    const s = this.scratch;
    s.set(bytes.subarray(0, len));
    const sdv = new DataView(s.buffer, 0, len);
    sdv.setUint32(FH_TICK_TIME_US, 0, true);
    sdv.setUint32(FH_DEBUG_OFFSET, 0, true);
    sdv.setUint32(FH_DEBUG_BYTES, 0, true);
    return { tick, hash: xxHash32(s, 0, len, 0) >>> 0, byteLength: len };
  }
}
