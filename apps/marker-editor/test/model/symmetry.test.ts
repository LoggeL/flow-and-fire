import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOp } from '../../src/model/ops.ts';
import { History } from '../../src/model/history.ts';
import {
  findTwin,
  isMirrorShape,
  isSymmetric,
  mirrorDelta,
  mirrorField,
  mirrorPoint,
  mirrorShape,
  MIRROR_SEED_XOR,
  sideOfPoint,
  sideOfShape,
  symmetrizeOp,
  SYMMETRY_MODES,
} from '../../src/model/symmetry.ts';
import type { SymmetryMode } from '../../src/model/types.ts';
import { bytesEqual, circle, field, mapBytes, openDoc, pointsOf, rect, WU } from './support.ts';

const MODES = SYMMETRY_MODES.filter((m) => m !== 'none');

describe('mirror mappings', () => {
  it('match the definitions exactly', () => {
    const S = 512 * WU;
    const x = 100 * WU + 7;
    const z = 300 * WU + 3;
    expect(mirrorPoint('point', 512, x, z)).toEqual({ x: S - x, z: S - z });
    expect(mirrorPoint('mirrorX', 512, x, z)).toEqual({ x: S - x, z });
    expect(mirrorPoint('mirrorZ', 512, x, z)).toEqual({ x, z: S - z });
    expect(mirrorPoint('diagonal', 512, x, z)).toEqual({ x: z, z: x });
    expect(mirrorPoint('antiDiagonal', 512, x, z)).toEqual({ x: S - z, z: S - x });
    expect(mirrorPoint('none', 512, x, z)).toEqual({ x, z });
  });

  it('are involutions on [0, S]², map the square onto itself and flip the half', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MODES), fc.constantFrom(64, 512, 1024, 4096), fc.nat(), fc.nat(), (mode, size, a, b) => {
        const S = size * WU;
        const x = a % (S + 1);
        const z = b % (S + 1);
        const m = mirrorPoint(mode, size, x, z);
        expect(m.x >= 0 && m.x <= S && m.z >= 0 && m.z <= S).toBe(true);
        expect(mirrorPoint(mode, size, m.x, m.z)).toEqual({ x, z });
        expect(sideOfPoint(mode, size, m.x, m.z)).toBe(-sideOfPoint(mode, size, x, z) as -1 | 0 | 1);
        // Fixed points are exactly the axis points.
        expect(m.x === x && m.z === z).toBe(sideOfPoint(mode, size, x, z) === 0);
        // Linear part.
        const d = mirrorDelta(mode, 37, -1234);
        const m2 = mirrorPoint(mode, size, x + 37, z - 1234);
        expect({ x: m2.x - m.x, z: m2.z - m.z }).toEqual(d);
      }),
      { numRuns: 400, seed: 0x5eed },
    );
  });

  it('mirrored shapes and fields are involutive (seed XOR is its own inverse)', () => {
    const f = field(rect(10, 20, 60, 45), { seed: 0x12345678 });
    for (const mode of MODES) {
      const m = mirrorField(mode, 512, f);
      expect(m.seed).toBe((0x12345678 ^ MIRROR_SEED_XOR) >>> 0);
      expect(isMirrorShape(mode, 512, f.shape, m.shape)).toBe(true);
      expect(isMirrorShape(mode, 512, m.shape, f.shape)).toBe(true);
      expect(mirrorField(mode, 512, m)).toEqual(f);
      expect(sideOfShape(mode, 512, m.shape)).toBe(-sideOfShape(mode, 512, f.shape) as -1 | 0 | 1);
      const c = mirrorShape(mode, 512, circle(10, 20, 5));
      expect(mirrorShape(mode, 512, c)).toEqual(circle(10, 20, 5));
    }
    // Polygon match is cyclic and direction-independent.
    const p = rect(10, 20, 60, 45);
    const pts = pointsOf(mirrorShape('mirrorX', 512, p));
    const rotated = { kind: 'polygon' as const, points: [pts[2]!, pts[1]!, pts[0]!, pts[3]!] };
    expect(isMirrorShape('mirrorX', 512, p, rotated)).toBe(true);
    const broken = { kind: 'polygon' as const, points: [pts[0]!, pts[2]!, pts[1]!, pts[3]!] };
    expect(isMirrorShape('mirrorX', 512, p, broken)).toBe(false);
  });
});

describe('symmetric checked-in maps', () => {
  for (const name of ['setons', 'tessera'] as const) {
    it(`${name} is exactly point-symmetric: isSymmetric, symmetrize a/b changes nothing`, () => {
      const doc = openDoc(name);
      expect(isSymmetric(doc, 'point')).toBe(true);
      for (const keep of ['a', 'b'] as const) {
        const op = symmetrizeOp(doc, 'point', keep);
        expect(op).toEqual({ kind: 'batch', ops: [] });
        const r = applyOp(doc, op);
        expect(bytesEqual(r.doc.toBytes(), mapBytes(name))).toBe(true);
      }
    });
  }

  it('hollow-ridge twins: every start/spot has a point twin', () => {
    const doc = openDoc('hollow-ridge');
    expect(isSymmetric(doc, 'point')).toBe(true);
    expect(findTwin(doc, { type: 'start', index: 0 }, 'point')).toEqual({ type: 'start', index: 1 });
    expect(findTwin(doc, { type: 'start', index: 0 }, 'none')).toBeNull();
    expect(isSymmetric(doc, 'none')).toBe(true);
  });
});

describe('symmetrize', () => {
  it('replaces the other half by mirrors in one undo step; two starts swap armies 0 <-> 1', () => {
    let doc = openDoc('hollow-ridge');
    const orig = doc.toBytes();
    const h = new History();
    // Break symmetry: move start 1 (army 1, half b) and add a spot in half a.
    doc = h.apply(doc, { kind: 'moveMarkers', refs: [{ type: 'start', index: 1 }], dx: 8 * WU, dz: 0 });
    doc = h.apply(doc, { kind: 'addSpot', spot: { kind: 'hydro', x: 40 * WU, z: 200 * WU } });
    expect(isSymmetric(doc, 'point')).toBe(false);
    const beforeSym = doc.toBytes();
    doc = h.apply(doc, symmetrizeOp(doc, 'point', 'a'));
    expect(h.undoDepth).toBe(3);
    expect(isSymmetric(doc, 'point')).toBe(true);
    expect(doc.starts).toEqual([
      { army: 0, x: 96 * WU, z: 96 * WU },
      { army: 1, x: 416 * WU, z: 416 * WU },
    ]);
    expect(doc.spots.some((s) => s.kind === 'hydro' && s.x === 472 * WU && s.z === 312 * WU)).toBe(true);
    doc = h.undo(doc);
    expect(bytesEqual(doc.toBytes(), beforeSym)).toBe(true);
    doc = h.undo(h.undo(doc));
    expect(bytesEqual(doc.toBytes(), orig)).toBe(true);
  });

  it('keep b drops the unmatched half-a marker instead', () => {
    let doc = openDoc('hollow-ridge');
    doc = applyOp(doc, { kind: 'addSpot', spot: { kind: 'hydro', x: 40 * WU, z: 200 * WU } }).doc;
    doc = applyOp(doc, symmetrizeOp(doc, 'point', 'b')).doc;
    expect(bytesEqual(doc.toBytes(), mapBytes('hollow-ridge'))).toBe(true);
  });

  it('mirrorX: axis markers stay single, new armies are the smallest free ones, fields mirrored with seed XOR', () => {
    let doc = openDoc('hollow-ridge');
    const S = 512 * WU;
    doc = applyOp(doc, {
      kind: 'batch',
      ops: [
        { kind: 'addSpot', spot: { kind: 'mass', x: S / 2, z: 30 * WU } }, // on the axis
        { kind: 'addField', field: field(rect(20, 400, 80, 450), { seed: 7 }) }, // half a
        { kind: 'addField', field: field(rect(236, 100, 276, 140), { name: 'axis', seed: 9 }) }, // on the axis (vertex sum)
        { kind: 'addField', field: field(circle(400, 60, 20), { name: 'lost' }) }, // half b, no twin
      ],
    }).doc;
    const nSpots = doc.spots.length;
    // hollow-ridge: army 0 at x = 96 (half a), army 1 at x = 416 (half b, twin of 0 under mirrorX? (416, 96) ≠ (416, 416)).
    doc = applyOp(doc, symmetrizeOp(doc, 'mirrorX', 'a')).doc;
    expect(isSymmetric(doc, 'mirrorX')).toBe(true);
    // Army 1 (half b, unmatched) was replaced by the mirror of army 0 and keeps army 1 (nearest deleted start).
    expect(doc.starts).toEqual([
      { army: 0, x: 96 * WU, z: 96 * WU },
      { army: 1, x: 416 * WU, z: 96 * WU },
    ]);
    expect(doc.spots.filter((s) => s.x === S / 2 && s.z === 30 * WU)).toHaveLength(1);
    expect(doc.spots.length).toBeLessThanOrEqual(nSpots * 2);
    const names = doc.fields.map((f) => f.name);
    expect(names.filter((n) => n === 'axis')).toHaveLength(1);
    expect(names).not.toContain('lost');
    const tw = doc.fields.find((f) => f.name === 'test field' && f.seed === ((7 ^ MIRROR_SEED_XOR) >>> 0));
    expect(tw).toBeDefined();
    expect(isMirrorShape('mirrorX', 512, rect(20, 400, 80, 450), tw!.shape)).toBe(true);
    // A second symmetrize is a no-op.
    expect(symmetrizeOp(doc, 'mirrorX', 'a')).toEqual({ kind: 'batch', ops: [] });
    expect(symmetrizeOp(doc, 'mirrorX', 'b')).toEqual({ kind: 'batch', ops: [] });
  });

  it('assigns new free armies when the other half has no start to pair with', () => {
    let doc = openDoc('hollow-ridge');
    doc = applyOp(doc, { kind: 'addStart', start: { army: 5, x: 50 * WU, z: 400 * WU } }).doc;
    // diagonal: army 0 (96, 96) on the axis, army 1 (416, 416) on the axis, army 5 (x < z) in half a.
    doc = applyOp(doc, symmetrizeOp(doc, 'diagonal', 'a')).doc;
    expect(doc.starts).toEqual([
      { army: 0, x: 96 * WU, z: 96 * WU },
      { army: 1, x: 416 * WU, z: 416 * WU },
      { army: 2, x: 400 * WU, z: 50 * WU },
      { army: 5, x: 50 * WU, z: 400 * WU },
    ]);
  });

  it('every mode on a random-ish asymmetric document yields a symmetric one and undoes exactly', () => {
    const base = applyOp(openDoc('hollow-ridge'), {
      kind: 'batch',
      ops: [
        { kind: 'addSpot', spot: { kind: 'mass', x: 33 * WU + 5, z: 411 * WU } },
        { kind: 'addSpot', spot: { kind: 'hydro', x: 301 * WU, z: 77 * WU + 1 } },
        { kind: 'addField', field: field(rect(20, 300, 60, 330)) },
        { kind: 'addField', field: field(circle(350, 150, 15), { kind: 'rock', entries: [{ id: 'core:rock_01', weight: 1 }] }) },
      ],
    }).doc;
    for (const mode of MODES as SymmetryMode[]) {
      for (const keep of ['a', 'b'] as const) {
        const h = new History();
        const d = h.apply(base, symmetrizeOp(base, mode, keep));
        expect(isSymmetric(d, mode)).toBe(true);
        expect(h.undoDepth).toBe(1);
        expect(bytesEqual(h.undo(d).toBytes(), base.toBytes())).toBe(true);
      }
    }
  });
});

describe('findTwin', () => {
  it('finds spot, field, vertex and radius twins by exact coordinates', () => {
    const S = 512 * WU;
    const doc = applyOp(openDoc('hollow-ridge'), {
      kind: 'batch',
      ops: [
        { kind: 'addField', field: field(rect(20, 300, 60, 330)) },
        { kind: 'addField', field: mirrorField('point', 512, field(rect(20, 300, 60, 330))) },
        { kind: 'addField', field: field(circle(100, 200, 9)) },
        { kind: 'addField', field: field(circle(412, 312, 9)) },
      ],
    }).doc;
    expect(findTwin(doc, { type: 'field', index: 0 }, 'point')).toEqual({ type: 'field', index: 1 });
    expect(findTwin(doc, { type: 'fieldRadius', index: 2 }, 'point')).toEqual({ type: 'fieldRadius', index: 3 });
    const tv = findTwin(doc, { type: 'fieldVertex', index: 0, vertex: 1 }, 'point');
    expect(tv).toMatchObject({ type: 'fieldVertex', index: 1 });
    const p = doc.positionOf({ type: 'fieldVertex', index: 0, vertex: 1 });
    expect(doc.positionOf(tv!)).toEqual({ x: S - p.x, z: S - p.z });
    expect(findTwin(doc, { type: 'field', index: 0 }, 'mirrorX')).toBeNull();
    expect(findTwin(doc, { type: 'spot', index: 999 }, 'point')).toBeNull();
    // A marker on the axis is its own twin.
    const c = applyOp(doc, { kind: 'addSpot', spot: { kind: 'mass', x: S / 2, z: S / 2 } }).doc;
    expect(findTwin(c, { type: 'spot', index: c.spots.length - 1 }, 'point')).toEqual({ type: 'spot', index: c.spots.length - 1 });
  });
});
