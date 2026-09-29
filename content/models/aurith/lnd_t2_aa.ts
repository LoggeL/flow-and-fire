/**
 * Bordun (f4:lnd_t2_aa) – Aurith-Flak T2.
 *
 * Roster: „Pfeife ×1,3 mit 3 gestuften senkrechten Pfeifen, 2 Tonpunkte.“
 * Tech-Skalierung (faction.md §3.4): zweite Pfeifenreihe statt neuer Form – drei senkrechte Pfeifen (Mitte am
 * längsten, Orgelprospekt), Pfeifen-Ø 0,15 WU × 1,3 = 0,2 WU (≤ halbe Spindel der Posaune, 0,49 WU), 2 Tonpunkte.
 * Maßstab 1,3 eingebacken. Paartest Zimbel↔Bordun: drei dicke Pfeifen mit kurzer Gabel davor gegen drei schlanke.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull  – Kiel, Oberschale (Team), Rückenkamm, Glyphenbänder, 2 Tonpunkte
 *   plate – Drehfuß, Pfeifenplatte (Team) mit drei Pfeifen, dreht um +Y (PartStream 1)
 */
import { defineModel, GLIDE_HEIGHT, lens, type Vec2, type Vec3 } from '@faf/modelkit';
import { organ } from './lnd_t1_aa.ts';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.04, width: 0.74, height: 0.28, drop: 0.4, cap: { rx: 0.62, rz: 0.62, dz: -0.12 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP, 0.1];
const BASE = TOP - 0.02;

/** Pfeifenplatte (Vorderansicht x/y), symmetrisch gewölbt, nur halbe Pfeifenhöhe (Pfeifen stehen frei). */
const PLATE: Vec2[] = [
  [-0.34, BASE],
  [0.34, BASE],
  [0.34, BASE + 0.26],
  [0.18, BASE + 0.36],
  [0, BASE + 0.4],
  [-0.18, BASE + 0.36],
  [-0.34, BASE + 0.26],
];

const CREST: Vec2[] = [
  [-0.12, 0.38],
  [-0.28, 0.6],
  [-0.46, 0.74],
  [-0.62, 0.68],
  [-0.66, 0.52],
  [-0.54, 0.46],
  [-0.44, 0.28],
  [-0.26, 0.3],
];

export default defineModel({
  id: 'f4:lnd_t2_aa',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST), ...shellGlyphs(K.shape, { th1: 44 }), ...toneDots(2, { from: [-0.38, 0.6], dir: [-1, 0.2] })],
    },
    {
      name: 'plate',
      pivot: PIVOT,
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.22, thickness: 0.12, segments: 8, rings: 2, at: PIVOT, mat: 'pitch', smooth: true, tag: 'lens' }),
        ...organ({
          base: BASE,
          z: PIVOT[2] + 0.09,
          plateZ: PIVOT[2] - 0.06,
          plate: PLATE,
          pipes: [
            { x: 0, top: BASE + 0.8, r: 0.075 },
            { x: 0.19, top: BASE + 0.6, r: 0.075 },
            { x: -0.19, top: BASE + 0.6, r: 0.075 },
          ],
        }),
      ],
    },
  ],
  notes: 'v_aa Stufe 2: drei Pfeifen; Pfeifenplatte-Yaw als einziger animierter Part.',
});
