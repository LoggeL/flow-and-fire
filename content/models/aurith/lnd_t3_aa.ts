/**
 * Zimbel (f4:lnd_t3_aa) – Aurith-Entladungsgleiter T3, Hybrid Flugabwehr + Direktfeuer (faction.md §5.3).
 *
 * Roster: „Bordun ×1,7 mit 3 dicken Pfeifen und kurzer Gabel davor (Sekundärmerkmal, Pfeifen ≥ 1,5 × Gabellänge),
 * 3 Tonpunkte; kein zweiter Kamm (Superset-Limit).“
 * Hybrid-Regel: Pfeifen (primär, 0,92 WU) und kurze Gabel (sekundär, 0,42 WU) tragen je ihre Bedeutung; die Gabel
 * sitzt tief vor dem Prospekt und dreht mit der Pfeifenplatte. T3-Merkmale: dicke Pfeifen (Ø 0,18 WU Basis), längerer
 * Kiel, 3 Tonpunkte. Maßstab 1,7 eingebacken (2×2-Footprint). Paartest Zimbel↔Bordun: dicke Pfeifen mit Gabel davor.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull  – Kiel 1,4 WU, Oberschale (Team), Rückenkamm, Glyphenbänder, 3 Tonpunkte
 *   plate – Drehfuß, Pfeifenplatte (Team) mit drei dicken Pfeifen, kurze Gabel davor; dreht um +Y (PartStream 1)
 */
import { defineModel, GLIDE_HEIGHT, lens, type Vec2, type Vec3 } from '@faf/modelkit';
import { organ } from './lnd_t1_aa.ts';
import { crest, forkTines, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.4, width: 0.84, height: 0.3, drop: 0.45, cap: { rx: 0.62, rz: 0.64, dz: -0.14 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP, 0.04];
const BASE = TOP - 0.02;

const PLATE: Vec2[] = [
  [-0.4, BASE],
  [0.4, BASE],
  [0.4, BASE + 0.28],
  [0.22, BASE + 0.4],
  [0, BASE + 0.44],
  [-0.22, BASE + 0.4],
  [-0.4, BASE + 0.28],
];

const CREST: Vec2[] = [
  [-0.18, 0.4],
  [-0.38, 0.62],
  [-0.6, 0.78],
  [-0.82, 0.76],
  [-0.94, 0.58],
  [-0.8, 0.52],
  [-0.64, 0.3],
  [-0.36, 0.32],
];

export default defineModel({
  id: 'f4:lnd_t3_aa',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST), ...shellGlyphs(K.shape, { th0: -64, th1: 44 }), ...toneDots(3, { from: [-0.5, 0.62], dir: [-1, 0.15] })],
    },
    {
      name: 'plate',
      pivot: PIVOT,
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.28, thickness: 0.13, segments: 8, rings: 2, at: PIVOT, mat: 'pitch', smooth: true, tag: 'lens' }),
        ...organ({
          base: BASE,
          z: PIVOT[2] + 0.02,
          plateZ: PIVOT[2] - 0.16,
          plate: PLATE,
          pipes: [
            { x: 0, top: BASE + 0.92, r: 0.09 },
            { x: 0.23, top: BASE + 0.7, r: 0.09 },
            { x: -0.23, top: BASE + 0.7, r: 0.09 },
          ],
        }),
        // kurze Gabel (sekundär) tief vor dem Prospekt: Zinken 0,42 WU
        ...forkTines({ y: BASE + 0.1, z0: PIVOT[2] + 0.12, len: 0.42, gap: 0.24, r: 0.06, bridge: 0.1, bridgeMaxLod: 1 }),
      ],
    },
  ],
  notes: 'v_aa Stufe 3: Hybrid Pfeifen + kurze Gabel; Pfeifenplatte-Yaw als einziger animierter Part.',
});
