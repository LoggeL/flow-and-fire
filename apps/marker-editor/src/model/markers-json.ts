/**
 * markers.json export in the format of the CLI import (packages/formats/scripts/mapc.ts):
 * world units as decimals, 2-space indented JSON with a trailing newline, keys in the order of the
 * checked-in content/maps/src/<name>/markers.json files.
 *
 * Exactness: every Fx raw value v is written as v / 4096, a dyadic rational that JavaScript prints
 * with the shortest round-tripping decimal, and mapc's Math.round(wu·4096) gives v back exactly.
 * Prop yaw is written as yawDeg = yaw·360/65536 (exact in float64, mapc's degToAng16 gives yaw back),
 * permille / milli values as value / 1000 (mapc rounds ·1000 back; the error is far below 0.5).
 * `yawDeg` / `scale` are omitted at their mapc defaults (0 / 1).
 *
 * Not representable in markers.json: the interleaved order of mass and hydro spots (mapc lists all
 * mass spots first, then all hydro spots), SPLT/PREV (separate mapc inputs) and unknown chunks.
 * `propFields` is written iff the map has a PFLD chunk (also when empty), always together with
 * `propFieldAlgo` (the stored expansion algorithm version).
 *
 * editor.json (toEditorOverlayJson) is the editor's own source file for maps built by `pnpm maps`
 * (content/maps/src/<name>/editor.json, see packages/formats/scripts/mapc.ts applyEditorOverlay):
 * only the markers the editor owns — starts, spots in map order (interleaving kept) and prop fields.
 * The generator keeps owning terrain, water, light, strata and props, and mapgen never overwrites
 * editor.json, so edits survive regeneration.
 */
import { MAP_FX_ONE, propFieldAlgoOf, type MapPropField, type RtsMap } from '@faf/formats';
import type { EditorDocument } from './document.ts';

const wu = (raw: number): number => raw / MAP_FX_ONE;
const milli = (v: number): number => v / 1000;

function fieldJson(f: MapPropField): Record<string, unknown> {
  const sh = f.shape;
  const shape = sh.kind === 'circle' ? { circle: { x: wu(sh.x), z: wu(sh.z), r: wu(sh.r) } } : { polygon: sh.points.map((p) => [wu(p.x), wu(p.z)]) };
  return {
    name: f.name,
    kind: f.kind,
    shape,
    entries: f.entries.map((e) => ({ id: e.id, weight: e.weight })),
    density: f.densityPerKWu2,
    seed: f.seed,
    scale: [milli(f.scaleMinPermille), milli(f.scaleMaxPermille)],
    maxSlope: milli(f.maxSlopePermille),
    dryOnly: f.dryOnly,
    reclaimMass: milli(f.reclaimMassMilli),
    reclaimEnergy: milli(f.reclaimEnergyMilli),
  };
}

/** markers.json object of a map (see module header). */
export function markersObject(map: RtsMap): Record<string, unknown> {
  const m = map.meta;
  const out: Record<string, unknown> = {
    version: 1,
    name: m.name,
    sizeWu: m.sizeWu,
    heightScaleRaw: m.heightScaleRaw,
    waterLevel: m.waterLevelRaw === null ? null : wu(m.waterLevelRaw),
    starts: m.starts.map((s) => ({ army: s.army, x: wu(s.x), z: wu(s.z) })),
    mass: m.spots.filter((s) => s.kind === 'mass').map((s) => ({ x: wu(s.x), z: wu(s.z) })),
    hydro: m.spots.filter((s) => s.kind === 'hydro').map((s) => ({ x: wu(s.x), z: wu(s.z) })),
    props: map.props.map((p) => {
      const o: Record<string, unknown> = { id: p.id, x: wu(p.x), z: wu(p.z) };
      if (p.yaw !== 0) o['yawDeg'] = (p.yaw * 360) / 65536;
      if (p.scalePermille !== 1000) o['scale'] = milli(p.scalePermille);
      return o;
    }),
    light: { azimuthDeg: m.light.azimuthDeg, elevationDeg: m.light.elevationDeg, sun: [...m.light.sun], ambient: [...m.light.ambient] },
    strata: m.strata.map((s) => ({ name: s.name, color: [...s.color] })),
  };
  if (map.propFields !== undefined) {
    out['propFields'] = map.propFields.map(fieldJson);
    out['propFieldAlgo'] = propFieldAlgoOf(map);
  }
  return out;
}

/** File name of the overlay in a map source directory (mapc: EDITOR_OVERLAY_FILE). */
export const EDITOR_OVERLAY_FILE = 'editor.json';

/** editor.json object of a map (see module header and mapc applyEditorOverlay). */
export function editorOverlayObject(map: RtsMap): Record<string, unknown> {
  const m = map.meta;
  const out: Record<string, unknown> = {
    version: 1,
    editorOverlay: 1,
    name: m.name,
    sizeWu: m.sizeWu,
    starts: m.starts.map((s) => ({ army: s.army, x: wu(s.x), z: wu(s.z) })),
    spots: m.spots.map((s) => ({ kind: s.kind, x: wu(s.x), z: wu(s.z) })),
  };
  if (map.propFields !== undefined) {
    out['propFields'] = map.propFields.map(fieldJson);
    out['propFieldAlgo'] = propFieldAlgoOf(map);
  }
  return out;
}

/** editor.json text of the document (2-space JSON with a trailing newline). */
export function toEditorOverlayJson(doc: EditorDocument): string {
  return `${JSON.stringify(editorOverlayObject(doc.toRtsMap()), null, 2)}\n`;
}

/** markers.json text of the document (mapc input together with the original heightmap). */
export function toMarkersJson(doc: EditorDocument): string {
  return `${JSON.stringify(markersObject(doc.toRtsMap()), null, 2)}\n`;
}
