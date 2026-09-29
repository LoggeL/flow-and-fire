/**
 * CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320, init/xorout 0xFFFFFFFF) — the checksum of
 * the chunk container (PLAN §3.1) and of PNG chunks. Table-driven, integer-only, allocation-free.
 * Check value: crc32("123456789") = 0xCBF43926.
 */

const TABLE: Uint32Array = buildTable();

function buildTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

/**
 * Continues a CRC-32 over bytes[offset, offset + length). Chainable: start with `crc = 0`, pass the
 * previous result to append more data. Returns a u32.
 */
export function crc32Update(crc: number, bytes: Uint8Array, offset = 0, length = bytes.length - offset): number {
  if (offset < 0 || length < 0 || offset + length > bytes.length) throw new RangeError('crc32: range out of bounds');
  let c = (crc ^ 0xffffffff) >>> 0;
  const end = offset + length;
  for (let i = offset; i < end; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of bytes[offset, offset + length) (u32). */
export function crc32(bytes: Uint8Array, offset = 0, length = bytes.length - offset): number {
  return crc32Update(0, bytes, offset, length);
}
