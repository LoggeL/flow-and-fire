/**
 * Full state dump (PLAN §3.12 "desync-diff: … per Voll-Dump Tabelle, Spalte und Entity"): the
 * complete dynamic arena of a world plus its layout, so two dumps — possibly taken in different
 * engines or builds — can be compared region by region, column by column, entity by entity
 * (replay/state-diff.ts).
 *
 * File format `.rtsdump`: formats chunk container, magic 'RTSD', formatVersion 1. Integers
 * little-endian, every chunk starts with u16 chunkVersion = 1. Chunks in this order (unknown chunks
 * after ARNA are skipped):
 *
 *   HEAD  u16 v | u32 tick | u32 simId | u32 layoutHash | u32 dynamicStart | u32 dynamicEnd
 *         | u16 n + simBuild (UTF-8) | u16 n + label (UTF-8)
 *   LAYT  u16 v | canonical arena layout text (ASCII, heap canonicalLayoutText) — the region
 *         table (RegionLayout[]) is parsed back from it; xxHash32(text) must equal layoutHash
 *   ARNA  u16 v | u8 codec (0 stored, 1 deflate-raw) | u8 reserved = 0 | u32 rawLength
 *         (= dynamicEnd − dynamicStart) | payload
 *
 * The static (map) area is not part of a dump: it is not simulation state and is covered by the
 * simId (mapSimHash). Reading is strict — every problem is a FormatError.
 *
 * Environment-neutral (Node and browser worker): no node: imports.
 */

import { xxHash32 } from '@faf/fixed';
import {
  decodeUtf8,
  deflateRaw,
  encodeUtf8,
  FormatError,
  inflateRaw,
  readContainer,
  writeContainer,
  type ContainerChunk,
} from '@faf/formats';
import { isColType, type LayoutPart, type RegionLayout } from '@faf/heap';
import { SIM_BUILD, type World } from '@faf/sim';

export const STATE_DUMP_MAGIC = 'RTSD';
export const STATE_DUMP_FORMAT_VERSION = 1;
const CHUNK_VERSION = 1;
/** Largest dynamic arena a dump may declare (the arena itself is capped far below). */
export const MAX_DUMP_ARENA_BYTES = 256 * 1024 * 1024;

export const DumpCodec = {
  Stored: 0,
  DeflateRaw: 1,
} as const;

export interface StateDump {
  /** SIM_BUILD of the sim that produced the state. */
  readonly simBuild: string;
  /** simId of the session (0 = unknown). */
  readonly simId: number;
  readonly layoutHash: number;
  /** Canonical arena layout text (its xxHash32 is layoutHash). */
  readonly layoutText: string;
  /** World tick of the state. */
  readonly tick: number;
  /** Arena offsets of the dynamic area; `bytes[i]` is arena byte `dynamicStart + i`. */
  readonly dynamicStart: number;
  readonly dynamicEnd: number;
  /** Copy of the dynamic arena area. */
  readonly bytes: Uint8Array;
  /** Region table of the arena (world.arena.regions; offsets absolute in the arena). */
  readonly regions: readonly RegionLayout[];
  /** Free text (e.g. "A: engine node, replay x.rtsreplay"). */
  readonly label: string;
}

/** Captures the dynamic arena of `world` (a copy; the world may continue). */
export function captureStateDump(world: World, info: { label?: string; simId?: number } = {}): StateDump {
  const a = world.arena;
  return {
    simBuild: SIM_BUILD,
    simId: (info.simId ?? 0) >>> 0,
    layoutHash: a.layoutHash >>> 0,
    layoutText: a.layoutText,
    tick: world.tick as number,
    dynamicStart: a.dynamicStart,
    dynamicEnd: a.dynamicEnd,
    bytes: a.snapshot(),
    regions: a.regions,
    label: info.label ?? '',
  };
}

// ---- writing ---------------------------------------------------------------------------------

class Writer {
  private buf: Uint8Array;
  private dv: DataView;
  len = 0;

  constructor(cap = 64) {
    this.buf = new Uint8Array(cap);
    this.dv = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.dv.setUint8(this.len, v);
    this.len += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.len, v, true);
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  str16(s: string, what: string): void {
    const b = encodeUtf8(s);
    if (b.length > 0xffff) throw new FormatError('bad-value', `${what} longer than 65535 bytes`, 'HEAD');
    this.u16(b.length);
    this.bytes(b);
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function asciiOf(s: string, chunk: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7e || (c < 0x20 && c !== 0x0a)) throw new FormatError('bad-value', 'layout text is not printable ASCII', chunk);
    out[i] = c;
  }
  return out;
}

/** Encodes a dump (deflate-raw arena, stored if that is not smaller). Deterministic. */
export function writeStateDump(d: StateDump): Uint8Array {
  const rawLength = d.dynamicEnd - d.dynamicStart;
  if (d.bytes.length !== rawLength) throw new FormatError('bad-length', `dump holds ${d.bytes.length} B, dynamic area is ${rawLength} B`, 'ARNA');
  const head = new Writer();
  head.u16(CHUNK_VERSION);
  head.u32(d.tick);
  head.u32(d.simId);
  head.u32(d.layoutHash);
  head.u32(d.dynamicStart);
  head.u32(d.dynamicEnd);
  head.str16(d.simBuild, 'simBuild');
  head.str16(d.label, 'label');

  const text = asciiOf(d.layoutText, 'LAYT');
  const layt = new Uint8Array(2 + text.length);
  new DataView(layt.buffer).setUint16(0, CHUNK_VERSION, true);
  layt.set(text, 2);

  const packed = deflateRaw(d.bytes);
  const stored = packed.length >= d.bytes.length;
  const payload = stored ? d.bytes : packed;
  const arna = new Uint8Array(8 + payload.length);
  const av = new DataView(arna.buffer);
  av.setUint16(0, CHUNK_VERSION, true);
  av.setUint8(2, stored ? DumpCodec.Stored : DumpCodec.DeflateRaw);
  av.setUint8(3, 0);
  av.setUint32(4, rawLength, true);
  arna.set(payload, 8);

  const chunks: ContainerChunk[] = [
    { id: 'HEAD', data: head.done() },
    { id: 'LAYT', data: layt },
    { id: 'ARNA', data: arna },
  ];
  return writeContainer(STATE_DUMP_MAGIC, STATE_DUMP_FORMAT_VERSION, chunks);
}

// ---- reading ---------------------------------------------------------------------------------

class Reader {
  private readonly dv: DataView;
  p = 0;

  constructor(
    private readonly b: Uint8Array,
    private readonly chunk: string,
    private readonly base: number,
  ) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  private need(n: number): void {
    if (this.p + n > this.b.length) throw new FormatError('truncated', `chunk data ends at ${this.b.length} B`, this.chunk, this.base + this.p);
  }

  u8(): number {
    this.need(1);
    return this.dv.getUint8(this.p++);
  }

  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.p, true);
    this.p += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.p, true);
    this.p += 4;
    return v;
  }

  str16(): string {
    const n = this.u16();
    this.need(n);
    const at = this.p;
    this.p += n;
    try {
      return decodeUtf8(this.b, at, n);
    } catch {
      throw new FormatError('bad-value', 'text is not valid UTF-8', this.chunk, this.base + at);
    }
  }

  rest(): Uint8Array {
    const r = this.b.subarray(this.p);
    this.p = this.b.length;
    return r;
  }

  end(): void {
    if (this.p !== this.b.length) throw new FormatError('trailing-bytes', `${this.b.length - this.p} unread bytes`, this.chunk, this.base + this.p);
  }

  version(): void {
    const v = this.u16();
    if (v !== CHUNK_VERSION) throw new FormatError('unsupported-version', `chunk version ${v}`, this.chunk, this.base);
  }
}

const HEADER_RE = /^faf-arena v(\d+) bytes=(\d+) dyn=(\d+)\.\.(\d+)$/;
const REGION_RE = /^(table|dense|slab|raw) (\S+) area=(dynamic|static) derived=([01]) cap=(\d+) off=(\d+) len=(\d+)$/;
const PART_RE = /^ (\S+) (\S+) off=(\d+) len=(\d+)$/;

function layoutFail(detail: string): never {
  throw new FormatError('bad-value', `layout text: ${detail}`, 'LAYT');
}

/** Parses the canonical layout text back into region layouts (strict; re-serialization must match). */
export function parseLayoutText(text: string): { version: number; totalBytes: number; dynamicStart: number; dynamicEnd: number; regions: RegionLayout[] } {
  if (!text.endsWith('\n')) layoutFail('missing final newline');
  const lines = text.slice(0, -1).split('\n');
  const h = HEADER_RE.exec(lines[0] ?? '');
  if (h === null) layoutFail('bad header line');
  const num = (s: string): number => {
    const v = Number(s);
    if (!Number.isSafeInteger(v)) layoutFail(`number ${s}`);
    return v;
  };
  const regions: RegionLayout[] = [];
  let cur: { kind: RegionLayout['kind']; name: string; area: RegionLayout['area']; derived: boolean; cap: number; byteOffset: number; byteLength: number; parts: LayoutPart[] } | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const r = REGION_RE.exec(line);
    if (r !== null) {
      if (cur !== null) regions.push(cur);
      cur = {
        kind: r[1] as RegionLayout['kind'],
        name: r[2]!,
        area: r[3] as RegionLayout['area'],
        derived: r[4] === '1',
        cap: num(r[5]!),
        byteOffset: num(r[6]!),
        byteLength: num(r[7]!),
        parts: [],
      };
      continue;
    }
    const p = PART_RE.exec(line);
    if (p === null || cur === null) layoutFail(`line ${i + 1}`);
    const type = p[2]!;
    if (type !== 'raw' && !isColType(type)) layoutFail(`part type '${type}'`);
    cur.parts.push({ name: p[1]!, type: type as LayoutPart['type'], byteOffset: num(p[3]!), byteLength: num(p[4]!) });
  }
  if (cur !== null) regions.push(cur);
  const out = { version: num(h[1]!), totalBytes: num(h[2]!), dynamicStart: num(h[3]!), dynamicEnd: num(h[4]!), regions };
  if (layoutTextOf(out.version, out.totalBytes, out.dynamicStart, out.dynamicEnd, regions) !== text) layoutFail('not canonical');
  return out;
}

/** Same text as heap canonicalLayoutText (not exported by @faf/heap; checked by the round trip above). */
function layoutTextOf(version: number, totalBytes: number, dynamicStart: number, dynamicEnd: number, regions: readonly RegionLayout[]): string {
  let s = `faf-arena v${version} bytes=${totalBytes} dyn=${dynamicStart}..${dynamicEnd}\n`;
  for (const r of regions) {
    s += `${r.kind} ${r.name} area=${r.area} derived=${r.derived ? 1 : 0} cap=${r.cap} off=${r.byteOffset} len=${r.byteLength}\n`;
    for (const p of r.parts) s += ` ${p.name} ${p.type} off=${p.byteOffset} len=${p.byteLength}\n`;
  }
  return s;
}

/**
 * Decodes a dump. Throws FormatError on any problem: container (magic, CRC, truncation), missing,
 * duplicate or misordered chunks, versions, layout text vs layoutHash and dynamic range,
 * compression, arena length.
 */
export function readStateDump(bytes: Uint8Array): StateDump {
  const c = readContainer(bytes, STATE_DUMP_MAGIC);
  if (c.formatVersion !== STATE_DUMP_FORMAT_VERSION) throw new FormatError('unsupported-version', `state dump format version ${c.formatVersion}`);
  const want = ['HEAD', 'LAYT', 'ARNA'];
  for (let i = 0; i < want.length; i++) {
    const ch = c.chunks[i];
    if (ch === undefined) throw new FormatError('missing-chunk', `chunk ${want[i]} missing`, want[i]!);
    if (ch.id !== want[i]) {
      const known = want.indexOf(ch.id);
      if (known >= 0 && known < i) throw new FormatError('duplicate-chunk', `chunk ${ch.id} twice`, ch.id, ch.offset);
      throw new FormatError(known >= 0 ? 'chunk-order' : 'missing-chunk', `expected ${want[i]}, found ${ch.id}`, ch.id, ch.offset);
    }
  }
  for (let i = want.length; i < c.chunks.length; i++) {
    const ch = c.chunks[i]!;
    if (want.includes(ch.id)) throw new FormatError('duplicate-chunk', `chunk ${ch.id} twice`, ch.id, ch.offset);
  }
  const [hc, lc, ac] = [c.chunks[0]!, c.chunks[1]!, c.chunks[2]!];

  const h = new Reader(hc.data, 'HEAD', hc.offset + 8);
  h.version();
  const tick = h.u32();
  const simId = h.u32();
  const layoutHash = h.u32();
  const dynamicStart = h.u32();
  const dynamicEnd = h.u32();
  const simBuild = h.str16();
  const label = h.str16();
  h.end();
  if (dynamicEnd < dynamicStart || dynamicEnd - dynamicStart > MAX_DUMP_ARENA_BYTES) {
    throw new FormatError('bad-value', `dynamic range ${dynamicStart}..${dynamicEnd}`, 'HEAD');
  }

  const l = new Reader(lc.data, 'LAYT', lc.offset + 8);
  l.version();
  const textBytes = l.rest();
  let layoutText = '';
  for (let i = 0; i < textBytes.length; i++) {
    const ch = textBytes[i]!;
    if (ch > 0x7e || (ch < 0x20 && ch !== 0x0a)) throw new FormatError('bad-value', 'layout text is not printable ASCII', 'LAYT', lc.offset + 10 + i);
  }
  for (let i = 0; i < textBytes.length; i += 8192) layoutText += String.fromCharCode(...textBytes.subarray(i, i + 8192));
  if (xxHash32(textBytes, 0, textBytes.length, 0) >>> 0 !== layoutHash) throw new FormatError('bad-value', 'layout text does not match layoutHash', 'LAYT');
  const layout = parseLayoutText(layoutText);
  if (layout.dynamicStart !== dynamicStart || layout.dynamicEnd !== dynamicEnd) throw new FormatError('bad-value', 'dynamic range differs from the layout', 'HEAD');
  for (const r of layout.regions) {
    if (r.area !== 'dynamic') continue;
    if (r.byteOffset < dynamicStart || r.byteOffset + r.byteLength > dynamicEnd) throw new FormatError('bad-value', `region ${r.name} outside the dynamic area`, 'LAYT');
    for (const p of r.parts) {
      if (p.byteOffset < r.byteOffset || p.byteOffset + p.byteLength > r.byteOffset + r.byteLength) throw new FormatError('bad-value', `part ${r.name}.${p.name} outside its region`, 'LAYT');
    }
  }

  const a = new Reader(ac.data, 'ARNA', ac.offset + 8);
  a.version();
  const codec = a.u8();
  if (a.u8() !== 0) throw new FormatError('bad-reserved', 'reserved byte', 'ARNA', ac.offset + 11);
  const rawLength = a.u32();
  if (rawLength !== dynamicEnd - dynamicStart) throw new FormatError('bad-length', `arena ${rawLength} B, dynamic area ${dynamicEnd - dynamicStart} B`, 'ARNA');
  const payload = a.rest();
  let arena: Uint8Array;
  if (codec === DumpCodec.Stored) {
    if (payload.length !== rawLength) throw new FormatError('bad-length', `stored arena ${payload.length} B ≠ ${rawLength} B`, 'ARNA');
    arena = payload.slice();
  } else if (codec === DumpCodec.DeflateRaw) {
    try {
      arena = inflateRaw(payload, rawLength, MAX_DUMP_ARENA_BYTES);
    } catch (e) {
      if (e instanceof FormatError) throw new FormatError(e.code, e.message, 'ARNA', ac.offset);
      throw new FormatError('bad-compression', e instanceof Error ? e.message : String(e), 'ARNA', ac.offset);
    }
  } else {
    throw new FormatError('bad-value', `unknown codec ${codec}`, 'ARNA', ac.offset + 10);
  }

  return { simBuild, simId, layoutHash, layoutText, tick, dynamicStart, dynamicEnd, bytes: arena, regions: layout.regions, label };
}
