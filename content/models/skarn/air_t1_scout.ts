/**
 * Motte (f2:air_t1_scout) – Skarn-Luftaufklärer T1.
 *
 * Roster: „Kleinster Flieger, ein Flügelpaar, zwei Fühler nach vorn; keine Waffen-Parts.“ Parts carapace [team],
 * wing [team], antenna (fuehler_l), antenna (fuehler_r); 1 Tech-Streifen (Quarz).
 * faction.md §5.2 (Luft-Späher): kleinster Flieger, zwei Fühler nach vorn; verboten: Waffen-Parts.
 * Abgrenzung (Pflichtpaar Motte↔Brummer): EIN breites, kurzes Flügelpaar ohne Hinterleib, die zwei geknickten
 * Fühler ragen weit vor die Bugspitze (Winkel-Code „hoch und dünn = Intel“). Der Brummer hat den dicken Hinterleib.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = links), Länge 1,05 WU inkl. Fühler, Spannweite 0,92 WU:
 *   hull – kurzer Sechskant-Keil (Rückenplatte team, Bauch Unterseite), breites Mottenflügelpaar (Chitin-Unterlage
 *          + Teamplatte, facettiert: Vorder- und Hinterflügel in einem Umriss), Sehnen an den Flügelwurzeln,
 *          zwei Fühler (2 Glieder, geknickt, als V schräg nach vorn oben), 1 Quarz-Tech-Streifen.
 *   Keine animierten Parts (Roster: animatedParts 0).
 */
import { defineModel, extrude, limb, mirrorX, stripes, strut, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 0.22;
/** Flacher Sechskant-Querschnitt (Oberseite mit scharfen Kanten, u = seitlich, v = oben). */
const TOP: Vec2[] = [
  [1, 0],
  [0.5, 1],
  [-0.5, 1],
  [-1, 0],
];
const BOTTOM: Vec2[] = [
  [-1, 0],
  [-0.45, -0.8],
  [0.45, -0.8],
  [1, 0],
];
// Rumpf: Bugspitze vorn, konstantes Stück hinten für den Tech-Streifen (z −0,26 … −0,08)
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.4],
  [0, BODY_Y, -0.26],
  [0, BODY_Y, -0.08],
  [0, BODY_Y, 0.16],
  [0, BODY_Y, 0.34],
];
const KEEL_R: [number, number][] = [
  [0.04, 0.03],
  [0.11, 0.08],
  [0.11, 0.08],
  [0.12, 0.09],
  [0.03, 0.03],
];

/** Mottenflügel, Draufsicht [x, z]: breite Vorderflügel, Kerbe, kleinere Hinterflügel (facettiert, keine Kurven). */
const WING: Vec2[] = [
  [0, 0.14],
  [0.24, 0.12],
  [0.46, 0.0],
  [0.44, -0.14],
  [0.26, -0.16],
  [0.3, -0.3],
  [0.16, -0.36],
  [0, -0.22],
  [-0.16, -0.36],
  [-0.3, -0.3],
  [-0.26, -0.16],
  [-0.44, -0.14],
  [-0.46, 0.0],
  [-0.24, 0.12],
];
/** Teamplatte obenauf, 0,02 WU eingerückt (schmaler Chitinrand bleibt als Glanzkante sichtbar). */
const WING_TEAM: Vec2[] = [
  [0, 0.12],
  [0.23, 0.1],
  [0.44, -0.005],
  [0.42, -0.12],
  [0.24, -0.15],
  [0.28, -0.28],
  [0.165, -0.335],
  [0, -0.2],
  [-0.165, -0.335],
  [-0.28, -0.28],
  [-0.24, -0.15],
  [-0.42, -0.12],
  [-0.44, -0.005],
  [-0.23, 0.1],
];
const WING_Y = BODY_Y + 0.01;

/** Fühler (links, +X): Wurzel am Kopf, Knick oben, Spitze weit vor dem Bug. */
const FEELER: Vec3[] = [
  [0.05, BODY_Y + 0.05, 0.2],
  [0.12, BODY_Y + 0.26, 0.4],
  [0.25, BODY_Y + 0.3, 0.64],
];

export default defineModel({
  id: 'f2:air_t1_scout',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Rumpfkeil: Rückenplatte (team) + Bauch (Unterseite)
        sweep({ path: KEEL, radius: KEEL_R, profile: TOP, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: KEEL, radius: KEEL_R, profile: BOTTOM, mat: 'underside', keep: true, maxLod: 1, tag: 'carapace' }),
        // Flügelpaar: Chitin-Unterlage + Teamplatte; ab LOD1 nur die Teamplatte in voller Dicke
        extrude({ profile: WING, depth: 0.03, axis: 'y', at: [0, WING_Y - 0.01, 0], mat: 'chitin', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING_TEAM, depth: 0.016, axis: 'y', at: [0, WING_Y + 0.013, 0], mat: 'team', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING, depth: 0.04, axis: 'y', at: [0, WING_Y, 0], mat: 'team', keep: true, minLod: 1, tag: 'wing' }),
        // Sehnen an den Flügelwurzeln (Flugmuskel-Ansatz)
        mirrorX(strut({ from: [0.08, WING_Y + 0.03, 0.06], to: [0.2, WING_Y + 0.024, -0.02], radius: 0.035, radiusEnd: 0.02, mat: 'sinew', maxLod: 0, tag: 'wing' })),
        // Fühler: 2 Glieder, geknickt, schräg nach vorn oben; LOD2 ein gerades Glied
        mirrorX(limb({ joints: FEELER, radius: [0.065, 0.055, 0.03], hipCap: false, mat: 'chitin', keep: true, maxLod: 1, tag: 'antenna' })),
        mirrorX(strut({ from: FEELER[0]!, to: FEELER[2]!, radius: 0.06, radiusEnd: 0.03, sides: 3, mat: 'chitin', keep: true, minLod: 2, tag: 'antenna' })),
        // 1 Tech-Streifen (Quarz) auf dem flachen Rücken im hinteren Drittel
        stripes({ count: 1, width: 0.1, at: [0, BODY_Y + 0.08 + 0.005, -0.17], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'Luftgruppe Skarn: ein breites Mottenflügelpaar + zwei geknickte Fühler nach vorn; keine animierten Parts.',
});
