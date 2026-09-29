/**
 * SPK5 "Hash & Snapshot" (PLAN §4): a 20 MB arena (WebAssembly.Memory), xxHash32 in JS
 * (@faf/fixed) against a hand-written WASM xxHash32 importing the same memory, the realistic
 * live-range hash of the MS1 sim (1,000 units), memcpy snapshot/restore and keyframe compression
 * with CompressionStream('deflate-raw').
 */
import { asArmyId, asTick, fx, xxHash32, XxHash32 } from '@faf/fixed';
import { ruleHash as arenaRuleHash } from '@faf/heap';
import { CommandBatchEncoder, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import { createWorld, restore, ruleHash, snapshot, step, unitHandles, type World } from '@faf/sim';
import { round4, summarize, type Clock, type Summary } from '../stats.ts';

/** 320 pages = 20 MiB. */
export const SPK5_ARENA_PAGES = 320;
export const SPK5_ARENA_BYTES = SPK5_ARENA_PAGES * 65536;

interface WasmMemoryLike {
  readonly buffer: ArrayBuffer;
}

interface WasmApi {
  Memory: new (d: { initial: number; maximum: number }) => WasmMemoryLike;
  instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: { exports: Record<string, unknown> } }>;
}

function wasmApi(): WasmApi {
  const wa = (globalThis as unknown as { WebAssembly?: WasmApi }).WebAssembly;
  if (wa === undefined) throw new Error('WebAssembly is not available');
  return wa;
}

/** WASM xxHash32 bound to one memory. */
export interface WasmXxh32 {
  readonly memory: WasmMemoryLike;
  readonly bytes: Uint8Array;
  /** u32 hash of memory[ptr, ptr + len). */
  hash(ptr: number, len: number, seed: number): number;
}

export async function loadWasmXxh32(wasmBytes: Uint8Array, pages = SPK5_ARENA_PAGES): Promise<WasmXxh32> {
  const wa = wasmApi();
  const memory = new wa.Memory({ initial: pages, maximum: pages });
  const { instance } = await wa.instantiate(wasmBytes, { env: { memory } });
  const fn = instance.exports['xxh32'] as (ptr: number, len: number, seed: number) => number;
  return {
    memory,
    bytes: new Uint8Array(memory.buffer),
    hash: (ptr, len, seed) => fn(ptr, len, seed) >>> 0,
  };
}

/** Deterministic pseudo-random fill (LCG, 32 bit). */
export function fillPseudoRandom(bytes: Uint8Array, seed: number): void {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2);
  let x = seed | 0;
  for (let i = 0; i < words.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) | 0;
    words[i] = x ^ (x >>> 13);
  }
  for (let i = words.length << 2; i < bytes.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) | 0;
    bytes[i] = x >>> 24;
  }
}

/** Compares JS and WASM xxHash32 over `cases` pseudo-random ranges (unaligned offsets, short tails). */
export function crossCheckXxh32(w: WasmXxh32, cases: number, seed: number): { cases: number; mismatches: number; firstMismatch: string | null } {
  const len = w.bytes.length;
  let x = seed | 0;
  const next = (): number => {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    return x >>> 1;
  };
  let mismatches = 0;
  let first: string | null = null;
  for (let c = 0; c < cases; c++) {
    const kind = c % 4;
    const n = kind === 0 ? next() % 33 : kind === 1 ? next() % 4096 : kind === 2 ? next() % 262144 : next() % 17;
    const off = next() % (len - n);
    const s = next();
    const a = xxHash32(w.bytes, off, n, s);
    const b = w.hash(off, n, s);
    if (a !== b) {
      mismatches++;
      if (first === null) first = `off ${off} len ${n} seed ${s}: js ${a} wasm ${b}`;
    }
  }
  return { cases, mismatches, firstMismatch: first };
}

/** Counts the bytes a hash pass feeds (rule-hash live range). */
class CountingHasher extends XxHash32 {
  bytes = 0;
  override update(u8: Uint8Array, off: number, len: number): this {
    this.bytes += len;
    return super.update(u8, off, len);
  }
}

/** MS1 sim with 1,000 cubes driving for `ticks` ticks (the realistic hash/keyframe subject). */
export function liveSimWorld(simBin: Uint8Array, ticks: number): World {
  const w = createWorld({ simBin, seed: 0x5b50005, armyCount: 2 });
  const enc = new CommandBatchEncoder();
  const spawn = (army: number, count: number, x: number): void => {
    enc.add({ tick: asTick(1), army: asArmyId(army), seq: army, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp: w.bp.indexOf('core:cube'), army, count, x: fx(x), z: fx(256), spread: fx(60) }) });
  };
  spawn(0, 500, 160);
  spawn(1, 500, 352);
  step(w, enc.view());
  enc.reset();
  enc.add({ tick: asTick(2), army: asArmyId(0), seq: 5, op: Op.Move, flags: 0, units: unitHandles(w, 0), payload: encodeMove({ x: fx(352), y: fx(0), z: fx(200) }) });
  enc.add({ tick: asTick(2), army: asArmyId(1), seq: 5, op: Op.Move, flags: 0, units: unitHandles(w, 1), payload: encodeMove({ x: fx(160), y: fx(0), z: fx(300) }) });
  step(w, enc.view());
  for (let t = 2; t < ticks; t++) step(w, null);
  return w;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>);
  void writer.close();
  return readAll(cs.readable);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>);
  void writer.close();
  return readAll(ds.readable);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    total += r.value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Times `fn` in batches of `inner` calls (per-call value = batch / inner) so that coarse clocks
 * still resolve sub-millisecond operations.
 */
function timeBatched(batches: number, inner: number, clock: Clock, fn: () => void): Summary {
  const s = new Float64Array(batches);
  for (let b = 0; b < batches; b++) {
    const t0 = clock();
    for (let i = 0; i < inner; i++) fn();
    s[b] = (clock() - t0) / inner;
  }
  return summarize(s);
}

async function timeAsync(reps: number, clock: Clock, fn: () => Promise<unknown>): Promise<Summary> {
  const s = new Float64Array(reps);
  for (let r = 0; r < reps; r++) {
    const t0 = clock();
    await fn();
    s[r] = clock() - t0;
  }
  return summarize(s);
}

/** GB/s from bytes and milliseconds. */
function gbps(bytes: number, ms: number): number {
  return ms > 0 ? round4(bytes / ms / 1e6) : 0;
}

export interface Spk5Options {
  readonly wasmBytes: Uint8Array;
  readonly simBin: Uint8Array;
  readonly clock: Clock;
  /** Repetitions (samples) of every measurement. */
  readonly reps: number;
  /**
   * Observed clock resolution (ms). Operations are timed in batches of `inner` calls so that
   * coarse clocks (WebKit: 1 ms) still resolve them; 1 on fine clocks.
   */
  readonly clockResolutionMs: number;
}

export interface Spk5Result {
  readonly arenaBytes: number;
  readonly equality: {
    readonly full20MB: boolean;
    readonly jsFull: string;
    readonly wasmFull: string;
    readonly liveRange: boolean;
    readonly randomRanges: { cases: number; mismatches: number; firstMismatch: string | null };
  };
  readonly full20MB: { readonly js: Summary; readonly wasm: Summary; readonly jsGBps: number; readonly wasmGBps: number };
  /** Rule-hash live range of the MS1 sim with 1,000 units. */
  readonly live: {
    readonly units: number;
    readonly bytes: number;
    /** sim.ruleHash (streaming over table live ranges) = the real hash tick. */
    readonly simRuleHash: Summary;
    /** One-shot over a contiguous block of the same size. */
    readonly jsContiguous: Summary;
    readonly wasmContiguous: Summary;
  };
  readonly snapshot: {
    readonly arena20MB: { readonly snapshot: Summary; readonly restore: Summary; readonly GBps: number };
    readonly sim: { readonly bytes: number; readonly snapshot: Summary; readonly restore: Summary };
  };
  readonly keyframe: {
    readonly sim: { readonly bytes: number; readonly compressedBytes: number; readonly ratio: number; readonly deflate: Summary; readonly inflate: Summary; readonly roundtrip: boolean };
    readonly random20MB: { readonly compressedBytes: number; readonly ratio: number; readonly deflate: Summary };
  };
}

export async function runSpk5(o: Spk5Options): Promise<Spk5Result> {
  const { clock, reps } = o;
  // Batch sizes: ≤ 1 % resolution error for sub-ms operations, ≤ 5 % for the 20 MB ones.
  const inner = Math.max(1, Math.ceil(o.clockResolutionMs / 0.01));
  const innerBig = Math.max(1, Math.ceil(o.clockResolutionMs / 0.05));
  const wasm = await loadWasmXxh32(o.wasmBytes);
  const arena = wasm.bytes;
  fillPseudoRandom(arena, 0x5e5e5e5);
  const n = arena.length;

  // --- 20 MB throughput (first: the aligned fast path before the unaligned cross-check) ---
  let sink = 0;
  const jsFullT = timeBatched(reps, innerBig, clock, () => {
    sink ^= xxHash32(arena, 0, n, 0);
  });
  const wasmFullT = timeBatched(reps, innerBig, clock, () => {
    sink ^= wasm.hash(0, n, 0);
  });

  // --- equality ---
  const jsFull = xxHash32(arena, 0, n, 0);
  const wasmFull = wasm.hash(0, n, 0);
  const randomRanges = crossCheckXxh32(wasm, 400, 0x1234567);

  // --- live range of the real sim ---
  const w = liveSimWorld(o.simBin, 100);
  const counter = new CountingHasher();
  arenaRuleHash(w.arena, counter);
  const liveBytes = counter.bytes;
  const simHashT = timeBatched(reps * 10, inner, clock, () => {
    sink ^= ruleHash(w);
  });
  // Same number of bytes, contiguous, inside the 20 MB arena (8-aligned like arena parts).
  const liveOff = 4096;
  arena.set(w.arena.bytes.subarray(0, Math.min(liveBytes, w.arena.bytes.length)), liveOff);
  const jsLive = xxHash32(arena, liveOff, liveBytes, 0);
  const wasmLive = wasm.hash(liveOff, liveBytes, 0);
  const jsLiveT = timeBatched(reps * 10, inner, clock, () => {
    sink ^= xxHash32(arena, liveOff, liveBytes, 0);
  });
  const wasmLiveT = timeBatched(reps * 10, inner, clock, () => {
    sink ^= wasm.hash(liveOff, liveBytes, 0);
  });

  // --- snapshot / restore (memcpy) ---
  const snap20 = new Uint8Array(n);
  const snapT = timeBatched(reps, innerBig, clock, () => snap20.set(arena));
  const restT = timeBatched(reps, innerBig, clock, () => arena.set(snap20));
  const simSnap = new Uint8Array(w.snapshotByteLength);
  const simSnapT = timeBatched(reps * 10, inner, clock, () => void snapshot(w, simSnap));
  const simRestT = timeBatched(reps * 10, inner, clock, () => restore(w, simSnap));

  // --- keyframe compression ---
  const keyframe = snapshot(w);
  let compressed = await deflateRaw(keyframe);
  const deflateT = await timeAsync(Math.max(3, reps), clock, async () => {
    compressed = await deflateRaw(keyframe);
  });
  let inflated = await inflateRaw(compressed);
  const inflateT = await timeAsync(Math.max(3, reps), clock, async () => {
    inflated = await inflateRaw(compressed);
  });
  let compressed20 = await deflateRaw(arena);
  const deflate20T = await timeAsync(3, clock, async () => {
    compressed20 = await deflateRaw(arena);
  });

  if (sink === 0x7fffffff) throw new Error('unreachable sink value');
  return {
    arenaBytes: n,
    equality: {
      full20MB: jsFull === wasmFull,
      jsFull: '0x' + jsFull.toString(16).padStart(8, '0'),
      wasmFull: '0x' + wasmFull.toString(16).padStart(8, '0'),
      liveRange: jsLive === wasmLive,
      randomRanges,
    },
    full20MB: { js: jsFullT, wasm: wasmFullT, jsGBps: gbps(n, jsFullT.p50), wasmGBps: gbps(n, wasmFullT.p50) },
    live: { units: w.units.liveCount, bytes: liveBytes, simRuleHash: simHashT, jsContiguous: jsLiveT, wasmContiguous: wasmLiveT },
    snapshot: {
      arena20MB: { snapshot: snapT, restore: restT, GBps: gbps(n, snapT.p50) },
      sim: { bytes: w.snapshotByteLength, snapshot: simSnapT, restore: simRestT },
    },
    keyframe: {
      sim: {
        bytes: keyframe.length,
        compressedBytes: compressed.length,
        ratio: round4(keyframe.length / Math.max(1, compressed.length)),
        deflate: deflateT,
        inflate: inflateT,
        roundtrip: equalBytes(inflated, keyframe),
      },
      random20MB: { compressedBytes: compressed20.length, ratio: round4(n / Math.max(1, compressed20.length)), deflate: deflate20T },
    },
  };
}
