/**
 * Raw DEFLATE through the engine's native CompressionStream/DecompressionStream('deflate-raw')
 * (PLAN §3.11 keyframes), with a fallback to the synchronous fflate codec of @faf/formats when the
 * engine has no native streams.
 *
 * Use: compressing keyframes off the sim tick (the native encoder runs outside the JS thread in
 * browsers, so the tick does not wait for it). The native output is NOT canonical — its bytes
 * depend on the engine's zlib build and settings — so it is only for in-memory data (keyframes).
 * Anything written to a file (CMDS blocks) goes through the canonical `deflateRaw` of @faf/formats.
 * Both decoders read both encoders' streams (raw DEFLATE, RFC 1951).
 *
 * `inflateRawNative` has the contract of formats `inflateRaw`: the caller states the exact
 * decompressed length; a stream that expands to anything else, malformed data or an empty input is
 * a FormatError ('bad-compression'), an expected length over the limit is 'too-large' before any
 * allocation. The output buffer is allocated once up front and never grown; a stream that
 * produces more is cancelled as soon as it overflows (deflate bombs cost at most one chunk).
 */

import { DEFAULT_DEFLATE_LEVEL, deflateRaw, FormatError, inflateRaw, MAX_INFLATE_BYTES } from '@faf/formats';

let nativeAvailable: boolean | null = null;

/** True if CompressionStream and DecompressionStream support 'deflate-raw' in this engine (cached). */
export function hasNativeDeflate(): boolean {
  if (nativeAvailable === null) {
    try {
      if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') {
        nativeAvailable = false;
      } else {
        // Constructing both probes the format; engines without 'deflate-raw' throw here.
        void new CompressionStream('deflate-raw');
        void new DecompressionStream('deflate-raw');
        nativeAvailable = true;
      }
    } catch {
      // Older engines throw a TypeError for an unknown format ('deflate-raw' came after 'deflate').
      nativeAvailable = false;
    }
  }
  return nativeAvailable;
}

/**
 * Compresses `bytes` as raw DEFLATE natively (level chosen by the engine, typically zlib's 6). The
 * input must stay unchanged until the promise settles. Without native streams the synchronous
 * fflate codec is used with `fallbackLevel`.
 */
export async function deflateRawNative(bytes: Uint8Array, fallbackLevel: number = DEFAULT_DEFLATE_LEVEL): Promise<Uint8Array> {
  if (!hasNativeDeflate()) return deflateRaw(bytes, fallbackLevel);
  const cs = new CompressionStream('deflate-raw');
  const chunks: Uint8Array[] = [];
  let total = 0;
  await pump(cs, bytes, (chunk) => {
    chunks.push(chunk);
    total += chunk.length;
    return true;
  });
  if (chunks.length === 1 && chunks[0]!.byteOffset === 0 && chunks[0]!.buffer.byteLength === total) return chunks[0]!;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Decompresses a raw DEFLATE stream that must expand to exactly `expectedLength` bytes (same
 * errors as formats `inflateRaw`). Without native streams the synchronous fflate codec is used.
 */
export async function inflateRawNative(bytes: Uint8Array, expectedLength: number, maxLength: number = MAX_INFLATE_BYTES): Promise<Uint8Array> {
  if (!hasNativeDeflate()) return inflateRaw(bytes, expectedLength, maxLength);
  if (!Number.isInteger(maxLength) || maxLength < 0) throw new RangeError(`inflateRawNative: maxLength must be a non-negative integer, got ${maxLength}`);
  if (!Number.isInteger(expectedLength) || expectedLength < 0) {
    throw new FormatError('bad-value', `inflate: expected length must be a non-negative integer, got ${expectedLength}`);
  }
  if (expectedLength > maxLength) {
    throw new FormatError('too-large', `inflate: expected length ${expectedLength} exceeds the limit of ${maxLength} bytes`);
  }
  if (bytes.length === 0) throw new FormatError('bad-compression', 'inflate: empty input is not a deflate stream');
  const out = new Uint8Array(expectedLength);
  let o = 0;
  let overflow = false;
  try {
    await pump(new DecompressionStream('deflate-raw'), bytes, (chunk) => {
      if (o + chunk.length > expectedLength) {
        overflow = true;
        return false;
      }
      out.set(chunk, o);
      o += chunk.length;
      return true;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FormatError('bad-compression', `inflate failed: ${msg}`);
  }
  if (overflow) throw new FormatError('bad-compression', `inflate: stream expands to more than the expected ${expectedLength} bytes`);
  if (o < expectedLength) throw new FormatError('bad-compression', `inflate: stream expands to ${o} bytes, expected ${expectedLength}`);
  return out;
}

/**
 * Writes `input` into a transform stream and hands every output chunk to `sink` until the stream
 * ends or `sink` returns false (then the stream is cancelled). Errors of the transform (malformed
 * data, trailing junk, truncation) reject the returned promise; the writer side never leaves an
 * unhandled rejection behind.
 */
async function pump(ts: CompressionStream | DecompressionStream, input: Uint8Array, sink: (chunk: Uint8Array) => boolean): Promise<void> {
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  // BufferSource wants an ArrayBuffer-backed view; keyframe/replay buffers never are shared.
  const written = writer.write(input as Uint8Array<ArrayBuffer>).then(() => writer.close());
  written.catch(() => undefined); // the same error surfaces on the readable side
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      if (!sink(r.value)) {
        await reader.cancel();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
  await written;
}
