/**
 * ReplayPlayer.seek (PLAN §3.11 "Seek: Keyframe wiederherstellen und nachsimulieren"): every
 * seek — backwards, forwards, onto and around keyframe ticks, random sequences, under a tiny
 * keyframe budget — yields exactly the state of a direct run (full hash per tick).
 */
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import type { CommandEnvelope } from '@faf/protocol';
import { unitHandles, type World } from '@faf/sim';
import { convertCommandLog, HeadlessSim, ReplayPlayer, type ReplayPlayerOptions } from '../src/index.ts';
import { gameSimBin, hollowRidgeBytes, killCmd, moveCmd, spawnCmd } from './support/fixtures.ts';

const TICKS = 2000;
const SEED = 0x5eec0001;

let table: SimBpTable;
let ridge: Uint8Array;
let replayBytes: Uint8Array;
/** Full hash of the direct run after every tick (index = tick). */
let direct: Uint32Array;
let directRule: number;

/** hollow-ridge: 2 × 120 cubes, moves every 100 ticks, kills + respawn (slot reuse). */
function commands(w: World, tick: number): CommandEnvelope[] {
  const seq = (tick * 4) & 0xffff;
  if (tick === 1) return [spawnCmd(0, 120, 120, 140, 25, seq), spawnCmd(1, 120, 175, 160, 25, seq + 1)];
  if (tick === 777) return [killCmd(0, unitHandles(w, 0).filter((_, i) => i % 7 === 0), seq), spawnCmd(0, 20, 110, 120, 10, seq + 1)];
  if (tick !== 2 && tick % 100 !== 0 && tick !== 1199) return [];
  const out: CommandEnvelope[] = [];
  for (let army = 0; army < 2; army++) {
    const hs = unitHandles(w, army);
    const half = hs.length >> 1;
    const a = Math.imul(tick * 4 + army + 1, 0x9e3779b1) >>> 0;
    out.push(moveCmd(army, hs.slice(0, half), 50 + (a % 150), 50 + ((a >>> 12) % 150), (seq + 2 + army * 2) & 0xffff));
    out.push(moveCmd(army, hs.slice(half), 50 + ((a >>> 5) % 150), 50 + ((a >>> 17) % 150), (seq + 3 + army * 2) & 0xffff));
  }
  return out;
}

function open(options: Partial<ReplayPlayerOptions> = {}): ReplayPlayer {
  return ReplayPlayer.open(replayBytes, { map: ridge, bpTable: table, ...options });
}

function expectAt(player: ReplayPlayer, tick: number): void {
  expect(player.tick).toBe(tick);
  expect(player.fullHash(), `full hash at tick ${tick}`).toBe(direct[tick]);
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  ridge = hollowRidgeBytes();
  const sim = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, map: ridge, keyframes: false });
  direct = new Uint32Array(TICKS + 1);
  direct[0] = sim.fullHash();
  while (sim.tick < TICKS) {
    const t = sim.tick + 1;
    const cmds = commands(sim.world, t);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
    direct[t] = sim.fullHash();
  }
  directRule = sim.ruleHash();
  const res = convertCommandLog(sim.exportLog(), { map: ridge, bpTable: table });
  expect(res.verified).toBe(true);
  replayBytes = res.bytes;
});

describe('ReplayPlayer.seek', () => {
  it('seeks from 2,000 to 250, 600, 1,199, 1,200, 0 and forward to 1,900 exactly', () => {
    const player = open();
    const v = player.playToEnd();
    expect(v.divergences).toEqual([]);
    expect(v.ruleHash).toBe(directRule);
    expectAt(player, TICKS);
    expect(player.keyframes.count).toBe(4);
    for (const t of [250, 600, 1199, 1200, 0]) {
      player.seek(t);
      expectAt(player, t);
    }
    const restores = player.restores;
    player.seek(1900); // forward: restores keyframe 1,800 (it lies between 0 and 1,900)
    expectAt(player, 1900);
    expect(player.restores).toBe(restores + 1);
    player.seek(1900); // no-op
    expectAt(player, 1900);
    player.seek(1950); // forward without a keyframe in between: just simulates on
    expectAt(player, 1950);
    expect(player.restores).toBe(restores + 1);
    // Re-simulations never count twice and never diverge.
    const r = player.playToEnd();
    expect(r.compared).toBe(TICKS / 10);
    expect(r.subCompared).toBe(TICKS / 100);
    expect(r.divergences).toEqual([]);
    expectAt(player, TICKS);
  });

  it('collects keyframes while playing forward, also the ones skipped before', () => {
    const player = open();
    player.seek(1300); // from 0: simulates 1..1300 → keyframes 0, 600, 1200
    expect(Array.from({ length: player.keyframes.count }, (_, i) => player.keyframes.tickAt(i))).toEqual([0, 600, 1200]);
    expectAt(player, 1300);
    player.seek(500);
    expectAt(player, 500);
    player.playToEnd();
    expect(Array.from({ length: player.keyframes.count }, (_, i) => player.keyframes.tickAt(i))).toEqual([0, 600, 1200, 1800]);
    // The compressed keyframes are small: < 10 % of the snapshot each.
    expect(player.keyframes.byteLength).toBeLessThan(player.keyframes.rawByteLength / 10);
  });

  it('random seek sequences equal the direct run', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer({ min: 0, max: TICKS }), fc.constantFrom(0, 599, 600, 601, 1199, 1200, 1800, TICKS)), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 40 }),
        (targets, stepAfter) => {
          const player = open();
          for (const t of targets) {
            player.seek(t);
            expectAt(player, t);
            const ran = player.step(stepAfter);
            expectAt(player, t + ran);
          }
          expect(player.result().divergences).toEqual([]);
        },
      ),
      { numRuns: 30, seed: 0x5eed },
    );
  }, 120_000);

  it('stays exact under a tiny keyframe budget (thinning) and without keyframes', () => {
    const probe = open();
    probe.seek(100);
    const kfSize = probe.keyframes.byteLength;
    // Room for ~3 keyframes at a 100-tick interval → repeated thinning over 2,000 ticks.
    const small = open({ keyframes: { intervalTicks: 100, maxBytes: kfSize * 3 + (kfSize >> 1) } });
    small.playToEnd();
    expect(small.keyframes.thinnings).toBeGreaterThanOrEqual(2);
    expect(small.keyframes.tickAt(0)).toBe(0);
    for (const t of [1999, 1234, 17, 800, 0, 1650]) {
      small.seek(t);
      expectAt(small, t);
    }
    expect(small.result().divergences).toEqual([]);

    const none = open({ keyframes: false });
    none.seek(1500);
    expect(none.keyframes.count).toBe(1);
    none.seek(333);
    expectAt(none, 333);
    expect(none.keyframes.count).toBe(1);
  });

  it('rejects targets outside [0, endTick]', () => {
    const player = open({ keyframes: false });
    expect(() => player.seek(-1)).toThrow(RangeError);
    expect(() => player.seek(TICKS + 1)).toThrow(RangeError);
    expect(() => player.seek(1.5)).toThrow(RangeError);
    expect(player.tick).toBe(0);
  });
});
