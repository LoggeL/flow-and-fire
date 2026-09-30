/**
 * Playing .rtsreplay files through the host's command-source interface (PLAN §3.11 "Wiedergabe
 * über ReplaySource").
 *
 * `RtsReplaySource` hands out the recorded batch of a tick straight from the CMDS blocks: a block
 * is decoded on first use and at most two decoded blocks are kept (the current one and the one
 * before, so a seek that lands just behind a block border does not decode twice). Jumps backwards
 * (seek) need no rewind: the block of a tick is ⌊tick / 600⌋ (formats blockIndexForTick) and the
 * entry inside the block is found by binary search. `expectedHash` / `expectedSubHashes` expose
 * the HASH chunk for verification.
 *
 * `replayToCommandLog` / `replayAsParsedLog` turn a replay back into a FAFL command log (v2) so
 * the existing log tooling (ReplaySource, replayLog, CommandLogRecorder consumers) can run it.
 */

import type { Tick } from '@faf/fixed';
import {
  blockIndexForTick,
  decodeCmdsBlock,
  readRtsReplay,
  ReplayFlags,
  type ReplayTickCommands,
  type RtsReplay,
} from '@faf/formats';
import { decodeBatch, type CommandEnvelope } from '@faf/protocol';
import {
  align4,
  encodeLogHeader,
  entryCheck,
  LOG_ENTRY_HEADER_BYTES,
  LogEntryKind,
  parseCommandLog,
  type LogHeader,
  type ParsedCommandLog,
} from '../log-format.ts';
import type { TickSource } from '../sources.ts';
import { armyCountOf, replayEndTick } from './setup.ts';

const EMPTY: readonly CommandEnvelope[] = [];

interface DecodedBlock {
  readonly index: number;
  readonly entries: readonly ReplayTickCommands[];
}

function lowerBound(a: readonly { readonly tick: number }[], tick: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]!.tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function asReplay(input: RtsReplay | Uint8Array): RtsReplay {
  return input instanceof Uint8Array ? readRtsReplay(input) : input;
}

/** A TickSource over the CMDS blocks of a replay (lazy block decoding, ≤ 2 blocks cached). */
export class RtsReplaySource implements TickSource {
  readonly replay: RtsReplay;
  /** Last tick of the playback (content-derived, setup.ts replayPlaybackEnd). */
  readonly lastTick: number;
  /** Number of block decodes so far (cache misses). */
  blockDecodes = 0;
  private recent: DecodedBlock | null = null;
  private older: DecodedBlock | null = null;
  private readonly regionCount: number;
  private readonly subRows: number;

  constructor(replay: RtsReplay | Uint8Array) {
    this.replay = asReplay(replay);
    this.lastTick = replayEndTick(this.replay);
    const h = this.replay.hashes;
    this.regionCount = h.regionNames.length;
    this.subRows = this.regionCount === 0 ? 0 : Math.floor(h.subHashes.length / this.regionCount);
  }

  pending(_tick: number): boolean {
    return false;
  }

  /** The recorded batch of `tick` (envelope ticks == tick), or null if none. */
  batchFor(tick: number): Uint8Array | null {
    const bi = blockIndexForTick(this.replay, tick);
    if (bi < 0 || this.replay.blocks[bi]!.entryCount === 0) return null;
    const entries = this.block(bi).entries;
    const i = lowerBound(entries, tick);
    return i < entries.length && entries[i]!.tick === tick ? entries[i]!.batch : null;
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    const b = this.batchFor(tick);
    return b === null ? EMPTY : decodeBatch(b);
  }

  /** Recorded rule hash after `tick` (u32), or −1 if the HASH chunk has none for it. */
  expectedHash(tick: number): number {
    const h = this.replay.hashes;
    const n = h.hashes.length;
    if (n === 0 || h.interval === 0) return -1;
    const d = tick - h.firstTick;
    if (d < 0 || d % h.interval !== 0) return -1;
    const i = d / h.interval;
    return i < n ? h.hashes[i]! : -1;
  }

  /** Row of the sub-hashes recorded after `tick`, or −1. */
  subHashRow(tick: number): number {
    const h = this.replay.hashes;
    if (this.subRows === 0 || h.subInterval === 0) return -1;
    const d = tick - h.subFirstTick;
    if (d < 0 || d % h.subInterval !== 0) return -1;
    const k = d / h.subInterval;
    return k < this.subRows ? k : -1;
  }

  /** Recorded sub-hashes after `tick` (view, one per HASH region name), or null. */
  expectedSubHashes(tick: number): Uint32Array | null {
    const k = this.subHashRow(tick);
    if (k < 0) return null;
    const rc = this.regionCount;
    return this.replay.hashes.subHashes.subarray(k * rc, k * rc + rc);
  }

  private block(index: number): DecodedBlock {
    const r = this.recent;
    if (r !== null && r.index === index) return r;
    const o = this.older;
    if (o !== null && o.index === index) {
      this.older = r;
      this.recent = o;
      return o;
    }
    const d: DecodedBlock = { index, entries: decodeCmdsBlock(this.replay.blocks[index]!) };
    this.blockDecodes++;
    this.older = r;
    this.recent = d;
    return d;
  }
}

/** FAFL log header of a replay (identity from HEAD, setup from GAME). */
export function replayLogHeader(replay: RtsReplay): LogHeader {
  const { head, game } = replay;
  return {
    simId: head.simId,
    layoutHash: head.layoutHash,
    seed: game.seed,
    bpSimHash: head.bpSimHash,
    mapSizeWu: game.mapSizeWu,
    armyCount: armyCountOf(game),
    playerArmy: game.playerArmy,
    hashInterval: head.hashInterval,
    buildHash: head.buildHash,
    mapSimHash: head.mapSimHash,
  };
}

/** Growable byte buffer for the FAFL writer. */
class LogWriter {
  buf: Uint8Array;
  dv: DataView;
  len = 0;
  /** Tick of the last entry written (0 before the first). */
  lastTick = 0;

  constructor(header: Uint8Array, capacity: number) {
    this.buf = new Uint8Array(Math.max(capacity, header.length + 64));
    this.dv = new DataView(this.buf.buffer);
    this.buf.set(header, 0);
    this.len = header.length;
  }

  entry(kind: number, sub: number, tick: number, data: Uint8Array): void {
    const padded = align4(data.length);
    const need = this.len + LOG_ENTRY_HEADER_BYTES + padded;
    if (need > this.buf.length) {
      let cap = this.buf.length * 2;
      while (cap < need) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
      this.dv = new DataView(nb.buffer);
    }
    const p = this.len;
    const dv = this.dv;
    dv.setUint8(p, kind);
    dv.setUint8(p + 1, sub);
    dv.setUint16(p + 2, 0, true);
    dv.setUint32(p + 4, tick >>> 0, true);
    dv.setUint32(p + 8, data.length, true);
    dv.setUint32(p + 12, entryCheck(kind, sub, 0, tick, data, 0, data.length), true);
    this.buf.set(data, p + LOG_ENTRY_HEADER_BYTES);
    this.buf.fill(0, p + LOG_ENTRY_HEADER_BYTES + data.length, need);
    this.len = need;
    this.lastTick = tick;
  }
}

/**
 * Writes a replay as a FAFL v2 command log: per tick the CMDS entry, then the marks, then the
 * rule hash (the order the host records a tick), END at the end tick if the replay is Complete.
 * Sub-hashes, GAME details other than seed/armies/playerArmy and META have no FAFL
 * representation and are dropped. For a replay converted from a log that recorded only Cheat
 * marks (e.g. the golden logs) the result is byte-identical to the source log.
 */
export function replayToCommandLog(input: RtsReplay | Uint8Array): Uint8Array {
  const replay = asReplay(input);
  const header = encodeLogHeader(replayLogHeader(replay));
  const w = new LogWriter(header, 64 * 1024);
  const h = replay.hashes;
  const marks = replay.marks;
  const four = new Uint8Array(4);
  const fourDv = new DataView(four.buffer);
  let hi = 0;
  let mi = 0;
  const flushUntil = (tick: number): void => {
    // Writes the marks and rule hashes of all ticks before `tick` (marks first within a tick).
    for (;;) {
      const ht = hi < h.hashes.length ? h.firstTick + hi * h.interval : Number.POSITIVE_INFINITY;
      const mt = mi < marks.length ? marks[mi]!.tick : Number.POSITIVE_INFINITY;
      const t = Math.min(ht, mt);
      if (!(t < tick)) return;
      while (mi < marks.length && marks[mi]!.tick === t) {
        const m = marks[mi++]!;
        fourDv.setUint32(0, m.value >>> 0, true);
        w.entry(LogEntryKind.Mark, m.kind, t, four);
      }
      if (ht === t) {
        fourDv.setUint32(0, h.hashes[hi++]!, true);
        w.entry(LogEntryKind.Hash, 0, t, four);
      }
    }
  };
  for (const block of replay.blocks) {
    if (block.entryCount === 0) continue;
    for (const e of decodeCmdsBlock(block)) {
      flushUntil(e.tick);
      w.entry(LogEntryKind.Cmds, 0, e.tick, e.batch);
      flushUntil(e.tick + 1);
    }
  }
  flushUntil(Number.POSITIVE_INFINITY);
  if ((replay.head.flags & ReplayFlags.Complete) !== 0) {
    w.entry(LogEntryKind.End, 0, Math.max(replayEndTick(replay), w.lastTick), new Uint8Array(0));
  }
  return w.buf.slice(0, w.len);
}

/**
 * A replay as a parsed FAFL command log (via replayToCommandLog), e.g. for the existing
 * `ReplaySource` / `replayLog`.
 */
export function replayAsParsedLog(input: RtsReplay | Uint8Array): ParsedCommandLog {
  return parseCommandLog(replayToCommandLog(input));
}
