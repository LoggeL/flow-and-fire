import { describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx } from '@faf/fixed';
import { FormatError, readContainer, writeContainer } from '@faf/formats';
import { CommandBatchEncoder, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import { createWorld, SIM_BUILD, step, unitHandles, type World } from '@faf/sim';
import { captureStateDump, readStateDump, writeStateDump, type StateDump } from '../src/replay/dump.ts';
import { diffStateDumps, formatStateDiff } from '../src/replay/state-diff.ts';
import { loadSimBin } from '../scripts/lib.ts';

const simBin = loadSimBin();

/** A small deterministic game: 60 cubes per army, moves at tick 5, run to `ticks`. */
function play(ticks: number): World {
  const w = createWorld({ simBin, seed: 0xd0d0, armyCount: 2 });
  const enc = new CommandBatchEncoder(4096);
  const bp = w.bp.indexOf('core:cube');
  for (let t = 1; t <= ticks; t++) {
    enc.reset();
    if (t === 1) {
      enc.add({ tick: asTick(t), army: asArmyId(0), seq: 0, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp, army: 0, count: 60, x: fx(150), z: fx(200), spread: fx(20) }) });
      enc.add({ tick: asTick(t), army: asArmyId(1), seq: 0, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp, army: 1, count: 60, x: fx(350), z: fx(300), spread: fx(20) }) });
    }
    if (t === 5) {
      enc.add({ tick: asTick(t), army: asArmyId(0), seq: 1, op: Op.Move, flags: 0, units: unitHandles(w, 0), payload: encodeMove({ x: fx(300), y: fx(0), z: fx(260) }) });
      enc.add({ tick: asTick(t), army: asArmyId(1), seq: 1, op: Op.Move, flags: 0, units: unitHandles(w, 1), payload: encodeMove({ x: fx(180), y: fx(220), z: fx(220) }) });
    }
    step(w, enc.count > 0 ? enc.view() : null);
  }
  return w;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function expectFormatError(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FormatError);
    return e as FormatError;
  }
  throw new Error('expected a FormatError');
}

describe('full state dump (.rtsdump) and dump diff', () => {
  const wa = play(40);
  const wb = play(40);
  const a = captureStateDump(wa, { label: 'A', simId: 0x1234 });

  it('captures the dynamic arena with layout and identity', () => {
    expect(a.tick).toBe(40);
    expect(a.simBuild).toBe(SIM_BUILD);
    expect(a.simId).toBe(0x1234);
    expect(a.layoutHash).toBe(wa.layoutHash >>> 0);
    expect(a.bytes.length).toBe(wa.snapshotByteLength);
    expect(a.regions.map((r) => r.name)).toContain('units');
  });

  it('write/read round trip is byte-identical and restores every field', () => {
    const bytes = writeStateDump(a);
    const back = readStateDump(bytes);
    expect(bytesEqual(writeStateDump(back), bytes)).toBe(true);
    expect(bytesEqual(back.bytes, a.bytes)).toBe(true);
    expect(back.regions).toEqual(a.regions.map((r) => ({ ...r, parts: r.parts.map((p) => ({ ...p })) })));
    const { bytes: _b, regions: _r, ...headA } = a;
    const { bytes: _b2, regions: _r2, ...headB } = back;
    expect(headB).toEqual(headA);
    // Deflate: a 1.4 MB arena with 120 units compresses to a few KB.
    expect(bytes.length).toBeLessThan(a.bytes.length / 20);
    expect(diffStateDumps(a, back).equal).toBe(true);
  });

  it('identical worlds → equal', () => {
    const b = captureStateDump(wb, { label: 'B' });
    const d = diffStateDumps(a, b);
    expect(d.equal).toBe(true);
    expect(d.layoutEqual).toBe(true);
    expect(d.entries).toEqual([]);
    expect(d.totalDifferingValues).toBe(0);
    expect(formatStateDiff(d)).toContain('Keine Abweichung');
  });

  it('one manipulated units column of slot 17 → exactly one entry naming region/column/index/A/B', () => {
    const w = play(40);
    const hp = w.units.col.hp[17]!;
    w.units.col.hp[17] = hp + 7;
    const d = diffStateDumps(a, captureStateDump(w, { label: 'B' }));
    expect(d.equal).toBe(false);
    expect(d.totalDifferingValues).toBe(1);
    expect(d.regionsDiffering).toEqual(['units']);
    expect(d.entries).toHaveLength(1);
    const e = d.entries[0]!;
    expect(e).toMatchObject({ region: 'units', regionKind: 'table', derived: false, part: 'hp', type: 'i32', index: 17, a: hp, b: hp + 7 });
    expect(e.entity).toBe(`slot 17 (17:${w.units.gen[17]! & 0xfff})`);
    const hpPart = a.regions.find((r) => r.name === 'units')!.parts.find((p) => p.name === 'hp')!;
    expect(e.byteOffset).toBe(hpPart.byteOffset + 17 * 4);
    const text = formatStateDiff(d);
    expect(text).toContain('Region');
    expect(text).toContain('Spalte');
    expect(text).toContain('Entity/Index');
    expect(text).toMatch(/units\s+\| hp \(i32\)\s+\| slot 17 \(17:0\)\s+\| \d+\s+\| \d+/);
  });

  it('a manipulated f64s (SafeInt) column and a dense row are decoded and attributed', () => {
    const w = play(40);
    w.units.col.buildDone.set(3, 123456789);
    const row = w.units.col.mover[9]!;
    w.movers.col.tx[row] = w.movers.col.tx[row]! + 1;
    const d = diffStateDumps(a, captureStateDump(w));
    expect(d.totalDifferingValues).toBe(2);
    const f = d.entries.find((e) => e.part === 'buildDone')!;
    expect(f).toMatchObject({ region: 'units', type: 'f64s', index: 3, b: 123456789 });
    const m = d.entries.find((e) => e.region === 'movers')!;
    expect(m).toMatchObject({ regionKind: 'dense', part: 'tx', index: row });
    expect(m.entity).toBe(`row ${row} → slot 9`);
  });

  it('a manipulation in a derived region is flagged derived (and skipped without includeDerived)', () => {
    const w = play(40);
    w.fine.cellOf[5] = w.fine.cellOf[5]! + 1;
    const b = captureStateDump(w);
    const d = diffStateDumps(a, b);
    expect(d.totalDifferingValues).toBe(1);
    expect(d.entries[0]).toMatchObject({ region: 'grid.fine.cellOf', derived: true, regionKind: 'raw', part: '$data', type: 'raw', index: 5 });
    expect(formatStateDiff(d)).toContain('abgeleitete Region');
    expect(diffStateDumps(a, b, { includeDerived: false }).equal).toBe(true);
  });

  it('limit caps the entries but counts every differing value', () => {
    const w = play(40);
    for (let i = 0; i < 50; i++) w.units.col.x[i] = w.units.col.x[i]! + 1;
    const d = diffStateDumps(a, captureStateDump(w), { limit: 10 });
    expect(d.entries).toHaveLength(10);
    expect(d.totalDifferingValues).toBe(50);
    expect(formatStateDiff(d)).toContain('40 weitere Abweichungen');
  });

  it('different layouts → layout diff only', () => {
    const other = captureStateDump(createWorld({ simBin, seed: 1, armyCount: 2, mapSizeWu: 1024 }));
    const d = diffStateDumps(a, other);
    expect(d.layoutEqual).toBe(false);
    expect(d.equal).toBe(false);
    expect(d.entries).toEqual([]);
    expect(d.layoutDiff.length).toBeGreaterThan(0);
    expect(d.regionsDiffering.length).toBeGreaterThan(0);
    expect(formatStateDiff(d)).toContain('Arena-Layout unterschiedlich');
  });

  describe('broken dumps → FormatError', () => {
    const good = writeStateDump(a);

    it('truncation, bit flips, wrong magic', () => {
      for (const n of [0, 10, 16, 40, good.length - 1]) expectFormatError(() => readStateDump(good.subarray(0, n)));
      for (const pos of [3, 20, 60, Math.floor(good.length / 2), good.length - 5]) {
        const bad = good.slice();
        bad[pos] = bad[pos]! ^ 0x10;
        expectFormatError(() => readStateDump(bad));
      }
    });

    /** Rebuilds the container with one chunk replaced (valid CRCs). */
    const withChunk = (id: string, patch: (d: Uint8Array) => Uint8Array): Uint8Array => {
      const c = readContainer(good, 'RTSD');
      return writeContainer('RTSD', 1, c.chunks.map((ch) => ({ id: ch.id, data: ch.id === id ? patch(ch.data.slice()) : ch.data })));
    };

    it('structurally valid containers with bad contents', () => {
      // Garbage deflate stream.
      expect(expectFormatError(() => readStateDump(withChunk('ARNA', (d) => d.map((v, i) => (i >= 8 ? v ^ 0x5a : v))))).chunkId).toBe('ARNA');
      // rawLength ≠ dynamic area.
      expectFormatError(() => readStateDump(withChunk('ARNA', (d) => (new DataView(d.buffer).setUint32(4, 99, true), d))));
      // Unknown codec, reserved byte.
      expectFormatError(() => readStateDump(withChunk('ARNA', (d) => ((d[2] = 7), d))));
      expectFormatError(() => readStateDump(withChunk('ARNA', (d) => ((d[3] = 1), d))));
      // Chunk version, layout hash, layout text.
      expect(expectFormatError(() => readStateDump(withChunk('HEAD', (d) => ((d[0] = 2), d)))).code).toBe('unsupported-version');
      expectFormatError(() => readStateDump(withChunk('HEAD', (d) => (new DataView(d.buffer).setUint32(10, 1, true), d))));
      expectFormatError(() => readStateDump(withChunk('LAYT', (d) => ((d[20] = 0x41), d))));
      expectFormatError(() => readStateDump(withChunk('HEAD', (d) => d.subarray(0, d.length - 1))));
      // Missing / reordered chunks, other magic, other format version.
      const c = readContainer(good, 'RTSD');
      expectFormatError(() => readStateDump(writeContainer('RTSD', 1, c.chunks.slice(0, 2))));
      expect(expectFormatError(() => readStateDump(writeContainer('RTSD', 1, [c.chunks[1]!, c.chunks[0]!, c.chunks[2]!]))).code).toBe('chunk-order');
      expect(expectFormatError(() => readStateDump(writeContainer('RTSD', 1, [...c.chunks, c.chunks[0]!]))).code).toBe('duplicate-chunk');
      expectFormatError(() => readStateDump(writeContainer('RTSX', 1, c.chunks)));
      expect(expectFormatError(() => readStateDump(writeContainer('RTSD', 2, c.chunks))).code).toBe('unsupported-version');
      // An unknown trailing chunk is skipped.
      const extra = writeContainer('RTSD', 1, [...c.chunks, { id: 'XTRA', data: new Uint8Array([1, 2, 3]) }]);
      expect(diffStateDumps(a, readStateDump(extra)).equal).toBe(true);
    });

    it('random corruption never throws anything but FormatError', () => {
      let seed = 0x1234567;
      const next = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed;
      };
      for (let k = 0; k < 300; k++) {
        const bad = good.slice(0, 16 + (next() % (good.length - 16)));
        const flips = 1 + (next() % 4);
        for (let f = 0; f < flips; f++) bad[next() % bad.length] = next() & 0xff;
        try {
          readStateDump(bad);
        } catch (e) {
          expect(e).toBeInstanceOf(FormatError);
        }
      }
    });
  });

  it('a dump written by another capture of the same state is byte-identical (deterministic writer)', () => {
    const b: StateDump = { ...captureStateDump(wb, { label: 'A', simId: 0x1234 }) };
    expect(bytesEqual(writeStateDump(a), writeStateDump(b))).toBe(true);
  });
});
