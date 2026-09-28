import fc from 'fast-check';
import { XxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { ArenaBuilder, HANDLE_NONE, defineTable, packHandle, ruleHash } from '../src/index.ts';

/** Reference model of the slot allocator (plain JS). */
class Model {
  hw = 0;
  live = 0;
  readonly free: number[] = [];
  readonly alive: boolean[] = [];
  readonly gen: number[] = [];
  constructor(readonly cap: number) {}
  alloc(): number {
    let i: number;
    if (this.free.length > 0) i = this.free.shift()!;
    else if (this.hw < this.cap) {
      i = this.hw++;
      this.gen[i] = 0;
    } else return -1;
    this.alive[i] = true;
    this.live++;
    return i;
  }
  freeSlot(i: number): void {
    this.alive[i] = false;
    this.gen[i] = (this.gen[i]! + 1) & 0xfff;
    this.free.push(i);
    this.live--;
  }
}

type Op = { kind: 'alloc' } | { kind: 'free'; pick: number } | { kind: 'resolveOld'; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.constant<Op>({ kind: 'alloc' }) },
  { weight: 4, arbitrary: fc.nat().map<Op>((pick) => ({ kind: 'free', pick })) },
  { weight: 2, arbitrary: fc.nat().map<Op>((pick) => ({ kind: 'resolveOld', pick })) },
);

describe('table allocator vs reference model (property)', () => {
  it('matches the model for random alloc/free sequences', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.array(opArb, { maxLength: 400 }), (cap, ops) => {
        const b = new ArenaBuilder();
        const t = b.addTable(defineTable('t', cap, { v: 'i32' }));
        b.build();
        const m = new Model(cap);
        const issued: number[] = []; // every handle ever handed out
        for (const op of ops) {
          if (op.kind === 'alloc') {
            const got = t.alloc();
            expect(got).toBe(m.alloc());
            if (got >= 0) {
              const h = t.handle(got);
              expect(h).toBe(packHandle(got, m.gen[got]!));
              issued.push(h);
              t.col.v[got] = got + 1;
            }
          } else if (op.kind === 'free') {
            const liveIdx: number[] = [];
            for (let i = 0; i < m.hw; i++) if (m.alive[i]) liveIdx.push(i);
            if (liveIdx.length === 0) continue;
            const i = liveIdx[op.pick % liveIdx.length]!;
            t.free(i);
            m.freeSlot(i);
          } else if (issued.length > 0) {
            const h = issued[op.pick % issued.length]!;
            const i = h & 0xfffff;
            const gen = h >>> 20;
            const expected = m.alive[i] && m.gen[i] === gen ? i : -1;
            expect(t.resolve(h)).toBe(expected);
          }
          expect(t.highWater).toBe(m.hw);
          expect(t.liveCount).toBe(m.live);
          expect(t.freeCount).toBe(m.free.length);
        }
        for (let i = 0; i < m.hw; i++) {
          expect(t.isLive(i)).toBe(m.alive[i] === true);
          expect(t.gen[i]).toBe(m.gen[i]);
        }
        expect(t.resolve(HANDLE_NONE)).toBe(-1);
      }),
      { numRuns: 300, seed: 0x1f2e3d },
    );
  });

  it('replaying the same op sequence gives the same rule hash (determinism)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 200 }), (ops) => {
        const run = () => {
          const b = new ArenaBuilder();
          const t = b.addTable(defineTable('t', 16, { v: 'i32' }));
          const arena = b.build();
          let n = 0;
          for (const op of ops) {
            if (op.kind === 'alloc') {
              const i = t.alloc();
              if (i >= 0) t.col.v[i] = n++;
            } else if (op.kind === 'free' && t.liveCount > 0) {
              let k = op.pick % t.liveCount;
              for (let i = 0; i < t.highWater; i++) {
                if (!t.isLive(i)) continue;
                if (k-- === 0) {
                  t.free(i);
                  break;
                }
              }
            }
          }
          return ruleHash(arena, new XxHash32());
        };
        expect(run()).toBe(run());
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});
