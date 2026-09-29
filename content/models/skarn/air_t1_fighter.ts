/**
 * Bremse (f2:air_t1_fighter) – Skarn-Abfangjäger T1.
 *
 * Roster: „Zwei schmale, stark gepfeilte Flügelpaare (X-Grundriss, lang > breit).“ Parts carapace, wing [team]
 * (vorderes Paar), wing [team] (hinteres Paar); 1 Tech-Streifen (Quarz).
 * faction.md §5.2 (Abfangjäger): zwei schmale, stark gepfeilte Flügelpaare, spitz nach hinten, lang > breit;
 * verboten: Hinterleib, breite Flügel. Teamfarbe auf der Oberseite beider Flügelpaare und des Rückens (Luft ≥ 45 %).
 * Abgrenzung: Brummer = dicker Hinterleib + gerader Breitflügel (T-Form), Stechmücke = EIN Pfeilflügelpaar mit
 * Kapseln an den Spitzen (T2, größer). Die Bremse trägt nichts an den Flügelspitzen; ihre vier Klingen stehen in der
 * Seitenansicht als X (vorderes Paar V-förmig nach oben, hinteres nach unten).
 *
 * Aufbau (y = Boden, +Z = Bug, +X = links), Länge 1,28 WU, Spannweite 0,78 WU (Pfeilung der Vorderkanten ≈ 55°):
 *   hull – schlanker Sechskant-Keil (Chitin, Rückenplatte team, Bugspitze), zwei Klingenpaare (Chitin-Unterlage +
 *          Teamplatte), Sehnen an den Flügelwurzeln, 1 Quarz-Tech-Streifen.
 *   Keine animierten Parts (Roster: animatedParts 0).
 */
import { defineModel, extrude, group, mirrorX, stripes, strut, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 0.24;
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
// Rumpf: lang und schlank, konstantes Stück hinten (z −0,38 … −0,14) für den Tech-Streifen
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.6],
  [0, BODY_Y, -0.38],
  [0, BODY_Y, -0.14],
  [0, BODY_Y, 0.3],
  [0, BODY_Y, 0.68],
];
const KEEL_R: [number, number][] = [
  [0.035, 0.03],
  [0.09, 0.07],
  [0.09, 0.07],
  [0.1, 0.08],
  [0.015, 0.015],
];

/** Klinge (linke Seite), Draufsicht [x, z]: schmal, Vorderkante stark gepfeilt, Spitze nach hinten. */
const FRONT: Vec2[] = [
  [0.04, 0.36],
  [0.42, -0.16],
  [0.4, -0.22],
  [0.04, 0.16],
];
const REAR: Vec2[] = [
  [0.04, -0.04],
  [0.34, -0.5],
  [0.31, -0.56],
  [0.04, -0.22],
];
const FRONT_Y = BODY_Y + 0.02;
const REAR_Y = BODY_Y - 0.01;

/** Klinge aus Chitin-Unterlage + Teamplatte (LOD0), ab LOD1 eine Teamplatte; `dihedral` kippt die Spitze (Grad). */
function blade(profile: Vec2[], y: number, dihedral: number): ReturnType<typeof group> {
  return group(
    [
      extrude({ profile, depth: 0.03, axis: 'y', at: [0, y - 0.012, 0], mat: 'chitin', keep: true, maxLod: 0, tag: 'wing' }),
      extrude({ profile, depth: 0.016, axis: 'y', at: [0, y + 0.011, 0], mat: 'team', keep: true, maxLod: 0, tag: 'wing' }),
      extrude({ profile, depth: 0.04, axis: 'y', at: [0, y, 0], mat: 'team', keep: true, minLod: 1, tag: 'wing' }),
    ],
    { rot: [0, 0, dihedral] },
  );
}

export default defineModel({
  id: 'f2:air_t1_fighter',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Rumpfkeil: Rückenplatte (team) + Chitin-Bauch
        sweep({ path: KEEL, radius: KEEL_R, profile: TOP, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: KEEL, radius: KEEL_R, profile: BOTTOM, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        // Vorderes Klingenpaar leicht nach oben, hinteres leicht nach unten gekippt (X in der Seitenansicht)
        mirrorX(blade(FRONT, FRONT_Y, 7)),
        mirrorX(blade(REAR, REAR_Y, -7)),
        // Sehnen an den Flügelwurzeln
        mirrorX([
          strut({ from: [0.05, FRONT_Y + 0.03, 0.26], to: [0.16, FRONT_Y + 0.03, 0.1], radius: 0.035, radiusEnd: 0.02, mat: 'sinew', maxLod: 0 }),
          strut({ from: [0.05, REAR_Y + 0.05, -0.08], to: [0.14, REAR_Y + 0.02, -0.22], radius: 0.035, radiusEnd: 0.02, mat: 'sinew', maxLod: 0 }),
        ]),
        // 1 Tech-Streifen (Quarz) auf dem flachen Rücken im hinteren Drittel
        stripes({ count: 1, width: 0.085, at: [0, BODY_Y + 0.07 + 0.005, -0.3], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'Luftgruppe Skarn: zwei schmale Pfeilklingen-Paare (X-Grundriss), nichts an den Spitzen; keine animierten Parts.',
});
