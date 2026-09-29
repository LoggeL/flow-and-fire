/**
 * Hecke (f2:str_t1_wall) – Mauerstück 1×1 (Drag-Linie).
 *
 * Roster: „Niedriger Krustenblock mit kurzen Dornen (≤ 0,3 × Blockhöhe, keine AA-Lesart), nur die Spitzen-Kappen
 * teamfarben (≈ 10 %).“ Quadratischer Krustenblock (füllt den Footprint, damit Ketten lückenlos stehen) mit gezackter
 * Oberkante und vier gedrungenen, schräg stehenden Stummeldornen, deren obere Hälfte teamfarben ist. Keine
 * Tech-Streifen (faction.md §3.4), keine Glut. Paartest Schlehe↔Hecke: flacher, breiter Block ohne Kamm gegen hohe
 * senkrechte Dornen.
 *
 * Budget-Klasse wall: 64 / 40 / 24 Tris. LOD1: Dornen dreikantig ohne Wurzel; LOD2: Block ohne Kantenmitten,
 * drei Dornen.
 */
import { defineModel, spike, strut, type Vec3 } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const H = 0.44;
const K = crust({ size: [1, 1], h: H, cut: 0, batter: 0.03, rim: 0, jag: 0.05, seed: 3 });
/** Stummeldornen: Wurzel [x, z], Neigung [dx, dz] (Länge ≤ 0,3 × Blockhöhe = 0,13). */
const THORNS: { at: [number, number]; lean: [number, number] }[] = [
  { at: [-0.3, 0.12], lean: [-0.09, 0.06] },
  { at: [-0.04, -0.16], lean: [0.03, -0.1] },
  { at: [0.2, 0.18], lean: [0.08, 0.06] },
  { at: [0.33, -0.24], lean: [0.07, -0.07] },
];
const Y0 = H - 0.03;

function thorn(t: (typeof THORNS)[number], lod: 'l0' | 'l1' | 'l2'): ReturnType<typeof spike>[] {
  const base: Vec3 = [t.at[0], Y0, t.at[1]];
  const mid: Vec3 = [t.at[0] + t.lean[0] * 0.3, Y0 + 0.045, t.at[1] + t.lean[1] * 0.3];
  const tip: Vec3 = [t.at[0] + t.lean[0], Y0 + 0.13, t.at[1] + t.lean[1]];
  if (lod === 'l0') {
    return [
      strut({ from: base, to: mid, radius: 0.16, radiusEnd: 0.13, sides: 3, caps: false, mat: 'chitin', maxLod: 0, keep: true, tag: 'spike' }),
      spike({ from: mid, to: tip, radius: 0.13, sides: 3, mat: 'team', maxLod: 0, keep: true, tag: 'spike' }),
    ];
  }
  return [spike({ from: base, to: tip, radius: 0.14, sides: 3, mat: 'team', minLod: lod === 'l1' ? 1 : 2, maxLod: lod === 'l1' ? 1 : 2, keep: true, tag: 'spike' })];
}

export default defineModel({
  id: 'f2:str_t1_wall',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...THORNS.flatMap((t) => thorn(t, 'l0')),
        ...THORNS.flatMap((t) => thorn(t, 'l1')),
        ...THORNS.slice(0, 3).flatMap((t) => thorn(t, 'l2')),
      ],
    },
  ],
});
