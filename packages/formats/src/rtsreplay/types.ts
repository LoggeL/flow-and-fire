/**
 * Public constants and types of the .rtsreplay format (PLAN §3.11). Byte layouts: see the chunk
 * modules (head.ts, game.ts, cmds.ts, hash.ts, mark.ts, meta.ts) and
 * docs/status/track-replay/p1.md.
 */

import type { ReadChunk } from '../container.ts';

export const RTSREPLAY_MAGIC = 'RTSR';
/** Container formatVersion written by this build; readers reject newer versions. */
export const RTSREPLAY_FORMAT_VERSION = 1;
/**
 * Layout version of each known chunk (first u16 of the chunk data), versioned independently:
 * a change of one chunk's layout or coding rules bumps only its own constant, readers accept every
 * version up to it (older versions keep their decoder, see decodeCmdsRaw) and reject newer ones
 * with 'unsupported-version'. APPEND-ONLY history in docs/status/track-replay.md.
 */
export const HEAD_CHUNK_VERSION = 1;
export const GAME_CHUNK_VERSION = 1;
export const CMDS_CHUNK_VERSION = 1;
export const HASH_CHUNK_VERSION = 1;
export const MARK_CHUNK_VERSION = 1;
export const META_CHUNK_VERSION = 1;
/** Ticks per CMDS block (60 s at 10 ticks/s): the unit of seeking and of compression. */
export const CMDS_BLOCK_TICKS = 600;
/**
 * Upper bound of a CMDS block's raw (decompressed) data and of the command batches decoded from
 * it. Readers reject larger declared lengths before allocating; the writer refuses to produce
 * blocks the reader would reject.
 */
export const MAX_CMDS_BLOCK_BYTES = 16 * 1024 * 1024;

/** Chunk ids. HEAD, GAME, HASH and MARK are mandatory, CMDS repeats, META is optional. */
export const ReplayChunkId = {
  Head: 'HEAD',
  Game: 'GAME',
  Cmds: 'CMDS',
  Hash: 'HASH',
  Mark: 'MARK',
  Meta: 'META',
} as const;

/**
 * Mark kinds. APPEND-ONLY. Values 1–7 equal @faf/sim-host MarkKind (command log), 8+ are
 * replay-only. Readers keep unknown kinds.
 */
export const ReplayMarkKind = {
  Pause: 1,
  Resume: 2,
  /** value = speed in ‰ */
  Speed: 3,
  /** A command batch of this tick contained Op.Cheat (taints). */
  Cheat: 4,
  /** Dev hot reload of sim code/data (taints). */
  DevReload: 5,
  /** value = number of ticks requested. */
  Step: 6,
  /** The arena was restored from a snapshot at this tick (taints). */
  Restore: 7,
  /** An AI army exceeded its time budget; value = army. */
  AiTimeout: 8,
} as const;
export type ReplayMarkKind = (typeof ReplayMarkKind)[keyof typeof ReplayMarkKind];

/**
 * True for mark kinds this build knows to taint a replay. A known taint mark requires the HEAD
 * flag Tainted; the flag without a known taint mark is accepted (taint kinds of newer builds).
 */
export function isTaintMarkKind(kind: number): boolean {
  return kind === ReplayMarkKind.Cheat || kind === ReplayMarkKind.DevReload || kind === ReplayMarkKind.Restore;
}

/** HEAD flag bits. Unknown bits are kept. */
export const ReplayFlags = {
  /** Contains Cheat/DevReload/Restore marks: not valid for ranking/verification. */
  Tainted: 1,
  /** The game ran to its end (a result exists). */
  Complete: 2,
  /** Converted from a crash-truncated command log: ends at the last valid tick. */
  Truncated: 4,
} as const;
export type ReplayFlags = (typeof ReplayFlags)[keyof typeof ReplayFlags];

/** CMDS block codecs. */
export const CmdsCodec = {
  /** Raw block data stored as is. */
  Stored: 0,
  /** Raw DEFLATE (RFC 1951) of the raw block data. */
  DeflateRaw: 1,
} as const;
export type CmdsCodec = (typeof CmdsCodec)[keyof typeof CmdsCodec];

/** Army kinds of GAME. */
export const ReplayArmyKind = {
  Human: 0,
  Ai: 1,
  Observer: 2,
} as const;
export type ReplayArmyKind = (typeof ReplayArmyKind)[keyof typeof ReplayArmyKind];

export interface ReplayHead {
  /** Container format version (= RTSREPLAY_FORMAT_VERSION when written). */
  readonly formatVersion: number;
  /** SIM_BUILD of the recording sim (human readable). */
  readonly simBuild: string;
  /** Build id for the /b/<buildHash>/ redirect (PLAN §3.11). */
  readonly buildHash: string;
  readonly simId: number;
  readonly bpSimHash: number;
  readonly mapSimHash: number;
  readonly layoutHash: number;
  /** Command batch format version (@faf/protocol COMMAND_BATCH_VERSION). */
  readonly protocolVersion: number;
  /** Rule hash interval in ticks (u16; = HASH.interval). */
  readonly hashInterval: number;
  /** Sub-hash interval in ticks (u16; = HASH.subInterval). */
  readonly subHashInterval: number;
  /** ReplayFlags bit set (u32). */
  readonly flags: number;
  /** 0 = recorded directly, 1/2 = converted from a FAFL command log of that version. */
  readonly sourceLogVersion: number;
}

export interface ReplayArmy {
  /** Army index 0..15 (ArmyId of the commands). */
  readonly index: number;
  /** ReplayArmyKind: 0 human, 1 AI, 2 observer. */
  readonly kind: number;
  readonly team: number;
  /** AIx resource multiplier in ‰ (1000 = none). */
  readonly aixPermille: number;
  readonly name: string;
  /** AI profile id ('' for humans). */
  readonly aiProfile: string;
  /** Faction id. */
  readonly faction: string;
}

export interface ReplayGame {
  readonly seed: number;
  readonly mapName: string;
  readonly mapSizeWu: number;
  /** Army of the recording player, −1 = observer. */
  readonly playerArmy: number;
  readonly armies: readonly ReplayArmy[];
  /** 16×16 alliance bit matrix, bit a·16+b (byte ⌊bit/8⌋, bit bit%8). Exactly 32 bytes. */
  readonly alliances: Uint8Array;
}

export interface ReplayTickCommands {
  readonly tick: number;
  /** @faf/protocol command batch; every envelope carries `tick`. */
  readonly batch: Uint8Array;
}

export interface ReplayHashes {
  /** Rule hash interval (ticks); hashes[i] is the rule hash after tick firstTick + i·interval. */
  readonly interval: number;
  readonly firstTick: number;
  readonly hashes: Uint32Array;
  /** Sub-hash interval (ticks); row k belongs to tick subFirstTick + k·subInterval. */
  readonly subInterval: number;
  readonly subFirstTick: number;
  /** Rule region names (sub-hash columns). */
  readonly regionNames: readonly string[];
  /** Row-major: index k·regionNames.length + r. */
  readonly subHashes: Uint32Array;
}

export interface ReplayMark {
  readonly tick: number;
  /** ReplayMarkKind (unknown kinds are kept). */
  readonly kind: number;
  readonly value: number;
}

export interface ReplayMetaPlayer {
  readonly army: number;
  readonly name: string;
}

export interface ReplayResult {
  /** Winning army or team id, −1 = none (draw, aborted, unknown). */
  readonly winner: number;
  readonly reason: string;
}

export interface ReplayMeta {
  readonly durationTicks: number;
  readonly endTick: number;
  readonly players: readonly ReplayMetaPlayer[];
  readonly result: ReplayResult;
  /** Short statistics; integers only. */
  readonly stats: Readonly<Record<string, number>>;
  readonly extra: Readonly<Record<string, string>>;
  /**
   * Top-level keys this build does not know (written by newer builds), key → canonical JSON text
   * of the value. Kept so a read → write roundtrip reproduces the chunk; absent or empty = none.
   */
  readonly extensions?: Readonly<Record<string, string>>;
}

export interface ReplayExtraChunk {
  /** Any 4CC other than the known replay chunk ids. */
  readonly id: string;
  readonly data: Uint8Array;
}

export interface RtsReplayInput {
  readonly head: ReplayHead;
  readonly game: ReplayGame;
  /** Ascending, unique ticks. */
  readonly commands: readonly ReplayTickCommands[];
  readonly hashes: ReplayHashes;
  /** Non-decreasing ticks. */
  readonly marks: readonly ReplayMark[];
  /** null = no META chunk. */
  readonly meta: ReplayMeta | null;
  /** Unknown chunks written after the known ones (forward-compat tests, tools). */
  readonly extraChunks?: readonly ReplayExtraChunk[];
}

/** A CMDS block as read from the file (decoded lazily with decodeCmdsBlock). */
export interface CmdsBlockRef {
  /** Block index; covers ticks [index·600, index·600 + 600). */
  readonly index: number;
  /** CMDS chunk version of the block (selects the decoder, ≤ CMDS_CHUNK_VERSION). */
  readonly version: number;
  readonly firstTick: number;
  /** CmdsCodec. */
  readonly codec: number;
  /** Byte length of the raw (decompressed) block data. */
  readonly rawLength: number;
  /** Number of tick entries in the block. */
  readonly entryCount: number;
  /** Stored block data (view into the file bytes). */
  readonly payload: Uint8Array;
  /** File offset of the chunk (error context). */
  readonly chunkOffset: number;
}

export interface RtsReplay {
  readonly formatVersion: number;
  readonly head: ReplayHead;
  readonly game: ReplayGame;
  readonly blocks: readonly CmdsBlockRef[];
  readonly hashes: ReplayHashes;
  readonly marks: readonly ReplayMark[];
  readonly meta: ReplayMeta | null;
  /** Chunks with unknown ids (kept byte-exact). */
  readonly unknown: readonly ReadChunk[];
  /** All chunks in file order (views into the input bytes). */
  readonly chunks: readonly ReadChunk[];
  readonly byteLength: number;
}

/**
 * Result of the tolerant HEAD reader (readRtsReplayHead): the version-independent part of a
 * .rtsreplay — container header, the frozen HEAD prefix and the chunk versions — readable for
 * files of any (older or newer) format, chunk or protocol version, so a build can list them and
 * redirect to /b/<buildHash>/ (PLAN §3.1, §3.11).
 */
export interface ReplayHeadInfo {
  /** Container version (file header u16 at offset 4). */
  readonly containerVersion: number;
  /** Container formatVersion (file header u16 at offset 6). */
  readonly formatVersion: number;
  /** HEAD chunk version. */
  readonly headChunkVersion: number;
  /** HEAD.formatVersion (copy of the container's in every HEAD version). */
  readonly headFormatVersion: number;
  readonly protocolVersion: number;
  readonly hashInterval: number;
  readonly subHashInterval: number;
  readonly sourceLogVersion: number;
  readonly simId: number;
  readonly bpSimHash: number;
  readonly mapSimHash: number;
  readonly layoutHash: number;
  readonly flags: number;
  readonly simBuild: string;
  readonly buildHash: string;
  /**
   * Highest chunk version per known chunk id found in the file (unknown ids are not listed;
   * chunks the scan could not reach are missing).
   */
  readonly chunkVersions: Readonly<Record<string, number>>;
}

/** Why this build's reader cannot parse a replay whose HEAD it could read. */
export interface ReplayFormatIncompatibility {
  /** 'format' = container/format/chunk version; 'protocol' = command protocol version. */
  readonly reason: 'format' | 'protocol';
  readonly detail: string;
}
