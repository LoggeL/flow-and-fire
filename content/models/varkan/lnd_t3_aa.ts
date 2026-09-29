/**
 * Trommelsieb (core:lnd_t3_aa) – Varkan-Schwere Flugabwehr T3.
 *
 * Roster: „Sieb ×1,4 (1×1-Deckel) mit 4 senkrechten Rohren, 3 Tech-Streifen.“ Grundform = Sieb (Punze-Wanne, flacher
 * Rost quer, Kamm senkrechter Rohre); T3-Merkmale: 4 Rohre als breiter Kamm (1,04 WU), liegende Kupfer-Trommel
 * (Magazin, Namensgeber) hinter dem Kamm, 3 Tech-Streifen, Maßstab 1,4 (eingebacken, 1×1-Deckel). Kein Heckschlot.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten, Deck mit Bugfase, Deckplatte (team), Heckkrümmer an der Heckfase + Glutschlitze, 3 Tech-Streifen
 *   turret – Drehkranz + Rostplatte (team) + 4 senkrechte Rohre + Trommelmagazin, dreht um +Y (PartStream 1)
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
const GRATE_Z = 0.1;
const BARREL_Z = GRATE_Z + 0.06;
const GRATE_TOP = 0.64;
const BARREL_TOP = 1.38;

/** Senkrechtes Flakrohr bei x (Verschluss = gemeinsame Kupferleiste): Rohr Ø 0,17, Mündungsring + Mündungsglut. */
function flakBarrel(x: number): Shape[] {
  return [
    cylinder({ radius: 0.085, height: BARREL_TOP - GRATE_TOP - 0.06, at: [x, (BARREL_TOP + GRATE_TOP) / 2 - 0.03, BARREL_Z], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.1, height: 0.1, at: [x, BARREL_TOP - 0.05, BARREL_Z], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' }),
    quad({ size: [0.1, 0.1], at: [x, BARREL_TOP + 0.004, BARREL_Z], mat: 'glow', maxLod: 0 }),
  ];
}

export default defineModel({
  id: 'core:lnd_t3_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 1.16], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [1.04, DECK_TOP - 0.24, 1.32],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.94, PLATE_TOP - DECK_TOP, 1.14], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.04], mat: 'team' }),
        box({ size: [0.9, 0.08, 0.08], at: [0, 0.36, -0.64], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        mirrorX(quad({ size: [0.22, 0.04], at: [0.18, 0.404, -0.64], mat: 'glow', maxLod: 1 })),
        stripes({ count: 3, width: 0.72, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.4] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, PLATE_TOP, GRATE_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.28, height: 0.1, at: [0, PLATE_TOP + 0.05, GRATE_Z], segments: 8, caps: false, mat: 'dark', maxLod: 0, tag: 'grate' }),
        beveledBox({ size: [1.04, 0.09, 0.46], at: [0, GRATE_TOP - 0.045, GRATE_Z], bevel: { top: 0.025 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.86, 0.05], at: [0, GRATE_TOP + 0.004, GRATE_Z + 0.17], mat: 'dark', maxLod: 0 }),
        // Trommelmagazin (Kupfer, liegend quer) hinter dem Rohrkamm
        cylinder({ radius: 0.1, height: 0.84, axis: 'x', at: [0, GRATE_TOP + 0.1, GRATE_Z - 0.13], segments: 8, mat: 'copper', tag: 'boiler' }),
        // Kupfer-Verschlussleiste unter dem Rohrkamm
        box({ size: [0.98, 0.1, 0.2], at: [0, GRATE_TOP + 0.05, BARREL_Z], mat: 'copper', maxLod: 1, tag: 'barrel' }),
        ...flakBarrel(-0.39),
        ...flakBarrel(-0.13),
        ...flakBarrel(0.13),
        ...flakBarrel(0.39),
      ],
    },
  ],
  notes: 'Rohre am Rost-Part (roster: grate yaw, barrels fest, senkrecht = 90°). Trommel = Magazin, kein Schlot.',
});
