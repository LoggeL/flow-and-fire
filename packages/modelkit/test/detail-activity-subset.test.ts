/** Geometry contract for the six playable Varkan activity models. Runtime activity and visual quality need separate review. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEntry, loadFaction } from '../../../content/models/registry.ts';
import type { BuiltModel, LodMesh } from '../src/index.ts';

const SUBSET = ['str_t1_fac_land', 'str_t2_fac_land', 'str_t1_mex', 'str_t2_mex', 'str_t1_radar', 'str_t1_pd'] as const;

interface OriginalModel {
  readonly id: string;
  readonly scale: BuiltModel['scale'];
  readonly icon: string;
  readonly footprint: BuiltModel['footprint'];
  readonly originalTriangles: readonly [number, number, number];
  readonly bounds: BuiltModel['bounds'];
  readonly parts: BuiltModel['parts'];
}

// Extracted from the accepted models before this subset's detail work, never from the upgraded geometry.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/detail-activity-subset.baseline.json', import.meta.url), 'utf8')) as {
  readonly sourceRevision: string;
  readonly models: Readonly<Record<(typeof SUBSET)[number], OriginalModel>>;
};
const faction = await loadFaction('varkan');

function expectValidStreams(lod: LodMesh, partCount: number): void {
  expect(lod.vertices).toBeGreaterThan(0);
  expect(lod.triangles).toBeGreaterThan(0);
  expect(lod.positions.length).toBe(3 * lod.vertices);
  expect(lod.normals.length).toBe(3 * lod.vertices);
  expect(lod.colors.length).toBe(3 * lod.vertices);
  expect(lod.partIds.length).toBe(lod.vertices);
  expect(lod.matIds.length).toBe(lod.vertices);
  expect(lod.mask.length).toBe(4 * lod.vertices);
  expect(lod.surface).toBeInstanceOf(Uint8Array);
  expect(lod.surface?.length).toBe(lod.vertices);
  expect(lod.indices.length).toBe(3 * lod.triangles);
  expect(lod.positions.every(Number.isFinite)).toBe(true);
  expect(lod.normals.every(Number.isFinite)).toBe(true);
  expect(lod.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
  expect(lod.indices.every((i) => Number.isInteger(i) && i >= 0 && i < lod.vertices)).toBe(true);
  expect(lod.partIds.every((i) => Number.isInteger(i) && i >= 0 && i < partCount)).toBe(true);
  // Varkan uses the seven core material slots; masks and surface weights are normalized bytes.
  expect(lod.matIds.every((i) => i >= 0 && i < 7)).toBe(true);
  expect(lod.mask.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  expect(lod.surface?.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  expect(lod.partTris).toHaveLength(partCount);
  expect(lod.partTris.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
  expect(lod.partTris.reduce((sum, n) => sum + n, 0)).toBe(lod.triangles);
  const actualPartTris = Array.from({ length: partCount }, () => 0);
  for (let triangle = 0; triangle < lod.indices.length; triangle += 3) {
    const a = lod.indices[triangle]!;
    const b = lod.indices[triangle + 1]!;
    const c = lod.indices[triangle + 2]!;
    expect(new Set([a, b, c]).size).toBe(3);
    const part = lod.partIds[a]!;
    expect(lod.partIds[b]).toBe(part);
    expect(lod.partIds[c]).toBe(part);
    actualPartTris[part]!++;
    expect(lod.matIds[b]).toBe(lod.matIds[a]);
    expect(lod.matIds[c]).toBe(lod.matIds[a]);
  }
  expect(actualPartTris).toEqual(lod.partTris);
  const materialAreas = Object.values(lod.matArea);
  expect(materialAreas.every((area) => Number.isFinite(area) && area >= 0)).toBe(true);
  expect(materialAreas.reduce((sum, area) => sum + area, 0)).toBeGreaterThan(0);
  expect(lod.matArea.team).toBeGreaterThan(0);
  expect(lod.mask.some((v, i) => i % 4 === 0 && v > 0)).toBe(true);
  expect(lod.surface?.some((v) => v > 0)).toBe(true);
  expect(lod.teamTopShare).toBeGreaterThanOrEqual(0);
  expect(lod.teamTopShare).toBeLessThanOrEqual(1);
  for (let i = 0; i < lod.vertices; i++) {
    const length = Math.hypot(lod.normals[3 * i]!, lod.normals[3 * i + 1]!, lod.normals[3 * i + 2]!);
    expect(length).toBeCloseTo(1, 4);
  }
}

describe('Varkan playable activity detail subset', () => {
  it('keeps an original baseline for exactly the six playable review models', () => {
    expect(baseline.sourceRevision).toBe('94e3029c946be087a2d0ada075b83b148b1e3231');
    expect(Object.keys(baseline.models).sort()).toEqual([...SUBSET].sort());
  });

  for (const unit of SUBSET) {
    describe(unit, () => {
      const original = baseline.models[unit];
      const entry = faction.models.find((m) => m.unit === unit);
      if (entry === undefined) throw new Error(`Missing Varkan activity detail model: ${unit}`);
      const built = buildEntry(faction, entry);

      it('preserves identity, footprint and every rig part in order', () => {
        expect(built.id).toBe(original.id);
        expect(built.unit).toBe(unit);
        expect(built.faction).toBe('varkan');
        expect(built.class).toBe('struct');
        expect(built.scale).toEqual(original.scale);
        expect(built.icon).toBe(original.icon);
        expect(built.footprint).toEqual(original.footprint);
        expect(built.parts).toEqual(original.parts);
      });

      it('at least doubles original LOD0 geometry within explicit local descending LOD budgets', () => {
        expect(built.errors).toEqual([]);
        expect(built.lods).toHaveLength(3);
        expect(built.budget.tris).toHaveLength(3);
        expect(entry.def.budget).toBeDefined();
        expect(built.budget.tris).toEqual(entry.def.budget?.tris);
        expect(built.lods[0]!.triangles).toBeGreaterThanOrEqual(2 * original.originalTriangles[0]);
        for (const [i, lod] of built.lods.entries()) {
          expect(lod.lod).toBe(i);
          expect(lod.triangles).toBeLessThanOrEqual(built.budget.tris[i]!);
          if (i > 0) expect(lod.triangles).toBeLessThanOrEqual(built.lods[i - 1]!.triangles);
        }
        expect(built.lods[0]!.partTris.every((n) => n > 0)).toBe(true);
      });

      it('has valid nonempty geometry and material streams at every LOD', () => {
        for (const lod of built.lods) expectValidStreams(lod, built.parts.length);
      });

      it('keeps the original ground plane and dimensions within 15 percent', () => {
        expect(built.bounds.min[1]).toBe(original.bounds.min[1]);
        expect(built.footprintCheck.ok).toBe(true);
        for (let axis = 0; axis < 3; axis++) {
          const originalSize = original.bounds.size[axis]!;
          expect(built.bounds.size[axis]!).toBeGreaterThanOrEqual(originalSize * 0.85);
          expect(built.bounds.size[axis]!).toBeLessThanOrEqual(originalSize * 1.15);
          expect(built.bounds.max[axis]!).toBeGreaterThan(built.bounds.min[axis]!);
          expect(built.bounds.max[axis]! - built.bounds.min[axis]!).toBeCloseTo(built.bounds.size[axis]!, 3);
        }
      });
    });
  }
});
