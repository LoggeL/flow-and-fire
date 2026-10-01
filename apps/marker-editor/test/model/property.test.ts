/**
 * Property tests (fast-check, fixed seeds): random operation sequences, then undo everything →
 * the original bytes; redo everything → the bytes before the undo. Once on the History/op level
 * (raw operations, including invalid ones that must be rejected without side effects) and once
 * through the EditorStore commands (snapping, gestures, live symmetry, symmetrize).
 */
import fc from 'fast-check';
import { FormatError, type MapPoint, type MapPropField } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store.ts';
import type { EditorDocument } from '../../src/model/document.ts';
import { History } from '../../src/model/history.ts';
import { EditorOpError, type EditorOp } from '../../src/model/ops.ts';
import { symmetrizeOp, SYMMETRY_MODES } from '../../src/model/symmetry.ts';
import type { MarkerRef } from '../../src/model/types.ts';
import { bytesEqual, field, mapBytes, openDoc, WU } from './support.ts';

const SIZE = 512;
const MAX = SIZE * WU;
const coord = fc.integer({ min: 0, max: MAX });
const delta = fc.integer({ min: -24 * WU, max: 24 * WU });
const idx = fc.nat({ max: 1000 });
const refType = fc.constantFrom('start', 'spot', 'field', 'fieldVertex', 'fieldRadius');
const polyArb = fc.record({
  x: fc.integer({ min: 48 * WU, max: 464 * WU }),
  z: fc.integer({ min: 48 * WU, max: 464 * WU }),
  rad: fc.integer({ min: 3 * WU, max: 40 * WU }),
  n: fc.integer({ min: 3, max: 9 }),
  rot: fc.integer({ min: 0, max: 359 }),
});

/** Convex regular n-gon (rounded to integers; radius >= 3 WU keeps the points distinct). */
function ngon(p: { x: number; z: number; rad: number; n: number; rot: number }): MapPoint[] {
  const out: MapPoint[] = [];
  for (let k = 0; k < p.n; k++) {
    const a = ((p.rot + (360 * k) / p.n) * Math.PI) / 180;
    out.push({ x: Math.round(p.x + p.rad * Math.cos(a)), z: Math.round(p.z + p.rad * Math.sin(a)) });
  }
  return out;
}

const intentArb = fc.oneof(
  fc.record({ t: fc.constant('addStart' as const), army: fc.integer({ min: 0, max: 15 }), x: coord, z: coord }),
  fc.record({ t: fc.constant('addSpot' as const), kind: fc.constantFrom('mass' as const, 'hydro' as const), x: coord, z: coord, at: idx }),
  fc.record({ t: fc.constant('addCircle' as const), x: coord, z: coord, r: fc.integer({ min: WU, max: 40 * WU }), kind: fc.constantFrom('tree' as const, 'rock' as const, 'wreck' as const) }),
  fc.record({ t: fc.constant('addPoly' as const), p: polyArb }),
  fc.record({ t: fc.constant('move' as const), type: refType, i: idx, v: idx, dx: delta, dz: delta }),
  fc.record({ t: fc.constant('moveVertex' as const), i: idx, v: idx, x: coord, z: coord }),
  fc.record({ t: fc.constant('insertVertex' as const), i: idx, v: idx, dx: delta, dz: delta }),
  fc.record({ t: fc.constant('deleteVertex' as const), i: idx, v: idx }),
  fc.record({ t: fc.constant('radius' as const), i: idx, r: fc.integer({ min: 0, max: 60 * WU }) }),
  fc.record({
    t: fc.constant('update' as const),
    i: idx,
    density: fc.integer({ min: 1, max: 300 }),
    seed: fc.nat({ max: 0xffffffff }),
    dryOnly: fc.boolean(),
    name: fc.constantFrom('Wald', 'Fels 2', 'x'),
  }),
  fc.record({ t: fc.constant('army' as const), i: idx, army: fc.integer({ min: 0, max: 15 }) }),
  fc.record({ t: fc.constant('delete' as const), type: refType, i: idx, j: idx }),
  fc.record({ t: fc.constant('symmetrize' as const), mode: fc.constantFrom(...SYMMETRY_MODES), keep: fc.constantFrom('a' as const, 'b' as const) }),
  fc.record({ t: fc.constant('undo' as const) }),
  fc.record({ t: fc.constant('redo' as const) }),
  fc.record({ t: fc.constant('gesture' as const), type: refType, i: idx, v: idx, steps: fc.array(fc.tuple(delta, delta), { minLength: 1, maxLength: 6 }) }),
);
type Intent = typeof intentArb extends fc.Arbitrary<infer T> ? T : never;

function refOf(doc: EditorDocument, type: MarkerRef['type'], i: number, v: number): MarkerRef | null {
  const n = type === 'start' ? doc.starts.length : type === 'spot' ? doc.spots.length : doc.fields.length;
  if (n === 0) return null;
  const index = i % n;
  if (type === 'fieldVertex') {
    const sh = doc.fields[index]!.shape;
    return sh.kind === 'polygon' ? { type, index, vertex: v % sh.points.length } : { type: 'field', index };
  }
  return { type, index } as MarkerRef;
}

function newField(shape: MapPropField['shape'], kind: MapPropField['kind'] = 'tree', seed = 1): MapPropField {
  const id = kind === 'tree' ? 'core:tree_01' : kind === 'rock' ? 'core:rock_01' : 'core:wreck_01';
  return field(shape, { kind, entries: [{ id, weight: 1 }], seed, densityPerKWu2: 16 });
}

/** Turns an intent into a raw operation on the current document (null = nothing to do). */
function opOf(doc: EditorDocument, it: Intent): EditorOp | null {
  switch (it.t) {
    case 'addStart':
      return { kind: 'addStart', start: { army: it.army, x: it.x, z: it.z } };
    case 'addSpot':
      return { kind: 'addSpot', spot: { kind: it.kind, x: it.x, z: it.z }, index: it.at % (doc.spots.length + 1) };
    case 'addCircle':
      return { kind: 'addField', field: newField({ kind: 'circle', x: it.x, z: it.z, r: it.r }, it.kind, it.x ^ it.z) };
    case 'addPoly':
      return { kind: 'addField', field: newField({ kind: 'polygon', points: ngon(it.p) }) };
    case 'move': {
      const r = refOf(doc, it.type, it.i, it.v);
      return r === null ? null : { kind: 'moveMarkers', refs: [r], dx: it.dx, dz: it.dz };
    }
    case 'moveVertex': {
      const r = refOf(doc, 'fieldVertex', it.i, it.v);
      return r === null || r.type !== 'fieldVertex' ? null : { kind: 'moveFieldVertex', field: r.index, vertex: r.vertex, x: it.x, z: it.z };
    }
    case 'insertVertex': {
      const r = refOf(doc, 'fieldVertex', it.i, it.v);
      if (r === null || r.type !== 'fieldVertex') return null;
      const p = doc.positionOf(r);
      return { kind: 'insertFieldVertex', field: r.index, after: r.vertex, x: p.x + (it.dx >> 3), z: p.z + (it.dz >> 3) };
    }
    case 'deleteVertex': {
      const r = refOf(doc, 'fieldVertex', it.i, it.v);
      return r === null || r.type !== 'fieldVertex' ? null : { kind: 'deleteFieldVertex', field: r.index, vertex: r.vertex };
    }
    case 'radius':
      return doc.fields.length === 0 ? null : { kind: 'setFieldRadius', field: it.i % doc.fields.length, r: it.r };
    case 'update':
      return doc.fields.length === 0
        ? null
        : { kind: 'updateField', index: it.i % doc.fields.length, patch: { densityPerKWu2: it.density, seed: it.seed, dryOnly: it.dryOnly, name: it.name } };
    case 'army':
      return { kind: 'setStartArmy', index: it.i % doc.starts.length, army: it.army };
    case 'delete': {
      const a = refOf(doc, it.type, it.i, 0);
      const b = refOf(doc, it.type, it.j, 0);
      return a === null || b === null ? null : { kind: 'deleteMarkers', refs: [a, b] };
    }
    case 'symmetrize':
      return symmetrizeOp(doc, it.mode, it.keep);
    default:
      return null;
  }
}

function isExpected(e: unknown): boolean {
  return e instanceof EditorOpError || e instanceof FormatError;
}

describe('property: random operation sequences are exactly undoable (History)', () => {
  it('undo all -> original bytes, redo all -> bytes before the undo (250 runs)', () => {
    const original = mapBytes('hollow-ridge');
    const base = openDoc('hollow-ridge');
    let applied = 0;
    let rejected = 0;
    fc.assert(
      fc.property(fc.array(intentArb, { minLength: 1, maxLength: 30 }), (intents) => {
        const h = new History();
        let doc = base;
        for (const it of intents) {
          try {
            if (it.t === 'undo') doc = h.undo(doc);
            else if (it.t === 'redo') doc = h.redo(doc);
            else if (it.t === 'gesture') {
              const r = refOf(doc, it.type, it.i, it.v);
              if (r === null) continue;
              h.beginGesture();
              try {
                for (const [dx, dz] of it.steps) {
                  try {
                    doc = h.apply(doc, { kind: 'moveMarkers', refs: [r], dx, dz });
                  } catch (e) {
                    if (!isExpected(e)) throw e;
                  }
                }
              } finally {
                h.endGesture();
              }
            } else {
              const op = opOf(doc, it);
              if (op === null) continue;
              const before = doc;
              try {
                doc = h.apply(doc, op);
                applied++;
              } catch (e) {
                if (!isExpected(e)) throw e;
                rejected++;
                expect(doc).toBe(before);
              }
            }
          } catch (e) {
            if (!isExpected(e)) throw e;
          }
        }
        const end = doc.toBytes();
        const n = h.undoDepth;
        while (h.canUndo) doc = h.undo(doc);
        expect(bytesEqual(doc.toBytes(), original)).toBe(true);
        for (let i = 0; i < n; i++) doc = h.redo(doc);
        expect(bytesEqual(doc.toBytes(), end)).toBe(true);
      }),
      { numRuns: 250, seed: 0x4d31_3200 },
    );
    // The generator must exercise both paths.
    expect(applied).toBeGreaterThan(500);
    expect(rejected).toBeGreaterThan(20);
  });
});

describe('property: random store command sequences are exactly undoable (EditorStore)', () => {
  it('undo all -> original bytes and clean, redo all -> bytes before the undo (200 runs)', () => {
    const original = mapBytes('hollow-ridge');
    let steps = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            { weight: 6, arbitrary: intentArb },
            { weight: 1, arbitrary: fc.record({ t: fc.constant('config' as const), mode: fc.constantFrom(...SYMMETRY_MODES), live: fc.boolean(), snap: fc.constantFrom(0, 1, 2048, 4096) }) },
            { weight: 2, arbitrary: fc.record({ t: fc.constant('select' as const), type: refType, i: idx, v: idx, j: idx, additive: fc.boolean() }) },
          ),
          { minLength: 1, maxLength: 30 },
        ),
        (cmds) => {
          const s = new EditorStore();
          s.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
          for (const c of cmds) {
            const doc = s.doc.value!;
            switch (c.t) {
              case 'config':
                s.symmetry.value = c.mode;
                s.liveSymmetry.value = c.live;
                s.snapRaw.value = c.snap;
                break;
              case 'select': {
                const a = refOf(doc, c.type, c.i, c.v);
                const b = refOf(doc, 'spot', c.j, 0);
                s.select([a, b].filter((r): r is MarkerRef => r !== null), c.additive);
                break;
              }
              case 'addStart':
                s.addStart(c.x, c.z);
                break;
              case 'addSpot':
                s.addSpot(c.kind, c.x, c.z);
                break;
              case 'addCircle':
                s.addField({ kind: 'circle', x: c.x, z: c.z, r: c.r }, { kind: c.kind, densityPerKWu2: 16 });
                break;
              case 'addPoly':
                s.addField({ kind: 'polygon', points: ngon(c.p) }, { densityPerKWu2: 16 });
                break;
              case 'move':
                s.moveSelectionBy(c.dx, c.dz);
                break;
              case 'moveVertex': {
                const r = refOf(doc, 'fieldVertex', c.i, c.v);
                if (r !== null && r.type === 'fieldVertex') s.moveVertex(r.index, r.vertex, c.x, c.z);
                break;
              }
              case 'insertVertex': {
                const r = refOf(doc, 'fieldVertex', c.i, c.v);
                if (r !== null && r.type === 'fieldVertex') {
                  const p = doc.positionOf(r);
                  s.insertVertex(r.index, r.vertex, p.x + (c.dx >> 3), p.z + (c.dz >> 3));
                }
                break;
              }
              case 'deleteVertex':
              case 'delete':
                s.deleteSelection();
                break;
              case 'radius':
                if (doc.fields.length > 0) s.setFieldRadius(c.i % doc.fields.length, c.r);
                break;
              case 'update':
                if (doc.fields.length > 0) s.updateField(c.i % doc.fields.length, { densityPerKWu2: c.density, seed: c.seed, dryOnly: c.dryOnly, name: c.name });
                break;
              case 'army':
                s.setStartArmy(c.i % doc.starts.length, c.army);
                break;
              case 'symmetrize':
                s.symmetrize(c.mode, c.keep);
                break;
              case 'undo':
                s.undo();
                break;
              case 'redo':
                s.redo();
                break;
              case 'gesture': {
                const r = refOf(doc, c.type, c.i, c.v);
                if (r === null) break;
                s.select([r]);
                s.beginGesture();
                for (const [dx, dz] of c.steps) {
                  if (r.type === 'fieldVertex') {
                    const p = s.doc.value!.has(r) ? s.doc.value!.positionOf(r) : null;
                    if (p !== null) s.moveVertex(r.index, r.vertex, p.x + dx, p.z + dz);
                  } else if (r.type === 'fieldRadius') {
                    const sh = s.doc.value!.fields[r.index]?.shape;
                    if (sh?.kind === 'circle') s.setFieldRadius(r.index, sh.r + dx);
                  } else {
                    s.moveSelectionBy(dx, dz);
                  }
                }
                s.endGesture();
                break;
              }
            }
          }
          const end = s.exportBytes();
          const n = s.undoDepth.value;
          steps += n;
          while (s.canUndo.value) s.undo();
          expect(bytesEqual(s.exportBytes(), original)).toBe(true);
          expect(s.dirty.value).toBe(false);
          for (let i = 0; i < n; i++) s.redo();
          expect(bytesEqual(s.exportBytes(), end)).toBe(true);
        },
      ),
      { numRuns: 200, seed: 0x5707e },
    );
    expect(steps).toBeGreaterThan(250);
  });
});
