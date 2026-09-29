/**
 * Stechmücke (f2:air_t2_fbomber) – Skarn-Jagdbomber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Gepfeiltes Flügelpaar mit zwei Kapseln an den Flügelspitzen, schlanker Keilrumpf (`carapace`, kein
 * Hinterleib: der bleibt Bomber-Monopol), Spannweite +30 % ggü. Bremse.“ Parts carapace (schlanker_rumpf),
 * wing [team] (pfeilfluegel), pod (kapsel_l), pod (kapsel_r); 2 Tech-Streifen (Quarz).
 * faction.md §5.2 (Jagdbomber): gepfeiltes Flügelpaar mit zwei Kapseln an den Flügelspitzen; verboten: Schwirrscheibe,
 * Bauch-Hinterleib. Abgrenzung (Pflichtpaar Bremse↔Stechmücke): EIN breiteres Pfeilflügelpaar statt zwei schmaler
 * Klingenpaare, dicke Sehnenkapseln an beiden Spitzen, Spannweite 1,34 WU gegenüber 0,78 WU (+72 %).
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug, +X = links): Länge 1,36 WU (→ 1,77 WU), Spannweite 1,03 WU
 * (→ 1,34 WU), Pfeilung der Vorderkante ≈ 40°.
 *   hull – schlanker Sechskant-Keil (Chitin, Rückenplatte team) mit langer Bugspitze, Pfeilflügelpaar (Chitin-Unterlage +
 *          Teamplatte), zwei Sechskant-Kapseln (Chitin) mit Sehnenspitzen an den Flügelenden, Sehnen an den Flügelwurzeln,
 *          2 Quarz-Tech-Streifen.
 *   Keine animierten Parts (Roster: animatedParts 0).
 */
import { defineModel, extrude, mirrorX, spike, stripes, strut, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

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
// Rumpf: schlank, lange Bugspitze, konstantes Stück hinten (z −0,44 … −0,16) für die zwei Streifen
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.64],
  [0, BODY_Y, -0.44],
  [0, BODY_Y, -0.16],
  [0, BODY_Y, 0.22],
  [0, BODY_Y - 0.02, 0.72],
];
const KEEL_R: [number, number][] = [
  [0.04, 0.035],
  [0.1, 0.075],
  [0.1, 0.075],
  [0.11, 0.08],
  [0.015, 0.015],
];

/** Pfeilflügel über die ganze Spannweite, Draufsicht [x, z]. */
const WING: Vec2[] = [
  [0, 0.26],
  [0.42, -0.1],
  [0.42, -0.3],
  [0.3, -0.26],
  [0, -0.12],
  [-0.3, -0.26],
  [-0.42, -0.3],
  [-0.42, -0.1],
];
const WING_Y = BODY_Y;
const POD_X = 0.44;
const POD_Y = WING_Y - 0.01;

export default defineModel({
  id: 'f2:air_t2_fbomber',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Rumpfkeil: Rückenplatte (team) + Chitin-Bauch
        sweep({ path: KEEL, radius: KEEL_R, profile: TOP, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: KEEL, radius: KEEL_R, profile: BOTTOM, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        // Pfeilflügel: Chitin-Unterlage + Teamplatte; ab LOD1 eine Teamplatte
        extrude({ profile: WING, depth: 0.03, axis: 'y', at: [0, WING_Y - 0.012, 0], mat: 'chitin', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING, depth: 0.016, axis: 'y', at: [0, WING_Y + 0.011, 0], mat: 'team', keep: true, maxLod: 0, tag: 'wing' }),
        extrude({ profile: WING, depth: 0.04, axis: 'y', at: [0, WING_Y, 0], mat: 'team', keep: true, minLod: 1, tag: 'wing' }),
        // Kapseln an den Flügelspitzen: gestreckte Sechskant-Prismen (Chitin) mit Sehnenspitze nach vorn
        mirrorX([
          strut({ from: [POD_X, POD_Y, -0.4], to: [POD_X, POD_Y, 0.0], radius: 0.08, radiusEnd: 0.085, sides: 6, mat: 'chitin', keep: true, tag: 'pod' }),
          spike({ from: [POD_X, POD_Y, 0.0], to: [POD_X, POD_Y, 0.16], radius: 0.085, sides: 6, mat: 'sinew', keep: true, maxLod: 1, tag: 'pod' }),
        ]),
        // Sehnen an den Flügelwurzeln
        mirrorX(strut({ from: [0.06, WING_Y + 0.06, 0.12], to: [0.22, WING_Y + 0.025, -0.04], radius: 0.04, radiusEnd: 0.022, mat: 'sinew', maxLod: 0, tag: 'wing' })),
        // 2 Tech-Streifen (Quarz) auf dem flachen Rücken im hinteren Drittel
        stripes({ count: 2, width: 0.095, at: [0, BODY_Y + 0.075 + 0.005, -0.2], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'Luftgruppe Skarn: ein Pfeilflügelpaar mit Sehnenkapseln an den Spitzen, schlanker Keil; keine animierten Parts.',
});
