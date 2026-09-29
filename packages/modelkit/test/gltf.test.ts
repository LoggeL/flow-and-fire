import { WebIO } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { box, buildModel, cylinder, DEFAULT_PALETTE, defineModel, exportGlb, modelMeta } from '../src/index.ts';

const def = () =>
  defineModel({
    id: 'test:unit',
    parts: [
      { name: 'hull', shapes: [box({ size: [1, 0.4, 1.4], at: [0, 0.2, 0], mat: 'team' })] },
      { name: 'turret', pivot: [0, 0.4, 0], shapes: [cylinder({ radius: 0.3, height: 0.2, at: [0, 0.5, 0], mat: 'glow' })] },
    ],
  });
const ctx = { faction: 'test', palette: { ...DEFAULT_PALETTE, faction: 'test' } };

describe('glTF export', () => {
  it('is byte-deterministic (same input → same bytes)', async () => {
    const a = await exportGlb(buildModel(def(), ctx));
    const b = await exportGlb(buildModel(def(), ctx));
    expect(a.byteLength).toBeGreaterThan(1000);
    expect(createHash('sha256').update(a).digest('hex')).toBe(createHash('sha256').update(b).digest('hex'));
  });

  it('contains LOD nodes with POSITION, NORMAL, COLOR_0, _PARTID, _MASK and part extras', async () => {
    const built = buildModel(def(), ctx);
    const doc = await new WebIO().readBinary(await exportGlb(built));
    const root = doc.getRoot();
    expect(root.listNodes().map((n) => n.getName())).toEqual(['lod0', 'lod1', 'lod2']);
    const scene = root.getDefaultScene()!;
    const faf = (scene.getExtras() as { faf: { parts: { name: string; pivot: number[] }[]; forward: string } }).faf;
    expect(faf.forward).toBe('+z');
    expect(faf.parts.map((p) => p.name)).toEqual(['hull', 'turret']);
    expect(faf.parts[1]!.pivot).toEqual([0, 0.4, 0]);
    root.listMeshes().forEach((mesh, i) => {
      const prim = mesh.listPrimitives()[0]!;
      expect(prim.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', '_MASK', '_PARTID']);
      expect(prim.getAttribute('_PARTID')!.getComponentType()).toBe(5121);
      expect(prim.getAttribute('_MASK')!.getNormalized()).toBe(true);
      expect(prim.getAttribute('_MASK')!.getType()).toBe('VEC4');
      expect(prim.getIndices()!.getCount()).toBe(built.lods[i]!.triangles * 3);
      expect(prim.getAttribute('POSITION')!.getCount()).toBe(built.lods[i]!.vertices);
    });
  });

  it('metadata carries bounds, tris per LOD and pivots', async () => {
    const built = buildModel(def(), ctx);
    const glb = await exportGlb(built);
    const meta = modelMeta(built, 'test.unit.glb', 'x', glb.byteLength);
    expect(meta.lods.map((l) => l.triangles)).toEqual(built.lods.map((l) => l.triangles));
    expect(meta.bounds.size).toEqual([1, 0.6, 1.4]);
    expect(meta.parts[1]!.pivot).toEqual([0, 0.4, 0]);
    expect(meta.budget.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});
