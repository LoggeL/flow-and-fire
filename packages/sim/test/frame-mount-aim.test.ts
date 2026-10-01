import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { encodeTarget, FrameReader, FrameWriter, Op, UnitFlags, type CommandEnvelope } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { createWorld, fullHash, initializeSkirmish, ruleHash, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { gameTable } from './support/fixtures.ts';

function frame(w: World, viewer = 0, parts = 32): FrameReader {
  const writer = new FrameWriter({ units: 64, parts, projectiles: 64, beams: 8, events: 64, debugBytes: 0 });
  const bytes = new Uint8Array(writer.capacityBytes), r = new FrameReader();
  expect(r.reset(bytes.subarray(0, writeFrame(w, viewer, writer, bytes)))).toBe(true);
  return r;
}
function setup() {
  const bp = gameTable(), w = createWorld({ bpTable: bp, seed: 12, armyCount: 2, mapSizeWu: 64 });
  initializeSkirmish(w, { kind: 'skirmish', faction: 0, rules: { unitCap: 200, fog: 'explore', victory: 'annihilation' } });
  const u = spawnUnit(w, bp.indexOf('core:lnd_t3_heavy'), 0, fx(20), fx(20), 0);
  const t = spawnUnit(w, bp.indexOf('core:lnd_t1_tank'), 1, fx(24), fx(24), 0);
  const cmd: CommandEnvelope = { tick: asTick(0), army: asArmyId(0), seq: 1, op: Op.Attack, flags: 0,
    units: [w.units.handle(u) as Handle], payload: encodeTarget(w.units.handle(t)) };
  step(w, [cmd]);
  return { w, u, t };
}
function index(r: FrameReader, handle: number): number {
  for (let i = 0; i < r.unitCount; i++) if (r.unitHandle(i) === handle) return i;
  throw new Error('unit absent');
}

describe('private-safe read-only mount observations', () => {
  it('exports actual independent weapon yaw and elevation while preserving all hashes and body heading', () => {
    const { w, u, t } = setup();
    const before = [fullHash(w), ruleHash(w)], yaw = w.units.col.yaw[u]!;
    const r = frame(w), i = index(r, w.units.handle(u)), base = r.unitPartBase(i);
    expect(r.unitFlags(i) & UnitFlags.MountAimParts).not.toBe(0);
    expect(r.unitPartCount(i)).toBe(2); expect(r.unitMountAimMask(i)).toBe(3);
    expect([r.partCurYaw(base), r.partCurYaw(base + 1)]).toEqual([w.weapons.i32[u * 80 + 2], w.weapons.i32[u * 80 + 7]]);
    expect(r.partCurYaw(base)).not.toBe(r.partCurYaw(base + 1));
    expect(w.weapons.i32[u * 80 + 1]).toBe(w.units.handle(t));
    expect(r.partCurPitch(base)).toBeLessThan(0);
    expect(r.unitCurYaw(i)).toBe(yaw); expect(w.units.col.yaw[u]).toBe(yaw);
    expect([fullHash(w), ruleHash(w)]).toEqual(before);
  });

  it('drops hidden viewer targets and firing-army targets before reading their coordinates', () => {
    const { w, u, t } = setup(), U = w.units.col;
    U.visibleMask[t] = 0;
    U.fireState[t] = 0;
    // Hidden coordinates are deliberately invalid; a privacy violation would corrupt elevation.
    U.x[t] = 0x7fffffff; U.y[t] = 0x7fffffff; U.z[t] = 0x7fffffff;
    let r = frame(w), i = index(r, w.units.handle(u));
    expect(r.unitMountAimMask(i)).toBe(0);
    expect(r.partCurYaw(r.unitPartBase(i))).toBe(U.yaw[u]);
    expect(r.partCurPitch(r.unitPartBase(i))).toBe(0);
    // Observer sees units, but may not reveal a target the firing army cannot see.
    r = frame(w, -1); i = index(r, w.units.handle(u));
    expect(r.unitMountAimMask(i)).toBe(0);
  });

  it('bounds part capacity and exposes only successfully written mount channels', () => {
    const { w } = setup();
    const r = frame(w, 0, 1);
    expect(r.partCount).toBe(1);
    for (let i = 0; i < r.unitCount; i++) {
      expect(r.unitPartBase(i) + r.unitPartCount(i)).toBeLessThanOrEqual(r.partCount);
      expect(r.unitMountAimMask(i) >>> r.unitPartCount(i)).toBe(0);
    }
  });
});
