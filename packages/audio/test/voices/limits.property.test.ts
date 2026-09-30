import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SOUND_CATEGORIES, categoryIndex, type VoiceHandle } from '../../src/types.ts';
import { loadRealManifest } from '../support/index.ts';
import { makeRig, seededRandom } from './fakes.ts';

interface Cmd {
  sound: number;
  gainPct: number;
  pos: boolean;
  x: number;
  z: number;
  boost: number;
  loop: boolean;
  advanceMs: number;
  stopOne: number;
}

const manifest = loadRealManifest();
const N = manifest.sounds.length;

// Unbiased: fast-check's default bias favours small integers (= the alert sounds at index 0..10
// with long cooldowns and one voice each), which would never saturate the pool.
const cmdArb: fc.Arbitrary<Cmd> = fc.noBias(fc.record({
  sound: fc.integer({ min: 0, max: N - 1 }),
  gainPct: fc.integer({ min: 0, max: 200 }),
  pos: fc.boolean(),
  x: fc.integer({ min: -300, max: 300 }),
  z: fc.integer({ min: -1200, max: 1200 }),
  boost: fc.constantFrom(0, 0, 0, 0, 5, 20, -10),
  loop: fc.constantFrom(false, false, false, false, false, false, false, true),
  advanceMs: fc.constantFrom(0, 0, 0, 0, 0, 0, 1, 2, 5, 16, 33, 100),
  stopOne: fc.integer({ min: -400, max: 40 }),
}));

describe('VoiceManager limits (property, 10 × 1 000 random requests)', () => {
  it('never exceeds the global, category or sound limit; fake sources = voices + tails', async () => {
    const catMax = SOUND_CATEGORIES.map((c) => manifest.categories[c].maxVoices);
    let totalRequests = 0;
    let totalSteals = 0;
    let totalDrops = 0;
    let maxPeak = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 1000, maxLength: 1000 }), fc.integer(), async (cmds, seed) => {
        const r = await makeRig(manifest, { random: seededRandom(seed), logAutomation: false });
        const handles: { h: VoiceHandle; sound: number; cat: number }[] = [];
        for (const c of cmds) {
          const s = manifest.sounds[c.sound]!;
          const h = r.vm.play(
            {
              sound: c.sound,
              gain: c.gainPct / 100,
              x: c.pos ? c.x : undefined,
              z: c.pos ? c.z : undefined,
              priorityBoost: c.boost,
              loop: c.loop ? true : undefined,
            },
            r.ctx.nowMs,
          );
          totalRequests++;
          if (h !== null) handles.push({ h, sound: c.sound, cat: categoryIndex(s.category) });
          if (c.stopOne >= 0 && c.stopOne < handles.length) handles[c.stopOne]!.h.stop(c.stopOne % 3 === 0 ? 0 : 40);
          r.ctx.advance(c.advanceMs);
          r.vm.update();

          // Independent count over the handles that are still alive.
          const perCat = new Int32Array(SOUND_CATEGORIES.length);
          const perSound = new Int32Array(N);
          let alive = 0;
          for (let k = handles.length - 1; k >= 0; k--) {
            const e = handles[k]!;
            if (!e.h.alive) {
              handles.splice(k, 1);
              continue;
            }
            alive++;
            perCat[e.cat]!++;
            perSound[e.sound]!++;
          }
          expect(alive).toBe(r.vm.voiceCount);
          expect(alive).toBeLessThanOrEqual(32);
          for (let ci = 0; ci < perCat.length; ci++) {
            expect(perCat[ci]).toBeLessThanOrEqual(catMax[ci]!);
            expect(r.vm.categoryVoices(ci)).toBe(perCat[ci]);
          }
          for (let si = 0; si < N; si++) expect(perSound[si]).toBeLessThanOrEqual(manifest.sounds[si]!.maxVoices);
          expect(r.vm.tails).toBeLessThanOrEqual(8);
          r.ctx.advance(0);
          expect(r.ctx.liveSources).toBe(r.vm.voiceCount + r.vm.tails);
          expect(r.ctx.liveSources).toBeLessThanOrEqual(32 + 8);
        }
        const st = r.vm.snapshotStats({
          voices: 0,
          peakVoices: 0,
          tails: 0,
          byCategory: new Int32Array(15),
          played: 0,
          stolen: 0,
          dropped: new Int32Array(9),
          lastDrop: null,
        });
        expect(st.peakVoices).toBeLessThanOrEqual(32);
        // Between two advances at most two hard-cut sources (one steal, one stop) are still counted by the fake.
        expect(r.ctx.peakLiveSources).toBeLessThanOrEqual(32 + 8 + 2);
        maxPeak = Math.max(maxPeak, st.peakVoices);
        totalSteals += st.stolen;
        totalDrops += st.dropped.reduce((a, b) => a + b, 0);
        r.vm.dispose();
      }),
      { numRuns: 10, seed: 20260929 },
    );
    expect(totalRequests).toBe(10_000);
    // The random load is heavy enough that the limits actually engage.
    expect(totalSteals).toBeGreaterThan(0);
    expect(totalDrops).toBeGreaterThan(0);
    expect(maxPeak).toBe(32);
  });
});
