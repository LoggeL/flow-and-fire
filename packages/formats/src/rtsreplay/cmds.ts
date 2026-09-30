/**
 * CMDS blocks of .rtsreplay: the command batches of 600 ticks each (PLAN §3.11).
 *
 * Chunk data (little-endian):
 *
 *   u16 chunkVersion (1) | u8 codec (0 stored, 1 deflate-raw) | u8 reserved (0)
 *   | u32 firstTick (= index·600) | u32 entryCount | u32 rawLength | payload
 *
 * `payload` is the raw block (codec 0; payload.length = rawLength) or a raw DEFLATE stream of it
 * (codec 1; any valid stream is read, e.g. from CompressionStream('deflate-raw') or zlib). The
 * writer tries raw DEFLATE (fflate, canonical level) and keeps codec 0 when that does not shrink
 * the data — which is the normal case, because the raw block is already entropy coded.
 *
 * Raw block (empty iff entryCount = 0): the output of the adaptive binary range coder of
 * rangecoder.ts over the symbols below. Every model starts flat and all coding state (sequence
 * and op predictors, list dictionaries, known handle sets, position references) starts empty in
 * each block, so a block decodes on its own (seeking needs only the block of the target tick).
 * "U" = UIntModel integer, "Z" = zigzag-mapped signed integer through a UIntModel, "bit" = one
 * adaptive bit, "byte" = 255-node byte tree; contexts in brackets.
 *
 *   per tick entry:  U tickDelta−1 (first entry: tick − firstTick), U envelopeCount (≤ 65535)
 *   per envelope:
 *     army          byte [previous army of the entry or "entry start"]
 *     flags         byte [the army's previous flags & 1]
 *     seq           bit "= predicted" (previous seq of the army + 1, u16; 0 for the first),
 *                   else Z of the signed 16-bit difference
 *     op            bit "= previous op of the army" [flags & 1], else byte [flags & 1]
 *     unit list     bit "= front of the army's list dictionary" [flags & 1, op group]; else a
 *                   2-bit kind [op group]: 0 empty, 1 new, 2 repeat of dictionary entry i ≥ 1
 *                   (U i−1, entry moves to the front), 3 dictionary entry i minus units
 *                   (U i, U removedCount−1, U gaps of the removed positions; result enters the
 *                   front). New lists: U count−1 [op group], then per handle in original order a
 *                   bit "known" [first / after known / after new]; known handles (in the army's
 *                   known set K, sorted by slot index then generation) as rank (first: U rank,
 *                   then Z rank − previous rank), unknown handles as slot index (first: U index,
 *                   then Z index − previous index) plus generation, and are added to K
 *                   (≤ 4096 per army) and to the block slot table. The dictionary holds the last
 *                   32 non-empty lists per army.
 *     generation    if the slot table has the slot: Z (gen − highest recorded gen of the slot) as
 *                   a signed 12-bit difference, else U gen.
 *     payload       bit "length = previous length of this op in the block" (only if there is
 *                   one), else U length; then by op (prediction hints only, bijective for any
 *                   bytes, so payloads of other layouts still roundtrip):
 *                     position ops (Move, AttackMove, AttackGround, Patrol, SetRally,
 *                     FormationMove at byte 0; Build at byte 2) with room for x, y, z (3 × i32):
 *                     U shift s = min(ctz x, ctz z, 24) [class], Z dx = (x >> s) − (rx >> s),
 *                     Z dz likewise [class, axis], Z dy = y − ry' [class] (int32 wrap), where
 *                     (rx, rz) is the last position of the same class (moves, rally points,
 *                     build sites) of the army, else of the army, else of the block, else 0, and
 *                     ry' the height of the nearest of the last 64 positions of the block
 *                     (|dx| + |dz|), else ry;
 *                     target ops (Attack, Guard, Assist, Repair, Reclaim, Overcharge) with
 *                     exactly 4 bytes: U slot index + generation (as above);
 *                     all other bytes: byte [op, min(byte index, 15)].
 *
 * Changing any of these rules changes the meaning of existing blocks and requires a new
 * CMDS_CHUNK_VERSION: the encoder then writes the new version, the old decoder stays reachable
 * via the version dispatch of decodeCmdsRaw (every CmdsBlockRef carries its block's version), so
 * files with older blocks keep decoding with the rules they were written with.
 */

import {
  BATCH_HEADER_BYTES,
  COMMAND_BATCH_VERSION,
  CommandBatchView,
  ENVELOPE_FIXED_BYTES,
  MAX_BATCH_COMMANDS,
  MAX_COMMAND_UNITS,
  MAX_PAYLOAD_BYTES,
  Op,
  validateBatch,
} from '@faf/protocol';
import { DEFAULT_DEFLATE_LEVEL, deflateRaw, inflateRaw } from '../deflate.ts';
import { FormatError } from '../errors.ts';
import { ByteReader, ByteWriter, unzigzag, zigzag } from './bytes.ts';
import { codeByte, codeTree, codeUInt, newProbs, RangeDecoder, RangeEncoder, UIntModel, type Coder } from './rangecoder.ts';
import {
  CMDS_BLOCK_TICKS,
  CmdsCodec,
  CMDS_CHUNK_VERSION,
  MAX_CMDS_BLOCK_BYTES,
  ReplayChunkId,
  type CmdsBlockRef,
  type ReplayTickCommands,
} from './types.ts';

/** Bytes of the CMDS chunk header before the payload. */
export const CMDS_HEADER_BYTES = 16;
/** Upper bound of envelopes in one block (reader and writer). */
export const MAX_CMDS_BLOCK_ENVELOPES = 1 << 18;

const CHUNK = ReplayChunkId.Cmds;
const ARMY_SLOTS = 256;
const ARMY_CTX_NONE = 16;
const DICT_SIZE = 32;
const KNOWN_MAX = 4096;
const SLOT_TABLE_MAX = 16384;
const MAX_POS_SHIFT = 24;
const NEAR_RING = 64;
const HANDLE_INDEX_MAX = 0xfffff;
const GEN_MASK = 0xfff;
const OP_GROUPS = 4;

const KIND_EMPTY = 0;
const KIND_NEW = 1;
const KIND_REPEAT = 2;
const KIND_SUBSET = 3;

/** Position classes: moves, rally points, build sites; 3 = any class of the army. */
const POS_CLASSES = 4;
const POS_ANY = 3;

/** Byte offset of the position hint in the payload of `op`, −1 if none. */
function posOffset(op: number): number {
  switch (op) {
    case Op.Move:
    case Op.AttackMove:
    case Op.AttackGround:
    case Op.Patrol:
    case Op.SetRally:
    case Op.FormationMove:
      return 0;
    case Op.Build:
      return 2;
    default:
      return -1;
  }
}

function posClass(op: number): number {
  if (op === Op.SetRally) return 1;
  if (op === Op.Build) return 2;
  return 0;
}

function isTargetOp(op: number): boolean {
  return op === Op.Attack || op === Op.Guard || op === Op.Assist || op === Op.Repair || op === Op.Reclaim || op === Op.Overcharge;
}

/** Context group of an op for the unit list models: army orders, builder orders, factory orders, rest. */
function opGroup(op: number): number {
  switch (op) {
    case Op.Move:
    case Op.AttackMove:
    case Op.Attack:
    case Op.AttackGround:
    case Op.Patrol:
    case Op.FormationMove:
    case Op.GroupMove:
    case Op.Stop:
    case Op.FireState:
    case Op.ToggleAbility:
    case Op.SelfDestruct:
      return 0;
    case Op.Build:
    case Op.Repair:
    case Op.Reclaim:
    case Op.Assist:
    case Op.Guard:
    case Op.Overcharge:
      return 1;
    case Op.FactoryQueue:
    case Op.FactoryRepeat:
    case Op.SetRally:
    case Op.Upgrade:
    case Op.TogglePause:
    case Op.SetPriority:
      return 2;
    default:
      return 3;
  }
}

function ctz32(v: number): number {
  if (v === 0) return 32;
  return 31 - Math.clz32(v & -v);
}

/** Sort key of a handle: slot index major, generation minor (fits in a u32). */
function handleKey(h: number): number {
  return (h & HANDLE_INDEX_MAX) * 4096 + ((h >>> 20) & GEN_MASK);
}

function keyHandle(key: number): number {
  return (((key & GEN_MASK) << 20) | (key >>> 12)) >>> 0;
}

/** First index i with a[i] >= v (a ascending). */
function lowerBound(a: readonly number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (a[m]! < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function sameList(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Adaptive models of one block. */
class Models {
  readonly tickDelta = new UIntModel();
  readonly count = new UIntModel();
  readonly army = newProbs(256 * (ARMY_CTX_NONE + 1));
  readonly flags = newProbs(256 * 2);
  readonly seqOk = newProbs(1);
  readonly seqDelta = new UIntModel();
  readonly opSame = newProbs(2);
  readonly op = newProbs(256 * 2);
  readonly listFront = newProbs(2 * OP_GROUPS);
  readonly listKind = newProbs(4 * OP_GROUPS);
  readonly repeatIndex = new UIntModel();
  readonly subsetIndex = new UIntModel();
  readonly removedCount = new UIntModel();
  readonly removedGap = new UIntModel();
  readonly unitCount: readonly UIntModel[] = [new UIntModel(), new UIntModel(), new UIntModel(), new UIntModel()];
  readonly tokKnown = newProbs(3);
  readonly rankFirst = new UIntModel();
  readonly rankDelta = new UIntModel();
  readonly slotFirst = new UIntModel();
  readonly slotDelta = new UIntModel();
  readonly genDelta = new UIntModel();
  readonly genRaw = new UIntModel();
  readonly lenSame = newProbs(1);
  readonly len = new UIntModel();
  readonly posShift: readonly UIntModel[] = [new UIntModel(), new UIntModel(), new UIntModel()];
  readonly posD: readonly UIntModel[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new UIntModel());
  readonly targetIdx = new UIntModel();
  private readonly payBytes: (Uint16Array | undefined)[] = [];

  /** Byte tree of payload byte `i` of `op` (allocated on first use). */
  payByte(op: number, i: number): Uint16Array {
    const k = op * 16 + (i < 15 ? i : 15);
    let p = this.payBytes[k];
    if (p === undefined) {
      p = newProbs(256);
      this.payBytes[k] = p;
    }
    return p;
  }
}

/** Per-block coding state (identical in encoder and decoder). */
class BlockState {
  readonly m = new Models();
  readonly lastSeq = new Int32Array(ARMY_SLOTS).fill(-1);
  readonly lastOp = new Uint8Array(ARMY_SLOTS);
  readonly lastFlags = new Uint8Array(ARMY_SLOTS);
  /** Previous payload length per op, −1 = none yet. */
  readonly lastLen = new Int32Array(256).fill(-1);
  readonly dicts: (Uint32Array[] | undefined)[] = [];
  readonly known: (number[] | undefined)[] = [];
  /** Sorted keys of every handle seen as a new list member or target in the block. */
  readonly slots: number[] = [];
  readonly posSet = new Uint8Array(ARMY_SLOTS * POS_CLASSES);
  readonly pos = new Int32Array(ARMY_SLOTS * POS_CLASSES * 3);
  lastPosSet = false;
  readonly lastPos = new Int32Array(3);
  readonly ring = new Int32Array(NEAR_RING * 3);
  ringCount = 0;
  envelopes = 0;

  dict(army: number): Uint32Array[] {
    let d = this.dicts[army];
    if (d === undefined) {
      d = [];
      this.dicts[army] = d;
    }
    return d;
  }

  knownSet(army: number): number[] {
    let k = this.known[army];
    if (k === undefined) {
      k = [];
      this.known[army] = k;
    }
    return k;
  }

  pushDict(army: number, list: Uint32Array): void {
    const d = this.dict(army);
    d.unshift(list);
    if (d.length > DICT_SIZE) d.pop();
  }

  /** Highest generation recorded for slot `idx`, −1 if none. */
  slotGen(idx: number): number {
    const i = lowerBound(this.slots, (idx + 1) * 4096) - 1;
    if (i >= 0 && this.slots[i]! >>> 12 === idx) return this.slots[i]! & GEN_MASK;
    return -1;
  }

  noteSlot(key: number): void {
    const s = this.slots;
    const i = lowerBound(s, key);
    if (i < s.length && s[i] === key) return;
    if (s.length < SLOT_TABLE_MAX) s.splice(i, 0, key);
  }

  /** Reference position for (army, class) into out[0..2]. */
  posRef(army: number, cls: number, out: Int32Array): void {
    const base = army * POS_CLASSES;
    let slot = -1;
    if (this.posSet[base + cls] !== 0) slot = base + cls;
    else if (this.posSet[base + POS_ANY] !== 0) slot = base + POS_ANY;
    if (slot >= 0) {
      out[0] = this.pos[slot * 3]!;
      out[1] = this.pos[slot * 3 + 1]!;
      out[2] = this.pos[slot * 3 + 2]!;
    } else if (this.lastPosSet) {
      out.set(this.lastPos);
    } else {
      out.fill(0);
    }
  }

  /** Height of the nearest (|dx| + |dz|) recent position, or `fallback`. */
  nearY(x: number, z: number, fallback: number): number {
    const n = this.ringCount < NEAR_RING ? this.ringCount : NEAR_RING;
    let best = -1;
    let bestD = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(this.ring[i * 3]! - x) + Math.abs(this.ring[i * 3 + 2]! - z);
      if (best < 0 || d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best < 0 ? fallback : this.ring[best * 3 + 1]!;
  }

  setPos(army: number, cls: number, x: number, y: number, z: number): void {
    const base = army * POS_CLASSES;
    for (let k = 0; k < 2; k++) {
      const slot = k === 0 ? base + cls : base + POS_ANY;
      this.posSet[slot] = 1;
      this.pos[slot * 3] = x;
      this.pos[slot * 3 + 1] = y;
      this.pos[slot * 3 + 2] = z;
    }
    this.lastPosSet = true;
    this.lastPos[0] = x;
    this.lastPos[1] = y;
    this.lastPos[2] = z;
    const r = (this.ringCount % NEAR_RING) * 3;
    this.ring[r] = x;
    this.ring[r + 1] = y;
    this.ring[r + 2] = z;
    this.ringCount++;
  }
}

// ---- shared symbol coders (encoder and decoder) ------------------------------------------------

function fail(code: 'bad-value' | 'too-large' | 'non-canonical', detail: string, chunkOffset: number): never {
  throw new FormatError(code, detail, CHUNK, chunkOffset);
}

function codeGen(c: Coder, st: BlockState, idx: number, gen: number, off: number): number {
  const pred = st.slotGen(idx);
  if (pred < 0) return codeUInt(c, st.m.genRaw, gen, GEN_MASK, 'generation', CHUNK, off);
  const z = codeUInt(c, st.m.genDelta, zigzag(((gen - pred) << 20) >> 20), 0xfff, 'generation delta', CHUNK, off);
  return (pred + unzigzag(z)) & GEN_MASK;
}

/**
 * Codes a position of class `cls` (x, y, z in `xyz`; the decoder fills it) and updates the
 * references.
 */
function codePosition(c: Coder, st: BlockState, army: number, cls: number, xyz: Int32Array, ref: Int32Array, off: number): void {
  st.posRef(army, cls, ref);
  const m = st.m;
  const ex = xyz[0]!;
  const ey = xyz[1]!;
  const ez = xyz[2]!;
  const s = codeUInt(c, m.posShift[cls]!, Math.min(ctz32(ex), ctz32(ez), MAX_POS_SHIFT), MAX_POS_SHIFT, 'position shift', CHUNK, off);
  const dx = unzigzag(codeUInt(c, m.posD[cls * 3]!, zigzag(((ex >> s) - (ref[0]! >> s)) | 0)));
  const dz = unzigzag(codeUInt(c, m.posD[cls * 3 + 1]!, zigzag(((ez >> s) - (ref[2]! >> s)) | 0)));
  const x = (((ref[0]! >> s) + dx) | 0) << s;
  const z = (((ref[2]! >> s) + dz) | 0) << s;
  const ry = st.nearY(x, z, ref[1]!);
  const dy = unzigzag(codeUInt(c, m.posD[cls * 3 + 2]!, zigzag((ey - ry) | 0)));
  const y = (ry + dy) | 0;
  xyz[0] = x;
  xyz[1] = y;
  xyz[2] = z;
  st.setPos(army, cls, x, y, z);
}

// ---- encoder ---------------------------------------------------------------------------------

/** Removed positions if `list` is `base` minus a few units (order kept), else null. */
function subsetRemovals(base: Uint32Array, list: Uint32Array): number[] | null {
  const removed = base.length - list.length;
  if (list.length === 0 || removed <= 0 || removed > Math.max(2, base.length >>> 2)) return null;
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k < base.length; k++) {
    if (j < list.length && base[k] === list[j]) j++;
    else {
      out.push(k);
      if (out.length > removed) return null;
    }
  }
  return j === list.length ? out : null;
}

function encodeNewList(e: RangeEncoder, st: BlockState, army: number, group: number, list: Uint32Array): void {
  const m = st.m;
  const known = st.knownSet(army);
  codeUInt(e, m.unitCount[group]!, list.length - 1);
  let prevRank = 0;
  let prevIdx = 0;
  let prevNew = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i]!;
    const key = handleKey(h);
    const idx = h & HANDLE_INDEX_MAX;
    const r = lowerBound(known, key);
    const isKnown = r < known.length && known[r] === key;
    const ctx = i === 0 ? 0 : 1 + prevNew;
    e.bit(m.tokKnown, ctx, isKnown ? 1 : 0);
    if (isKnown) {
      if (i === 0) codeUInt(e, m.rankFirst, r);
      else codeUInt(e, m.rankDelta, zigzag(r - prevRank));
      prevNew = 0;
    } else {
      if (i === 0) codeUInt(e, m.slotFirst, idx);
      else codeUInt(e, m.slotDelta, zigzag(idx - prevIdx));
      codeGen(e, st, idx, (h >>> 20) & GEN_MASK, -1);
      st.noteSlot(key);
      if (known.length < KNOWN_MAX) known.splice(r, 0, key);
      prevNew = 1;
    }
    prevRank = r;
    prevIdx = idx;
  }
}

function encodeUnits(e: RangeEncoder, st: BlockState, army: number, flags: number, group: number, list: Uint32Array): void {
  const m = st.m;
  const dict = st.dict(army);
  const front = list.length > 0 && dict.length > 0 && sameList(dict[0]!, list);
  e.bit(m.listFront, (flags & 1) * OP_GROUPS + group, front ? 1 : 0);
  if (front) return;
  if (list.length === 0) {
    codeTree(e, m.listKind, group * 4, 2, KIND_EMPTY);
    return;
  }
  for (let i = 1; i < dict.length; i++) {
    if (sameList(dict[i]!, list)) {
      codeTree(e, m.listKind, group * 4, 2, KIND_REPEAT);
      codeUInt(e, m.repeatIndex, i - 1);
      const entry = dict.splice(i, 1)[0]!;
      dict.unshift(entry);
      return;
    }
  }
  for (let i = 0; i < dict.length; i++) {
    const rem = subsetRemovals(dict[i]!, list);
    if (rem !== null) {
      codeTree(e, m.listKind, group * 4, 2, KIND_SUBSET);
      codeUInt(e, m.subsetIndex, i);
      codeUInt(e, m.removedCount, rem.length - 1);
      let prev = -1;
      for (const r of rem) {
        codeUInt(e, m.removedGap, r - prev - 1);
        prev = r;
      }
      st.pushDict(army, list);
      return;
    }
  }
  codeTree(e, m.listKind, group * 4, 2, KIND_NEW);
  encodeNewList(e, st, army, group, list);
  st.pushDict(army, list);
}

function badInput(detail: string): never {
  throw new FormatError('bad-value', detail, CHUNK);
}

/**
 * Encodes the tick entries of one block into raw block data. Entries must have strictly
 * ascending ticks inside [firstTick, firstTick + 600) and valid batches whose envelope ticks
 * equal the entry tick (FormatError 'bad-value'); a block beyond the size limits throws
 * FormatError 'too-large'.
 */
export function encodeCmdsRaw(entries: readonly ReplayTickCommands[], firstTick: number): Uint8Array {
  if (entries.length === 0) return new Uint8Array(0);
  const e = new RangeEncoder();
  const st = new BlockState();
  const m = st.m;
  const view = new CommandBatchView();
  const ref = new Int32Array(3);
  const xyz = new Int32Array(3);
  let prevTick = firstTick - 1;
  let decodedBytes = 0;
  for (const entry of entries) {
    const tick = entry.tick;
    if (!Number.isInteger(tick) || tick <= prevTick || tick >= firstTick + CMDS_BLOCK_TICKS) {
      badInput(`tick ${tick} is outside block [${firstTick}, ${firstTick + CMDS_BLOCK_TICKS}) or not ascending`);
    }
    const batch = entry.batch;
    if (!(batch instanceof Uint8Array) || validateBatch(batch) < 0) badInput(`command batch of tick ${tick} is malformed`);
    decodedBytes += batch.length;
    if (decodedBytes > MAX_CMDS_BLOCK_BYTES) {
      throw new FormatError('too-large', `the block starting at tick ${firstTick} holds more than ${MAX_CMDS_BLOCK_BYTES} bytes of batches`, CHUNK);
    }
    const count = view.reset(batch);
    st.envelopes += count;
    if (st.envelopes > MAX_CMDS_BLOCK_ENVELOPES) {
      throw new FormatError('too-large', `the block starting at tick ${firstTick} holds more than ${MAX_CMDS_BLOCK_ENVELOPES} envelopes`, CHUNK);
    }
    codeUInt(e, m.tickDelta, tick - prevTick - 1);
    codeUInt(e, m.count, count);
    prevTick = tick;
    const dv = view.dataView;
    let prevArmy = ARMY_CTX_NONE;
    while (view.next()) {
      if (view.tick !== tick) badInput(`envelope ${view.index} of tick ${tick} carries tick ${view.tick}`);
      const army = view.army;
      const flags = view.flags;
      const op = view.op;
      codeByte(e, m.army.subarray(prevArmy * 256, prevArmy * 256 + 256), army);
      prevArmy = army < ARMY_CTX_NONE ? army : ARMY_CTX_NONE - 1;
      const fctx = st.lastFlags[army]! & 1;
      codeByte(e, m.flags.subarray(fctx * 256, fctx * 256 + 256), flags);
      st.lastFlags[army] = flags;
      const pred = (st.lastSeq[army]! + 1) & 0xffff;
      e.bit(m.seqOk, 0, view.seq === pred ? 1 : 0);
      if (view.seq !== pred) codeUInt(e, m.seqDelta, zigzag(((view.seq - pred) << 16) >> 16));
      st.lastSeq[army] = view.seq;
      const q = flags & 1;
      const sameOp = op === st.lastOp[army];
      e.bit(m.opSame, q, sameOp ? 1 : 0);
      if (!sameOp) codeByte(e, m.op.subarray(q * 256, q * 256 + 256), op);
      st.lastOp[army] = op;

      const list = new Uint32Array(view.unitCount);
      for (let i = 0; i < list.length; i++) list[i] = view.unitAt(i);
      encodeUnits(e, st, army, flags, opGroup(op), list);

      const off = view.payloadOffset;
      const len = view.payloadLength;
      const lastLen = st.lastLen[op]!;
      if (lastLen >= 0) e.bit(m.lenSame, 0, len === lastLen ? 1 : 0);
      if (len !== lastLen) codeUInt(e, m.len, len);
      st.lastLen[op] = len;
      const po = posOffset(op);
      if (po >= 0 && len >= po + 12) {
        for (let i = 0; i < po; i++) codeByte(e, m.payByte(op, i), batch[off + i]!);
        xyz[0] = dv.getInt32(off + po, true);
        xyz[1] = dv.getInt32(off + po + 4, true);
        xyz[2] = dv.getInt32(off + po + 8, true);
        codePosition(e, st, army, posClass(op), xyz, ref, -1);
        for (let i = po + 12; i < len; i++) codeByte(e, m.payByte(op, i), batch[off + i]!);
      } else if (len === 4 && isTargetOp(op)) {
        const h = dv.getUint32(off, true);
        const idx = h & HANDLE_INDEX_MAX;
        codeUInt(e, m.targetIdx, idx);
        codeGen(e, st, idx, (h >>> 20) & GEN_MASK, -1);
        st.noteSlot(handleKey(h));
      } else {
        for (let i = 0; i < len; i++) codeByte(e, m.payByte(op, i), batch[off + i]!);
      }
    }
  }
  return e.finish();
}

// ---- decoder ---------------------------------------------------------------------------------

/** Output buffer of one batch with a block-wide byte budget. */
class BatchOut {
  buf: Uint8Array;
  dv: DataView;
  len = 0;

  constructor(
    private readonly budget: { left: number },
    private readonly chunkOffset: number,
  ) {
    this.buf = new Uint8Array(64);
    this.dv = new DataView(this.buf.buffer);
  }

  reserve(n: number): void {
    if (n > this.budget.left) fail('too-large', `decoded batches exceed ${MAX_CMDS_BLOCK_BYTES} bytes`, this.chunkOffset);
    this.budget.left -= n;
    const need = this.len + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
}

function decodeNewList(d: RangeDecoder, st: BlockState, army: number, group: number, off: number): Uint32Array {
  const m = st.m;
  const n = codeUInt(d, m.unitCount[group]!, 0, MAX_COMMAND_UNITS - 1, 'unit count', CHUNK, off) + 1;
  const list = new Uint32Array(n);
  const known = st.knownSet(army);
  let prevRank = 0;
  let prevIdx = 0;
  let prevNew = 0;
  for (let i = 0; i < n; i++) {
    const ctx = i === 0 ? 0 : 1 + prevNew;
    if (d.bit(m.tokKnown, ctx) === 1) {
      const rank = i === 0 ? codeUInt(d, m.rankFirst, 0) : prevRank + unzigzag(codeUInt(d, m.rankDelta, 0));
      if (rank < 0 || rank >= known.length) fail('bad-value', `known unit rank ${rank} out of range (${known.length} known)`, off);
      const key = known[rank]!;
      list[i] = keyHandle(key);
      prevRank = rank;
      prevIdx = key >>> 12;
      prevNew = 0;
    } else {
      const idx = i === 0 ? codeUInt(d, m.slotFirst, 0) : prevIdx + unzigzag(codeUInt(d, m.slotDelta, 0));
      if (idx < 0 || idx > HANDLE_INDEX_MAX) fail('bad-value', `unit slot index ${idx} out of range`, off);
      const gen = codeGen(d, st, idx, 0, off);
      const key = idx * 4096 + gen;
      const rank = lowerBound(known, key);
      if (rank < known.length && known[rank] === key) fail('non-canonical', 'a known unit is coded as unknown', off);
      st.noteSlot(key);
      if (known.length < KNOWN_MAX) known.splice(rank, 0, key);
      list[i] = keyHandle(key);
      prevRank = rank;
      prevIdx = idx;
      prevNew = 1;
    }
  }
  return list;
}

function decodeUnits(d: RangeDecoder, st: BlockState, army: number, flags: number, group: number, off: number): Uint32Array {
  const m = st.m;
  const dict = st.dict(army);
  if (d.bit(m.listFront, (flags & 1) * OP_GROUPS + group) === 1) {
    if (dict.length === 0) fail('bad-value', 'unit list refers to an empty dictionary', off);
    return dict[0]!;
  }
  const kind = codeTree(d, m.listKind, group * 4, 2, 0);
  if (kind === KIND_EMPTY) return new Uint32Array(0);
  if (kind === KIND_NEW) {
    const list = decodeNewList(d, st, army, group, off);
    st.pushDict(army, list);
    return list;
  }
  if (kind === KIND_REPEAT) {
    const i = codeUInt(d, m.repeatIndex, 0, DICT_SIZE - 2, 'dictionary index', CHUNK, off) + 1;
    if (i >= dict.length) fail('bad-value', `unit list dictionary entry ${i} does not exist (${dict.length} entries)`, off);
    const entry = dict.splice(i, 1)[0]!;
    dict.unshift(entry);
    return entry;
  }
  const i = codeUInt(d, m.subsetIndex, 0, DICT_SIZE - 1, 'dictionary index', CHUNK, off);
  if (i >= dict.length) fail('bad-value', `unit list dictionary entry ${i} does not exist (${dict.length} entries)`, off);
  const base = dict[i]!;
  const removed = codeUInt(d, m.removedCount, 0, 0xffff, 'removed unit count', CHUNK, off) + 1;
  if (removed >= base.length) fail('bad-value', `removes ${removed} of ${base.length} units`, off);
  const drop = new Uint8Array(base.length);
  let p = -1;
  for (let k = 0; k < removed; k++) {
    p += codeUInt(d, m.removedGap, 0, 0xffff, 'removed unit gap', CHUNK, off) + 1;
    if (p >= base.length) fail('bad-value', `removed unit position ${p} out of range`, off);
    drop[p] = 1;
  }
  const list = new Uint32Array(base.length - removed);
  let j = 0;
  for (let k = 0; k < base.length; k++) if (drop[k] === 0) list[j++] = base[k]!;
  st.pushDict(army, list);
  return list;
}

/**
 * Decodes raw block data of CMDS chunk version `version` (default: the current one) into tick
 * entries (batches with the envelope ticks stamped). Dispatches on the version so blocks keep the
 * coding rules they were written with; an unknown version is 'unsupported-version'. Strict:
 * truncated or overlong coder data, ticks outside the block, out-of-range references and decoded
 * sizes beyond the limits throw FormatError.
 */
export function decodeCmdsRaw(raw: Uint8Array, firstTick: number, entryCount: number, chunkOffset = -1, version: number = CMDS_CHUNK_VERSION): ReplayTickCommands[] {
  switch (version) {
    case 1:
      return decodeCmdsRawV1(raw, firstTick, entryCount, chunkOffset);
    default:
      throw new FormatError('unsupported-version', `CMDS block version ${version} has no decoder in this build (≤ ${CMDS_CHUNK_VERSION})`, CHUNK, chunkOffset);
  }
}

/** CMDS version 1 decoder (the rules of the module doc). Frozen: never change, add a V2. */
function decodeCmdsRawV1(raw: Uint8Array, firstTick: number, entryCount: number, chunkOffset: number): ReplayTickCommands[] {
  const off = chunkOffset;
  if (entryCount === 0) {
    if (raw.length !== 0) throw new FormatError('trailing-bytes', `empty block has ${raw.length} raw bytes`, CHUNK, off);
    return [];
  }
  const d = new RangeDecoder(raw, CHUNK, off);
  const st = new BlockState();
  const m = st.m;
  const budget = { left: MAX_CMDS_BLOCK_BYTES };
  const ref = new Int32Array(3);
  const xyz = new Int32Array(3);
  const entries: ReplayTickCommands[] = [];
  let prevTick = firstTick - 1;
  for (let k = 0; k < entryCount; k++) {
    const tick = prevTick + 1 + codeUInt(d, m.tickDelta, 0, CMDS_BLOCK_TICKS - 1, 'tick delta', CHUNK, off);
    if (tick >= firstTick + CMDS_BLOCK_TICKS) fail('bad-value', `tick ${tick} lies outside the block starting at ${firstTick}`, off);
    prevTick = tick;
    const count = codeUInt(d, m.count, 0, MAX_BATCH_COMMANDS, 'envelope count', CHUNK, off);
    st.envelopes += count;
    if (st.envelopes > MAX_CMDS_BLOCK_ENVELOPES) fail('too-large', `block holds more than ${MAX_CMDS_BLOCK_ENVELOPES} envelopes`, off);
    const out = new BatchOut(budget, off);
    out.reserve(BATCH_HEADER_BYTES);
    out.buf[0] = COMMAND_BATCH_VERSION;
    out.dv.setUint16(1, count, true);
    out.len = BATCH_HEADER_BYTES;
    let prevArmy = ARMY_CTX_NONE;
    for (let n = 0; n < count; n++) {
      const army = codeByte(d, m.army.subarray(prevArmy * 256, prevArmy * 256 + 256), 0);
      prevArmy = army < ARMY_CTX_NONE ? army : ARMY_CTX_NONE - 1;
      const fctx = st.lastFlags[army]! & 1;
      const flags = codeByte(d, m.flags.subarray(fctx * 256, fctx * 256 + 256), 0);
      st.lastFlags[army] = flags;
      const pred = (st.lastSeq[army]! + 1) & 0xffff;
      let seq = pred;
      if (d.bit(m.seqOk, 0) === 0) {
        const delta = unzigzag(codeUInt(d, m.seqDelta, 0, 0xffff, 'seq delta', CHUNK, off));
        if (delta === 0) fail('non-canonical', 'seq delta 0 must be coded as predicted', off);
        seq = (pred + delta) & 0xffff;
      }
      st.lastSeq[army] = seq;
      const q = flags & 1;
      const op = d.bit(m.opSame, q) === 1 ? st.lastOp[army]! : codeByte(d, m.op.subarray(q * 256, q * 256 + 256), 0);
      st.lastOp[army] = op;

      out.reserve(ENVELOPE_FIXED_BYTES - 4);
      let dv = out.dv;
      dv.setUint32(out.len, tick, true);
      dv.setUint8(out.len + 4, army);
      dv.setUint16(out.len + 5, seq, true);
      dv.setUint8(out.len + 7, op);
      dv.setUint8(out.len + 8, flags);
      out.len += 9;

      const list = decodeUnits(d, st, army, flags, opGroup(op), off);
      out.reserve(2 + list.length * 4);
      dv = out.dv;
      dv.setUint16(out.len, list.length, true);
      out.len += 2;
      for (let i = 0; i < list.length; i++) {
        dv.setUint32(out.len, list[i]!, true);
        out.len += 4;
      }

      const lastLen = st.lastLen[op]!;
      const len = lastLen >= 0 && d.bit(m.lenSame, 0) === 1 ? lastLen : codeUInt(d, m.len, 0, MAX_PAYLOAD_BYTES, 'payload length', CHUNK, off);
      st.lastLen[op] = len;
      out.reserve(2 + len);
      dv = out.dv;
      dv.setUint16(out.len, len, true);
      out.len += 2;
      const p0 = out.len;
      const po = posOffset(op);
      if (po >= 0 && len >= po + 12) {
        for (let i = 0; i < po; i++) out.buf[p0 + i] = codeByte(d, m.payByte(op, i), 0);
        codePosition(d, st, army, posClass(op), xyz, ref, off);
        dv.setInt32(p0 + po, xyz[0]!, true);
        dv.setInt32(p0 + po + 4, xyz[1]!, true);
        dv.setInt32(p0 + po + 8, xyz[2]!, true);
        for (let i = po + 12; i < len; i++) out.buf[p0 + i] = codeByte(d, m.payByte(op, i), 0);
      } else if (len === 4 && isTargetOp(op)) {
        const idx = codeUInt(d, m.targetIdx, 0, HANDLE_INDEX_MAX, 'target slot index', CHUNK, off);
        const gen = codeGen(d, st, idx, 0, off);
        const key = idx * 4096 + gen;
        st.noteSlot(key);
        dv.setUint32(p0, keyHandle(key), true);
      } else {
        for (let i = 0; i < len; i++) out.buf[p0 + i] = codeByte(d, m.payByte(op, i), 0);
      }
      out.len = p0 + len;
    }
    const batch = out.buf.slice(0, out.len);
    // Constructed to be well-formed; checked anyway so no decoder slip can leak a bad batch.
    if (validateBatch(batch) !== count) fail('bad-value', `decoded batch of tick ${tick} is malformed`, off);
    entries.push({ tick, batch });
  }
  d.finish();
  return entries;
}

// ---- chunk -----------------------------------------------------------------------------------

/**
 * Builds the CMDS chunk data of block `index` from its entries: raw encoding, then raw DEFLATE at
 * `level`, keeping codec 0 when compression does not shrink the data.
 */
export function encodeCmdsChunk(index: number, entries: readonly ReplayTickCommands[], level: number = DEFAULT_DEFLATE_LEVEL): Uint8Array {
  const firstTick = index * CMDS_BLOCK_TICKS;
  if (!Number.isInteger(index) || index < 0 || firstTick > 0xffffffff) badInput(`block index ${index} out of range`);
  const raw = encodeCmdsRaw(entries, firstTick);
  if (raw.length > MAX_CMDS_BLOCK_BYTES) throw new FormatError('too-large', `raw block ${index} is ${raw.length} bytes, max ${MAX_CMDS_BLOCK_BYTES}`, CHUNK);
  let codec: number = CmdsCodec.Stored;
  let payload = raw;
  if (raw.length > 0) {
    const z = deflateRaw(raw, level);
    if (z.length < raw.length) {
      codec = CmdsCodec.DeflateRaw;
      payload = z;
    }
  }
  const w = new ByteWriter(CMDS_HEADER_BYTES + payload.length);
  w.u16(CMDS_CHUNK_VERSION);
  w.u8(codec);
  w.u8(0);
  w.u32(firstTick);
  w.u32(entries.length);
  w.u32(raw.length);
  w.bytes(payload);
  return w.finish();
}

/**
 * Parses the header of a CMDS chunk (no decompression). `index` is the expected block index
 * (position among the CMDS chunks).
 */
export function parseCmdsChunk(data: Uint8Array, index: number, chunkOffset: number): CmdsBlockRef {
  const r = new ByteReader(data, CHUNK, chunkOffset);
  const version = r.u16('chunk version');
  if (version > CMDS_CHUNK_VERSION) {
    throw new FormatError('unsupported-version', `CMDS chunk version ${version} is newer than ${CMDS_CHUNK_VERSION}`, CHUNK, chunkOffset);
  }
  if (version === 0) r.fail('bad-value', 'chunk version 0');
  const codec = r.u8('codec');
  if (codec !== CmdsCodec.Stored && codec !== CmdsCodec.DeflateRaw) r.fail('bad-value', `unknown codec ${codec}`);
  if (r.u8('reserved') !== 0) r.fail('bad-reserved', 'reserved byte must be 0');
  const firstTick = r.u32('first tick');
  if (firstTick !== index * CMDS_BLOCK_TICKS) r.fail('bad-value', `block ${index} must start at tick ${index * CMDS_BLOCK_TICKS}, not ${firstTick}`);
  const entryCount = r.u32('entry count');
  if (entryCount > CMDS_BLOCK_TICKS) r.fail('bad-value', `entry count ${entryCount} exceeds ${CMDS_BLOCK_TICKS} ticks`);
  const rawLength = r.u32('raw length');
  if (rawLength > MAX_CMDS_BLOCK_BYTES) r.fail('too-large', `raw length ${rawLength} exceeds ${MAX_CMDS_BLOCK_BYTES}`);
  const payload = r.take(r.remaining, 'payload');
  if (codec === CmdsCodec.Stored && payload.length !== rawLength) {
    r.fail('bad-length', `stored block has ${payload.length} bytes, raw length says ${rawLength}`);
  }
  if ((entryCount === 0) !== (rawLength === 0)) r.fail('bad-value', `entry count ${entryCount} does not match raw length ${rawLength}`);
  return { index, version, firstTick, codec, rawLength, entryCount, payload, chunkOffset };
}

/** Raw (decompressed) data of a block. */
export function cmdsBlockRaw(ref: CmdsBlockRef): Uint8Array {
  if (ref.codec === CmdsCodec.Stored) return ref.payload;
  try {
    return inflateRaw(ref.payload, ref.rawLength, MAX_CMDS_BLOCK_BYTES);
  } catch (e) {
    if (e instanceof FormatError) throw new FormatError(e.code, `block ${ref.index}: ${e.message}`, CHUNK, ref.chunkOffset);
    throw e;
  }
}

/** Decodes one CMDS block into its tick entries. */
export function decodeCmdsBlock(ref: CmdsBlockRef): ReplayTickCommands[] {
  return decodeCmdsRaw(cmdsBlockRaw(ref), ref.firstTick, ref.entryCount, ref.chunkOffset, ref.version);
}
