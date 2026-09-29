/**
 * Schrein (f3:str_t1_estore) – Sael-Energiespeicher auf 2×2.
 *
 * Roster: „Zwei liegende Laternen in flacher Schale (Höhe ≤ 0,3 × Kante); keine stehende Laterne, kein Ring.“
 * faction.md §5.2 Storage: Energy = Schrein, zwei liegende Laternen in flacher Schale, flach; `lantern` ist
 * flow-exklusiv (Goldkern). Pflichtpaare: Laterne↔Schrein (stehend gegen liegend), Zisterne↔Schrein (Becken gegen
 * Leuchtlinsen).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 2×2 (Emaille-Rand, Perlmutt-Einlage), flache Goldschale, zwei liegende Laternen quer
 *          (Glaslinse mit Goldkern-Kern, der oben durch das Glas tritt), goldene Endknäufe, Tech-Streifen
 *          (Tiefjade) hinten; Höhe ≤ 0,6 WU; keine beweglichen Teile.
 */
import { defineModel, ellipsoid, lens, sphere, stripes, type Shape } from '@faf/modelkit';
import { cushion } from './str_t1_mex.ts';

const CUSHION_H = 0.16;
const TOP = CUSHION_H + 0.006;
const DISH_H = 0.1;
const LANTERN_Y = TOP + DISH_H + 0.06; // Linsenmitte, liegt in der Schale

const hull: Shape[] = [
  ...cushion({ size: 1.96, height: CUSHION_H, inset: 0.14 }),
  // flache Goldschale (Flow-Kennung, hebt sich von der Perlmutt-Einlage ab)
  ellipsoid({ radii: [0.8, DISH_H, 0.72], half: true, segments: 12, rings: 2, at: [0, TOP + DISH_H / 2, 0], mat: 'gold', keep: true, tag: 'shell' }),
  // Tech-Streifen hinten auf der Einlage
  stripes({ count: 1, width: 0.5, at: [0, TOP + 0.004, -0.84], mat: 'jade' }),
];
for (const z of [0.25, -0.25]) {
  hull.push(
    // liegende Laterne: Linse quer (lang in x), flach liegend
    lens({ radius: 0.2, thickness: 0.2, length: 1.1, segments: 8, rings: 3, axis: 'x', rot: [0, 90, 0], at: [0, LANTERN_Y, z], smooth: 179, mat: 'glass', keep: true, tag: 'lantern' }),
    // Goldkern: flacher Kern, tritt oben aus dem Glas
    lens({ radius: 0.1, thickness: 0.26, length: 0.56, segments: 6, rings: 3, axis: 'x', rot: [0, 90, 0], at: [0, LANTERN_Y + 0.02, z], smooth: 179, mat: 'light', keep: true, tag: 'lantern' }),
  );
  for (const x of [0.5, -0.5]) hull.push(sphere({ radius: 0.07, segments: 6, rings: 3, at: [x, LANTERN_Y, z], mat: 'gold', maxLod: 1, tag: 'lantern' }));
}

export default defineModel({
  id: 'f3:str_t1_estore',
  parts: [{ name: 'hull', smooth: true, shapes: hull }],
  notes: 'v_estore: zwei liegende Laternen in flacher Schale, statisch.',
});
