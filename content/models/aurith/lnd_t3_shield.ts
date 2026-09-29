/**
 * Stille (f4:lnd_t3_shield) – Aurith-Großschild T3.
 *
 * Roster: „Überlanger Kiel mit Mast, waagerechter Reif (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt, Doppelkamm,
 * 3 Tonpunkte; keine Gabel, kein Trichter.“
 * faction.md §5.2 Mobiler Schild: Mast mit waagerechtem Reif als höchstem Punkt; Winkel-Code: Mast + waagerechter
 * Reif = Schild. Reif Ø 1,12 WU = 1,4 × Rumpfbreite (0,8 WU), Teamfarbe (Roster `ring:team`), an drei Speichen.
 * Paartest Pfiff↔Stille: Mast mit großem Reif auf langem Kiel gegen dünnen Mast mit Kopf-Linse und Gabel.
 * Maßstab 1,7 eingebacken (2×2-Footprint).
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – überlanger Kiel, Oberschale (Team), Doppelkamm, Mast (Pechglas), Glyphenbänder, 3 Tonpunkte
 *   ring – Nabe, drei Speichen und waagerechter Reif (Team), dreht um +Y (PartStream 1)
 */
import { cylinder, defineModel, GLIDE_HEIGHT, lens, radial, strut, torus, type Vec2 } from '@faf/modelkit';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.5, width: 0.8, height: 0.3, drop: 0.45, cap: { rx: 0.62, rz: 0.66, dz: -0.08 } });
const TOP = K.shape.capTop;
const MAST_Z = 0.06;
const RING_Y = 1.34;
const RING_R = 0.5;

/** Doppelkamm, niedriger als der Reif. */
const CREST: Vec2[] = [
  [-0.14, 0.38],
  [-0.36, 0.6],
  [-0.64, 0.8],
  [-0.9, 0.8],
  [-1.04, 0.62],
  [-0.9, 0.54],
  [-0.7, 0.32],
  [-0.4, 0.3],
];
const CREST_X = 0.13;

export default defineModel({
  id: 'f4:lnd_t3_shield',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...crest(CREST, { depth: 0.12, x: CREST_X }),
        ...crest(CREST, { depth: 0.12, x: -CREST_X }),
        // Mast (Pechglas) mit Bernstein-Fuß
        cylinder({ radius: 0.065, height: RING_Y - TOP, segments: 6, caps: false, at: [0, (RING_Y + TOP) / 2, MAST_Z], mat: 'pitch', keep: true, tag: 'mast' }),
        lens({ radius: 0.16, thickness: 0.1, segments: 8, rings: 2, at: [0, TOP, MAST_Z], mat: 'amberedge', smooth: true, tag: 'mast' }),
        ...shellGlyphs(K.shape, { th0: -66, th1: 44 }),
        ...toneDots(3, { from: [-0.56, 0.64], dir: [-1, 0.1], depth: 0.12, x: CREST_X, flanks: [1] }),
        ...toneDots(3, { from: [-0.56, 0.64], dir: [-1, 0.1], depth: 0.12, x: -CREST_X, flanks: [-1] }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, MAST_Z],
      anim: 'yaw',
      shapes: [
        // waagerechter Reif (Team), höchster Punkt der Einheit
        torus({ radius: RING_R, tube: 0.065, segments: 12, sides: 3, at: [0, RING_Y, MAST_Z], mat: 'team', keep: true, tag: 'ring' }),
        // Nabe (Bernstein-Kante) und drei Speichen (Pechglas)
        lens({ radius: 0.12, thickness: 0.12, segments: 6, rings: 2, at: [0, RING_Y, MAST_Z], mat: 'amberedge', smooth: true, tag: 'ring' }),
        radial(strut({ from: [0.08, 0, 0], to: [RING_R - 0.04, 0, 0], radius: 0.035, sides: 3, caps: false }), { count: 3, startDeg: 90, at: [0, RING_Y, MAST_Z], mat: 'pitch', maxLod: 1, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_shield_mobile: Reif-Yaw als einziger animierter Part.',
});
