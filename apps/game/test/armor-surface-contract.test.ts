import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { box, buildModel, DEFAULT_PALETTE, defineModel, exportGlb, SLOT_INDEX, VARKAN_PALETTE } from '@faf/modelkit';
import { parseGlb } from '../../../packages/client/src/assets/glb.ts';
import { transferablesOf } from '../../../packages/client/src/assets/messages.ts';
import { MESH_VERTEX_STRIDE, mergeMeshes } from '../../../packages/render/src/passes/units.ts';
import { fromModelkit } from '../../../tools/assets-pipeline/src/modelkit.ts';
import { writeCompressedGlb, writeRawGlb } from '../../../tools/assets-pipeline/src/gltf.ts';

const definition = defineModel({ id: 'varkan:surface_test', parts: [{ name: 'hull', shapes:
  ['body', 'soot', 'copper', 'ceramic', 'team', 'glow', 'glass'].map((mat, i) => box({ size: [0.4, 0.4, 0.4], at: [i * 0.5, 0.2, 0], mat, keep: true })),
}] });

describe('generated Varkan armor surface transport', () => {
  it('keeps team, glow and glass clean in every LOD, without changing geometry or palette masks', async () => {
    const built = buildModel(definition, { faction: 'varkan', palette: VARKAN_PALETTE });
    for (const lod of built.lods) {
      expect(lod.surface).toHaveLength(lod.vertices);
      lod.matIds.forEach((slot, i) => {
        expect(lod.surface![i]! > 0).toBe([SLOT_INDEX.base, SLOT_INDEX.dark, SLOT_INDEX.metal, SLOT_INDEX.accent].includes(slot));
        if (lod.mask[i * 4]! > 0 || lod.mask[i * 4 + 1]! > 0) expect(lod.surface![i]).toBe(0);
      });
    }
    const generic = buildModel(defineModel({ id: 'default:test', parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1] })] }] }),
      { faction: 'default', palette: DEFAULT_PALETTE });
    expect(generic.lods.every(lod => lod.surface === undefined)).toBe(true);
    const rawKit = parseGlb(await exportGlb(built), null);
    expect(rawKit.lods[0]!.surface).toEqual(built.lods[0]!.surface);
  });

  it('preserves grain through raw, meshopt, worker transfer and the existing 40-byte GPU stride', async () => {
    const built = buildModel(definition, { faction: 'varkan', palette: VARKAN_PALETTE });
    const model = fromModelkit('units/varkan/surface_test', built);
    await MeshoptDecoder.ready;
    const raw = parseGlb(await writeRawGlb(model), null), packed = parseGlb(await writeCompressedGlb(model), MeshoptDecoder);
    expect(raw.lods.map(lod => lod.surface)).toEqual(built.lods.map(lod => lod.surface));
    expect(packed.lods.map(lod => lod.surface)).toEqual(raw.lods.map(lod => lod.surface));
    const message = { t: 'model', requestId: 1, id: model.id, source: 'network', variant: 'raw', fallbackReason: null, lods: raw.lods, parts: raw.parts } as const;
    expect(transferablesOf(message)).toContain(raw.lods[0]!.surface!.buffer);
    const transferred = structuredClone(message, { transfer: transferablesOf(message) });
    const mesh = transferred.lods[0]!, gpu = new Uint8Array(mergeMeshes([mesh]).vertices);
    expect(MESH_VERTEX_STRIDE).toBe(40);
    mesh.surface!.forEach((weight, i) => expect(gpu[i * MESH_VERTEX_STRIDE + 17]).toBe(weight));
    expect(mesh.mask).toEqual(built.lods[0]!.mask);
    expect(mesh.colors).toEqual(built.lods[0]!.colors);
  });
});
