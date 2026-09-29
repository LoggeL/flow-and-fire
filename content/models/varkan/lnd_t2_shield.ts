/**
 * Schürze (core:lnd_t2_shield) – Varkan-Mobiler Schild T2.
 *
 * Roster: „Wanne mit Mast, waagerechter Ring (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt; kein Rohr, keine Glocke.“
 * Rollen-Monopol Mobiler Schild (faction.md §5.2, Winkel-Code: Ring = Flow-Anschluss oder Schild). Ring Ø außen
 * 1,40 WU bei 1,0 WU Rumpfbreite (1,4×). Paartest Funke↔Schürze: Funke = dünner Mast ohne Kopf, Schürze = Mast mit
 * breitem Ring. T2-Merkmale: seitliche Schürzenplatten (Namensgeber), 2 Tech-Streifen, Maßstab 1,3 (eingebacken).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull – Ketten, Deck mit Bugfase, Deckplatte (team), Schürzenplatten, Heckkrümmer + Glutschlitze, Gusskragen +
 *          Mast (Ø 0,17), 2 Tech-Streifen
 *   ring – waagerechter Schildring (team) mit Kupfer-Nabe und zwei Speichen, dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, stripes, torus } from '@faf/modelkit';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.54, 0],
  [0.52, 0],
  [0.64, 0.12],
  [0.58, 0.24],
  [-0.58, 0.24],
  [-0.64, 0.12],
];

const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const MAST_Z = 0.02;
const RING_Y = 1.26;

export default defineModel({
  id: 'core:lnd_t2_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 1.12], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.28],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.8, PLATE_TOP - DECK_TOP, 1.04], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.05], mat: 'team' }),
        // Schürzenplatten (T2-Merkmal, Namensgeber)
        mirrorX(extrude({ profile: [[-0.48, 0.2], [0.44, 0.2], [0.54, 0.4], [-0.54, 0.4]], depth: 0.06, axis: 'x', at: [0.53, 0, 0], mat: 'body', maxLod: 1, tag: 'hull' })),
        box({ size: [0.9, 0.08, 0.08], at: [0, 0.36, -0.62], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        mirrorX(quad({ size: [0.22, 0.04], at: [0.18, 0.404, -0.62], mat: 'glow', maxLod: 1 })),
        // Gusskragen + Mast (Ø 0,17)
        frustum({ radius: 0.2, radiusTop: 0.13, height: 0.14, at: [0, PLATE_TOP + 0.07, MAST_Z], segments: 8, caps: 'top', mat: 'body', maxLod: 0, tag: 'mast' }),
        cylinder({ radius: 0.085, height: RING_Y - PLATE_TOP - 0.05, at: [0, (RING_Y + PLATE_TOP) / 2 - 0.025, MAST_Z], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'mast' }),
        stripes({ count: 2, width: 0.66, at: [0, PLATE_TOP + 0.004, -0.4] }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, MAST_Z],
      anim: 'yaw',
      shapes: [
        // Schildring Ø 1,40 WU (außen), höchster Punkt
        torus({ radius: 0.62, tube: 0.08, segments: 12, sides: 4, at: [0, RING_Y, MAST_Z], mat: 'team', keep: true, tag: 'ring' }),
        // Zwei Speichen (0,12 WU) über Kreuz + Kupfer-Nabe mit Glutauge (Emitter)
        box({ size: [1.2, 0.06, 0.12], at: [0, RING_Y, MAST_Z], rot: [0, 45, 0], mat: 'body', tag: 'ring' }),
        box({ size: [1.2, 0.06, 0.12], at: [0, RING_Y, MAST_Z], rot: [0, -45, 0], mat: 'body', tag: 'ring' }),
        cylinder({ radius: 0.15, height: 0.12, at: [0, RING_Y, MAST_Z], segments: 8, mat: 'copper', maxLod: 1, tag: 'ring' }),
        quad({ size: [0.12, 0.12], at: [0, RING_Y + 0.064, MAST_Z], rot: [0, 45, 0], mat: 'glow', maxLod: 1 }),
      ],
    },
  ],
  notes: 'Kein Rohr, keine Glocke (Monopol-Regel). Ring als Team-Part; Glutauge der Nabe = kleine Glutnaht (≤ 2 %).',
});
