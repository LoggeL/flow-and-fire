import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRtsMap } from '@faf/formats';
import { sampleHeightRaw } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { PARTS_PER_UNIT, PROP_LODS, PROP_MESHES, UNIT_LODS, UNIT_VARIANTS, UNIT_VISUALS, propMeshes, unitVariantLods, unitVisualTable } from '../src/meshes.ts';
import {
  FLIGHT_SECONDS,
  PROP_COUNT,
  RAW,
  SPLAT_LAYERS,
  SPLAT_RESOLUTION,
  UNIT_COUNT,
  buildScene,
  flightPose,
  fnv1a,
  terrainDesc,
} from '../src/scene.ts';
import type { BenchScene, CameraPose } from '../src/scene.ts';

const MAP = readRtsMap(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/maps/hollow-ridge.rtsmap'))));

function sceneHash(s: BenchScene): number {
  const p = s.props;
  return fnv1a(s.units.writer.bytes, s.units.parts, p.x, p.y, p.z, p.yaw, p.scale, p.mesh, p.tint, ...s.splat);
}

describe('SPK4 scene (deterministic)', () => {
  const scene = buildScene(MAP);

  it('has the spike counts: 2,000 units, 30,000 props, 8 splat layers', () => {
    expect(UNIT_COUNT).toBe(2000);
    expect(PROP_COUNT).toBe(30000);
    expect(scene.units.count).toBe(2000);
    expect(scene.units.writer.capacity).toBe(2000);
    expect(scene.props.count).toBe(30000);
    expect(SPLAT_LAYERS).toBe(8);
    expect(scene.splat).toHaveLength(2);
    for (const plane of scene.splat) expect(plane.length).toBe(SPLAT_RESOLUTION * SPLAT_RESOLUTION * 4);
    const desc = terrainDesc(MAP, 8, scene.splat);
    expect(desc.splat?.layers).toBe(8);
    expect(desc.splat?.planes).toHaveLength(2);
    expect(terrainDesc(MAP, 4, scene.splat).splat?.planes).toHaveLength(1);
    expect(terrainDesc(MAP, 0).splat).toBeUndefined();
    expect(scene.decals).toHaveLength(MAP.meta.spots.length);
  });

  it('builds 3 LODs per multi-part unit visual (hull/turret/barrel) and 2 LODs per prop mesh', () => {
    expect(UNIT_VARIANTS).toHaveLength(UNIT_VISUALS);
    expect(UNIT_LODS).toBe(3);
    for (const v of UNIT_VARIANTS) {
      const lods = unitVariantLods(v);
      expect(lods).toHaveLength(3);
      // three parts in every LOD, coarser LODs have fewer indices
      for (const m of lods) expect(new Set(m.partIds)).toEqual(new Set([0, 1, 2]));
      expect(lods[0]!.indexCount).toBeGreaterThan(lods[1]!.indexCount);
      expect(lods[1]!.indexCount).toBeGreaterThan(lods[2]!.indexCount);
      expect(lods[0]!.partParents?.[2]).toBe(1); // barrel follows the turret
    }
    const table = unitVisualTable();
    expect(table).toHaveLength(UNIT_VISUALS);
    for (const e of table) expect(e.meshes).toHaveLength(3);
    const props = propMeshes();
    expect(props).toHaveLength(PROP_MESHES);
    for (const lods of props) {
      expect(lods).toHaveLength(PROP_LODS);
      expect(lods[0]!.indexCount).toBeGreaterThan(lods[1]!.indexCount);
      expect(lods[0]!.indexCount % 3).toBe(0);
    }
  });

  it('is deterministic: same map bytes ⇒ bit-identical scene', () => {
    const again = buildScene(MAP);
    expect(sceneHash(again)).toBe(sceneHash(scene));
  });

  it('puts every unit on the terrain (y = rules.sampleHeightRaw), also after ticks', () => {
    const hf = scene.heights.hf;
    const w = scene.units.writer;
    for (let i = 0; i < scene.units.count; i++) expect(w.curY(i)).toBe(sampleHeightRaw(hf, w.curX(i), w.curZ(i)));
    const u = buildScene(MAP, { props: 10 }).units;
    const v0 = u.version;
    for (let t = 0; t < 5; t++) u.tick();
    expect(u.version).toBe(v0 + 5);
    expect(u.partsView.version).toBeGreaterThan(5);
    for (let i = 0; i < u.count; i += 7) expect(u.writer.curY(i)).toBe(sampleHeightRaw(hf, u.writer.curX(i), u.writer.curZ(i)));
    // PartStream: 2 parts per unit, turret yaw changes between ticks
    expect(u.partsView.count).toBe(u.count * PARTS_PER_UNIT);
  });

  it('places props on dry land inside the map with all three meshes', () => {
    const p = scene.props;
    const water = MAP.meta.waterLevelRaw ?? -Infinity;
    const perMesh = [0, 0, 0];
    const size = MAP.meta.sizeWu * RAW;
    for (let i = 0; i < p.count; i++) {
      expect(p.x[i]).toBeGreaterThan(0);
      expect(p.x[i]).toBeLessThan(size);
      expect(p.z[i]).toBeGreaterThan(0);
      expect(p.z[i]).toBeLessThan(size);
      expect(scene.heights.raw(p.x[i]!, p.z[i]!)).toBeGreaterThanOrEqual(water);
      perMesh[p.mesh[i]!]!++;
    }
    for (const n of perMesh) expect(n).toBeGreaterThan(3000);
  });

  it('flies a continuous 10-s path over the map (close, overview, back)', () => {
    const pose: CameraPose = { x: 0, z: 0, y: 0, distance: 0, pitch: 0, yaw: 0 };
    let minD = Infinity;
    let maxD = 0;
    let prevX = Number.NaN;
    let prevZ = Number.NaN;
    for (let t = 0; t < FLIGHT_SECONDS; t += 1 / 60) {
      flightPose(scene.heights, t, pose);
      expect(pose.x).toBeGreaterThan(0);
      expect(pose.x).toBeLessThan(MAP.meta.sizeWu);
      expect(Number.isFinite(pose.y)).toBe(true);
      if (!Number.isNaN(prevX)) expect(Math.hypot(pose.x - prevX, pose.z - prevZ)).toBeLessThan(3); // < 180 WU/s
      prevX = pose.x;
      prevZ = pose.z;
      minD = Math.min(minD, pose.distance);
      maxD = Math.max(maxD, pose.distance);
    }
    expect(minD).toBeLessThan(50);
    expect(maxD).toBeGreaterThan(200);
  });
});
