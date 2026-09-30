/**
 * .rtsreplay reader, writer and incremental builder (PLAN §3.11).
 *
 * File = chunk container (container.ts) with magic 'RTSR' and formatVersion
 * RTSREPLAY_FORMAT_VERSION. Chunk order:
 *
 *   HEAD, GAME, CMDS × n (block 0, 1, … n−1; n = 0 without commands), HASH, MARK, [META]
 *
 * with unknown chunks (any other 4CC) allowed anywhere after GAME. Readers skip unknown chunks
 * but keep them (`unknown`, `chunks`), so rewriteRtsReplay reproduces every file byte-exact.
 * Validation: a newer container formatVersion or chunkVersion of a known chunk →
 * 'unsupported-version'; missing / repeated mandatory chunks → 'missing-chunk' /
 * 'duplicate-chunk'; known chunks out of order → 'chunk-order'; HEAD.hashInterval /
 * subHashInterval must equal HASH.interval / subInterval, a Cheat, DevReload or Restore mark needs
 * the Tainted flag (the flag alone is accepted: taint kinds of newer builds) and META.endTick must
 * not lie before the recorded content (last rule hash, sub-hash row, mark or command block;
 * 'bad-value' in META).
 *
 * readRtsReplayHead is the tolerant counterpart for build/version checks before the strict parse:
 * it reads only the version-independent parts (container header, chunk framing, the frozen HEAD
 * prefix and the first u16 = chunk version of every known chunk) of files of ANY format, chunk or
 * protocol version; replayFormatIncompatibility says whether this build's reader can parse them.
 */

import { COMMAND_BATCH_VERSION, CommandBatchView, validateBatch } from '@faf/protocol';
import { crc32Update } from '../crc32.ts';
import {
  CHUNK_OVERHEAD_BYTES,
  CONTAINER_HEADER_BYTES,
  CONTAINER_VERSION,
  fourCC,
  isFourCC,
  readContainer,
  writeContainer,
  type ContainerChunk,
  type ReadChunk,
} from '../container.ts';
import { DEFAULT_DEFLATE_LEVEL } from '../deflate.ts';
import { FormatError } from '../errors.ts';
import { decodeGame, decodeHashes, decodeHead, decodeHeadPrefix, decodeMarks, encodeGame, encodeHashes, encodeHead, encodeMarks, validateHashes, validateHead, validateMarks } from './chunks.ts';
import { decodeCmdsBlock, encodeCmdsChunk, parseCmdsChunk } from './cmds.ts';
import { decodeMeta, encodeMeta, validateMeta } from './meta.ts';
import {
  CMDS_BLOCK_TICKS,
  CMDS_CHUNK_VERSION,
  GAME_CHUNK_VERSION,
  HASH_CHUNK_VERSION,
  HEAD_CHUNK_VERSION,
  MARK_CHUNK_VERSION,
  META_CHUNK_VERSION,
  RTSREPLAY_FORMAT_VERSION,
  RTSREPLAY_MAGIC,
  ReplayChunkId,
  ReplayFlags,
  isTaintMarkKind,
  type CmdsBlockRef,
  type ReplayExtraChunk,
  type ReplayGame,
  type ReplayFormatIncompatibility,
  type ReplayHashes,
  type ReplayHead,
  type ReplayHeadInfo,
  type ReplayMark,
  type ReplayMeta,
  type ReplayTickCommands,
  type RtsReplay,
  type RtsReplayInput,
} from './types.ts';

export interface WriteRtsReplayOptions {
  /** DEFLATE level of the CMDS blocks (default DEFAULT_DEFLATE_LEVEL = canonical output). */
  readonly level?: number;
}

export interface ReadRtsReplayOptions {
  /** Decode every CMDS block while reading (default false: blocks are decoded lazily). */
  readonly verifyBlocks?: boolean;
}

export interface RtsReplayBuilderOptions {
  /** DEFLATE level of the CMDS blocks (default DEFAULT_DEFLATE_LEVEL). */
  readonly level?: number;
  /** Rule region names (sub-hash columns); required before subHashes() is used. Default none. */
  readonly regionNames?: readonly string[];
  /** Unknown chunks written after the known ones. */
  readonly extraChunks?: readonly ReplayExtraChunk[];
}

export interface ReplaySizeReport {
  /** File size in bytes. */
  readonly total: number;
  /**
   * Container bytes per chunk id (id + length + data + padding + CRC, summed over repeats);
   * key 'header' = the 16-byte file header. The values add up to `total`.
   */
  readonly byChunk: Record<string, number>;
  /** Sum of the raw (decompressed) CMDS block lengths. */
  readonly cmdsRawBytes: number;
  /** Sum of the stored CMDS block payloads (after the codec). */
  readonly cmdsStoredBytes: number;
  /** Number of CMDS blocks. */
  readonly blocks: number;
}

const KNOWN_IDS: readonly string[] = [ReplayChunkId.Head, ReplayChunkId.Game, ReplayChunkId.Cmds, ReplayChunkId.Hash, ReplayChunkId.Mark, ReplayChunkId.Meta];

/** Order rank of a known chunk id, −1 for unknown ids. */
function chunkRank(id: string): number {
  return KNOWN_IDS.indexOf(id);
}

function bad(detail: string, chunkId: string | null = null): never {
  throw new FormatError('bad-value', detail, chunkId);
}

function checkExtraChunks(extra: readonly ReplayExtraChunk[]): ContainerChunk[] {
  if (!Array.isArray(extra)) bad('extraChunks must be an array');
  const out: ContainerChunk[] = [];
  for (const c of extra) {
    if (typeof c.id !== 'string' || !isFourCC(c.id)) throw new FormatError('bad-chunk-id', `extra chunk id ${JSON.stringify(c.id)} is not a 4CC`);
    if (chunkRank(c.id) >= 0) bad(`extra chunk id '${c.id}' is a known .rtsreplay chunk`, c.id);
    if (!(c.data instanceof Uint8Array)) bad(`extra chunk '${c.id}' data must be a Uint8Array`, c.id);
    out.push({ id: c.id, data: c.data.slice() });
  }
  return out;
}

function hasTaintMark(marks: readonly ReplayMark[]): boolean {
  for (const m of marks) if (isTaintMarkKind(m.kind)) return true;
  return false;
}

/** Tick of the last rule hash, −1 if none. */
function lastRuleHashTick(h: ReplayHashes): number {
  return h.hashes.length > 0 ? h.firstTick + (h.hashes.length - 1) * h.interval : -1;
}

/** Tick of the last sub-hash row, −1 if none. */
function lastSubHashTick(h: ReplayHashes): number {
  const rc = h.regionNames.length;
  const rows = rc === 0 ? 0 : Math.floor(h.subHashes.length / rc);
  return rows > 0 ? h.subFirstTick + (rows - 1) * h.subInterval : -1;
}

/** Largest tick of the hashes and marks, −1 if none. */
function lastHashOrMarkTick(h: ReplayHashes, marks: readonly ReplayMark[]): number {
  let end = Math.max(lastRuleHashTick(h), lastSubHashTick(h));
  if (marks.length > 0) end = Math.max(end, marks[marks.length - 1]!.tick);
  return end;
}

function checkMetaEnd(meta: ReplayMeta, contentEnd: number, what: string, offset = -1): void {
  if (meta.endTick < contentEnd) {
    throw new FormatError('bad-value', `META.endTick ${meta.endTick} lies before the recorded content (${what} at tick ${contentEnd})`, ReplayChunkId.Meta, offset);
  }
}

/**
 * Incremental writer: feed commands, hashes and marks in tick order while a game runs (or while
 * converting a log), then finish(meta). CMDS blocks are encoded as soon as a later block starts
 * (the builder keeps at most one block of batches, copied); gaps become empty blocks.
 *
 * HEAD.flags: the Tainted bit is set when a Cheat, DevReload or Restore mark was added and kept
 * when the given head has it (taint reasons of newer builds); all other bits are written as given.
 * HASH uses head.hashInterval / head.subHashInterval and the region names of the options.
 * finish(meta) refuses a META.endTick before the last command, hash, sub-hash row or mark.
 */
export class RtsReplayBuilder {
  private readonly head: ReplayHead;
  private readonly gameData: Uint8Array;
  private readonly level: number;
  private readonly regionNames: readonly string[];
  private readonly extra: ContainerChunk[];
  private readonly cmdsChunks: Uint8Array[] = [];
  private pending: ReplayTickCommands[] = [];
  private pendingBlock = 0;
  private lastCommandTick = -1;
  private readonly view = new CommandBatchView();
  private readonly ruleHashes: number[] = [];
  private hashFirstTick = 0;
  private readonly subRows: number[] = [];
  private subRowCount = 0;
  private subFirstTick = 0;
  private readonly marks: ReplayMark[] = [];
  private tainted = false;
  private finished = false;

  constructor(head: ReplayHead, game: ReplayGame, opts: RtsReplayBuilderOptions = {}) {
    validateHead(head);
    this.head = head;
    this.gameData = encodeGame(game);
    this.level = opts.level ?? DEFAULT_DEFLATE_LEVEL;
    if (!Number.isInteger(this.level) || this.level < 0 || this.level > 9) bad(`deflate level must be 0..9, got ${String(opts.level)}`);
    this.regionNames = opts.regionNames === undefined ? [] : opts.regionNames.slice();
    // Validates the region names (empty lists).
    validateHashes({ interval: 0, firstTick: 0, hashes: new Uint32Array(0), subInterval: 0, subFirstTick: 0, regionNames: this.regionNames, subHashes: new Uint32Array(0) });
    this.extra = checkExtraChunks(opts.extraChunks ?? []);
  }

  private checkOpen(): void {
    if (this.finished) throw new Error('RtsReplayBuilder: finish() was already called');
  }

  private flushBlock(): void {
    this.cmdsChunks.push(encodeCmdsChunk(this.pendingBlock, this.pending, this.level));
    this.pending = [];
    this.pendingBlock++;
  }

  /**
   * Adds the command batch of `tick` (ticks strictly ascending; every envelope must carry
   * `tick`). The batch is copied.
   */
  commands(tick: number, batch: Uint8Array): void {
    this.checkOpen();
    const C = ReplayChunkId.Cmds;
    if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) bad(`command tick ${String(tick)} is not a u32`, C);
    if (tick <= this.lastCommandTick) bad(`command ticks must ascend (${tick} after ${this.lastCommandTick})`, C);
    if (!(batch instanceof Uint8Array) || validateBatch(batch) < 0) bad(`command batch of tick ${tick} is malformed`, C);
    this.view.reset(batch);
    while (this.view.next()) {
      if (this.view.tick !== tick) bad(`envelope ${this.view.index} of tick ${tick} carries tick ${this.view.tick}`, C);
    }
    const block = Math.floor(tick / CMDS_BLOCK_TICKS);
    while (this.pendingBlock < block) this.flushBlock();
    this.pending.push({ tick, batch: batch.slice() });
    this.lastCommandTick = tick;
  }

  /** Adds the rule hash after `tick`; ticks must follow the head.hashInterval grid without gaps. */
  hash(tick: number, h: number): void {
    this.checkOpen();
    const C = ReplayChunkId.Hash;
    const interval = this.head.hashInterval;
    if (interval === 0) bad('head.hashInterval is 0: no rule hashes allowed', C);
    if (!Number.isInteger(h) || h < 0 || h > 0xffffffff) bad(`rule hash ${String(h)} is not a u32`, C);
    if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) bad(`hash tick ${String(tick)} is not a u32`, C);
    if (this.ruleHashes.length === 0) this.hashFirstTick = tick;
    else if (tick !== this.hashFirstTick + this.ruleHashes.length * interval) {
      bad(`rule hash tick ${tick} breaks the grid (expected ${this.hashFirstTick + this.ruleHashes.length * interval})`, C);
    }
    this.ruleHashes.push(h);
  }

  /** Adds the sub-hashes (one per region name) after `tick`, on the head.subHashInterval grid. */
  subHashes(tick: number, values: Uint32Array): void {
    this.checkOpen();
    const C = ReplayChunkId.Hash;
    const interval = this.head.subHashInterval;
    const rc = this.regionNames.length;
    if (interval === 0) bad('head.subHashInterval is 0: no sub-hashes allowed', C);
    if (rc === 0) bad('sub-hashes need region names (RtsReplayBuilderOptions.regionNames)', C);
    if (!(values instanceof Uint32Array) || values.length !== rc) bad(`sub-hashes need exactly ${rc} values`, C);
    if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) bad(`sub-hash tick ${String(tick)} is not a u32`, C);
    if (this.subRowCount === 0) this.subFirstTick = tick;
    else if (tick !== this.subFirstTick + this.subRowCount * interval) {
      bad(`sub-hash tick ${tick} breaks the grid (expected ${this.subFirstTick + this.subRowCount * interval})`, C);
    }
    for (let i = 0; i < rc; i++) this.subRows.push(values[i]!);
    this.subRowCount++;
  }

  /** Adds a mark (ticks non-decreasing; kind 1..255, unknown kinds allowed; value u32). */
  mark(tick: number, kind: number, value = 0): void {
    this.checkOpen();
    const m: ReplayMark = { tick, kind, value };
    const last = this.marks.length > 0 ? this.marks[this.marks.length - 1]! : null;
    validateMarks(last === null ? [m] : [last, m]);
    this.marks.push(m);
    if (isTaintMarkKind(kind)) this.tainted = true;
  }

  /** Number of CMDS blocks encoded so far (not counting the open one). */
  get encodedBlocks(): number {
    return this.cmdsChunks.length;
  }

  /** Largest tick of any command, rule hash, sub-hash row or mark added so far (−1: none). */
  get contentEndTick(): number {
    let end = this.lastCommandTick;
    const hi = this.head.hashInterval;
    if (this.ruleHashes.length > 0) end = Math.max(end, this.hashFirstTick + (this.ruleHashes.length - 1) * hi);
    if (this.subRowCount > 0) end = Math.max(end, this.subFirstTick + (this.subRowCount - 1) * this.head.subHashInterval);
    if (this.marks.length > 0) end = Math.max(end, this.marks[this.marks.length - 1]!.tick);
    return end;
  }

  /** Writes the file. `meta` null = no META chunk. The builder cannot be used afterwards. */
  finish(meta: ReplayMeta | null): Uint8Array {
    this.checkOpen();
    if (meta !== null) {
      validateMeta(meta);
      checkMetaEnd(meta, this.contentEndTick, 'last command, hash or mark');
    }
    this.finished = true;
    if (this.pending.length > 0) this.flushBlock();
    const flags = this.tainted ? (this.head.flags | ReplayFlags.Tainted) >>> 0 : this.head.flags >>> 0;
    const head: ReplayHead = { ...this.head, flags };
    const hashes: ReplayHashes = {
      interval: this.head.hashInterval,
      firstTick: this.ruleHashes.length > 0 ? this.hashFirstTick : 0,
      hashes: Uint32Array.from(this.ruleHashes),
      subInterval: this.head.subHashInterval,
      subFirstTick: this.subRowCount > 0 ? this.subFirstTick : 0,
      regionNames: this.regionNames,
      subHashes: Uint32Array.from(this.subRows),
    };
    const chunks: ContainerChunk[] = [
      { id: ReplayChunkId.Head, data: encodeHead(head) },
      { id: ReplayChunkId.Game, data: this.gameData },
    ];
    for (const data of this.cmdsChunks) chunks.push({ id: ReplayChunkId.Cmds, data });
    chunks.push({ id: ReplayChunkId.Hash, data: encodeHashes(hashes) });
    chunks.push({ id: ReplayChunkId.Mark, data: encodeMarks(this.marks) });
    if (meta !== null) chunks.push({ id: ReplayChunkId.Meta, data: encodeMeta(meta) });
    for (const c of this.extra) chunks.push(c);
    return writeContainer(RTSREPLAY_MAGIC, RTSREPLAY_FORMAT_VERSION, chunks);
  }
}

/**
 * Serializes a replay (canonical: the same input and level always give the same bytes, and a
 * file written with the default level survives read → rtsReplayToInput → write byte-exact).
 * Throws FormatError('bad-value') for invalid or inconsistent input.
 */
export function writeRtsReplay(input: RtsReplayInput, opts: WriteRtsReplayOptions = {}): Uint8Array {
  const { head, hashes, marks } = input;
  validateHead(head);
  validateHashes(hashes);
  validateMarks(marks);
  if (hashes.interval !== head.hashInterval) bad(`HASH interval ${hashes.interval} differs from head.hashInterval ${head.hashInterval}`, ReplayChunkId.Hash);
  if (hashes.subInterval !== head.subHashInterval) bad(`HASH subInterval ${hashes.subInterval} differs from head.subHashInterval ${head.subHashInterval}`, ReplayChunkId.Hash);
  const tainted = (head.flags & ReplayFlags.Tainted) !== 0;
  if (!tainted && hasTaintMark(marks)) bad('Cheat/DevReload/Restore marks need the head flag Tainted', ReplayChunkId.Head);
  if (input.meta !== null) validateMeta(input.meta);
  if (!Array.isArray(input.commands)) bad('commands must be an array', ReplayChunkId.Cmds);
  const b = new RtsReplayBuilder(head, input.game, {
    level: opts.level ?? DEFAULT_DEFLATE_LEVEL,
    regionNames: hashes.regionNames,
    extraChunks: input.extraChunks ?? [],
  });
  for (const c of input.commands) b.commands(c.tick, c.batch);
  for (let i = 0; i < hashes.hashes.length; i++) b.hash(hashes.firstTick + i * hashes.interval, hashes.hashes[i]!);
  const rc = hashes.regionNames.length;
  const rows = rc === 0 ? 0 : Math.floor(hashes.subHashes.length / rc);
  for (let k = 0; k < rows; k++) b.subHashes(hashes.subFirstTick + k * hashes.subInterval, hashes.subHashes.subarray(k * rc, k * rc + rc));
  for (const m of marks) b.mark(m.tick, m.kind, m.value);
  return b.finish(input.meta);
}

/**
 * Parses a .rtsreplay file. CMDS blocks are only validated structurally (header, sizes) unless
 * `verifyBlocks` is set; decode them with decodeCmdsBlock / readAllCommands. All returned byte
 * arrays except `game.alliances` and the hash arrays are views into `bytes`.
 */
export function readRtsReplay(bytes: Uint8Array, opts: ReadRtsReplayOptions = {}): RtsReplay {
  if (!(bytes instanceof Uint8Array)) throw new FormatError('truncated', 'input is not a Uint8Array');
  const c = readContainer(bytes, RTSREPLAY_MAGIC);
  if (c.formatVersion > RTSREPLAY_FORMAT_VERSION) {
    throw new FormatError('unsupported-version', `.rtsreplay format version ${c.formatVersion} is newer than ${RTSREPLAY_FORMAT_VERSION}`, null, 6);
  }
  if (c.formatVersion < 1) throw new FormatError('bad-format-version', `.rtsreplay format version ${c.formatVersion}`, null, 6);
  const chunks = c.chunks;
  const idsPresent = (id: string): boolean => chunks.some((ch) => ch.id === id);
  const expectAt = (i: number, id: string): ReadChunk => {
    const ch = chunks[i];
    if (ch !== undefined && ch.id === id) return ch;
    if (idsPresent(id)) throw new FormatError('chunk-order', `chunk ${i} must be '${id}'`, ch?.id ?? null, ch?.offset ?? -1);
    throw new FormatError('missing-chunk', `mandatory chunk '${id}' is missing`, id);
  };
  const headChunk = expectAt(0, ReplayChunkId.Head);
  const head = decodeHead(headChunk.data, headChunk.offset, c.formatVersion);
  const gameChunk = expectAt(1, ReplayChunkId.Game);
  const game = decodeGame(gameChunk.data, gameChunk.offset);

  const blocks: CmdsBlockRef[] = [];
  const unknown: ReadChunk[] = [];
  let hashes: ReplayHashes | null = null;
  let marks: ReplayMark[] | null = null;
  let meta: ReplayMeta | null = null;
  let rank = chunkRank(ReplayChunkId.Game);
  for (let i = 2; i < chunks.length; i++) {
    const ch = chunks[i]!;
    const r = chunkRank(ch.id);
    if (r < 0) {
      unknown.push(ch);
      continue;
    }
    if (r <= chunkRank(ReplayChunkId.Game)) throw new FormatError('duplicate-chunk', `second '${ch.id}' chunk`, ch.id, ch.offset);
    if (r < rank) throw new FormatError('chunk-order', `'${ch.id}' after '${KNOWN_IDS[rank]!}'`, ch.id, ch.offset);
    if (r === rank && ch.id !== ReplayChunkId.Cmds) throw new FormatError('duplicate-chunk', `second '${ch.id}' chunk`, ch.id, ch.offset);
    rank = r;
    switch (ch.id) {
      case ReplayChunkId.Cmds:
        blocks.push(parseCmdsChunk(ch.data, blocks.length, ch.offset));
        break;
      case ReplayChunkId.Hash:
        hashes = decodeHashes(ch.data, ch.offset);
        break;
      case ReplayChunkId.Mark:
        marks = decodeMarks(ch.data, ch.offset);
        break;
      default:
        meta = decodeMeta(ch.data, ch.offset);
        break;
    }
  }
  if (hashes === null) throw new FormatError('missing-chunk', `mandatory chunk '${ReplayChunkId.Hash}' is missing`, ReplayChunkId.Hash);
  if (marks === null) throw new FormatError('missing-chunk', `mandatory chunk '${ReplayChunkId.Mark}' is missing`, ReplayChunkId.Mark);
  if (head.hashInterval !== hashes.interval) {
    throw new FormatError('bad-value', `head.hashInterval ${head.hashInterval} differs from HASH interval ${hashes.interval}`, ReplayChunkId.Hash);
  }
  if (head.subHashInterval !== hashes.subInterval) {
    throw new FormatError('bad-value', `head.subHashInterval ${head.subHashInterval} differs from HASH subInterval ${hashes.subInterval}`, ReplayChunkId.Hash);
  }
  const tainted = (head.flags & ReplayFlags.Tainted) !== 0;
  if (!tainted && hasTaintMark(marks)) {
    throw new FormatError('bad-value', 'Cheat/DevReload/Restore mark without the flag Tainted', ReplayChunkId.Head, headChunk.offset);
  }
  if (meta !== null) {
    // Cheap bound without decoding: hashes, marks and the first tick of the last non-empty block
    // (verifyBlocks: the exact last command tick).
    const metaOffset = chunks.find((ch) => ch.id === ReplayChunkId.Meta)!.offset;
    checkMetaEnd(meta, lastHashOrMarkTick(hashes, marks), 'last hash or mark', metaOffset);
    const lastBlock = lastNonEmptyBlock(blocks);
    if (lastBlock !== null) checkMetaEnd(meta, lastBlock.firstTick, `CMDS block ${lastBlock.index}`, metaOffset);
  }
  const replay: RtsReplay = { formatVersion: c.formatVersion, head, game, blocks, hashes, marks, meta, unknown, chunks, byteLength: bytes.length };
  if (opts.verifyBlocks === true) {
    for (const b of blocks) decodeCmdsBlock(b);
    if (meta !== null) {
      const metaOffset = chunks.find((ch) => ch.id === ReplayChunkId.Meta)!.offset;
      checkMetaEnd(meta, lastCommandTick(replay), 'last command', metaOffset);
    }
  }
  return replay;
}

function lastNonEmptyBlock(blocks: readonly CmdsBlockRef[]): CmdsBlockRef | null {
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]!.entryCount > 0) return blocks[i]!;
  return null;
}

/** Tick of the last command entry (decodes the last non-empty CMDS block), −1 without commands. */
export function lastCommandTick(replay: RtsReplay): number {
  const b = lastNonEmptyBlock(replay.blocks);
  if (b === null) return -1;
  const entries = decodeCmdsBlock(b);
  return entries[entries.length - 1]!.tick;
}

/**
 * Last tick of the recorded content: the largest tick of any command, rule hash, sub-hash row or
 * mark (decodes the last non-empty CMDS block once); 0 for an empty replay. Unlike META.endTick
 * (descriptive) this is what the file proves.
 */
export function replayContentEndTick(replay: RtsReplay): number {
  return Math.max(0, lastCommandTick(replay), lastHashOrMarkTick(replay.hashes, replay.marks));
}

// ---- tolerant head reader ----------------------------------------------------------------------

const KNOWN_CHUNK_VERSIONS: Readonly<Record<string, number>> = {
  [ReplayChunkId.Head]: HEAD_CHUNK_VERSION,
  [ReplayChunkId.Game]: GAME_CHUNK_VERSION,
  [ReplayChunkId.Cmds]: CMDS_CHUNK_VERSION,
  [ReplayChunkId.Hash]: HASH_CHUNK_VERSION,
  [ReplayChunkId.Mark]: MARK_CHUNK_VERSION,
  [ReplayChunkId.Meta]: META_CHUNK_VERSION,
};

/**
 * Tolerant reader of the version-independent part of a .rtsreplay (see module doc): for any
 * container / format / HEAD / protocol version. Frozen for all versions: the 16-byte file header
 * (magic 'RTSR', u16 containerVersion, u16 formatVersion, u32 chunkCount), the chunk framing
 * (4CC, u32 length, data, padding, CRC), HEAD as the first chunk with its frozen prefix (chunks.ts)
 * and u16 chunkVersion as the first field of every chunk. Checks the magic, the HEAD framing and
 * CRC; chunks behind a broken framing are simply not scanned. Throws FormatError only if even the
 * HEAD prefix cannot be read ('bad-magic', 'truncated', 'missing-chunk', 'bad-crc', …).
 */
export function readRtsReplayHead(bytes: Uint8Array): ReplayHeadInfo {
  if (!(bytes instanceof Uint8Array)) throw new FormatError('truncated', 'input is not a Uint8Array');
  if (bytes.length < CONTAINER_HEADER_BYTES) {
    throw new FormatError('truncated', `file has ${bytes.length} bytes, header needs ${CONTAINER_HEADER_BYTES}`, null, 0);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== fourCC(RTSREPLAY_MAGIC)) throw new FormatError('bad-magic', `expected '${RTSREPLAY_MAGIC}'`, null, 0);
  const containerVersion = dv.getUint16(4, true);
  const formatVersion = dv.getUint16(6, true);
  const chunkCount = dv.getUint32(8, true);
  const chunkVersions: Record<string, number> = {};
  let head: ReturnType<typeof decodeHeadPrefix> | null = null;
  let p = CONTAINER_HEADER_BYTES;
  for (let i = 0; i < chunkCount; i++) {
    if (p + 8 > bytes.length) break;
    const idNum = dv.getUint32(p, true);
    const id = String.fromCharCode(idNum & 0xff, (idNum >>> 8) & 0xff, (idNum >>> 16) & 0xff, idNum >>> 24);
    const len = dv.getUint32(p + 4, true);
    const padded = (len + 3) & ~3;
    const end = p + 8 + padded + 4;
    if (!isFourCC(id) || len > bytes.length || end > bytes.length) {
      if (i === 0) throw new FormatError('truncated', 'the HEAD chunk runs past the end of the file', id, p);
      break;
    }
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (i === 0) {
      if (id !== ReplayChunkId.Head) throw new FormatError('missing-chunk', `the first chunk must be '${ReplayChunkId.Head}', not '${id}'`, id, p);
      const stored = dv.getUint32(p + 8 + padded, true);
      const crc = crc32Update(0, bytes, p, 8 + len);
      if (crc !== stored) throw new FormatError('bad-crc', `CRC 0x${crc.toString(16)} != stored 0x${stored.toString(16)}`, id, p + 8 + padded);
      head = decodeHeadPrefix(data, p);
    }
    if (KNOWN_CHUNK_VERSIONS[id] !== undefined && len >= 2) {
      const v = data[0]! | (data[1]! << 8);
      if (v > (chunkVersions[id] ?? 0)) chunkVersions[id] = v;
    }
    p = end;
  }
  if (head === null) throw new FormatError('missing-chunk', `mandatory chunk '${ReplayChunkId.Head}' is missing`, ReplayChunkId.Head);
  return {
    containerVersion,
    formatVersion,
    headChunkVersion: head.chunkVersion,
    headFormatVersion: head.formatVersion,
    protocolVersion: head.protocolVersion,
    hashInterval: head.hashInterval,
    subHashInterval: head.subHashInterval,
    sourceLogVersion: head.sourceLogVersion,
    simId: head.simId,
    bpSimHash: head.bpSimHash,
    mapSimHash: head.mapSimHash,
    layoutHash: head.layoutHash,
    flags: head.flags,
    simBuild: head.simBuild,
    buildHash: head.buildHash,
    chunkVersions,
  };
}

/**
 * Whether this build's strict reader can parse a replay with this head info: null = yes, else the
 * reason ('format': container / format / chunk version newer or unknown; 'protocol': another
 * command protocol version, older or newer). A replay that is not parseable here is a build
 * compatibility case (redirect to /b/<buildHash>/), not a broken file.
 */
export function replayFormatIncompatibility(info: ReplayHeadInfo): ReplayFormatIncompatibility | null {
  if (info.containerVersion !== CONTAINER_VERSION) {
    return { reason: 'format', detail: `container version ${info.containerVersion} (this build reads ${CONTAINER_VERSION})` };
  }
  if (info.formatVersion < 1 || info.formatVersion > RTSREPLAY_FORMAT_VERSION) {
    return { reason: 'format', detail: `.rtsreplay format version ${info.formatVersion} (this build reads 1..${RTSREPLAY_FORMAT_VERSION})` };
  }
  for (const id of Object.keys(KNOWN_CHUNK_VERSIONS)) {
    const v = info.chunkVersions[id];
    if (v !== undefined && v > KNOWN_CHUNK_VERSIONS[id]!) {
      return { reason: 'format', detail: `${id} chunk version ${v} (this build reads ≤ ${KNOWN_CHUNK_VERSIONS[id]!})` };
    }
  }
  if (info.protocolVersion !== COMMAND_BATCH_VERSION) {
    return { reason: 'protocol', detail: `command protocol version ${info.protocolVersion} (this build: ${COMMAND_BATCH_VERSION})` };
  }
  return null;
}

/** All tick entries of all blocks, ascending (decodes every block). */
export function readAllCommands(replay: RtsReplay): ReplayTickCommands[] {
  const out: ReplayTickCommands[] = [];
  for (const b of replay.blocks) for (const e of decodeCmdsBlock(b)) out.push(e);
  return out;
}

/**
 * Index of the CMDS block holding `tick` (⌊tick / 600⌋), or −1 if the replay has no block for it
 * (negative / non-integer ticks, ticks after the block of the last command).
 */
export function blockIndexForTick(replay: RtsReplay, tick: number): number {
  if (!Number.isInteger(tick) || tick < 0) return -1;
  const i = Math.floor(tick / CMDS_BLOCK_TICKS);
  return i < replay.blocks.length ? i : -1;
}

/** Writes a read replay back unchanged (all chunks incl. unknown ones): byte-identical to its input. */
export function rewriteRtsReplay(replay: RtsReplay): Uint8Array {
  return writeContainer(RTSREPLAY_MAGIC, replay.formatVersion, replay.chunks);
}

/** The writer input of a read replay (decodes every block; unknown chunks become extraChunks). */
export function rtsReplayToInput(replay: RtsReplay): RtsReplayInput {
  return {
    head: replay.head,
    game: replay.game,
    commands: readAllCommands(replay),
    hashes: replay.hashes,
    marks: replay.marks,
    meta: replay.meta,
    extraChunks: replay.unknown.map((ch) => ({ id: ch.id, data: ch.data })),
  };
}

/** Size breakdown of a replay file (reads it). */
export function replaySizeReport(bytes: Uint8Array): ReplaySizeReport {
  const replay = readRtsReplay(bytes);
  const byChunk: Record<string, number> = { header: CONTAINER_HEADER_BYTES };
  for (const ch of replay.chunks) {
    const n = CHUNK_OVERHEAD_BYTES + ((ch.data.length + 3) & ~3);
    byChunk[ch.id] = (byChunk[ch.id] ?? 0) + n;
  }
  let cmdsRawBytes = 0;
  let cmdsStoredBytes = 0;
  for (const b of replay.blocks) {
    cmdsRawBytes += b.rawLength;
    cmdsStoredBytes += b.payload.length;
  }
  return { total: bytes.length, byChunk, cmdsRawBytes, cmdsStoredBytes, blocks: replay.blocks.length };
}
