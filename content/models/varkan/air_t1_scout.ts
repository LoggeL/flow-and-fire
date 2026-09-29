/**
 * Lerche (core:air_t1_scout) – Varkan-Luftaufklärer T1.
 *
 * Roster: „Kleinster Flieger, gerader Kurzflügel, einzelnes Seitenleitwerk.“ Parts hull [team], wing [team],
 * wing (Seitenleitwerk), keine animierten Parts, unbewaffnet.
 * Rollen-Monopol Luft-Späher (faction.md §5.2): kleinster Flieger + EIN Seitenleitwerk; verboten: Waffen-Parts.
 * Abgrenzung: Dohle = gerader BREITflügel + Bauchkessel, Turmfalke = Delta + Doppelleitwerk. Die Lerche ist
 * deutlich kleiner (Länge 0,92 WU), der Flügel kurz und gerade, das hohe Einzelleitwerk sitzt ganz hinten.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull – Rumpf mit 45°-Fasen, Rückenplatte (team), Glas-Sensorlinse im Bug (Aufklärer-„Auge“), gerader
 *          Kurzflügel (Guss + Bannerplatte team), hohes Seitenleitwerk, Kupferleitungen an den Flanken, 1 Kupfer-Düse mit Glutkern, 1 Tech-Streifen.
 */
import { beveledBox, box, cylinder, defineModel, extrude, mirrorX, sphere, stripes } from '@faf/modelkit';

/** Kurzflügel, Draufsicht [x, z]: gerade, leicht verjüngt, gefaste Spitzen. */
const WING: readonly (readonly [number, number])[] = [
  [0.44, 0.1],
  [0.44, -0.08],
  [-0.44, -0.08],
  [-0.44, 0.1],
  [-0.4, 0.16],
  [0.4, 0.16],
];
const WING_BANNER: readonly (readonly [number, number])[] = [
  [0.41, 0.09],
  [0.41, -0.05],
  [-0.41, -0.05],
  [-0.41, 0.09],
  [-0.38, 0.13],
  [0.38, 0.13],
];
/** Seitenleitwerk, Seitenansicht [z, y]: hoch und gepfeilt, das Späher-Merkmal. */
const FIN: readonly (readonly [number, number])[] = [
  [-0.46, 0],
  [-0.24, 0],
  [-0.37, 0.26],
  [-0.49, 0.26],
];

const BODY_Y = 0.14;
const BODY_TOP = BODY_Y + 0.07;
const WING_Y = 0.13;

export default defineModel({
  id: 'core:air_t1_scout',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Rumpf: schmaler Gusskörper, steile Bugfase zeigt die Flugrichtung
        beveledBox({
          size: [0.18, 0.14, 0.74],
          at: [0, BODY_Y, -0.05],
          bevel: { top: 0.04, bottom: 0.04, topFront: 0.06, bottomFront: 0.04 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        // Rückenplatte in Teamfarbe (Roster: hull [team])
        box({ size: [0.1, 0.012, 0.31], at: [0, BODY_TOP + 0.006, 0.075], mat: 'team', tag: 'hull' }),
        // Sensorlinse im Bug (Glas) mit Kupferkragen – unbewaffnet, das „Auge“ des Aufklärers
        cylinder({ radius: 0.085, height: 0.05, segments: 6, axis: 'z', at: [0, BODY_Y - 0.005, 0.345], caps: false, mat: 'copper', tag: 'manifold' }),
        sphere({ radius: 0.075, segments: 6, rings: 2, hemi: true, axis: 'z', at: [0, BODY_Y - 0.005, 0.37 + 0.0375], mat: 'glass', tag: 'hull' }),
        // Gerader Kurzflügel: Gussplatte + Bannerplatte (team)
        extrude({ profile: WING, depth: 0.04, axis: 'y', at: [0, WING_Y, 0.04], mat: 'body', keep: true, tag: 'wing' }),
        extrude({ profile: WING_BANNER, depth: 0.02, axis: 'y', at: [0, WING_Y + 0.03, 0.04], mat: 'team', keep: true, tag: 'wing' }),
        // Einzelnes, hohes Seitenleitwerk (Monopol Späher) – Guss mit teamfarbener Kappe
        extrude({ profile: FIN, depth: 0.05, axis: 'x', at: [0, BODY_TOP - 0.01, 0], mat: 'body', keep: true, tag: 'wing' }),
        box({ size: [0.06, 0.03, 0.12], at: [0, BODY_TOP + 0.25 - 0.01 + 0.015, -0.43], mat: 'team', maxLod: 1 }),
        // Düse: Kupferkragen + Glutkern (Glutnaht)
        cylinder({ radius: 0.07, height: 0.08, segments: 6, axis: 'z', at: [0, BODY_Y - 0.01, -0.46], caps: false, mat: 'copper', tag: 'manifold' }),
        cylinder({ radius: 0.05, height: 0.02, segments: 6, axis: 'z', at: [0, BODY_Y - 0.01, -0.49], caps: 'bottom', mat: 'glow', maxLod: 1 }),
        // Kupferleitungen an den Rumpfflanken vom Flügel zur Düse (der „Flow“)
        mirrorX(cylinder({ radius: 0.05, height: 0.26, segments: 6, axis: 'z', at: [0.075, BODY_Y + 0.01, -0.3], caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' })),
        // 1 Tech-Streifen (Keramik) hinten auf dem Rumpfrücken, vor dem Leitwerk
        stripes({ count: 1, width: 0.1, at: [0, BODY_TOP + 0.004, -0.17] }),
      ],
    },
  ],
  notes: 'Luftgruppe Varkan: kleinster Flieger, gerader Kurzflügel, Einzelleitwerk; keine animierten Parts (Roster).',
});
