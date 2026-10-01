/** Lazy replay source. At most two decompressed minute blocks are retained. */
import { blockIndexForTick, decodeCmdsBlock, readAllCommands, ReplayFlags, type RtsReplay, type ReplayTickCommands } from '@faf/formats';
import { decodeBatch, type CommandEnvelope } from '@faf/protocol';
import type { Tick } from '@faf/fixed';
import type { TickSource } from '../sources.ts';
import type { ParsedCommandLog } from '../log-format.ts';

export function replayEndTick(replay: RtsReplay): number {
  const h = replay.hashes, regions = h.regionNames.length;
  let commandTick = 0;
  // Empty trailing blocks do not erase the last command in an earlier block.
  for (let i = replay.blocks.length - 1; i >= 0; i--) {
    const block = replay.blocks[i]!;
    if (block.entryCount === 0) continue;
    commandTick = decodeCmdsBlock(block).at(-1)?.tick ?? 0;
    break;
  }
  const subRows = regions === 0 ? 0 : h.subHashes.length / regions;
  return Math.max(replay.meta?.endTick ?? 0, commandTick, replay.marks.at(-1)?.tick ?? 0,
    h.hashes.length === 0 ? 0 : h.firstTick + (h.hashes.length - 1) * h.interval,
    subRows === 0 ? 0 : h.subFirstTick + (subRows - 1) * h.subInterval);
}
export class RtsReplaySource implements TickSource {
  private readonly cache: { index: number; commands: ReplayTickCommands[] }[] = [];
  readonly lastTick: number;
  constructor(readonly replay: RtsReplay) { this.lastTick = replayEndTick(replay); }
  pending(_tick: number): boolean { return false; }
  batchFor(tick: number): Uint8Array | null {
    const index = blockIndexForTick(this.replay, tick);
    if (index < 0) return null;
    let at = this.cache.findIndex((x) => x.index === index);
    if (at < 0) {
      this.cache.unshift({ index, commands: decodeCmdsBlock(this.replay.blocks[index]!) });
      if (this.cache.length > 2) this.cache.pop();
      at = 0;
    }
    const entry = this.cache[at]!;
    if (at > 0) { this.cache.splice(at, 1); this.cache.unshift(entry); }
    const commands = entry.commands;
    let lo = 0, hi = commands.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (commands[m]!.tick < tick) lo = m + 1; else hi = m; }
    return commands[lo]?.tick === tick ? commands[lo]!.batch : null;
  }
  commandsFor(tick: Tick): readonly CommandEnvelope[] { const batch = this.batchFor(tick); return batch === null ? [] : decodeBatch(batch); }
  expectedHash(tick: number): number {
    const h = this.replay.hashes, i = (tick - h.firstTick) / h.interval;
    return Number.isInteger(i) && i >= 0 && i < h.hashes.length ? h.hashes[i]! : -1;
  }
}
export function replayAsParsedLog(replay: RtsReplay): ParsedCommandLog {
  const commands = readAllCommands(replay), bytes = new Uint8Array(commands.reduce((n, c) => n + c.batch.length, 0));
  let offset = 0;
  const entries = commands.map((c) => { const entry = { tick: c.tick, offset, length: c.batch.length }; bytes.set(c.batch, offset); offset += c.batch.length; return entry; });
  const h = replay.head, g = replay.game;
  return { header: { simId: h.simId, layoutHash: h.layoutHash, seed: g.seed, bpSimHash: h.bpSimHash,
    mapSizeWu: g.mapSizeWu, armyCount: g.armies.length, playerArmy: g.playerArmy, hashInterval: h.hashInterval,
    buildHash: h.buildHash, mapSimHash: h.mapSimHash, ...(g.initialization === undefined ? {} : { initialization: g.initialization }) }, version: h.sourceLogVersion || (g.initialization === undefined ? 2 : g.initialization.slots === undefined && g.initialization.rules === undefined ? 3 : 4), bytes, commands: entries,
    marks: replay.marks, hashes: Array.from(replay.hashes.hashes, (hash, i) => ({ tick: replay.hashes.firstTick + i * replay.hashes.interval, hash })),
    endTick: (h.flags & ReplayFlags.Complete) !== 0 ? replayEndTick(replay) : -1, lastTick: replayEndTick(replay),
    tainted: (h.flags & ReplayFlags.Tainted) !== 0, truncated: (h.flags & ReplayFlags.Truncated) !== 0, validBytes: bytes.length };
}
