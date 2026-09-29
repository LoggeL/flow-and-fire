/**
 * Rinne (core:lnd_t2_mml) – Varkan-Raketenwerfer T2.
 *
 * Roster: „Wanne mit liegendem Kessel, ein breiter Raketenkasten 0,5 × 0,25 × 1,1 WU auf Schwenkarm, 50° geneigt
 * (≥ 25° flacher als AA-Rohre, Breite ≥ 2 × AA-Rohr-Ø); kein Rohr.“ Rollen-Monopol Artillerie/T2-Raketen
 * (faction.md §5.2 + Winkel-Code §5.1 Nr. 5: schräg = indirekt). Kasten in Basisgröße 0,40 × 0,20 × 0,86 WU,
 * mit Maßstab 1,3 = 0,52 × 0,26 × 1,12 WU; Breite 0,52 ≥ 2 × 0,22 (AA-Rohr-Ø des Rüttelsiebs). Paartests
 * Rinne↔Rüttelsieb (ein breiter 50°-Kasten gegen drei dünne senkrechte Rohre) und Meißel↔Rinne (keine Kuppel).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull  – Ketten, Deck mit Bugfase, Deckplatte (team), liegender Kessel quer am Heck (Gegengewicht) mit Kupferbändern,
 *           Glutschlitz, 2 Tech-Streifen vor dem Kessel
 *   boom  – Drehkranz + Schwenkarm-Gabel (zwei Wangen), dreht um +Y                               (PartStream 1)
 *   rack  – Raketenkasten 50° (Oberseite team, zwei Glut-Luken an der Stirn), Pitch um die Gabelachse (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes } from '@faf/modelkit';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.54, 0],
  [0.52, 0],
  [0.64, 0.12],
  [0.58, 0.24],
  [-0.58, 0.24],
  [-0.64, 0.12],
];

const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const BOOM_Z = 0.02;
const RACK_PIVOT: readonly [number, number, number] = [0, 0.64, -0.06];
const RACK_PITCH = -50;
const RACK: readonly [number, number, number] = [0.4, 0.2, 0.86];

export default defineModel({
  id: 'core:lnd_t2_mml',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 1.12], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.28],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.8, PLATE_TOP - DECK_TOP, 0.94], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.05], mat: 'team' }),
        // Liegender Kessel quer am Heck (Rumpf der Rinne, Gegengewicht) mit zwei Kupferbändern
        cylinder({ radius: 0.16, height: 0.84, axis: 'x', at: [0, DECK_TOP + 0.13, -0.5], segments: 8, mat: 'body', tag: 'boiler' }),
        mirrorX(cylinder({ radius: 0.175, height: 0.08, axis: 'x', at: [0.3, DECK_TOP + 0.13, -0.5], segments: 8, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' })),
        quad({ size: [0.4, 0.04], at: [0, 0.32, -0.644], rot: [-90, 0, 0], mat: 'glow', maxLod: 1 }),
        stripes({ count: 2, width: 0.66, at: [0, PLATE_TOP + 0.004, -0.22] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, PLATE_TOP, BOOM_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.25, height: 0.06, at: [0, PLATE_TOP + 0.03, BOOM_Z], segments: 8, caps: 'top', mat: 'dark', maxLod: 1, tag: 'boom' }),
        // Gabel: zwei Wangen (0,08 WU, zusammen mit dem Kasten ≥ 0,17 WU) bis zur Kippachse
        mirrorX(extrude({ profile: [[-0.16, 0.45], [0.1, 0.45], [0.06, 0.72], [-0.12, 0.72]], depth: 0.08, axis: 'x', at: [0.25, 0, 0], mat: 'body', maxLod: 1, tag: 'boom' })),
        cylinder({ radius: 0.06, height: 0.6, axis: 'x', at: [RACK_PIVOT[0], RACK_PIVOT[1], RACK_PIVOT[2]], segments: 6, mat: 'copper', maxLod: 1, tag: 'boom' }),
      ],
    },
    {
      name: 'rack',
      parent: 'boom',
      pivot: [RACK_PIVOT[0], RACK_PIVOT[1], RACK_PIVOT[2]],
      anim: 'pitch',
      shapes: [
        // Kasten-Koordinaten: Achse = +z (vom Drehpunkt nach vorn oben), gekippt um 50° (Nase hoch)
        group(
          [
            beveledBox({ size: [RACK[0], RACK[1], RACK[2]], at: [0, 0.02, RACK[2] / 2 - 0.08], bevel: { top: 0.03, topFront: 0.04 }, mat: 'body', keep: true, tag: 'hull' }),
            box({ size: [0.32, 0.02, 0.62], at: [0, 0.02 + RACK[1] / 2 + 0.01, RACK[2] / 2 - 0.1], mat: 'team' }),
            // Stirnseite: zwei Glut-Luken (Glutraketen)
            mirrorX(quad({ size: [0.12, 0.1], at: [0.09, 0.0, RACK[2] - 0.08 + 0.004], rot: [90, 0, 0], mat: 'glow', maxLod: 1 })),
            // Kupferband um den Kasten
            box({ size: [RACK[0] + 0.03, RACK[1] + 0.03, 0.08], at: [0, 0.02, RACK[2] - 0.3], mat: 'copper', maxLod: 0 }),
            // Kupferverschluss am Heck des Kastens
            box({ size: [0.34, 0.14, 0.06], at: [0, 0.02, -0.1], mat: 'copper', maxLod: 1 }),
          ],
          { at: [RACK_PIVOT[0], RACK_PIVOT[1], RACK_PIVOT[2]], rot: [RACK_PITCH, 0, 0] },
        ),
      ],
    },
  ],
  notes: 'Raketenkasten im Leerlauf 50° (Winkel-Code: schräg = indirekt), Kasten-Maße in Basisgröße ×1,3 ≈ Roster-Maß.',
});
