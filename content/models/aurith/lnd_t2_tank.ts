/**
 * Heuler (f4:lnd_t2_tank) – Aurith-Stoßgleiter T2.
 *
 * Roster: „Triller ×1,3, längere Gabelzinken mit Linse (Ladekammer) dazwischen, Kamm +30 %, 2 Tonpunkte.“
 * Tech-Skalierung (faction.md §3.4): dieselbe Gleiterform wie der Triller, T2-Merkmale = Ladekammer zwischen den
 * Zinken (Bernstein-Tiefe, hier sammeln sich vor dem schweren Schuss die Glyphen), relativ längere Zinken
 * (0,76 WU = 73 % der Kiellänge), höherer Kamm, 2 Tonpunkte. Maßstab 1,3 wird eingebacken; der Basiskiel ist mit
 * 1,04 WU kürzer als der des Trillers, damit Zinken und Kamm im 1×1-Footprint-Check bleiben (1,53 × 1,3 = 1,99 WU).
 * Paartest Heuler↔Brüller: Gleiter mit schmaler Gabel gegen Dreibein mit breiter Gabel.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – Kiel, Oberschale (Team), hoher Rückenkamm, Glyphenbänder, 2 Tonpunkte
 *   fork – Drehfuß, Gabel mit Ladekammer, dreht um +Y (PartStream 1)
 */
import { defineModel, GLIDE_HEIGHT, lens, type Vec2 } from '@faf/modelkit';
import { crest, forkTines, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.04, width: 0.72, height: 0.28, drop: 0.45, cap: { rx: 0.72, rz: 0.72, dz: -0.1 } });
const TURRET_Z = 0.16;
const TOP = K.shape.capTop;
const FORK_Y = TOP + 0.06;

/** Hoher Rückenkamm (+30 % gegenüber dem Triller), Schweif endet bei z = −0,63. */
const CREST: Vec2[] = [
  [-0.02, 0.36],
  [-0.14, 0.58],
  [-0.3, 0.8],
  [-0.46, 0.93],
  [-0.58, 0.9],
  [-0.62, 0.72],
  [-0.55, 0.6],
  [-0.48, 0.4],
  [-0.36, 0.24],
  [-0.14, 0.3],
];

export default defineModel({
  id: 'f4:lnd_t2_tank',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST, { depth: 0.2 }), ...shellGlyphs(K.shape), ...toneDots(2, { from: [-0.26, 0.66], dir: [-1, 0.45], depth: 0.2 })],
    },
    {
      name: 'fork',
      pivot: [0, TOP, TURRET_Z],
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.2, thickness: 0.13, segments: 8, rings: 2, at: [0, TOP, TURRET_Z], mat: 'pitch', smooth: true, tag: 'lens' }),
        // Gabel: Zinken 0,76 WU, weiter gespreizt als beim Triller, ragen 0,36 WU über die Kielspitze
        ...forkTines({ y: FORK_Y, z0: 0.12, len: 0.76, gap: 0.34 }),
        // Ladekammer: gestreckte Linse zwischen den Zinken (Bernstein-Tiefe)
        lens({ radius: 0.085, thickness: 0.42, length: 0.17, axis: 'z', segments: 6, rings: 2, at: [0, FORK_Y, 0.46], mat: 'amberdeep', smooth: true, keep: true, tag: 'lens' }),
      ],
    },
  ],
  notes: 'v_tank Stufe 2: Ladekammer zwischen den Zinken, Gabel-Yaw als einziger animierter Part.',
});
