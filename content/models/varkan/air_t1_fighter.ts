/**
 * Turmfalke (core:air_t1_fighter) – Varkan-Abfangjäger T1.
 *
 * Roster: „Schmales, stark gepfeiltes Delta (lang > breit), 2 Glutnähte am Heck.“
 * Rollen-Monopol Abfangjäger (faction.md §5.2): schmales, stark gepfeiltes Delta, lang > breit, 2 Glutdüsen hinten;
 * verboten: breite Flügel, Kessel. Teamfarbe auf der gesamten Flügeloberseite (Luft ≥ 45 % der Draufsicht).
 * Abgrenzung: Lerche = gerader Kurzflügel + EIN Seitenleitwerk, Elster = Delta + Kessel-Gondeln an den Spitzen –
 * der Turmfalke trägt deshalb ein nach außen gekipptes Doppelleitwerk und nichts an den Flügelspitzen.
 *
 * Aufbau (y = Boden, +Z = Bug), Länge 1,32 WU, Spannweite 0,80 WU (Pfeilung der Vorderkante ≈ 68°):
 *   hull – gusseiserne Delta-Platte + eingelegte Bannerplatte (team), gefaster Rumpfrücken mit Pyramiden-Nase,
 *          Sichtschlitz, 2 Kupfer-Düsen mit Glutkern (Glutnaht), Doppelleitwerk, 1 Keramik-Tech-Streifen.
 *   Keine animierten Parts (Roster: animatedParts 0) – der Antrieb sind die zwei starren Glutdüsen.
 */
import { beveledBox, box, cone, cylinder, defineModel, extrude, frustum, mirrorX, quad, stripes } from '@faf/modelkit';

/** Draufsicht [x, z] der linken Flügelhälfte + Spiegel: Spitze vorn, Vorderkante stark gepfeilt, gerade Hinterkante. */
const DELTA: readonly (readonly [number, number])[] = [
  [0, 0.5],
  [0.1, 0.34],
  [0.4, -0.36],
  [0.4, -0.5],
  [0.14, -0.5],
  [0.1, -0.44],
  [-0.1, -0.44],
  [-0.14, -0.5],
  [-0.4, -0.5],
  [-0.4, -0.36],
  [-0.1, 0.34],
];
/** Bannerplatte (Teamfarbe): Delta, 0,02 WU eingerückt (schmaler Gussrand bleibt sichtbar). */
const BANNER: readonly (readonly [number, number])[] = [
  [0, 0.45],
  [0.09, 0.31],
  [0.38, -0.36],
  [0.38, -0.48],
  [-0.38, -0.48],
  [-0.38, -0.36],
  [-0.09, 0.31],
];
/** Seitenleitwerk, Seitenansicht [z, y] (gepfeilt). */
const FIN: readonly (readonly [number, number])[] = [
  [-0.5, 0],
  [-0.24, 0],
  [-0.42, 0.24],
  [-0.56, 0.24],
];

const WING_Y = 0.12; // Mitte der Gussplatte
const WING_T = 0.05;
const WING_TOP = WING_Y + WING_T / 2;
const BODY_Y = 0.15;
const NOZZLE_Y = 0.13;

export default defineModel({
  id: 'core:air_t1_fighter',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Delta-Gussplatte (Unterseite/Rand) + Bannerplatte obenauf; LOD2: nur noch die Bannerform als ganze Platte
        extrude({ profile: DELTA, depth: WING_T, axis: 'y', at: [0, WING_Y, 0], mat: 'body', keep: true, maxLod: 1, tag: 'wing' }),
        extrude({ profile: BANNER, depth: 0.02, axis: 'y', at: [0, WING_TOP + 0.01, 0], mat: 'team', keep: true, maxLod: 1, tag: 'wing' }),
        extrude({ profile: DELTA, depth: WING_T, axis: 'y', at: [0, WING_Y + 0.01, 0], mat: 'team', minLod: 2, tag: 'wing' }),
        // Rumpfrücken: schmaler Gusskörper mit 45°-Fasen, läuft vorn in die Pyramiden-Nase
        beveledBox({
          size: [0.2, 0.16, 0.86],
          at: [0, BODY_Y, -0.1],
          bevel: { top: 0.05, bottom: 0.04, topFront: 0.06 },
          mat: 'body',
          tag: 'hull',
        }),
        cone({ radius: 0.127, height: 0.26, segments: 4, axis: 'z', at: [0, BODY_Y - 0.01, 0.45], mat: 'body', keep: true, tag: 'hull' }),
        // Sichtschlitz (Glas) auf dem Rücken
        beveledBox({ size: [0.1, 0.04, 0.16], at: [0, BODY_Y + 0.09, 0.2], bevel: { topFront: 0.03 }, mat: 'glass', maxLod: 1 }),
        // Rückenplatte (Teamfarbe) hinter dem Sichtschlitz
        box({ size: [0.1, 0.012, 0.44], at: [0, BODY_Y + 0.086, -0.14], mat: 'team', maxLod: 1 }),
        // Breite Einlassbacken und offene Kragen brechen die flache Flügeloberseite.
        mirrorX(beveledBox({ size: [0.14, 0.075, 0.25], at: [0.19, WING_TOP + 0.045, -0.17], bevel: { topFront: 0.05 }, mat: 'team', maxLod: 0, tag: 'hull' })),
        mirrorX(quad({ size: [0.09, 0.04], at: [0.19, WING_TOP + 0.0645, -0.0735], rot: [45, 0, 0], mat: 'dark', maxLod: 0 })),
        mirrorX(frustum({ radius: 0.095, radiusTop: 0.075, height: 0.07, segments: 6, axis: 'z', scale: [1, 0.8, 1], at: [0.09, NOZZLE_Y, -0.55], caps: false, mat: 'body', maxLod: 0, tag: 'manifold' })),
        // 2 Glutdüsen: Kupferrohre längs des Rumpfs + Glutkern hinten (Glutnaht ≤ 2 %)
        mirrorX([
          cylinder({ radius: 0.08, height: 0.36, segments: 6, axis: 'z', at: [0.09, NOZZLE_Y, -0.47], caps: false, mat: 'copper', keep: true, tag: 'manifold' }),
          cylinder({ radius: 0.06, height: 0.01, segments: 6, axis: 'z', at: [0.09, NOZZLE_Y, -0.645], caps: 'bottom', mat: 'glow', maxLod: 1 }),
        ]),
        // Doppelleitwerk, nach außen gekippt (Abgrenzung zum Einzelleitwerk der Lerche)
        mirrorX(extrude({ profile: FIN, depth: 0.04, axis: 'x', at: [0.12, BODY_Y + 0.05, 0], rot: [0, 0, -22], mat: 'body', tag: 'wing' })),
        // 1 Tech-Streifen (Keramik) im hinteren Drittel des Rumpfrückens
        stripes({ count: 1, width: 0.1, at: [0, BODY_Y + 0.084, -0.44] }),
      ],
    },
  ],
  notes: 'Luftgruppe Varkan: Delta + Doppelleitwerk, 2 Glutdüsen; keine animierten Parts (Roster).',
});
