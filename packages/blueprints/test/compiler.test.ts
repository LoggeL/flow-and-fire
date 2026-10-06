import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { xxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  compileBlueprints,
  decimalToFx,
  decodeSimBin,
  definePatch,
  defineUnit,
  degPerSecondToAng16PerTick,
  encodeSimBin,
  mergePatch,
  parseViewJson,
  perSecond2ToFxPerTick2,
  perSecondToFxPerTick,
  SIM_BIN_MAGIC,
  type CompileResult,
} from '../src/index.ts';
import { compileContent, CONTENT_GENERATED, loadDefinitions, staleGenerated } from '../scripts/content.ts';

import { compileErr, fullUnit, src } from './support/fixtures.ts';

describe('mergePatch', () => {
  it('merges objects, deletes with null, replaces primitives/plain arrays and never mutates inputs', () => {
    const base = { a: 1, b: { c: 2, d: [1, 2], e: 'x' }, f: true };
    const patch = { a: 5, b: { c: null, d: [9], g: { h: null, i: 1 } }, f: undefined };
    const snapshot = JSON.stringify([base, patch]);
    expect(mergePatch(base, patch)).toEqual({ a: 5, b: { d: [9], e: 'x', g: { i: 1 } }, f: true });
    expect(JSON.stringify([base, patch])).toBe(snapshot);
    expect(mergePatch({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
    expect(mergePatch({ a: { b: 2 } }, { a: 3 })).toEqual({ a: 3 });
    expect(mergePatch([1, 2], [])).toEqual([]);
  });

  it('merges arrays of id-objects by id (update, append, $remove)', () => {
    const base = { w: [{ id: 'gun', dmg: 10, arc: 90 }, { id: 'aa', dmg: 2 }] };
    const patch = { w: [{ id: 'aa', $remove: true }, { id: 'gun', dmg: 12, arc: null }, { id: 'new', dmg: 1, x: null }] };
    expect(mergePatch(base, patch)).toEqual({ w: [{ id: 'gun', dmg: 12 }, { id: 'new', dmg: 1 }] });
    // Mixed arrays are replaced.
    expect(mergePatch({ w: [{ id: 'a' }] }, { w: [{ name: 'b' }] })).toEqual({ w: [{ name: 'b' }] });
  });
});

describe('unit conversion (compile time only)', () => {
  it('converts per second → per tick, degrees → Ang16 and decimals → Fx with round half up', () => {
    expect(perSecondToFxPerTick(3)).toBe(1229); // 1228.8
    expect(perSecondToFxPerTick(0)).toBe(0);
    expect(perSecondToFxPerTick(0.0001)).toBe(1); // never rounds a moving unit to 0
    expect(perSecond2ToFxPerTick2(3)).toBe(123); // 122.88
    expect(degPerSecondToAng16PerTick(180)).toBe(3277); // 3276.8
    expect(degPerSecondToAng16PerTick(360)).toBe(6554); // 6553.6
    expect(degPerSecondToAng16PerTick(360000)).toBe(32768); // capped at a half turn
    expect(decimalToFx(0.5)).toBe(2048);
    expect(decimalToFx(0.6)).toBe(2458); // 2457.6
    expect(decimalToFx(1 / 8192)).toBe(1); // exact half rounds up
  });
});

describe('compileBlueprints', () => {
  it('resolves extends: child values win, parent values are inherited, null deletes', () => {
    const r = compileBlueprints(
      src(
        defineUnit({ ...fullUnit('core:base'), abstract: true, view: { placeholder: { hull: 'box', size: [1, 1, 1] }, icon: 'base_icon' } }),
        defineUnit({
          id: 'core:child',
          extends: 'core:base',
          sim: { motion: { speed: 5 }, intel: { vision: 20 } },
          view: { icon: null },
        }),
        defineUnit({ id: 'core:grandchild', extends: 'core:child', sim: { intel: null }, categories: ['AIR'] }),
      ),
    );
    expect(r.units.map((u) => u.id)).toEqual(['core:child', 'core:grandchild']);
    const child = r.units[0]!;
    expect(child.resolved.sim.motion.speed).toBe(5);
    expect(child.resolved.sim.motion.accel).toBe(3);
    expect(child.resolved.sim.health.max).toBe(100);
    expect(child.resolved.view.icon).toBeUndefined();
    expect(child.resolved.abstract).toBeUndefined();
    expect(child.sim.vision).toBe(20 * 4096);
    const gc = r.units[1]!;
    expect(gc.resolved.sim.intel).toBeUndefined();
    expect(gc.sim.vision).toBe(0);
    expect(gc.sim.speedPerTick).toBe(perSecondToFxPerTick(5));
    expect(gc.resolved.categories).toEqual(['AIR']);
    expect(gc.resolved.extends).toBe('core:child');
    // Abstract bases are not emitted.
    expect(r.view.visuals.map((v) => v.id)).toEqual(['core:child', 'core:grandchild']);
  });

  it('applies merge patches before extends', () => {
    const r = compileBlueprints(
      src(
        defineUnit({ ...fullUnit('core:base'), abstract: true }),
        defineUnit({ id: 'core:a', extends: 'core:base' }),
        definePatch('core:base', { sim: { health: { max: 400 } } }),
        definePatch('core:a', { view: { icon: 'patched' } }),
      ),
    );
    expect(r.units[0]!.sim.maxHp).toBe(400);
    expect(r.units[0]!.view.icon).toBe('patched');
    const e = compileErr(src(defineUnit(fullUnit('core:a')), definePatch('core:nope', { categories: ['X'] })));
    expect(e.diagnostics).toEqual([
      { id: 'core:nope', source: 'mem/1.ts', path: '', message: "patch targets unknown blueprint 'core:nope'" },
    ]);
  });

  it('reports validation errors with JSON paths (unknown fields, types, ranges, missing fields)', () => {
    const e = compileErr(
      src(
        defineUnit({
          ...fullUnit('core:bad'),
          categories: ['land'],
          sim: {
            health: { max: 0 },
            motion: { layer: 'land', speed: 'fast' as unknown as number, accel: 3, turnRateDeg: 180, sizeClass: 1, footprint: [1, 1], maxSlope: 0.6, sped: 3 } as never,
          },
        }),
        defineUnit({ id: 'core:incomplete', extends: 'core:bad2' }),
        defineUnit({ ...fullUnit('core:bad2'), abstract: true, colour: 'red' } as never),
      ),
    );
    const paths = e.diagnostics.map((d) => `${d.id}${d.path}`);
    expect(paths).toContain('core:bad/categories/0');
    expect(paths).toContain('core:bad/sim/health/max');
    expect(paths).toContain('core:bad/sim/motion/speed');
    expect(e.diagnostics).toContainEqual({ id: 'core:bad', source: 'mem/0.ts', path: '/sim/motion/sped', message: 'Unexpected property' });
    expect(e.diagnostics).toContainEqual({ id: 'core:bad', source: 'mem/0.ts', path: '/sim/motion/speed', message: 'Expected number' });
    // Unknown top-level field on the abstract base (the abstract schema is strict too).
    expect(e.diagnostics).toContainEqual({ id: 'core:bad2', source: 'mem/2.ts', path: '/colour', message: 'Unexpected property' });
    expect(e.message).toMatch(/blueprint compilation failed/);
    expect(e.message).toMatch(/mem\/0\.ts core:bad\/sim\/motion\/speed: /);

    const missing = compileErr(src(defineUnit({ id: 'core:m', categories: ['LAND'] } as never)));
    expect(missing.diagnostics.map((d) => d.path)).toEqual(expect.arrayContaining(['/sim', '/view']));
  });

  it('checks semantics: layers, references, namespaces, duplicates, ids', () => {
    const water = compileErr(
      src(defineUnit({ ...fullUnit('core:boat'), sim: { ...fullUnit('x:y').sim, motion: { ...fullUnit('x:y').sim.motion, layer: 'water' } } })),
    );
    expect(water.diagnostics[0]).toMatchObject({ id: 'core:boat', path: '/sim/motion/layer' });
    expect(water.diagnostics[0]!.message).toMatch(/not active in the MVP/);

    const ref = compileErr(src(defineUnit({ id: 'core:orphan', extends: 'core:missing' })));
    expect(ref.diagnostics).toEqual([
      { id: 'core:orphan', source: 'mem/0.ts', path: '/extends', message: "extends unknown blueprint 'core:missing'" },
    ]);

    const testBase = compileErr(src(defineUnit(fullUnit('test:base')), defineUnit({ id: 'core:x', extends: 'test:base' })));
    expect(testBase.diagnostics[0]!.message).toMatch(/test: namespace and cannot be a base/);

    const dup = compileErr(src(defineUnit(fullUnit('core:a')), defineUnit(fullUnit('core:a'))));
    expect(dup.diagnostics[0]!.message).toMatch(/duplicate blueprint id \(already defined in mem\/0\.ts\)/);

    const badId = compileErr(src(defineUnit(fullUnit('Cube'))));
    expect(badId.diagnostics[0]).toMatchObject({ path: '/id' });
  });

  it('detects extends cycles', () => {
    const e = compileErr(
      src(
        defineUnit({ id: 'core:a', extends: 'core:c' }),
        defineUnit({ id: 'core:b', extends: 'core:a' }),
        defineUnit({ id: 'core:c', extends: 'core:b' }),
        defineUnit({ id: 'core:self', extends: 'core:self' }),
      ),
    );
    const msgs = e.diagnostics.map((d) => d.message);
    expect(msgs).toContain('extends cycle: core:a -> core:c -> core:b -> core:a');
    expect(msgs).toContain('extends cycle: core:self -> core:self');
    expect(e.diagnostics.every((d) => d.path === '/extends')).toBe(true);
  });

  it('assigns stable sim ids by sorted string id, independent of definition order', () => {
    const defs = [fullUnit('core:zeta'), fullUnit('core:alpha'), fullUnit('aaa:mid'), fullUnit('core:beta')].map((u) => defineUnit(u));
    const a = compileBlueprints(src(...defs));
    const b = compileBlueprints(src(...[...defs].reverse()));
    expect(a.units.map((u) => [u.simId, u.id])).toEqual([
      [0, 'aaa:mid'],
      [1, 'core:alpha'],
      [2, 'core:beta'],
      [3, 'core:zeta'],
    ]);
    expect(Buffer.from(b.simBin).equals(Buffer.from(a.simBin))).toBe(true);
    expect(b.viewJson).toBe(a.viewJson);
    expect(b.simHash).toBe(a.simHash);
  });

  it('separates simHash (sim values) from viewHash (view values)', () => {
    const base = compileBlueprints(src(defineUnit(fullUnit('core:a'))));
    const viewChanged = compileBlueprints(
      src(defineUnit(fullUnit('core:a', { view: { placeholder: { hull: 'cyl', size: [1, 2, 1], color: [1, 0, 0] }, icon: 'x' } }))),
    );
    expect(viewChanged.simHash).toBe(base.simHash);
    expect(viewChanged.viewHash).not.toBe(base.viewHash);
    const simChanged = compileBlueprints(
      src(defineUnit(fullUnit('core:a', { sim: { ...fullUnit('x:y').sim, health: { max: 101 } } }))),
    );
    expect(simChanged.simHash).not.toBe(base.simHash);
    expect(simChanged.viewHash).toBe(base.viewHash);
    const catChanged = compileBlueprints(src(defineUnit(fullUnit('core:a', { categories: ['LAND', 'MOBILE', 'TECH2'] }))));
    expect(catChanged.simHash).not.toBe(base.simHash);
    // view.json v2 lists the categories (UI filters), so categories move both hashes.
    expect(catChanged.viewHash).not.toBe(base.viewHash);
    // Hashes are xxHash32 over sim.bin and over the compact canonical view.json.
    expect(base.simHash).toBe(xxHash32(base.simBin, 0, base.simBin.length, 0));
    const compact = new TextEncoder().encode(canonicalJson(JSON.parse(base.viewJson)));
    expect(base.viewHash).toBe(xxHash32(compact, 0, compact.length, 0));
  });

  it('excludes the test: namespace unless includeTest is set', () => {
    const defs = src(defineUnit(fullUnit('core:a')), defineUnit({ id: 'test:b', extends: 'core:a', categories: ['TESTONLY'] }));
    const game = compileBlueprints(defs);
    expect(game.units.map((u) => u.id)).toEqual(['core:a']);
    expect(game.categories).not.toContain('TESTONLY');
    const test = compileBlueprints(defs, { includeTest: true });
    expect(test.units.map((u) => u.id)).toEqual(['core:a', 'test:b']);
    expect(test.categories).toContain('TESTONLY');
  });

  it('builds category masks from the sorted registry of emitted units', () => {
    const r = compileBlueprints(
      src(defineUnit(fullUnit('core:a', { categories: ['TECH1', 'LAND'] })), defineUnit(fullUnit('core:b', { categories: ['AIR', 'TECH1'] }))),
    );
    expect(r.categories).toEqual(['AIR', 'LAND', 'TECH1']);
    expect(r.units[0]!.sim.categories).toEqual([0b110, 0, 0, 0]);
    expect(r.units[1]!.sim.categories).toEqual([0b101, 0, 0, 0]);
  });
});

describe('sim.bin', () => {
  it('round-trips through decodeSimBin', () => {
    const r = compileBlueprints(
      src(
        defineUnit(fullUnit('core:a', { categories: ['LAND', 'TECH1'] })),
        defineUnit(
          fullUnit('core:b', {
            categories: ['AIR'],
            sim: {
              health: { max: 1234 },
              motion: { layer: 'air', speed: 12.5, accel: 7, turnRateDeg: 90, sizeClass: 3, footprint: [2, 3], maxSlope: 1.5, radius: 1.25 },
              intel: { vision: 32 },
            },
          }),
        ),
      ),
    );
    const t = decodeSimBin(r.simBin);
    expect(t.count).toBe(2);
    expect(t.ids).toEqual(['core:a', 'core:b']);
    expect(t.categoryNames).toEqual(r.categories);
    expect(t.simHash).toBe(r.simHash);
    for (const u of r.units) {
      const i = u.simId;
      expect(t.indexOf(u.id)).toBe(i);
      expect(t.idOf(i)).toBe(u.id);
      expect(t.speedPerTick(i)).toBe(u.sim.speedPerTick);
      expect(t.accelPerTick(i)).toBe(u.sim.accelPerTick);
      expect(t.turnRatePerTick(i)).toBe(u.sim.turnRatePerTick);
      expect(t.maxHp(i)).toBe(u.sim.maxHp);
      expect(t.radius(i)).toBe(u.sim.radius);
      expect(t.vision(i)).toBe(u.sim.vision);
      expect(t.maxSlope(i)).toBe(u.sim.maxSlope);
      expect(t.layer(i)).toBe(u.sim.layer);
      expect(t.sizeClass(i)).toBe(u.sim.sizeClass);
      expect(t.footprintW(i)).toBe(u.sim.footprintW);
      expect(t.footprintH(i)).toBe(u.sim.footprintH);
      expect(Array.from(t.categories(i, new Uint32Array(4)))).toEqual(u.sim.categories);
    }
    const b = r.units[1]!.sim;
    expect(b).toMatchObject({ speedPerTick: 5120, accelPerTick: 287, turnRatePerTick: 1638, layer: 5, radius: 5120, maxSlope: 6144 });
    expect(t.indexOf('core:zzz')).toBe(-1);
    expect(t.has(2)).toBe(false);
    // Re-encoding the decoded table reproduces the bytes.
    const again = encodeSimBin({ units: r.units.map((u) => u.sim), categoryNames: t.categoryNames });
    expect(Buffer.from(again).equals(Buffer.from(r.simBin))).toBe(true);
  });

  it('rejects malformed input', () => {
    const good = compileBlueprints(src(defineUnit(fullUnit('core:a')))).simBin;
    const mutate = (f: (b: Uint8Array, dv: DataView) => void): Uint8Array => {
      const b = good.slice();
      f(b, new DataView(b.buffer));
      return b;
    };
    expect(new DataView(good.buffer).getUint32(0, true)).toBe(SIM_BIN_MAGIC);
    expect(() => decodeSimBin(good.subarray(0, 10))).toThrow(/truncated header/);
    expect(() => decodeSimBin(mutate((b) => (b[0] = 0)))).toThrow(/bad magic/);
    expect(() => decodeSimBin(mutate((_, dv) => dv.setUint16(4, 3, true)))).toThrow(/unsupported version 3 \(this build reads 1\.\.2\)/);
    expect(() => decodeSimBin(mutate((_, dv) => dv.setUint16(4, 0, true)))).toThrow(/unsupported version 0/);
    expect(() => decodeSimBin(good.subarray(0, good.length - 4))).toThrow(/length/);
    const unitsOff = new DataView(good.buffer).getUint32(16, true);
    expect(() => decodeSimBin(mutate((_, dv) => dv.setInt32(unitsOff + 12, 0, true)))).toThrow(/invalid values in unit record 0/);
    const sim0 = compileBlueprints(src(defineUnit(fullUnit('core:a')))).units[0]!.sim;
    expect(() => encodeSimBin({ units: [{ ...sim0, maxHp: 0 }], categoryNames: ['A'] })).toThrow(/maxHp/);
  });
});

describe('content', () => {
  let game: CompileResult;

  it('compiles the checked-in content (core:cube keeps sim id 0 and its MS1 sim values)', async () => {
    game = await compileContent({ includeTest: false });
    expect(game.units.map((u) => u.id)).toEqual([
      'core:cube',
      'core:fac_land_t1',
      'core:lnd_t1_arty',
      'core:lnd_t1_scout',
      'core:lnd_t1_tank',
      'core:lnd_t2_tank',
      'core:lnd_t3_heavy',
    ]);
    const cube = game.units[0]!;
    expect(cube.simId).toBe(0);
    expect(cube.source).toBe('content/blueprints/core/units/cube.ts');
    expect(cube.resolved.extends).toBe('core:base_cube');
    expect(cube.resolved.view.placeholder.hull).toBe('box');
    expect(cube.resolved.view.placeholder.size).toEqual([0.5, 0.5, 0.5]);
    // The MS1 unit record fields of core:cube are unchanged (goldens, test plane).
    expect(cube.sim).toMatchObject({
      speedPerTick: 1229,
      accelPerTick: 123,
      turnRatePerTick: 3277,
      layer: 0,
      sizeClass: 1,
      maxHp: 100,
      radius: 1229,
      vision: 16 * 4096,
      maxSlope: 2458,
      footprintW: 1,
      footprintH: 1,
    });
    const withTest = await compileContent({ includeTest: true });
    expect(withTest.units.map((u) => u.id)).toContain('test:fast_cube');
    expect(withTest.units[0]!.id).toBe('core:cube');
    const fast = withTest.units.find((u) => u.id === 'test:fast_cube')!;
    expect(fast.sim.speedPerTick).toBe(perSecondToFxPerTick(8));
    expect(fast.resolved.view.placeholder.hull).toBe('cyl');
    // Loading order is deterministic (sorted paths).
    const sources = (await loadDefinitions()).map((d) => d.source);
    expect(sources).toEqual([...sources].sort());
    expect(sources[0]).toBe('content/blueprints/core/ai/ai_default.ts');
    expect(sources.at(-1)).toBe('content/blueprints/test/units/fast_cube.ts');
  });

  it('content/generated is up to date (run `pnpm --filter @faf/blueprints compile`)', async () => {
    game ??= await compileContent({ includeTest: false });
    expect(await staleGenerated(game)).toEqual([]);
    const hashes = JSON.parse(await readFile(join(CONTENT_GENERATED, 'hashes.json'), 'utf8')) as { simHash: string; viewHash: string };
    expect(hashes.simHash).toBe(`0x${game.simHash.toString(16).toUpperCase().padStart(8, '0')}`);
    const view = parseViewJson(await readFile(join(CONTENT_GENERATED, 'view.json'), 'utf8'));
    expect(view.version).toBe(2);
    expect(view.visuals.map((v) => v.id)).toEqual(game.units.map((u) => u.id));
    expect(view.visuals[0]!.placeholder).toEqual({ hull: 'box', size: [0.5, 0.5, 0.5], color: [0.62, 0.66, 0.72] });
    const bin = new Uint8Array(await readFile(join(CONTENT_GENERATED, 'sim.bin')));
    const t = decodeSimBin(bin);
    expect(t.version).toBe(2);
    expect(t.ids).toEqual(game.units.map((u) => u.id));
    expect(t.indexOf('core:cube')).toBe(0);
    expect(await readFile(join(CONTENT_GENERATED, 'bundle.json'), 'utf8')).not.toMatch(/test:/);
  });
});

describe('view.json / canonical JSON', () => {
  it('parses and rejects view.json documents', () => {
    const r = compileBlueprints(src(defineUnit(fullUnit('core:a'))));
    expect(parseViewJson(r.viewJson)).toEqual(r.view);
    expect(() => parseViewJson('{"format":"x"}')).toThrow(/\/format/);
    expect(() => parseViewJson({ format: 'faf-view', version: 1, visuals: [{ id: 'a', nameKey: 'a', descKey: 'b', placeholder: { hull: 'x' } }] })).toThrow(
      /\/visuals\/0\/placeholder\/hull/,
    );
  });

  it('sorts keys, normalizes -0 and rejects non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: [{ d: -0, c: 'x' }], u: undefined })).toBe('{"a":[{"c":"x","d":0}],"b":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite number at \/a/);
    expect(canonicalJson({ a: [1, 2] }, 2)).toBe('{\n  "a": [1, 2]\n}');
  });
});
