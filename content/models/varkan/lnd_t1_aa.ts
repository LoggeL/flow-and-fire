/**
 * Sieb (core:lnd_t1_aa) – Varkan-Mobile Flugabwehr T1.
 *
 * Roster: „Wanne mit Rost-Platte, darauf 2 dünne senkrechte Rohre (≥ 75°) als Kamm quer zur Fahrtrichtung.“
 * Rollen-Monopol Flugabwehr (faction.md §5.2): 2–4 dünne senkrechte Rohre als Kamm quer zur Fahrtrichtung auf einer
 * `grate`-Platte; Rohr-Ø 0,17 WU (Mindestmaß, höchstens halb so dick wie Kelle/Raketenkasten); keine Glocke, keine
 * Kelle. Paartest Punze↔Sieb: gleiche Wanne, aber flacher Rost + senkrechte Rohre statt Kuppel + waagerechtem Rohr.
 * Grundform der Sieb-Familie (Rüttelsieb T2 mit 3, Trommelsieb T3 mit 4 Rohren).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Punze-Wanne (Ketten, Deck mit Bugfase, Deckplatte team, Kupferleitungen, Heckkrümmer), 1 Tech-Streifen
 *   turret – Drehkranz + Rostplatte (team, dunkle Schlitze) + 2 senkrechte Rohre mit Kupfer-Verschluss und
 *            Mündungsring, dreht um +Y (PartStream 1; Rohre fest, roster: kein Pitch)
 */
import { beveledBox, box, cylinder, defineModel, extrude, mirrorX, quad, stripes } from '@faf/modelkit';

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
const GRATE_Z = 0.02;
const GRATE_TOP = 0.64;
const BARREL_X = 0.2;
const BARREL_TOP = 1.34;

export default defineModel({
  id: 'core:lnd_t1_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 1.16], at: [0, 0.15, 0], mat: 'dark', maxLod: 1, tag: 'hull' }),
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.32],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.07 },
          mat: 'body',
          tag: 'hull',
        }),
        beveledBox({ size: [0.8, PLATE_TOP - DECK_TOP, 0.9], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.02], bevel: { top: 0.012 }, mat: 'team' }),
        beveledBox({ size: [0.96, 0.08, 0.14], at: [0, DECK_TOP + 0.04, -0.52], bevel: { top: 0.02 }, mat: 'copper', maxLod: 1, tag: 'manifold' }),
        mirrorX(cylinder({ radius: 0.085, height: 0.84, axis: 'z', at: [0.45, DECK_TOP + 0.01, -0.03], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' })),
        mirrorX(quad({ size: [0.2, 0.04], at: [0.16, DECK_TOP + 0.084, -0.52], mat: 'glow', maxLod: 1 })),
        stripes({ count: 1, width: 0.7, at: [0, PLATE_TOP + 0.004, -0.34] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, PLATE_TOP, GRATE_Z],
      anim: 'yaw',
      shapes: [
        // Drehkranz
        cylinder({ radius: 0.24, height: 0.1, at: [0, PLATE_TOP + 0.05, GRATE_Z], segments: 8, caps: false, mat: 'dark', maxLod: 1, tag: 'grate' }),
        // Rostplatte quer zur Fahrtrichtung (team) mit dunklen Schlitzen
        beveledBox({ size: [0.78, 0.09, 0.42], at: [0, GRATE_TOP - 0.045, GRATE_Z], bevel: { top: 0.025 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.6, 0.05], at: [0, GRATE_TOP + 0.004, GRATE_Z + 0.12], mat: 'dark', maxLod: 1 }),
        quad({ size: [0.6, 0.05], at: [0, GRATE_TOP + 0.004, GRATE_Z - 0.12], mat: 'dark', maxLod: 1 }),
        // 2 senkrechte Rohre (Kamm quer): Kupfer-Verschluss, Rohr Ø 0,17, Mündungsring + Mündungsglut
        mirrorX([
          cylinder({ radius: 0.12, height: 0.12, at: [BARREL_X, GRATE_TOP + 0.06, GRATE_Z], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' }),
          cylinder({ radius: 0.085, height: BARREL_TOP - GRATE_TOP - 0.06, at: [BARREL_X, (BARREL_TOP + GRATE_TOP) / 2 - 0.03, GRATE_Z], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
          cylinder({ radius: 0.1, height: 0.1, at: [BARREL_X, BARREL_TOP - 0.05, GRATE_Z], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' }),
          quad({ size: [0.1, 0.1], at: [BARREL_X, BARREL_TOP + 0.004, GRATE_Z], mat: 'glow', maxLod: 0 }),
        ]),
      ],
    },
  ],
  notes: 'Rohre am Rost-Part (roster: grate yaw, barrels fest, senkrecht = 90°).',
});
