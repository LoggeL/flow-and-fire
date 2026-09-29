/**
 * Rüttelsieb (core:lnd_t2_aa) – Varkan-Flak T2.
 *
 * Roster: „Sieb ×1,3 mit 3 senkrechten Rohren (≥ 75°) und Schürzenplatte, 2 Tech-Streifen.“ Grundform = Sieb
 * (Punze-Wanne, flacher Rost quer, Kamm senkrechter Rohre); T2-Merkmale: drittes Rohr (Kamm 0,78 WU breit),
 * seitliche Schürzenplatten, 2 Tech-Streifen, Maßstab 1,3 (eingebacken). Rohr-Ø 0,17 × 1,3 = 0,22 WU – höchstens
 * halb so breit wie der Raketenkasten der Rinne (0,52 WU), Paartest Rinne↔Rüttelsieb.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten, Deck mit Bugfase, Deckplatte (team), Schürzenplatten, Heckkrümmer an der Heckfase + Glutschlitze,
 *            2 Tech-Streifen
 *   turret – Drehkranz + Rostplatte (team, dunkle Schlitze) + 3 senkrechte Rohre, dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, extrude, mirrorX, quad, stripes, type Shape } from '@faf/modelkit';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.56, 0],
  [0.54, 0],
  [0.66, 0.12],
  [0.6, 0.24],
  [-0.6, 0.24],
  [-0.66, 0.12],
];

const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const GRATE_Z = 0.06;
const GRATE_TOP = 0.64;
const BARREL_TOP = 1.34;

/** Senkrechtes Flakrohr bei x: Kupfer-Verschluss, Rohr Ø 0,17, Mündungsring + Mündungsglut. */
function flakBarrel(x: number): Shape[] {
  return [
    cylinder({ radius: 0.12, height: 0.12, at: [x, GRATE_TOP + 0.06, GRATE_Z], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' }),
    cylinder({ radius: 0.085, height: BARREL_TOP - GRATE_TOP - 0.06, at: [x, (BARREL_TOP + GRATE_TOP) / 2 - 0.03, GRATE_Z], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.1, height: 0.1, at: [x, BARREL_TOP - 0.05, GRATE_Z], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' }),
    quad({ size: [0.1, 0.1], at: [x, BARREL_TOP + 0.004, GRATE_Z], mat: 'glow', maxLod: 0 }),
  ];
}

export default defineModel({
  id: 'core:lnd_t2_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 1.16], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.32],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.8, PLATE_TOP - DECK_TOP, 1.06], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.05], mat: 'team' }),
        // Schürzenplatten (T2-Merkmal)
        mirrorX(extrude({ profile: [[-0.50, 0.2], [0.48, 0.2], [0.56, 0.3], [0.52, 0.4], [-0.54, 0.4], [-0.56, 0.34]], depth: 0.06, axis: 'x', at: [0.53, 0, 0], mat: 'body', maxLod: 1, tag: 'hull' })),
        // Heckkrümmer an der Heckfase + Glutschlitze
        box({ size: [0.9, 0.08, 0.08], at: [0, 0.36, -0.64], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        mirrorX(quad({ size: [0.22, 0.04], at: [0.18, 0.404, -0.64], mat: 'glow', maxLod: 1 })),
        stripes({ count: 2, width: 0.7, at: [0, PLATE_TOP + 0.004, -0.42] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, PLATE_TOP, GRATE_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.26, height: 0.1, at: [0, PLATE_TOP + 0.05, GRATE_Z], segments: 8, caps: false, mat: 'dark', maxLod: 0, tag: 'grate' }),
        beveledBox({ size: [0.9, 0.09, 0.42], at: [0, GRATE_TOP - 0.045, GRATE_Z], bevel: { top: 0.025 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.72, 0.05], at: [0, GRATE_TOP + 0.004, GRATE_Z + 0.12], mat: 'dark', maxLod: 1 }),
        quad({ size: [0.72, 0.05], at: [0, GRATE_TOP + 0.004, GRATE_Z - 0.12], mat: 'dark', maxLod: 1 }),
        ...flakBarrel(-0.27),
        ...flakBarrel(0),
        ...flakBarrel(0.27),
      ],
    },
  ],
  notes: 'Rohre am Rost-Part (roster: grate yaw, barrels fest, senkrecht = 90°).',
});
