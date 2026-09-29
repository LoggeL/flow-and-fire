import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTAINER_HEADER_BYTES, containerSize, crc32, FormatError, fourCC, readContainer, writeContainer, type ContainerChunk } from '../src/index.ts';

const idArb = fc.stringMatching(/^[ -~]{4}$/);
const chunkArb = fc.record({ id: idArb, data: fc.uint8Array({ maxLength: 64 }) });

function expectFormatError(fn: () => unknown, code: string): FormatError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FormatError);
    expect((e as FormatError).code).toBe(code);
    return e as FormatError;
  }
  throw new Error(`expected FormatError '${code}'`);
}

describe('chunk container', () => {
  it('round-trips arbitrary chunk lists byte-exactly', () => {
    fc.assert(
      fc.property(fc.array(chunkArb, { maxLength: 8 }), fc.integer({ min: 0, max: 0xffff }), (chunks, version) => {
        const bytes = writeContainer('TEST', version, chunks);
        expect(bytes.length).toBe(containerSize(chunks));
        expect(bytes.length % 4).toBe(0);
        const c = readContainer(bytes, 'TEST');
        expect(c.formatVersion).toBe(version);
        expect(c.chunks.map((x) => ({ id: x.id, data: Uint8Array.from(x.data) }))).toEqual(chunks.map((x) => ({ id: x.id, data: Uint8Array.from(x.data) })));
        expect(writeContainer('TEST', version, c.chunks)).toEqual(bytes);
      }),
      { numRuns: 300 },
    );
  });

  it('writes the documented layout', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const b = writeContainer('RTSM', 7, [{ id: 'ABCD', data }]);
    const dv = new DataView(b.buffer);
    expect([...b.subarray(0, 4)]).toEqual([0x52, 0x54, 0x53, 0x4d]); // 'RTSM' in file order
    expect(dv.getUint32(0, true)).toBe(fourCC('RTSM'));
    expect(dv.getUint16(4, true)).toBe(1);
    expect(dv.getUint16(6, true)).toBe(7);
    expect(dv.getUint32(8, true)).toBe(1);
    expect(dv.getUint32(12, true)).toBe(0);
    const p = CONTAINER_HEADER_BYTES;
    expect(String.fromCharCode(...b.subarray(p, p + 4))).toBe('ABCD');
    expect(dv.getUint32(p + 4, true)).toBe(5);
    expect([...b.subarray(p + 8, p + 16)]).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
    expect(dv.getUint32(p + 16, true)).toBe(crc32(b, p, 8 + 5));
    expect(b.length).toBe(16 + 8 + 8 + 4);
    expect(readContainer(b, 'RTSM').chunks[0]!.offset).toBe(16);
  });

  const sample = (): Uint8Array =>
    writeContainer('TEST', 1, [
      { id: 'AAAA', data: new Uint8Array([9, 8, 7]) },
      { id: 'BBBB', data: new Uint8Array(8).fill(5) },
    ]);

  it('reports structural errors with code, chunk id and offset', () => {
    const b = sample();
    expectFormatError(() => readContainer(b, 'NOPE'), 'bad-magic');
    expectFormatError(() => readContainer(b.subarray(0, 10), 'TEST'), 'truncated');
    const crc = b.slice();
    crc[16 + 8] = crc[16 + 8]! ^ 1;
    const e = expectFormatError(() => readContainer(crc, 'TEST'), 'bad-crc');
    expect(e.chunkId).toBe('AAAA');
    expect(e.offset).toBe(16 + 8 + 4);
    const pad = b.slice();
    pad[16 + 8 + 3] = 1;
    expect(expectFormatError(() => readContainer(pad, 'TEST'), 'bad-padding').offset).toBe(16 + 8 + 3);
    const trail = new Uint8Array(b.length + 4);
    trail.set(b);
    expectFormatError(() => readContainer(trail, 'TEST'), 'trailing-bytes');
    const ver = b.slice();
    ver[4] = 2;
    expectFormatError(() => readContainer(ver, 'TEST'), 'bad-container-version');
    const res = b.slice();
    res[13] = 1;
    expectFormatError(() => readContainer(res, 'TEST'), 'bad-reserved');
    const count = b.slice();
    new DataView(count.buffer).setUint32(8, 0x7fffffff, true);
    expectFormatError(() => readContainer(count, 'TEST'), 'truncated');
    const id = b.slice();
    id[16] = 0x07;
    expectFormatError(() => readContainer(id, 'TEST'), 'bad-chunk-id');
    const len = b.slice();
    new DataView(len.buffer).setUint32(16 + 4, 0xfffffff0, true);
    expect(expectFormatError(() => readContainer(len, 'TEST'), 'truncated').chunkId).toBe('AAAA');
  });

  it('throws FormatError for every truncation of a file', () => {
    const b = sample();
    for (let n = 0; n < b.length; n++) {
      expect(() => readContainer(b.subarray(0, n), 'TEST'), `length ${n}`).toThrow(FormatError);
    }
  });

  it('rejects invalid ids and versions when writing', () => {
    expect(() => writeContainer('TOOLONG', 1, [])).toThrow(FormatError);
    expect(() => writeContainer('TEST', 1, [{ id: 'AéCD', data: new Uint8Array(0) } as ContainerChunk])).toThrow(FormatError);
    expect(() => writeContainer('TEST', 0x10000, [])).toThrow(FormatError);
  });
});
