/**
 * Elster (core:air_t2_fbomber) – Varkan-Jagdbomber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Delta mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 % gegenüber Turmfalke; keine
 * Ringdüse.“ Parts hull, wing [team] (Delta), boiler (Gondel l/r), wing (Leitwerk); 2 Tech-Streifen.
 * Rollen-Monopol Jagdbomber (faction.md §5.2): Delta mit zwei Kessel-Gondeln an den Flügelspitzen; verboten:
 * Ringdüse, Bauch-Kessel. Gleiche Delta-Familie wie der Turmfalke (Rumpf, Pyramiden-Nase, 2 Glutdüsen,
 * Doppelleitwerk), lesbar verschieden durch die Gondeln, die breitere Fläche und den Maßstab 1,3.
 *
 * Maße (Basis vor Maßstab): Länge 1,26 WU, Spannweite 0,96 WU inkl. Gondeln → 1,64 × 1,25 WU im Spiel
 * (Turmfalke 0,80 WU ⇒ Spannweite +56 %).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull – Delta (Guss + Bannerplatte team), Rumpfrücken mit Pyramiden-Nase, Sichtschlitz, Rückenplatte (team),
 *          2 Kupfer-Glutdüsen, Doppelleitwerk, 2 Kessel-Gondeln (Bombenkessel mit Kupferband) an den Spitzen,
 *          2 Keramik-Tech-Streifen. Keine animierten Parts (Roster: animatedParts 0).
 */
import { beveledBox, box, cone, cylinder, defineModel, extrude, frustum, mirrorX, quad, stripes } from '@faf/modelkit';

/** Delta, Draufsicht [x, z]: breiter und weniger gepfeilt als der Turmfalke, gerade Spitzen für die Gondeln. */
const DELTA: readonly (readonly [number, number])[] = [
  [0, 0.52],
  [0.1, 0.36],
  [0.4, -0.12],
  [0.4, -0.46],
  [0.14, -0.46],
  [0.1, -0.4],
  [-0.1, -0.4],
  [-0.14, -0.46],
  [-0.4, -0.46],
  [-0.4, -0.12],
  [-0.1, 0.36],
];
const BANNER: readonly (readonly [number, number])[] = [
  [0, 0.49],
  [0.095, 0.345],
  [0.39, -0.12],
  [0.39, -0.45],
  [-0.39, -0.45],
  [-0.39, -0.12],
  [-0.095, 0.345],
];
/** Seitenleitwerk, Seitenansicht [z, y]. */
const FIN: readonly (readonly [number, number])[] = [
  [-0.46, 0],
  [-0.2, 0],
  [-0.38, 0.22],
  [-0.52, 0.22],
];

const WING_Y = 0.13;
const WING_T = 0.05;
const WING_TOP = WING_Y + WING_T / 2;
const BODY_Y = 0.16;
const NOZZLE_Y = 0.14;
const POD_X = 0.4;
const POD_Y = 0.13;
const POD_R = 0.095;

export default defineModel({
  id: 'core:air_t2_fbomber',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Delta: Gussplatte + Bannerplatte (team); ab LOD1 nur noch eine teamfarbene Platte (Gussrand ab 60 WU unsichtbar)
        extrude({ profile: DELTA, depth: WING_T, axis: 'y', at: [0, WING_Y, 0], mat: 'body', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: BANNER, depth: 0.02, axis: 'y', at: [0, WING_TOP + 0.01, 0], mat: 'team', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: DELTA, depth: WING_T, axis: 'y', at: [0, WING_Y + 0.01, 0], mat: 'team', minLod: 1, tag: 'wing' }),
        // Rumpfrücken + Pyramiden-Nase (wie Turmfalke)
        beveledBox({
          size: [0.22, 0.17, 0.86],
          at: [0, BODY_Y, -0.08],
          bevel: { top: 0.05, bottom: 0.04, topFront: 0.06 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        cone({ radius: 0.14, height: 0.26, segments: 4, axis: 'z', at: [0, BODY_Y - 0.01, 0.48], mat: 'body', keep: true, tag: 'hull' }),
        quad({ size: [0.11, 0.1], rot: [30, 0, 0], at: [0, BODY_Y + 0.094, 0.24], mat: 'glass', maxLod: 0 }),
        box({ size: [0.13, 0.012, 0.4], at: [0, BODY_Y + 0.091, -0.025], mat: 'team', maxLod: 1 }),
        // 2 Glutdüsen (Kupfer) + Glutkern
        mirrorX([
          cylinder({ radius: 0.08, height: 0.34, segments: 6, axis: 'z', at: [0.1, NOZZLE_Y, -0.42], caps: false, mat: 'copper', keep: true, tag: 'manifold' }),
          cylinder({ radius: 0.06, height: 0.01, segments: 6, axis: 'z', at: [0.1, NOZZLE_Y, -0.585], caps: 'bottom', mat: 'glow', maxLod: 1 }),
        ]),
        // Doppelleitwerk, nach außen gekippt
        mirrorX(extrude({ profile: FIN, depth: 0.04, axis: 'x', at: [0.12, BODY_Y + 0.05, 0], rot: [0, 0, -22], mat: 'body', maxLod: 1, tag: 'wing' })),
        // Kessel-Gondeln an den Flügelspitzen (Hero-Feature): Gusskessel mit stumpfen Enden + Kupferband + Bannerleiste, ragen vor die Flügelspitze
        mirrorX([
          cylinder({ radius: POD_R, height: 0.52, segments: 6, axis: 'z', at: [POD_X, POD_Y, -0.12], caps: false, mat: 'dark', keep: true, tag: 'boiler' }),
          frustum({ radius: POD_R, radiusTop: 0.05, height: 0.1, segments: 6, axis: 'z', at: [POD_X, POD_Y, 0.19], caps: 'top', mat: 'dark', keep: true, tag: 'boiler' }),
          frustum({ radius: POD_R, radiusTop: 0.06, height: 0.06, segments: 6, axis: 'z', at: [POD_X, POD_Y, -0.41], rot: [0, 180, 0], caps: 'top', mat: 'dark', maxLod: 0, tag: 'boiler' }),
          cylinder({ radius: POD_R + 0.012, height: 0.08, segments: 6, axis: 'z', at: [POD_X, POD_Y, 0.06], caps: false, mat: 'copper', maxLod: 0, tag: 'boiler' }),
          // Bannerleiste (team) auf dem Kesselrücken
          box({ size: [0.11, 0.02, 0.3], at: [POD_X, POD_Y + POD_R * 0.866 + 0.008, -0.2], mat: 'team', maxLod: 1 }),
        ]),
        // 2 Tech-Streifen (Keramik) hinten auf dem Rumpfrücken
        stripes({ count: 2, width: 0.11, at: [0, BODY_Y + 0.089, -0.3] }),
      ],
    },
  ],
  notes: 'Luftgruppe Varkan: Delta-Familie des Turmfalken + 2 Kessel-Gondeln an den Spitzen; keine animierten Parts (Roster).',
});
