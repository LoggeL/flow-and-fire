/**
 * Brummer (f2:air_t1_bomber) – Skarn-Bomber T1.
 *
 * Roster: „Dicker Hinterleib (≥ 1,4 × Flügeltiefe, ragt hinten über) mit kurzen, breiten, geraden Flügeln (T-Form von
 * oben).“ Parts abdomen [team] (hinterleib), wing [team] (breitfluegel), wing (stummel); 1 Tech-Streifen (Quarz).
 * faction.md §5.2 (Bomber): dicker Hinterleib (`abdomen`, Monopol) + kurze, breite, gerade Flügel; verboten:
 * Pfeilung > 30°. Abgrenzung: Bremse = zwei schmale Pfeilklingen-Paare, Motte = kleiner, ein Flügelpaar + Fühler.
 *
 * Maße: Spannweite 1,32 WU, Länge 1,54 WU (mit Stachel), Flügeltiefe 0,36 WU (Pfeilung 0°), Hinterleib 0,98 WU (= 2,7 × Flügeltiefe),
 * ragt 0,82 WU hinter die Flügelhinterkante → T-Form von oben.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = links):
 *   hull – kurzer Kopf-/Bruststück-Keil (Chitin), gerader Breitflügel (Chitin-Unterlage + Teamplatte), dicker
 *          Hinterleib als gestrecktes Sechskant-Oktaeder (Rückenplatten team, Bauch Unterseite) mit Sehnen-Stachel
 *          (Bombenabwurf) am Ende, zwei Stummelflügel (Chitin) am Hinterleib, 1 Quarz-Tech-Streifen.
 *   Keine animierten Parts (Roster: animatedParts 0).
 */
import { claw, defineModel, extrude, group, mirrorX, stripes, strut, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 0.3;
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

// Kopf und Bruststück: kurzer Keil vorn (Chitin), trägt den Flügel
const THORAX: Vec3[] = [
  [0, BODY_Y, 0.04],
  [0, BODY_Y, 0.3],
  [0, BODY_Y, 0.52],
];
const THORAX_R: [number, number][] = [
  [0.15, 0.11],
  [0.14, 0.1],
  [0.04, 0.035],
];
// Hinterleib: gestrecktes Sechskant-Oktaeder, dickste Stelle hinter dem Flügel, konstantes Stück für den Streifen
const ABD: Vec3[] = [
  [0, BODY_Y, 0.12],
  [0, BODY_Y, -0.08],
  [0, BODY_Y, -0.32],
  [0, BODY_Y, -0.5],
  [0, BODY_Y - 0.03, -0.86],
];
const ABD_R: [number, number][] = [
  [0.14, 0.1],
  [0.26, 0.19],
  [0.27, 0.2],
  [0.25, 0.185],
  [0.04, 0.035],
];

/** Breitflügel, Draufsicht [x, z]: gerade Vorderkante, gestutzte Ecken, Pfeilung 0°. */
const WING: Vec2[] = [
  [0, 0.36],
  [0.58, 0.36],
  [0.66, 0.3],
  [0.66, 0.08],
  [0.58, 0.0],
  [-0.58, 0.0],
  [-0.66, 0.08],
  [-0.66, 0.3],
  [-0.58, 0.36],
];
const WING_Y = BODY_Y + 0.02;

/** Stummelflügel (links) am Hinterleib, Draufsicht [x, z]. */
const STUB: Vec2[] = [
  [0.2, -0.2],
  [0.4, -0.26],
  [0.4, -0.36],
  [0.2, -0.38],
];

export default defineModel({
  id: 'f2:air_t1_bomber',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Kopf/Bruststück (Chitin)
        sweep({ path: THORAX, radius: THORAX_R, profile: TOP, mat: 'chitin', keep: true, tag: 'carapace' }),
        sweep({ path: THORAX, radius: THORAX_R, profile: BOTTOM, mat: 'underside', maxLod: 1, tag: 'carapace' }),
        // Hinterleib: Rückenplatten (team) + Bauch
        sweep({ path: ABD, radius: ABD_R, profile: TOP, mat: 'team', keep: true, tag: 'abdomen' }),
        sweep({ path: ABD, radius: ABD_R, profile: BOTTOM, mat: 'underside', keep: true, tag: 'abdomen' }),
        // Stachel am Hinterleibsende (Bombenabwurf), schräg nach hinten unten
        claw({ from: [0, BODY_Y - 0.06, -0.78], to: [0, BODY_Y - 0.2, -1.02], bend: [0, 0.04, 0], radius: 0.06, mat: 'sinew', keep: true, maxLod: 1, tag: 'abdomen' }),
        // Breitflügel: Chitin-Unterlage + Teamplatte; ab LOD1 eine Teamplatte
        extrude({ profile: WING, depth: 0.03, axis: 'y', at: [0, WING_Y - 0.012, 0], mat: 'chitin', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING, depth: 0.016, axis: 'y', at: [0, WING_Y + 0.011, 0], mat: 'team', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING, depth: 0.04, axis: 'y', at: [0, WING_Y, 0], mat: 'team', keep: true, minLod: 1, tag: 'wing' }),
        // Sehnen an den Flügelwurzeln
        mirrorX(strut({ from: [0.1, WING_Y + 0.08, 0.22], to: [0.26, WING_Y + 0.03, 0.2], radius: 0.04, radiusEnd: 0.025, mat: 'sinew', maxLod: 0, tag: 'wing' })),
        // Stummelflügel (Chitin) am Hinterleib, nach unten gekippt
        mirrorX(group([extrude({ profile: STUB, depth: 0.03, axis: 'y', at: [0, BODY_Y - 0.02, 0], mat: 'chitin', maxLod: 1, tag: 'wing' })], { rot: [0, 0, -12] })),
        // 1 Tech-Streifen (Quarz) auf dem flachen Hinterleibsrücken im hinteren Drittel
        stripes({ count: 1, width: 0.2, at: [0, BODY_Y + 0.195 + 0.006, -0.41], rot: [-3, 0, 0], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'Luftgruppe Skarn: dicker Hinterleib (Monopol) + gerader Breitflügel, T-Form von oben; keine animierten Parts.',
});
