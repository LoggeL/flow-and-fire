/**
 * Procedural source models of the asset pipeline (P3, MS2). Own placeholder art (nothing from FA):
 * each model is a merged-part mesh (PLAN §3.7) with up to 3 LODs.
 *
 * Part convention (shared with `@faf/render` UnitPass): part 0 = hull (moves with the unit only);
 * part k ≥ 1 reads PartStream entry `partBase + k − 1`, rotates around its pivot by pitch (nose +x
 * up, around the side axis) and yaw (around +y) relative to its parent (`parent < k`).
 */
import { GeometryBuilder, type LodGeometry } from './geometry.ts';

export interface ModelPart {
  readonly name: string;
  /** Parent part index (< own index; the hull is its own root with parent 0). */
  readonly parent: number;
  /** Rotation pivot in model space (WU). */
  readonly pivot: readonly [number, number, number];
}

export interface ModelDef {
  /** Logical asset id = blueprint `view.mesh` (e.g. `units/cube_bot`). */
  readonly id: string;
  readonly parts: readonly ModelPart[];
  /** 1–3 LODs, finest first. */
  readonly lods: readonly LodGeometry[];
}

/**
 * `units/cube_bot`: a small tracked cube robot the size of the MS1 cube (≈ 0.54 × 0.42 × 0.5 WU):
 * hull with two tracks (part 0), a turret (part 1, yaw) and a barrel (part 2, pitch, child of the
 * turret). LOD 0/1/2: turret cylinder 12/8/4 segments, barrel 8/6/4, LOD 2 merges hull and tracks.
 */
export function cubeBot(): ModelDef {
  const HULL = 0;
  const TURRET = 1;
  const BARREL = 2;
  const turretX = -0.03;
  const turretBase = 0.3;
  const turretTop = 0.42;
  const barrelY = 0.36;
  const lod = (level: 0 | 1 | 2): LodGeometry => {
    const g = new GeometryBuilder();
    if (level < 2) {
      g.box(HULL, [-0.24, 0.08, -0.19], [0.24, turretBase, 0.19]);
      g.box(HULL, [-0.27, 0, -0.25], [0.27, 0.13, -0.13]);
      g.box(HULL, [-0.27, 0, 0.13], [0.27, 0.13, 0.25]);
    } else {
      g.box(HULL, [-0.26, 0, -0.25], [0.26, turretBase, 0.25]);
    }
    const turretSegs = [12, 8, 4][level]!;
    const barrelSegs = [8, 6, 4][level]!;
    g.cylinder(TURRET, 'y', turretX, 0, turretBase, turretTop, 0.13, turretSegs, { start: level === 0, end: true });
    g.cylinder(BARREL, 'x', barrelY, 0, 0.06, 0.4, 0.035, barrelSegs, { start: false, end: true });
    return g.build();
  };
  return {
    id: 'units/cube_bot',
    parts: [
      { name: 'hull', parent: 0, pivot: [0, 0, 0] },
      { name: 'turret', parent: 0, pivot: [turretX, turretBase, 0] },
      { name: 'barrel', parent: 1, pivot: [0.06, barrelY, 0] },
    ],
    lods: [lod(0), lod(1), lod(2)],
  };
}

/** All pipeline models, sorted by id. */
export function allModels(): ModelDef[] {
  return [cubeBot()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
