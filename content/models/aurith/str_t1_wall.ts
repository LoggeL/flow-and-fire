/**
 * Grat (f4:str_t1_wall) – Mauerstück 1×1 (Drag-Linie).
 *
 * Roster: „Niedrige Kette flacher Kämme, nur die Firstkante teamfarben (≈ 10 %).“ Jedes Stück ist ein flacher,
 * geschwungener Kamm quer zur Z-Achse (Querschnitt mit hohl geschwungenen Flanken), der die Footprint-Kante in X voll
 * füllt: in X gereiht wird er zu einem durchgehenden Grat, in Z gereiht zu einer Kette paralleler Kämme.
 * Pechglas-Fuß, Bernstein-Flanken (weich), schmale Teamfarben-Firstkante; keine Tonpunkte (faction.md §3.4),
 * keine Glyphen, kein Kristall (bewusst ruhig). Budget-Klasse wall: 64 / 40 / 24 Tris.
 *
 * Aufbau (y = Boden, +Z = vorn): nur `hull` (statisch).
 *   LOD0: Fuß (Pechglas) + Flanken (Bernstein) + Firstkante (Team)
 *   LOD1: Flanken bis zum Boden + Firstkante; LOD2: vierseitiger Querschnitt + Firstkante
 */
import { defineModel, extrude, type Vec2 } from '@faf/modelkit';

const W = 1.0; // Länge in X = Footprint-Kante (lückenlose Ketten)

/** Fuß (Seitenprofil z/y). */
const FOOT: Vec2[] = [
  [-0.45, 0],
  [0.45, 0],
  [0.41, 0.13],
  [-0.41, 0.13],
];
/** Flanken: hohl geschwungen (konkav) zu einem schmalen First – liest sich als Kamm, nicht als Block. */
const RIDGE: Vec2[] = [
  [-0.41, 0.12],
  [0.41, 0.12],
  [0.26, 0.19],
  [0.14, 0.29],
  [0.07, 0.4],
  [0.045, 0.48],
  [-0.045, 0.48],
  [-0.07, 0.4],
  [-0.14, 0.29],
  [-0.26, 0.19],
];
/** LOD1: Flanken bis zum Boden. */
const BODY1: Vec2[] = [
  [-0.45, 0],
  [0.45, 0],
  [0.18, 0.23],
  [0.06, 0.47],
  [-0.06, 0.47],
  [-0.18, 0.23],
];
/** LOD2: vierseitig. */
const BODY2: Vec2[] = [
  [-0.45, 0],
  [0.45, 0],
  [0.05, 0.47],
  [-0.05, 0.47],
];
/** Firstkante (Team), ≈ 10 % der Draufsicht. */
const CREST: Vec2[] = [
  [-0.055, 0.465],
  [0.055, 0.465],
  [0.035, 0.53],
  [-0.035, 0.53],
];

export default defineModel({
  id: 'f4:str_t1_wall',
  parts: [
    {
      name: 'hull',
      shapes: [
        extrude({ profile: FOOT, depth: W, mat: 'pitch', keep: true, maxLod: 0, tag: 'fin' }),
        extrude({ profile: RIDGE, depth: W, mat: 'amber', keep: true, smooth: 50, maxLod: 0, tag: 'fin' }),
        extrude({ profile: BODY1, depth: W, mat: 'amber', keep: true, smooth: 50, minLod: 1, maxLod: 1, tag: 'fin' }),
        extrude({ profile: BODY2, depth: W, mat: 'amber', keep: true, minLod: 2, tag: 'fin' }),
        extrude({ profile: CREST, depth: W, mat: 'team', keep: true, tag: 'fin' }),
      ],
    },
  ],
  notes: 'v_wall: Kamm-Querschnitt über die volle Kante; Firstkante als einziges Teamfarben-Element.',
});
