/**
 * Dohle (core:air_t1_bomber) – Varkan-Bomber T1.
 *
 * Roster: „Gerader Breitflügel (breit ≥ lang) mit Bauch-Kessel, T-Form von oben; Kessellänge ≥ 1,4 × Flügeltiefe,
 * ragt vorn und hinten sichtbar über.“ Parts hull, wing [team] (Breitflügel), boiler (Bombenbauch).
 * Rollen-Monopol Bomber (faction.md §5.2): gerader Breitflügel + Bauch-`boiler`; verboten: Pfeilung > 30°.
 * Abgrenzung: Lerche = kleiner Kurzflügel + Einzelleitwerk; Turmfalke = schmales Delta.
 *
 * Maße: Spannweite 1,50 WU, Länge 1,26 WU (breit ≥ lang), Flügeltiefe 0,40 WU, Kessel 0,96 WU (= 2,4 × Flügeltiefe),
 * ragt 0,24 WU vor die Flügelvorderkante und 0,32 WU hinter die Hinterkante. Der Flügel sitzt vorn, der Rumpf läuft
 * als Stiel nach hinten → T-Form von oben.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull    – Rumpfstiel (Guss, 45°-Fasen) mit Rückenplatte (team), Breitflügel (Guss + Bannerplatte team),
 *             Bauchkessel (liegender Zylinder, Kupferbänder, Bombenschacht mit Glutschlitz), 2 Motorgondeln,
 *             Höhenleitwerk-Stummel, 1 Tech-Streifen
 *   prop_l / prop_r – Propeller vor den Gondeln (Nabe Kupfer + 2 breite Blätter), anim `spin` um die Längsachse
 */
import { beveledBox, box, cone, cylinder, defineModel, extrude, mirrorX, quad, stripes } from '@faf/modelkit';

/** Breitflügel, Draufsicht [x, z]: gerade Vorderkante, leicht verjüngte Hinterkante (Pfeilung 0°). */
const WING: readonly (readonly [number, number])[] = [
  [0.75, 0.3],
  [0.75, 0.02],
  [0.2, -0.1],
  [-0.2, -0.1],
  [-0.75, 0.02],
  [-0.75, 0.3],
];
const WING_BANNER: readonly (readonly [number, number])[] = [
  [0.715, 0.27],
  [0.715, 0.045],
  [0.2, -0.065],
  [-0.2, -0.065],
  [-0.715, 0.045],
  [-0.715, 0.27],
];
/** Höhenleitwerk-Stummel am Heck [x, z]. */
const TAIL: readonly (readonly [number, number])[] = [
  [0.3, -0.5],
  [0.3, -0.64],
  [-0.3, -0.64],
  [-0.3, -0.5],
];

const WING_Y = 0.24;
const WING_T = 0.05;
const BODY_Y = 0.26;
const BOILER_Y = 0.17;
const BOILER_R = 0.16;
const NAC_X = 0.42;
const NAC_Y = 0.23;
const PROP_Z = 0.5;

/** Propeller (Nabe + 2 breite Schaufelblätter) um die Längsachse bei x; entfällt in LOD2 (≥ 180 WU unsichtbar). */
function propeller(x: number) {
  return [
    cone({ radius: 0.07, height: 0.1, segments: 6, axis: 'z', at: [x, NAC_Y, PROP_Z + 0.03], mat: 'copper', maxLod: 1, tag: 'manifold' }),
    // zweiblättrig, breite Schaufeln, angestellt; Ruhestellung waagerecht (hängt nicht unter die Gondel)
    box({ size: [0.11, 0.36, 0.02], at: [x, NAC_Y, PROP_Z - 0.01], rot: [0, 14, 90], mat: 'dark', maxLod: 1 }),
  ];
}

export default defineModel({
  id: 'core:air_t1_bomber',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Breitflügel: Gussplatte + Bannerplatte (Teamfarbe, gesamte Oberseite)
        extrude({ profile: WING, depth: WING_T, axis: 'y', at: [0, WING_Y, 0], mat: 'body', keep: true, maxLod: 1, tag: 'wing' }),
        extrude({ profile: WING_BANNER, depth: 0.02, axis: 'y', at: [0, WING_Y + WING_T / 2 + 0.01, 0], mat: 'team', keep: true, maxLod: 1, tag: 'wing' }),
        extrude({ profile: WING, depth: WING_T, axis: 'y', at: [0, WING_Y + 0.01, 0], mat: 'team', minLod: 2, tag: 'wing' }),
        // Rumpfstiel: vorn gefast (Richtung), läuft weit nach hinten (T-Form)
        beveledBox({
          size: [0.24, 0.16, 1.14],
          at: [0, BODY_Y, -0.1],
          bevel: { top: 0.05, bottom: 0.03, topFront: 0.08, topBack: 0.04 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        // Sichtschlitz vorn
        beveledBox({ size: [0.12, 0.035, 0.12], at: [0, BODY_Y + 0.09, 0.3], bevel: { topFront: 0.025 }, mat: 'glass', maxLod: 0 }),
        // Rückenplatte (team) auf dem Stiel hinter dem Flügel
        box({ size: [0.14, 0.012, 0.44], at: [0, BODY_Y + 0.086, -0.13], mat: 'team', maxLod: 1, tag: 'hull' }),
        // Höhenleitwerk-Stummel (Guss) – hält die T-Form, Pfeilung 0°
        extrude({ profile: TAIL, depth: 0.04, axis: 'y', at: [0, BODY_Y + 0.02, 0], mat: 'team', tag: 'wing' }),
        // Bauchkessel (boiler): liegender Zylinder mit Kuppelenden, 2 Kupferbänder, Bombenschacht-Glutschlitz
        cylinder({ radius: BOILER_R, height: 0.76, segments: 8, axis: 'z', at: [0, BOILER_Y, 0.06], caps: false, mat: 'body', keep: true, tag: 'boiler' }),
        cone({ radius: BOILER_R, height: 0.1, segments: 8, axis: 'z', at: [0, BOILER_Y, 0.49], mat: 'dark', keep: true, tag: 'boiler' }),
        cone({ radius: BOILER_R, height: 0.1, segments: 8, axis: 'z', at: [0, BOILER_Y, -0.37], rot: [0, 180, 0], mat: 'dark', keep: true, tag: 'boiler' }),
        cylinder({ radius: BOILER_R + 0.012, height: 0.07, segments: 8, axis: 'z', at: [0, BOILER_Y, 0.3], caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: BOILER_R + 0.012, height: 0.07, segments: 8, axis: 'z', at: [0, BOILER_Y, -0.18], caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        quad({ size: [0.08, 0.3], at: [0, 0.016, 0.06], rot: [180, 0, 0], mat: 'glow', maxLod: 1 }),
        // Motorgondeln unter dem Flügel (Kupfer, hinten Glutkern)
        mirrorX([
          cylinder({ radius: 0.08, height: 0.44, segments: 6, axis: 'z', at: [NAC_X, NAC_Y, 0.27], caps: false, mat: 'copper', tag: 'manifold' }),
          cylinder({ radius: 0.06, height: 0.01, segments: 6, axis: 'z', at: [NAC_X, NAC_Y, 0.048], caps: 'bottom', mat: 'glow', maxLod: 1 }),
        ]),
        // 1 Tech-Streifen (Keramik) im hinteren Drittel des Rumpfstiels
        stripes({ count: 1, width: 0.12, at: [0, BODY_Y + 0.084, -0.43] }),
      ],
    },
    { name: 'prop_l', pivot: [NAC_X, NAC_Y, PROP_Z], anim: 'spin', shapes: propeller(NAC_X) },
    { name: 'prop_r', pivot: [-NAC_X, NAC_Y, PROP_Z], anim: 'spin', shapes: propeller(-NAC_X) },
  ],
  notes: 'Luftgruppe Varkan: Breitflügel + Bauchkessel (T-Form), 2 Propeller als spin-Parts (Rotor-Parts), sonst statisch.',
});
