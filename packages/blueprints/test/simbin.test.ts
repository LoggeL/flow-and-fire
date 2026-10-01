// MS3: sim.bin version 2 – round trip of every table, value ranges, section directory, v1 still
// readable (defaults), corrupt input rejected with a clear message.
import { describe, expect, it } from 'vitest';
import { CategoryFilter, matchesMask, compileCategoryExpr, CategoryRegistry } from '@faf/rules';
import {
  compileBlueprints,
  decodeSimBin,
  defineFaction,
  defineProjectile,
  defineProp,
  defineUnit,
  defineWeapon,
  encodeSimBin,
  perSecond2ToFxPerTick2,
  perSecondToFxPerTick,
  SIM_BIN_HEADER_BYTES,
  SIM_BIN_UNIT_RECORD_BYTES,
  SIM_BIN_VERSION,
  SimBinSection,
  type CompileResult,
} from '../src/index.ts';
import { fullUnit, src } from './support/fixtures.ts';

/** content/generated/sim.bin as checked in with MS1/MS2 (version 1, core:cube only, 132 B). */
const SIM_BIN_V1_HEX =
  '4946425001002000010040000400040020000000600000007800000084000000cd0400007b000000cd0c000164000000cd040000000001009a090000010100000f000000000000000000000000000000000000000000000000000000000000000443554245044c414e44064d4f42494c450554454348310009636f72653a637562650000';

function hexBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((b) => Number.parseInt(b, 16)));
}

function richBundle(): CompileResult {
  const m = fullUnit('x:y').sim.motion;
  return compileBlueprints(
    src(
      defineUnit({
        ...fullUnit('core:factory', { categories: ['FACTORY', 'LAND', 'STRUCTURE'] }),
        sim: { ...fullUnit('x:y').sim, motion: { ...m, speed: 0, accel: 0, turnRateDeg: 0, footprint: [4, 4] }, upgradesTo: 'core:factory2' },
      }),
      defineUnit({
        ...fullUnit('core:factory2', { categories: ['FACTORY', 'LAND', 'STRUCTURE', 'TECH2'] }),
        sim: { ...fullUnit('x:y').sim, motion: { ...m, speed: 0, accel: 0, turnRateDeg: 0, footprint: [4, 4] } },
      }),
      defineUnit({
        ...fullUnit('core:tank', { categories: ['LAND', 'MOBILE', 'DIRECTFIRE'] }),
        sim: {
          health: { max: 300 },
          motion: { layer: 'land', speed: 3, accel: 2.5, turnRateDeg: 90, sizeClass: 1, footprint: [1, 1], maxSlope: 0.6, radius: 0.45, mass: 3, turnInPlace: false, brake: 4 },
          economy: { mass: 56, energy: 280, buildTime: 280, buildableBy: 'FACTORY & LAND' },
          weapons: [
            { id: 'main', ref: 'core:wpn_cannon', part: 'turret', arcDeg: 360, yawRateDeg: 120, layers: ['land'], priorities: ['MOBILE & LAND', 'STRUCTURE'] },
            { id: 'aa', ref: 'core:wpn_flak', part: 'hull', arcDeg: 90, yawRateDeg: 45, layers: ['air', 'land'], priorities: ['STRUCTURE'] },
          ],
          hitbox: [0.6, 0.4, 0.8],
          wreck: { massFraction: 0.9, hpFraction: 0.5 },
          deathWeapon: 'core:wpn_flak',
          veterancy: 'none',
        },
      }),
      defineWeapon({
        id: 'core:wpn_cannon',
        sim: { range: 18, damage: 30, reloadSec: 1.4, muzzleVelocity: 30, projectile: 'core:prj_shell', salvo: 1 },
      }),
      defineWeapon({
        id: 'core:wpn_flak',
        sim: { range: 12.5, minRange: 2, damage: 7, damageRadius: 1.5, reloadSec: 0.25, muzzleVelocity: 40, projectile: 'core:prj_homing', salvo: 3, salvoIntervalSec: 0.1 },
      }),
      defineProjectile({ id: 'core:prj_shell', sim: { kind: 'ballistic', speed: 16, gravity: 4.9, lifetimeSec: 6 } }),
      defineProjectile({ id: 'core:prj_homing', sim: { kind: 'homing', speed: 25, lifetimeSec: 2, turnRateDeg: 180 } }),
      defineProp({
        id: 'core:rock',
        sim: { reclaim: { mass: 12, energy: 3, timeSec: 2.5 }, blocksShots: true, footprint: [2, 1], health: 80 },
        view: { placeholder: { hull: 'box', size: [1, 1, 1] } },
      }),
      defineProp({ id: 'core:tree', sim: { reclaim: { mass: 0, energy: 25, timeSec: 1 }, blocksShots: false, footprint: [0, 0] }, view: { placeholder: { hull: 'cyl', size: [1, 2, 1] } } }),
      defineFaction({ id: 'core:faction', units: ['core:tank', 'core:factory', 'core:factory2'], startUnit: 'core:factory', color: [0, 0, 1] }),
    ),
  );
}

describe('sim.bin v2', () => {
  it('round-trips every table with the documented conversions', () => {
    const r = richBundle();
    const t = decodeSimBin(r.simBin);
    expect(t.version).toBe(SIM_BIN_VERSION);
    expect(t.ids).toEqual(['core:factory', 'core:factory2', 'core:tank']);
    const tank = t.indexOf('core:tank');
    // v1 columns keep their meaning.
    expect([t.speedPerTick(tank), t.accelPerTick(tank), t.turnRatePerTick(tank), t.radius(tank)]).toEqual([1229, 102, 1638, 1843]);
    // v2 unit columns.
    expect(t.mass(tank)).toBe(3);
    expect(t.turnInPlace(tank)).toBe(false);
    expect(t.brakePerTick(tank)).toBe(perSecond2ToFxPerTick2(4));
    expect(t.massCost(tank)).toBe(56);
    expect(t.energyCost(tank)).toBe(280);
    expect(t.buildTime(tank)).toBe(280);
    expect(t.wreckMassFraction(tank)).toBe(3686); // 0.9 · 4096
    expect(t.wreckHpFraction(tank)).toBe(2048);
    expect([t.hitbox(tank, 0), t.hitbox(tank, 1), t.hitbox(tank, 2)]).toEqual([2458, 1638, 3277]);
    expect(t.veterancy(tank)).toBe(0);
    expect(t.deathWeapon(tank)).toBe(t.weaponIndexOf('core:wpn_flak'));
    expect(t.upgradesTo(0)).toBe(1);
    expect(t.upgradesTo(1)).toBe(-1);
    // Defaults: mass by size class, tracks turn in place, brake = 2 × accel, veterancy default.
    const f = t.indexOf('core:factory');
    expect([t.mass(f), t.turnInPlace(f), t.brakePerTick(f), t.veterancy(f)]).toEqual([2, true, 0, 1]);
    // Weapons (index = sorted id), projectiles.
    expect(t.weaponIds).toEqual(['core:wpn_cannon', 'core:wpn_flak']);
    const flak = 1;
    expect([t.weaponRange(flak), t.weaponMinRange(flak), t.weaponDamage(flak), t.weaponDamageRadius(flak)]).toEqual([51200, 8192, 7, 6144]);
    expect([t.weaponReloadTicks(flak), t.weaponSalvo(flak), t.weaponSalvoIntervalTicks(flak)]).toEqual([3, 3, 1]);
    expect(t.weaponMuzzleVelocityPerTick(flak)).toBe(perSecondToFxPerTick(40));
    expect(t.projectileIds).toEqual(['core:prj_homing', 'core:prj_shell']);
    expect(t.weaponProjectile(flak)).toBe(0);
    expect([t.projectileKind(0), t.projectileTurnRatePerTick(0), t.projectileLifetimeTicks(0)]).toEqual([2, 3277, 20]);
    expect([t.projectileKind(1), t.projectileGravityPerTick2(1), t.projectileSpeedPerTick(1)]).toEqual([1, 201, 6554]);
    // Mounts (consecutive per unit) and priorities (expression indices).
    expect([t.firstMount(tank), t.mountCount(tank), t.mountCount(f)]).toEqual([0, 2, 0]);
    expect([t.mountUnit(0), t.mountWeapon(0), t.mountPart(0), t.mountHalfArc(0), t.mountYawRatePerTick(0), t.mountLayerMask(0)]).toEqual([tank, 0, 1, 32768, 2185, 1]);
    expect([t.mountPart(1), t.mountHalfArc(1), t.mountLayerMask(1)]).toEqual([0, 8192, 0b100001]);
    const prios = (m: number) => Array.from({ length: t.mountPriorityCount(m) }, (_, i) => t.exprSources[t.priority(t.mountPriorityFirst(m) + i)]);
    expect(prios(0)).toEqual(['MOBILE & LAND', 'STRUCTURE']);
    expect(prios(1)).toEqual(['STRUCTURE']);
    // Expressions: bytecode evaluates like @faf/rules against the unit masks.
    expect(t.exprSources).toEqual(['FACTORY & LAND', 'MOBILE & LAND', 'STRUCTURE']);
    expect(t.buildableByExpr(tank)).toBe(t.exprIndexOf('FACTORY & LAND'));
    expect(t.canBuild(f, tank)).toBe(true);
    expect(t.canBuild(tank, tank)).toBe(false);
    const reg = new CategoryRegistry(t.categoryNames);
    for (let e = 0; e < t.exprCount; e++) {
      const c = compileCategoryExpr(t.exprSources[e]!, reg);
      for (let u = 0; u < t.count; u++) expect(t.unitMatchesExpr(u, e)).toBe(matchesMask(t.categoryMasks, c, t.categoryOffset(u)));
    }
    expect(new CategoryFilter('STRUCTURE', t.categoryNames).matches(t.categoryMasks, t.categoryOffset(f))).toBe(true);
    // Props and factions.
    expect(t.propIds).toEqual(['core:rock', 'core:tree']);
    expect([t.propMaxHpCol[0], t.propReclaimMassCol[0], t.propReclaimEnergyCol[0], t.propReclaimTicksCol[0], t.propFootprintWCol[0], t.propFootprintHCol[0], t.propBlocksShotsCol[0]]).toEqual([
      80, 12, 3, 25, 2, 1, 1,
    ]);
    expect([t.propMaxHpCol[1], t.propBlocksShotsCol[1], t.propFootprintWCol[1]]).toEqual([0, 0, 0]);
    expect(t.factionIds).toEqual(['core:faction']);
    expect(t.factionStartUnit(0)).toBe(f);
    expect(Array.from(t.factionUnitList.subarray(t.factionUnitFirstCol[0]!, t.factionUnitFirstCol[0]! + t.factionUnitCountCol[0]!))).toEqual([tank, 0, 1]);
    expect(t.simHash).toBe(r.simHash);
  });

  it('keeps the v1 layout of header and unit records; adds a section directory', () => {
    const r = richBundle();
    const dv = new DataView(r.simBin.buffer);
    expect(dv.getUint16(4, true)).toBe(2);
    expect(dv.getUint16(6, true)).toBe(SIM_BIN_HEADER_BYTES);
    expect(dv.getUint16(10, true)).toBe(SIM_BIN_UNIT_RECORD_BYTES);
    const dir = dv.getUint32(32, true);
    const n = dv.getUint16(36, true);
    const tags = Array.from({ length: n }, (_, i) => dv.getUint32(dir + i * 16, true));
    expect(tags).toEqual(Object.values(SimBinSection));
    expect(String.fromCharCode(...r.simBin.subarray(dir, dir + 4))).toBe('UEXT');
    // Unknown tags are skipped, so renaming the mandatory UEXT section leaves its data unread.
    const copy = r.simBin.slice();
    const cdv = new DataView(copy.buffer);
    const unitsOff = cdv.getUint32(16, true);
    expect(unitsOff).toBe(dir + n * 16);
    cdv.setUint32(dir + 0 * 16, 0x58585858, true); // UEXT → 'XXXX'
    expect(() => decodeSimBin(copy)).toThrow(/UEXT count ≠ unit count/);
  });

  it('is deterministic: two compilations give identical bytes', () => {
    expect(Buffer.from(richBundle().simBin).equals(Buffer.from(richBundle().simBin))).toBe(true);
  });

  it('encoder rejects out-of-range values and dangling references', () => {
    const r = richBundle();
    const units = r.units.map((u) => u.sim);
    const base = { units, categoryNames: r.categories };
    expect(() => encodeSimBin({ ...base, units: units.map((u, i) => (i === 0 ? { ...u, mass: 0 } : u)) })).toThrow(/mass out of range: 0/);
    expect(() => encodeSimBin({ ...base, units: units.map((u, i) => (i === 0 ? { ...u, mass: 70000 } : u)) })).toThrow(/mass out of range/);
    expect(() => encodeSimBin({ ...base, units: units.map((u, i) => (i === 0 ? { ...u, upgradesTo: 7 } : u)) })).toThrow(/upgradesTo out of range/);
    expect(() => encodeSimBin({ ...base, units: units.map((u, i) => (i === 0 ? { ...u, wreckMass: 5000 } : u)) })).toThrow(/wreckMass out of range/);
    expect(() => encodeSimBin({ ...base, units: units.map((u, i) => (i === 2 ? { ...u, mountCount: 3 } : u)) })).toThrow(/mounts out of range/);
    expect(() =>
      encodeSimBin({
        units: [],
        categoryNames: [],
        weapons: [{ id: 'a:w', range: 1, minRange: 0, damage: 1, damageRadius: 0, reloadTicks: 1, salvo: 1, muzzleVelocityPerTick: 1, projectile: 0, salvoIntervalTicks: 0 }],
      }),
    ).toThrow(/projectile out of range/);
    const plain = { units: [], categoryNames: ['A'] };
    expect(() => encodeSimBin({ ...plain, exprs: [{ source: 'X', code: [1, 99], maxDepth: 1 }] })).toThrow(/invalid bytecode/);
    expect(() => encodeSimBin({ ...plain, exprs: [{ source: 'B', code: [1, 0], maxDepth: 1 }, { source: 'A', code: [1, 0], maxDepth: 1 }] })).toThrow(
      /sources must be strictly sorted/,
    );
  });

  it('decoder rejects corrupt sections and references', () => {
    const good = richBundle().simBin;
    const dv0 = new DataView(good.buffer);
    const dir = dv0.getUint32(32, true);
    const section = (tag: string): { off: number; len: number } => {
      const n = dv0.getUint16(36, true);
      for (let i = 0; i < n; i++) {
        const o = dir + i * 16;
        if (String.fromCharCode(...good.subarray(o, o + 4)) === tag) return { off: dv0.getUint32(o + 4, true), len: dv0.getUint32(o + 8, true) };
      }
      throw new Error(tag);
    };
    const mutate = (f: (dv: DataView) => void): Uint8Array => {
      const b = good.slice();
      f(new DataView(b.buffer));
      return b;
    };
    const unitsOff = dv0.getUint32(16, true);
    expect(() => decodeSimBin(mutate((dv) => dv.setUint16(unitsOff + 48, 0, true)))).toThrow(/invalid values in unit record 0/); // mass 0
    expect(() => decodeSimBin(mutate((dv) => dv.setUint16(unitsOff + 50, 9, true)))).toThrow(/invalid values in unit record 0/); // upgradesTo
    const w = section('WPNR');
    expect(() => decodeSimBin(mutate((dv) => dv.setUint16(w.off + 24, 9, true)))).toThrow(/invalid values in weapon record 0/);
    const c = section('CEXC');
    expect(() => decodeSimBin(mutate((dv) => dv.setInt32(c.off + 4, 99, true)))).toThrow(/invalid values in expression record 0/);
    const m = section('MNTR');
    expect(() => decodeSimBin(mutate((dv) => dv.setUint16(m.off, 0, true)))).toThrow(/invalid values in mount record 0/);
    expect(() => decodeSimBin(mutate((dv) => dv.setUint32(dir + 4, 3, true)))).toThrow(/section 0 out of range/);
    expect(() => decodeSimBin(good.subarray(0, good.length - 4))).toThrow(/length/);
  });
});

describe('sim.bin v1 (MS1/MS2) stays readable', () => {
  it('decodes the MS2 file with v2 defaults', () => {
    const t = decodeSimBin(hexBytes(SIM_BIN_V1_HEX));
    expect(t.version).toBe(1);
    expect(t.ids).toEqual(['core:cube']);
    expect(t.categoryNames).toEqual(['CUBE', 'LAND', 'MOBILE', 'TECH1']);
    expect([t.speedPerTick(0), t.accelPerTick(0), t.turnRatePerTick(0), t.maxHp(0), t.radius(0)]).toEqual([1229, 123, 3277, 100, 1229]);
    expect(t.simHash).toBe(0xd4135af1);
    // Defaults: mass from sizeClass 1, land ⇒ turn in place, brake = accel, no references.
    expect([t.mass(0), t.turnInPlace(0), t.brakePerTick(0), t.upgradesTo(0), t.buildableByExpr(0), t.deathWeapon(0), t.mountCount(0)]).toEqual([
      2, true, 123, -1, -1, -1, 0,
    ]);
    expect([t.weaponCount, t.projectileCount, t.exprCount, t.propCount, t.factionCount]).toEqual([0, 0, 0, 0, 0]);
    expect(t.hitbox(0, 0)).toBe(2 * 1229);
  });

  it('rejects unknown versions with a clear message', () => {
    const b = hexBytes(SIM_BIN_V1_HEX);
    new DataView(b.buffer).setUint16(4, 7, true);
    expect(() => decodeSimBin(b)).toThrow('sim.bin: unsupported version 7 (this build reads 1..2)');
  });
});

describe('MS4 UECO extension', () => {
  it('missing optional extension has zero flow/default free placement, rejects corrupted integer fields', () => {
    const bytes = richBundle().simBin, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dir = dv.getUint32(32, true), count = dv.getUint16(36, true);
    let entry = -1;
    for (let i=0;i<count;i++) if (dv.getUint32(dir+i*16,true)===SimBinSection.UECO) entry=dir+i*16;
    expect(entry).toBeGreaterThan(0);
    const old=bytes.slice(), oldView=new DataView(old.buffer);oldView.setUint32(entry,0x7a7a7a7a,true);
    const table=decodeSimBin(old);expect(Array.from(table.buildPowerQ16PerTickCol)).toEqual([0,0,0]);expect(Array.from(table.spotKindCol)).toEqual([-1,-1,-1]);
    const bad=bytes.slice(),badView=new DataView(bad.buffer);badView.setInt32(dv.getUint32(entry+4,true),-1,true);expect(()=>decodeSimBin(bad)).toThrow(/UECO field/);
    const mismatched=bytes.slice(),mismatchView=new DataView(mismatched.buffer);mismatchView.setUint16(entry+12,1,true);expect(()=>decodeSimBin(mismatched)).toThrow(/UECO count/);
  });
});
