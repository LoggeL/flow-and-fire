/** Versioned .rtsreplay container and incremental command-block writer. */
import { readContainer, writeContainer, type ContainerChunk, type ReadChunk } from '../container.ts';
import { FormatError } from '../errors.ts';
import { decodeGame, decodeHashes, decodeHead, decodeMarks, encodeGame, encodeHashes, encodeHead, encodeMarks } from './chunks.ts';
import { decodeCmdsBlock, encodeCmdsChunk, parseCmdsChunk } from './cmds.ts';
import { decodeMeta, encodeMeta } from './meta.ts';
import { CMDS_BLOCK_TICKS, ReplayFlags, RTSREPLAY_FORMAT_VERSION, RTSREPLAY_MAGIC, isTaintMarkKind,
  type CmdsBlockRef, type ReplayGame, type ReplayHashes, type ReplayHead, type ReplayMark, type ReplayMeta,
  type ReplayTickCommands, type RtsReplay, type RtsReplayInput } from './types.ts';

const KNOWN = ['HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META'];
const MAX_BLOCKS = 65536;
export interface ReplayWriteOptions { readonly level?: number; }
export interface ReplayReadOptions { readonly verifyBlocks?: boolean; }
function consistent(head: ReplayHead, hashes: ReplayHashes, marks: readonly ReplayMark[]): void {
  if (head.hashInterval !== hashes.interval || head.subHashInterval !== hashes.subInterval)
    throw new FormatError('bad-value', 'HEAD/HASH intervals disagree');
  if (((head.flags & ReplayFlags.Tainted) !== 0) !== marks.some((m) => isTaintMarkKind(m.kind)))
    throw new FormatError('bad-value', 'Tainted flag disagrees with MARK');
}
function terminalTick(hashes: ReplayHashes, marks: readonly ReplayMark[], meta: ReplayMeta | null): number {
  const hn = hashes.hashes.length, rn = hashes.regionNames.length;
  const sn = rn === 0 ? 0 : Math.floor(hashes.subHashes.length / rn);
  return Math.max(meta?.endTick ?? 0, marks.at(-1)?.tick ?? 0,
    hn === 0 ? 0 : hashes.firstTick + (hn - 1) * hashes.interval,
    sn === 0 ? 0 : hashes.subFirstTick + (sn - 1) * hashes.subInterval);
}
function consistentEnd(meta: ReplayMeta | null, dataEnd: number): void {
  if (meta !== null && meta.endTick < dataEnd)
    throw new FormatError('bad-value', 'META.endTick precedes replay data', 'META');
}
function commandChunks(commands: readonly ReplayTickCommands[], end: number, level?: number): ContainerChunk[] {
  let last = -1;
  for (const c of commands) {
    if (!Number.isInteger(c.tick) || c.tick < 0 || c.tick > 0xffffffff || c.tick <= last)
      throw new FormatError('bad-value', 'command ticks must increase');
    last = c.tick;
  }
  const count = Math.floor(Math.max(end, last) / CMDS_BLOCK_TICKS) + 1;
  if (count > MAX_BLOCKS) throw new FormatError('too-large', 'replay exceeds block limit');
  const chunks: ContainerChunk[] = []; let cursor = 0;
  for (let i = 0; i < count; i++) {
    const start = cursor;
    while (cursor < commands.length && commands[cursor]!.tick < (i + 1) * CMDS_BLOCK_TICKS) cursor++;
    chunks.push({ id: 'CMDS', data: encodeCmdsChunk(i, commands.slice(start, cursor), level) });
  }
  return chunks;
}
export function writeRtsReplay(input: RtsReplayInput, opts: ReplayWriteOptions = {}): Uint8Array {
  consistent(input.head, input.hashes, input.marks);
  consistentEnd(input.meta, Math.max(input.commands.at(-1)?.tick ?? 0, terminalTick(input.hashes, input.marks, null)));
  const chunks: ContainerChunk[] = [
    { id: 'HEAD', data: encodeHead(input.head) }, { id: 'GAME', data: encodeGame(input.game) },
    ...commandChunks(input.commands, terminalTick(input.hashes, input.marks, input.meta), opts.level),
    { id: 'HASH', data: encodeHashes(input.hashes) }, { id: 'MARK', data: encodeMarks(input.marks) },
  ];
  if (input.meta !== null) chunks.push({ id: 'META', data: encodeMeta(input.meta) });
  for (const c of input.extraChunks ?? []) {
    if (KNOWN.includes(c.id)) throw new FormatError('duplicate-chunk', 'extra chunk has reserved id', c.id);
    chunks.push(c);
  }
  return writeContainer(RTSREPLAY_MAGIC, RTSREPLAY_FORMAT_VERSION, chunks);
}
export function readRtsReplay(bytes: Uint8Array, opts: ReplayReadOptions = {}): RtsReplay {
  const c = readContainer(bytes, RTSREPLAY_MAGIC);
  if (c.formatVersion !== RTSREPLAY_FORMAT_VERSION) throw new FormatError('unsupported-version', `replay version ${c.formatVersion}`);
  for (const id of ['HEAD', 'GAME', 'HASH', 'MARK']) {
    const n = c.chunks.filter((x) => x.id === id).length;
    if (n === 0) throw new FormatError('missing-chunk', `missing ${id}`, id);
    if (n > 1) throw new FormatError('duplicate-chunk', `duplicate ${id}`, id);
  }
  if (c.chunks.filter((x) => x.id === 'META').length > 1) throw new FormatError('duplicate-chunk', 'duplicate META', 'META');
  if (c.chunks[0]?.id !== 'HEAD' || c.chunks[1]?.id !== 'GAME') throw new FormatError('chunk-order', 'HEAD/GAME must be first');
  let phase = 2, commandEnd = 0; const blocks: CmdsBlockRef[] = []; const unknown: ReadChunk[] = [];
  for (const chunk of c.chunks.slice(2)) {
    const next = chunk.id === 'CMDS' ? 2 : chunk.id === 'HASH' ? 3 : chunk.id === 'MARK' ? 4 : chunk.id === 'META' ? 5 : -1;
    if (next < 0) { unknown.push(chunk); continue; }
    if (next < phase) throw new FormatError('chunk-order', 'known chunks out of order', chunk.id, chunk.offset);
    phase = next;
    if (chunk.id === 'CMDS') {
      if (blocks.length >= MAX_BLOCKS) throw new FormatError('too-large', 'too many command blocks');
      const b = parseCmdsChunk(chunk.data, blocks.length, chunk.offset);
      if (opts.verifyBlocks !== false) commandEnd = Math.max(commandEnd, decodeCmdsBlock(b).at(-1)?.tick ?? 0);
      else if (b.entryCount > 0) commandEnd = Math.max(commandEnd, b.firstTick);
      blocks.push(b);
    }
  }
  const get = (id: string): ReadChunk => c.chunks.find((x) => x.id === id)!;
  const head = decodeHead(get('HEAD').data, get('HEAD').offset, c.formatVersion);
  const game = decodeGame(get('GAME').data, get('GAME').offset);
  const hashes = decodeHashes(get('HASH').data, get('HASH').offset);
  const marks = decodeMarks(get('MARK').data, get('MARK').offset);
  const mc = c.chunks.find((x) => x.id === 'META'); const meta = mc === undefined ? null : decodeMeta(mc.data, mc.offset);
  consistent(head, hashes, marks);
  consistentEnd(meta, Math.max(commandEnd, terminalTick(hashes, marks, null)));
  if (blocks.length === 0 || blocks.length <= Math.floor(terminalTick(hashes, marks, meta) / CMDS_BLOCK_TICKS))
    throw new FormatError('missing-chunk', 'CMDS do not cover the replay duration', 'CMDS');
  return { formatVersion: c.formatVersion, head, game, blocks, hashes, marks, meta, unknown, chunks: c.chunks, byteLength: bytes.length };
}
export function readAllCommands(replay: RtsReplay): ReplayTickCommands[] {
  const out: ReplayTickCommands[] = []; for (const b of replay.blocks) out.push(...decodeCmdsBlock(b)); return out;
}
export function blockIndexForTick(replay: RtsReplay, tick: number): number {
  if (!Number.isInteger(tick) || tick < 0) return -1;
  const i = Math.floor(tick / CMDS_BLOCK_TICKS); return i < replay.blocks.length ? i : -1;
}
export function rewriteRtsReplay(replay: RtsReplay): Uint8Array {
  return writeContainer(RTSREPLAY_MAGIC, replay.formatVersion, replay.chunks);
}
export function replaySizeReport(bytes: Uint8Array): { total: number; byChunk: Record<string, number>; cmdsRawBytes: number; cmdsStoredBytes: number; blocks: number } {
  const r = readRtsReplay(bytes, { verifyBlocks: false }); const byChunk: Record<string, number> = {};
  for (const c of r.chunks) byChunk[c.id] = (byChunk[c.id] ?? 0) + 12 + ((c.data.length + 3) & ~3);
  return { total: bytes.length, byChunk, cmdsRawBytes: r.blocks.reduce((n, b) => n + b.rawLength, 0),
    cmdsStoredBytes: r.blocks.reduce((n, b) => n + b.payload.length, 0), blocks: r.blocks.length };
}
export class RtsReplayBuilder {
  private readonly pending: ReplayTickCommands[] = [];
  private readonly encoded: ContainerChunk[] = [];
  private readonly rule: number[] = [];
  private readonly sub: number[] = [];
  private readonly marks: ReplayMark[] = [];
  private lastTick = -1;
  private firstHash = 0;
  private firstSub = 0;
  private subRows = 0;
  private readonly regions: readonly string[];
  constructor(readonly head: ReplayHead, readonly game: ReplayGame, private readonly opts: ReplayWriteOptions & { readonly regionNames?: readonly string[] } = {}) {
    this.regions = [...(opts.regionNames ?? [])]; encodeHead(head); encodeGame(game);
  }
  private flush(): void {
    if (this.encoded.length >= MAX_BLOCKS) throw new FormatError('too-large', 'too many command blocks');
    this.encoded.push({ id: 'CMDS', data: encodeCmdsChunk(this.encoded.length, this.pending, this.opts.level) });
    this.pending.length = 0;
  }
  commands(tick: number, batch: Uint8Array): void {
    if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff || tick <= this.lastTick) throw new FormatError('bad-value', 'command ticks must increase');
    while (tick >= (this.encoded.length + 1) * CMDS_BLOCK_TICKS) this.flush();
    this.pending.push({ tick, batch: batch.slice() }); this.lastTick = tick;
  }
  hash(tick: number, h: number): void {
    if (this.rule.length === 0) this.firstHash = tick;
    if (tick !== this.firstHash + this.rule.length * this.head.hashInterval) throw new FormatError('bad-value', 'hash tick is off interval');
    this.rule.push(h >>> 0);
  }
  subHashes(tick: number, hashes: Uint32Array): void {
    if (hashes.length !== this.regions.length) throw new FormatError('bad-value', 'sub-hash region count mismatch');
    if (this.subRows === 0) this.firstSub = tick;
    if (tick !== this.firstSub + this.subRows * this.head.subHashInterval) throw new FormatError('bad-value', 'sub-hash tick is off interval');
    this.sub.push(...hashes); this.subRows++;
  }
  mark(tick: number, kind: number, value: number): void { this.marks.push({ tick, kind, value }); }
  finish(meta: ReplayMeta | null): Uint8Array {
    const hashes: ReplayHashes = { interval: this.head.hashInterval, firstTick: this.firstHash, hashes: Uint32Array.from(this.rule),
      subInterval: this.head.subHashInterval, subFirstTick: this.firstSub, regionNames: this.regions, subHashes: Uint32Array.from(this.sub) };
    consistent(this.head, hashes, this.marks);
    consistentEnd(meta, Math.max(this.lastTick, terminalTick(hashes, this.marks, null)));
    const end = Math.max(this.lastTick, terminalTick(hashes, this.marks, meta));
    while (this.encoded.length <= Math.floor(end / CMDS_BLOCK_TICKS)) this.flush();
    return writeContainer(RTSREPLAY_MAGIC, RTSREPLAY_FORMAT_VERSION, [
      { id: 'HEAD', data: encodeHead(this.head) }, { id: 'GAME', data: encodeGame(this.game) }, ...this.encoded,
      { id: 'HASH', data: encodeHashes(hashes) }, { id: 'MARK', data: encodeMarks(this.marks) },
      ...(meta === null ? [] : [{ id: 'META', data: encodeMeta(meta) }]),
    ]);
  }
}
