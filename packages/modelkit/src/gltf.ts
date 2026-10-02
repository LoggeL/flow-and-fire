/**
 * glTF 2.0 export (GLB, via @gltf-transform/core). Byte-deterministic: no timestamps, fixed generator, fixed
 * accessor order and names.
 *
 * Layout (compatible with the pipeline GLBs read by `@faf/client` assets/glb.ts):
 * - scene `extras.faf = {id, faction, lods, forward:'+z', up:'+y', unit:'WU', parts:[{name, parent, pivot, anim}], …}`
 *   (+ `hover` in WU for hover/glide units: the height already baked into the geometry)
 * - nodes `lod0…lod2` (finest first) with `extras.faf.lod`, each with mesh `<unit>_lod<i>` and one triangle
 *   primitive: POSITION (f32 VEC3), NORMAL (f32 VEC3, flat or smooth per shape), COLOR_0 (f32 VEC3, linear), _PARTID (u8 SCALAR),
 *   _MASK (u8 normalized VEC4: team, glow, metal, AO), indices (u16, u32 above 65,535 vertices).
 * - one material `faf_vertex` (white base color × COLOR_0, roughness 0.85) so generic viewers show the colors.
 *
 * Axes: glTF convention (+Y up, +Z forward). The game renderer's yaw 0 is +X; it rotates models by -90° about Y
 * at load time (integration in the render milestone).
 */
import { Document, Logger, WebIO } from '@gltf-transform/core';
import type { BuiltModel } from './build.ts';

export const GLTF_GENERATOR = 'faf-modelkit';

export function modelDocument(m: BuiltModel): Document {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  doc.getRoot().getAsset().generator = GLTF_GENERATOR;
  const buffer = doc.createBuffer('data');
  const name = m.unit;
  const parts = m.parts.map((p) => ({ name: p.name, parent: p.parent, pivot: [p.pivot[0], p.pivot[1], p.pivot[2]], anim: p.anim }));
  const material = doc.createMaterial('faf_vertex').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
  const scene = doc.createScene(name).setExtras({
    faf: {
      id: m.id,
      faction: m.faction,
      lods: m.lods.length,
      lodDistances: [...m.lodDistances],
      icon: m.icon,
      iconThreshold: m.iconThreshold,
      footprint: [...m.footprint],
      ...(m.hover > 0 ? { hover: m.hover } : {}),
      forward: '+z',
      up: '+y',
      unit: 'WU',
      parts,
    },
  });
  m.lods.forEach((lod, i) => {
    const acc = (label: string, type: 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array | Uint8Array | Uint16Array | Uint32Array, normalized = false) =>
      doc.createAccessor(`${name}_lod${i}_${label}`).setType(type).setArray(array as Float32Array<ArrayBuffer>).setNormalized(normalized).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', acc('position', 'VEC3', lod.positions))
      .setAttribute('NORMAL', acc('normal', 'VEC3', lod.normals))
      .setAttribute('COLOR_0', acc('color', 'VEC3', lod.colors))
      .setAttribute('_PARTID', acc('partid', 'SCALAR', lod.partIds))
      .setAttribute('_MASK', acc('mask', 'VEC4', lod.mask, true))
      .setIndices(acc('indices', 'SCALAR', lod.indices));
    if (lod.surface !== undefined) prim.setAttribute('_SURFACE', acc('surface', 'SCALAR', lod.surface, true));
    const mesh = doc.createMesh(`${name}_lod${i}`).addPrimitive(prim).setExtras({ faf: { lod: i, parts } });
    scene.addChild(doc.createNode(`lod${i}`).setMesh(mesh).setExtras({ faf: { lod: i } }));
  });
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

/** GLB bytes of a built model. */
export async function exportGlb(m: BuiltModel): Promise<Uint8Array> {
  return new WebIO().writeBinary(modelDocument(m));
}
