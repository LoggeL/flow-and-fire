/**
 * Laterne I (f3:str_t1_pgen) – Sael-Kraftwerk T1; Grundform der Laternen-Familie (II/III importieren `pgenParts`).
 *
 * Roster: „Eine stehende Laterne (Linse, Zahl = Tech, Höhe ≥ 1,5 × Schalen-Ø) über einer flachen Schale, Goldkern in
 * der Linse.“ Laterne II: 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Laternen; Laterne III: 8×8 (Maßstab 4,0, Höhe ×1,4) mit
 * 3 Laternen. Alle drei werden im Basismaß 2×2 gebaut, der Roster-Maßstab bläst sie auf.
 * faction.md §5.2 Laterne: 1–3 stehende Laternen (Zahl = Tech) über einer flachen Schale, Laternenhöhe (Oberkante)
 * ≥ 1,5 × Schalen-Ø; `lantern` ist flow-exklusiv (Goldkern). §3.2: das Rollen-Element schwebt 0,2–0,4 WU über dem
 * Sockel. Pflichtpaare: Brunnen↔Laterne, Laterne↔Schrein (stehend gegen liegend), Sintflut↔Laterne III.
 *
 * Aufbau (y = Boden, +Z = vorn, Basismaß 2×2):
 *   hull – Kissen (Emaille-Rand, Perlmutt-Einlage), flache Goldschale, schwebende Laternen: stehende
 *          Glaslinse (Laternenglas) mit durchstoßendem Goldkern und goldenem Fuß-Knauf, Tech-Streifen (Tiefjade)
 *          hinten; keine beweglichen Teile.
 */
import { defineModel, ellipsoid, lens, sphere, stripes, type PartDef, type Shape, type Vec3 } from '@faf/modelkit';
import { cushion } from './str_t1_mex.ts';

const CUSHION_H = 0.16;
const TOP = CUSHION_H + 0.006;
const DISH_R = 0.52;
const DISH_H = 0.16;
/** Abstand Schale → Laternenunterkante im Spielmaß (§3.2: 0,2–0,4 WU), im Basismaß durch den Höhen-Maßstab geteilt. */
const FLOAT = 0.3;
const SCALE_Y: Record<1 | 2 | 3, number> = { 1: 1, 2: 3.6, 3: 5.6 };

interface LanternSpec {
  readonly x: number;
  readonly z: number;
  /** Halbe Breite, Höhe, Dicke der Glaslinse. */
  readonly w: number;
  readonly h: number;
  readonly t: number;
  /** Drehung um +Y (Grad): Laternen fächern leicht auf. */
  readonly yaw: number;
}

const LANTERNS: Record<1 | 2 | 3, readonly LanternSpec[]> = {
  1: [{ x: 0, z: 0, w: 0.34, h: 1.36, t: 0.3, yaw: 0 }],
  2: [
    { x: 0.3, z: 0, w: 0.27, h: 1.2, t: 0.27, yaw: 18 },
    { x: -0.3, z: 0, w: 0.27, h: 1.2, t: 0.27, yaw: -18 },
  ],
  3: [
    { x: 0, z: -0.08, w: 0.29, h: 1.12, t: 0.28, yaw: 0 },
    { x: 0.46, z: 0.1, w: 0.22, h: 0.86, t: 0.23, yaw: 26 },
    { x: -0.46, z: 0.1, w: 0.22, h: 0.86, t: 0.23, yaw: -26 },
  ],
};

/**
 * Stehende Laterne: weiche Glaslinse (auch der Rand geglättet, kein Kristall), Goldkern tritt vorn und hinten aus dem
 * Glas, goldener Kragen unten (nur I/II) und goldene Knospe oben.
 */
function lantern(l: LanternSpec, y0: number, segs: number, collar: boolean): Shape[] {
  const cy = y0 + l.h / 2;
  const at: Vec3 = [l.x, cy, l.z];
  const rot: Vec3 = [0, l.yaw, 0];
  const out: Shape[] = [
    lens({ radius: l.w, thickness: l.t, length: l.h, segments: segs, rings: segs > 8 ? 4 : 3, axis: 'z', rot, at, smooth: 179, mat: 'glass', keep: true, tag: 'lantern' }),
    lens({ radius: l.w * 0.46, thickness: l.t * 1.3, length: l.h * 0.46, segments: 6, rings: 3, axis: 'z', rot, at, smooth: 179, mat: 'light', keep: true, tag: 'lantern' }),
    sphere({ radius: l.w * 0.26, segments: 6, rings: 3, at: [l.x, y0 + l.h - 0.02, l.z], mat: 'gold', maxLod: 1, tag: 'lantern' }),
  ];
  if (collar) out.push(lens({ radius: l.w * 0.62, thickness: 0.1, segments: 6, rings: 2, rot, at: [l.x, y0 + 0.04, l.z], mat: 'gold', maxLod: 1, tag: 'lantern' }));
  return out;
}

export function pgenParts(tech: 1 | 2 | 3): PartDef[] {
  // Streifen 0,10 WU im Spielmaß ⇒ im Basismaß 0,10 / Maßstab (II ×3, III ×4)
  const scale = tech === 1 ? 1 : tech === 2 ? 3 : 4;
  const d = 0.1 / scale;
  const dishTop = TOP + DISH_H;
  const segs = tech === 3 ? 8 : 10;
  const hull: Shape[] = [
    ...cushion({ size: 1.96, height: CUSHION_H, inset: 0.14 }),
    // flache Goldschale unter den Laternen (Flow-Kennung, hebt sich von der Einlage ab)
    ellipsoid({ radii: [DISH_R + (tech - 1) * 0.12, DISH_H, DISH_R], half: true, segments: segs, rings: 2, at: [0, TOP + DISH_H / 2, 0], mat: 'gold', keep: true, tag: 'shell' }),
    // Tech-Streifen (Tiefjade) auf der Einlage hinten
    stripes({ count: tech, width: 0.5, stripe: d, gap: d, at: [0, TOP + 0.004, -0.7], mat: 'jade' }),
  ];
  for (const l of LANTERNS[tech]) hull.push(...lantern(l, dishTop + FLOAT / SCALE_Y[tech], segs, tech < 3)); // III: Kragen entfallen (Budget)
  return [{ name: 'hull', smooth: true, shapes: hull }];
}

export default defineModel({
  id: 'f3:str_t1_pgen',
  parts: pgenParts(1),
  notes: 'Grundform v_pgen; Laternen = Goldkern (flow-exklusiv), keine Animation.',
});
