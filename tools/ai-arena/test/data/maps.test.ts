import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARENA_MAPS,
  arenaMapPath,
  checkOpeningsJson,
  checkRosterJson,
  getArenaMap,
  heightAt,
  loadArenaMap,
  loadOpeningsJson,
  loadRosterJson,
  mapClassOf,
  repoRoot,
  type ArenaMap,
} from '../../src/data/index.ts';

interface Markers {
  readonly name: string;
  readonly sizeWu: number;
  readonly heightScaleRaw: number;
  readonly waterLevel: number | null;
  readonly starts: readonly { army: number; x: number; z: number }[];
  readonly mass: readonly { x: number; z: number }[];
  readonly hydro: readonly { x: number; z: number }[];
}

function markers(name: string): Markers {
  return JSON.parse(readFileSync(join(repoRoot(), 'content', 'maps', 'src', name, 'markers.json'), 'utf8')) as Markers;
}

/** WU as stored in the map file (mapc: Math.round(v · 4096) Fx raw). */
function wu(v: number): number {
  return Math.round(v * 4096) / 4096;
}

const EXPECTED_SIZE: Record<string, number> = { setons: 1024, 'hollow-ridge': 512, tessera: 512, braidwater: 512 };

describe('repoRoot', () => {
  it('finds the workspace root', () => {
    expect(existsSync(join(repoRoot(), 'pnpm-workspace.yaml'))).toBe(true);
    expect(existsSync(join(repoRoot(), 'docs', 'design', 'ai.md'))).toBe(true);
  });
});

describe('loadArenaMap', () => {
  const maps = new Map<string, ArenaMap>();
  for (const name of ARENA_MAPS) maps.set(name, loadArenaMap(name));

  it('knows the four arena maps', () => {
    expect([...ARENA_MAPS]).toEqual(['setons', 'hollow-ridge', 'tessera', 'braidwater']);
  });

  it.each([...ARENA_MAPS])('%s: size, dim, heights, map class', (name) => {
    const m = maps.get(name) as ArenaMap;
    const mk = markers(name);
    expect(m.name).toBe(name);
    expect(m.displayName).toBe(mk.name);
    expect(m.sizeWu).toBe(EXPECTED_SIZE[name]);
    expect(m.sizeWu).toBe(mk.sizeWu);
    expect(m.dim).toBe(m.sizeWu + 1);
    expect(m.heights).toBeInstanceOf(Uint16Array);
    expect(m.heights.length).toBe(m.dim * m.dim);
    expect(m.heightScaleRaw).toBe(mk.heightScaleRaw);
    if (mk.waterLevel === null) {
      expect(m.waterLevelRaw).toBeNull();
      expect(m.waterLevelWu).toBeNull();
    } else {
      expect(m.waterLevelRaw).toBe(Math.round(mk.waterLevel * 4096));
      expect(m.waterLevelWu).toBe(wu(mk.waterLevel));
    }
    expect(m.mapClass).toBe(name === 'setons' ? 'setons' : 'size512');
  });

  it.each([...ARENA_MAPS])('%s: starts match markers.json', (name) => {
    const m = maps.get(name) as ArenaMap;
    const expected = [...markers(name).starts]
      .sort((a, b) => a.army - b.army)
      .map((s) => ({ army: s.army, x: wu(s.x), z: wu(s.z) }));
    expect(m.starts).toEqual(expected);
  });

  it.each([...ARENA_MAPS])('%s: spots match markers.json in file order (mass, then hydro)', (name) => {
    const m = maps.get(name) as ArenaMap;
    const mk = markers(name);
    const expected = [
      ...mk.mass.map((s) => ({ kind: 'mass' as const, x: wu(s.x), z: wu(s.z) })),
      ...mk.hydro.map((s) => ({ kind: 'hydro' as const, x: wu(s.x), z: wu(s.z) })),
    ].map((s, index) => ({ index, ...s }));
    expect(m.spots).toEqual(expected);
  });

  it('Setons has 8 starts, 108 mass and 8 hydro spots', () => {
    const m = maps.get('setons') as ArenaMap;
    expect(m.starts.length).toBe(8);
    expect(m.spots.filter((s) => s.kind === 'mass').length).toBe(108);
    expect(m.spots.filter((s) => s.kind === 'hydro').length).toBe(8);
    expect(m.starts[0]).toEqual({ army: 0, x: 354, z: 678 });
    expect(m.starts[1]).toEqual({ army: 1, x: 670, z: 346 });
  });

  it('rejects path-like names and missing maps', () => {
    expect(() => arenaMapPath('../secret')).toThrow(/invalid map name/);
    expect(() => loadArenaMap('does-not-exist')).toThrow();
  });

  it('getArenaMap caches, loadArenaMap does not', () => {
    expect(getArenaMap('hollow-ridge')).toBe(getArenaMap('hollow-ridge'));
    expect(loadArenaMap('hollow-ridge')).not.toBe(loadArenaMap('hollow-ridge'));
  });
});

describe('heightAt', () => {
  const m = loadArenaMap('hollow-ridge');
  const raw = (x: number, z: number): number => m.heights[z * m.dim + x] as number;
  const toWu = (r: number): number => (r * m.heightScaleRaw) / 4096;

  it('equals the stored sample on grid points', () => {
    for (const [x, z] of [
      [0, 0],
      [17, 311],
      [256, 256],
      [511, 3],
      [512, 512],
    ] as const) {
      expect(m.heightAt(x, z)).toBe(toWu(raw(x, z)));
      expect(heightAt(m, x, z)).toBe(toWu(raw(x, z)));
    }
  });

  it('interpolates bilinearly between samples', () => {
    const x = 100;
    const z = 200;
    const h00 = raw(x, z);
    const h10 = raw(x + 1, z);
    const h01 = raw(x, z + 1);
    const h11 = raw(x + 1, z + 1);
    expect(m.heightAt(x + 0.5, z)).toBeCloseTo(toWu((h00 + h10) / 2), 12);
    expect(m.heightAt(x, z + 0.5)).toBeCloseTo(toWu((h00 + h01) / 2), 12);
    expect(m.heightAt(x + 0.5, z + 0.5)).toBeCloseTo(toWu((h00 + h10 + h01 + h11) / 4), 12);
    const fx = 0.25;
    const fz = 0.75;
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    expect(m.heightAt(x + fx, z + fz)).toBeCloseTo(toWu(top + (bottom - top) * fz), 12);
  });

  it('clamps outside the map and at the far edge', () => {
    expect(m.heightAt(-5, -5)).toBe(toWu(raw(0, 0)));
    expect(m.heightAt(600, 600)).toBe(toWu(raw(512, 512)));
    expect(m.heightAt(512, 0)).toBe(toWu(raw(512, 0)));
  });

  it('start positions are on dry land on every map', () => {
    for (const name of ARENA_MAPS) {
      const map = loadArenaMap(name);
      for (const s of map.starts) {
        expect(map.waterDepthAt(s.x, s.z)).toBeLessThanOrEqual(0.5);
        expect(map.heightAt(s.x, s.z)).toBeGreaterThan(0);
      }
    }
  });
});

describe('mapClassOf', () => {
  it('classes by name and size', () => {
    expect(mapClassOf('setons', 1024)).toBe('setons');
    expect(mapClassOf('hollow-ridge', 512)).toBe('size512');
    expect(mapClassOf('tiny', 256)).toBe('size256');
    expect(mapClassOf('big', 1024)).toBe('size1024');
    expect(mapClassOf('huge', 2048)).toBe('size1024');
  });
});

describe('design JSON loaders', () => {
  it('loads roster.json raw', () => {
    const r = loadRosterJson();
    expect(r.schema).toBe('faf-roster/1');
    expect(r.units.length).toBe(56);
    const cmd = r.units.find((u) => u.id === 'core:cmd_commander');
    expect(cmd?.tech).toBe(0);
    expect(cmd?.categories).toContain('COMMAND');
  });

  it('loads ai-openings.json raw', () => {
    const o = loadOpeningsJson();
    expect(o.schema).toBe('faf-ai-openings/1');
    expect(o.openings.map((x) => x.id)).toEqual(['eco_standard', 'land_rush', 'tech_greed', 'air_opener']);
    expect(Object.keys(o.roles)).toContain('mex');
  });

  it('rejects malformed documents', () => {
    expect(() => checkRosterJson(null)).toThrow(/object/);
    expect(() => checkRosterJson({ schema: 'x', units: [] })).toThrow(/schema/);
    expect(() => checkRosterJson({ schema: 'faf-roster/1', units: [] })).toThrow(/non-empty/);
    expect(() => checkRosterJson({ schema: 'faf-roster/1', units: [{ id: 'a', tech: 1, categories: [] }, { id: 'a', tech: 1, categories: [] }] })).toThrow(
      /duplicate/,
    );
    expect(() => checkRosterJson({ schema: 'faf-roster/1', units: [{ id: 'a', tech: 1.5, categories: [] }] })).toThrow(/tech/);
    expect(() => checkOpeningsJson({ schema: 'faf-ai-openings/1', roles: {}, openings: [] })).toThrow(/non-empty/);
    expect(() => checkOpeningsJson({ schema: 'faf-ai-openings/2', roles: {}, openings: [{ id: 'a' }] })).toThrow(/schema/);
    expect(() => checkOpeningsJson({ schema: 'faf-ai-openings/1', roles: [], openings: [{ id: 'a' }] })).toThrow(/roles/);
  });
});
