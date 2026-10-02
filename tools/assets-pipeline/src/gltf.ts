/**
 * glTF export of pipeline models (P3): one GLB per model with one node + mesh per LOD.
 *
 * Layout (read by `@faf/client` GLB parser):
 * - scene `extras.faf = {id, lods, parts: [{name, parent, pivot}]}`; nodes `lod0..lodN` (in LOD
 *   order) with `extras.faf.lod`, each referencing mesh `<name>_lod<i>` with one triangle
 *   primitive: POSITION (VEC3), NORMAL (VEC3), `_PARTID` (SCALAR u8), indices (u16).
 *   The mesh carries the same `extras.faf` (lod + parts) so a mesh alone is self-describing.
 * - raw fallback (`.raw.glb`): float32 attributes, no extensions.
 * - compressed (`.glb`): KHR_mesh_quantization (POSITION int16 normalized with a node
 *   translation/scale per LOD, NORMAL int8 normalized) + EXT_meshopt_compression (required,
 *   quantize method, lossless on the quantized data; fallback buffer without data).
 *
 * Both files are byte-deterministic for the same model (no timestamps, fixed generator string).
 */
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import type { ModelDef } from './models.ts';

/** Bits for quantized positions (int16 storage) and normals (int8). */
export const QUANTIZE_POSITION_BITS = 14;
export const QUANTIZE_NORMAL_BITS = 8;
export const GLTF_GENERATOR = 'faf-assets-pipeline';

function modelName(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** Builds the (uncompressed) glTF document of a model. */
export function modelDocument(model: ModelDef): Document {
  if (model.lods.length < 1 || model.lods.length > 3) throw new RangeError(`${model.id}: 1–3 LODs expected`);
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  doc.getRoot().getAsset().generator = GLTF_GENERATOR;
  const buffer = doc.createBuffer('data');
  const name = modelName(model.id);
  const parts = model.parts.map((p) => ({ name: p.name, parent: p.parent, pivot: [p.pivot[0], p.pivot[1], p.pivot[2]], ...(p.anim === undefined ? {} : { anim: p.anim }) }));
  const scene = doc.createScene(name).setExtras({ faf: { id: model.id, lods: model.lods.length, parts,
    ...(model.forward === undefined ? {} : { forward: model.forward, up: '+y', unit: 'WU', sourceModelId: model.sourceModelId, viewScale: model.viewScale ?? 1 }) } });
  model.lods.forEach((lod, i) => {
    for (const id of lod.partIds) if (id >= model.parts.length) throw new RangeError(`${model.id} lod${i}: part id ${id} without part`);
    const acc = (label: string, type: 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, normalized = false) =>
      doc.createAccessor(`${name}_lod${i}_${label}`).setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('position', 'VEC3', lod.positions))
      .setAttribute('NORMAL', acc('normal', 'VEC3', lod.normals))
      .setAttribute('_PARTID', acc('partid', 'SCALAR', lod.partIds))
      .setIndices(acc('indices', 'SCALAR', lod.indices));
    if (lod.colors !== undefined && lod.mask !== undefined) {
      if (lod.colors.length !== lod.positions.length || lod.mask.length !== lod.partIds.length * 4) throw new RangeError(`${model.id}: invalid palette arrays`);
      prim.setAttribute('COLOR_0', acc('color', 'VEC3', lod.colors))
        .setAttribute('_MASK', acc('mask', 'VEC4', lod.mask, true));
      prim.setMaterial(doc.createMaterial(`${name}_vertex`).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.85));
    }
    if (lod.surface !== undefined) {
      if (lod.surface.length !== lod.partIds.length) throw new RangeError(`${model.id}: invalid surface array`);
      prim.setAttribute('_SURFACE', acc('surface', 'SCALAR', lod.surface, true));
    }
    const extras = { faf: { lod: i, parts } };
    const mesh = doc.createMesh(`${name}_lod${i}`).addPrimitive(prim).setExtras(extras);
    scene.addChild(doc.createNode(`lod${i}`).setMesh(mesh).setExtras({ faf: { lod: i } }));
  });
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

/** Uncompressed float32 GLB (fallback). */
export async function writeRawGlb(model: ModelDef): Promise<Uint8Array> {
  return new NodeIO().writeBinary(modelDocument(model));
}

/** Quantized + meshopt-compressed GLB. */
export async function writeCompressedGlb(model: ModelDef): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const doc = modelDocument(model);
  await doc.transform(
    quantize({
      pattern: /^(POSITION|NORMAL)$/,
      quantizePosition: QUANTIZE_POSITION_BITS,
      quantizeNormal: QUANTIZE_NORMAL_BITS,
      quantizationVolume: 'mesh',
    }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}
