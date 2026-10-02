/**
 * Kelle (core:lnd_t1_arty) – Varkan-Mobile Artillerie T1.
 *
 * Roster: „Lange schmale Wanne, offene Kelle auf kurzem Schwenkarm, Gegengewicht am Heck; keine Glocke, kein
 * waagerechtes Rohr.“ faction.md §10.1: Wanne 0,9 × 0,35 × 1,5 WU, Kelle Ø 0,6 WU mit Wandstärke ≥ 0,17 WU, kippt
 * beim Schuss nach vorn oben. Rollen-Monopol Artillerie (§5.2): offene Kelle auf Schwenkarm, Gegengewicht am Heck,
 * Rumpf ≥ 1,3× länger als breit (1,5 / 0,9 = 1,67). Grundform der Kellen-Familie (Pfanne T3).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten, Wanne, lange Deckplatte (team), Gegengewicht-Block am Heck mit Kupferkrümmer + Glutschlitz,
 *            1 Tech-Streifen auf dem Gegengewicht (hinteres Deckdrittel)
 *   boom   – Drehkranz + kurzer Schwenkarm (Lafette) mit Kupfer-Gelenk, dreht um +Y   (PartStream 1)
 *   ladle  – offene Kelle (Außenseite team, Schlackenboden dunkel), leicht nach vorn gekippt, Pitch (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes, strut, tube } from '@faf/modelkit';

/** Seitenprofil einer Kette [z, y]: lang und flach. */
const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.64, 0],
  [0.62, 0],
  [0.74, 0.11],
  [0.68, 0.22],
  [-0.68, 0.22],
  [-0.74, 0.11],
];

const DECK_TOP = 0.35;
const PLATE_TOP = 0.38;
const CW_TOP = 0.6;
const BOOM_Z = -0.02;
const LADLE_PIVOT: readonly [number, number, number] = [0, 0.76, 0.4];
const ROAD_WHEELS = [-0.53, -0.265, 0, 0.265, 0.53] as const;
const TOP_SHOES = [-0.5, -0.25, 0, 0.25, 0.5] as const;
const BOTTOM_SHOES = [-0.4, 0, 0.4] as const;
const ARM_CHEEK: readonly (readonly [number, number])[] = [
  [-0.18, 0.43], [0.01, 0.43], [0.47, 0.76], [0.43, 0.84], [0.31, 0.81], [-0.12, 0.55],
];

export default defineModel({
  id: 'core:lnd_t1_arty',
  budget: { tris: [1800, 500, 180] },
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.2, axis: 'x', at: [0.35, 0, 0], mat: 'dark', tag: 'tracks' })),
        // Die dunkle Kettenhülle bleibt in der Entfernung; außen sitzen Laufrollen und einzelne Schuhe.
        ...ROAD_WHEELS.map((z) => mirrorX(cylinder({ radius: 0.087, height: 0.018, axis: 'x', at: [0.441, 0.112, z], segments: 6, caps: 'top', mat: 'body', smooth: 60, maxLod: 0, tag: 'tracks' }))),
        ...[-0.53, 0, 0.53].map((z) => mirrorX(cylinder({ radius: 0.037, height: 0.014, axis: 'x', at: [0.45, 0.112, z], segments: 6, caps: 'top', mat: 'copper', smooth: 60, maxLod: 0, tag: 'tracks' }))),
        ...TOP_SHOES.map((z) => mirrorX(box({ size: [0.204, 0.025, 0.14], at: [0.35, 0.223, z], mat: 'body', maxLod: 0, tag: 'tracks' }))),
        ...BOTTOM_SHOES.map((z) => mirrorX(box({ size: [0.204, 0.02, 0.17], at: [0.35, 0.015, z], mat: 'body', maxLod: 0, tag: 'tracks' }))),
        mirrorX(box({ size: [0.204, 0.025, 0.12], at: [0.35, 0.139, 0.709], rot: [-54, 0, 0], mat: 'body', maxLod: 0, tag: 'tracks' })),
        mirrorX(box({ size: [0.204, 0.025, 0.12], at: [0.35, 0.139, -0.709], rot: [54, 0, 0], mat: 'body', maxLod: 0, tag: 'tracks' })),
        box({ size: [0.5, 0.16, 1.3], at: [0, 0.14, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [0.9, DECK_TOP - 0.21, 1.5],
          at: [0, (DECK_TOP + 0.21) / 2, 0],
          bevel: { top: 0.04, topFront: 0.12, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        // Bannerplatte (team) über die ganze vordere Decklänge
        box({ size: [0.72, PLATE_TOP - DECK_TOP, 0.98], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.08], mat: 'team' }),
        // Bugpanzerung mit abgesetzter Schleppkupplung; freie, lange Deckfläche vor der Lafette.
        beveledBox({ size: [0.62, 0.11, 0.19], at: [0, 0.258, 0.65], bevel: { topFront: 0.06 }, mat: 'body', maxLod: 0, tag: 'hull' }),
        box({ size: [0.14, 0.06, 0.06], at: [0, 0.2, 0.744], mat: 'copper', maxLod: 0 }),
        mirrorX(box({ size: [0.055, 0.052, 0.63], at: [0.395, 0.344, 0.08], mat: 'body', maxLod: 1, tag: 'hull' })),
        // Gegengewicht am Heck (Pflichtteil Artillerie)
        beveledBox({ size: [0.76, CW_TOP - DECK_TOP, 0.34], at: [0, (CW_TOP + DECK_TOP) / 2, -0.53], bevel: { top: 0.06, topBack: 0.08 }, mat: 'body', tag: 'hull' }),
        // Motordeck: versenkte Kühlrippen und breite Wartungsklammern am Gegengewicht.
        ...[-0.63, -0.575, -0.52, -0.465].map((z) => box({ size: [0.43, 0.018, 0.026], at: [0, 0.604, z], mat: 'dark', maxLod: 0 })),
        mirrorX(box({ size: [0.044, 0.17, 0.18], at: [0.29, 0.492, -0.56], mat: 'copper', maxLod: 0 })),
        // Kupferkrümmer an der Rückseite des Gegengewichts + Glutschlitz
        box({ size: [0.7, 0.08, 0.08], at: [0, DECK_TOP + 0.06, -0.72], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.3, 0.03], at: [0, DECK_TOP + 0.104, -0.72], mat: 'glow', maxLod: 1 }),
        // Kupferleitungen längs der Deckkanten zum Drehkranz
        mirrorX(cylinder({ radius: 0.075, height: 0.62, axis: 'z', at: [0.39, DECK_TOP + 0.01, -0.05], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' })),
        stripes({ count: 1, width: 0.56, at: [0, CW_TOP + 0.023, -0.51] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, PLATE_TOP, BOOM_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.22, height: 0.06, at: [0, PLATE_TOP + 0.03, BOOM_Z], segments: 12, caps: 'top', mat: 'dark', smooth: 60, maxLod: 1, tag: 'boom' }),
        // Schwenkarm (Lafette, 0,22 WU breit) schräg nach vorn oben
        box({ size: [0.22, 0.13, 0.58], at: [0, 0.585, BOOM_Z + 0.21], rot: [-40, 0, 0], mat: 'body', tag: 'boom' }),
        // Zwei ausgeschnittene Wangen halten den Arm und das querliegende Pitch-Lager.
        mirrorX(extrude({ profile: ARM_CHEEK, depth: 0.045, axis: 'x', at: [0.135, 0, 0], mat: 'body', maxLod: 1, tag: 'boom' })),
        cylinder({ radius: 0.075, height: 0.36, axis: 'x', at: [LADLE_PIVOT[0], LADLE_PIVOT[1], LADLE_PIVOT[2]], segments: 6, mat: 'copper', maxLod: 1, tag: 'boom' }),
        mirrorX(tube({ outer: 0.096, inner: 0.055, height: 0.036, axis: 'x', at: [0.18, 0.76, 0.4], segments: 6, mat: 'body', smooth: 60, maxLod: 0, tag: 'boom' })),
        // Stützzylinder folgen dem Yaw-Part; die Kolben enden unmittelbar unter der Pitch-Achse.
        mirrorX(strut({ from: [0.205, 0.43, 0.02], to: [0.205, 0.625, 0.25], radius: 0.038, sides: 6, caps: true, mat: 'copper', smooth: 60, maxLod: 0, tag: 'boom' })),
        mirrorX(strut({ from: [0.205, 0.625, 0.25], to: [0.205, 0.73, 0.375], radius: 0.017, sides: 6, caps: false, mat: 'accent', smooth: 60, maxLod: 0, tag: 'boom' })),
      ],
    },
    {
      name: 'ladle',
      parent: 'boom',
      pivot: [LADLE_PIVOT[0], LADLE_PIVOT[1], LADLE_PIVOT[2]],
      anim: 'pitch',
      shapes: [
        group(
          [
            // Kelle Ø 0,62 WU, Wand 0,17 WU, Boden 0,08 WU; Außenseite = Bannerfläche
            tube({ outer: 0.31, inner: 0.14, height: 0.24, floor: 0.08, segments: 16, at: [0, 0.12, 0], mat: 'team', smooth: 55, keep: true, tag: 'ladle' }),
            // Offener, dickwandiger Mündungsring: der innere dunkle Kanal bleibt sichtbar.
            tube({ outer: 0.312, inner: 0.14, height: 0.033, segments: 12, at: [0, 0.233, 0], mat: 'body', smooth: 55, maxLod: 0, tag: 'ladle' }),
            // Bodenverschluss und kurze Ladebahn auf der Rückseite kippen mit der Kelle.
            beveledBox({ size: [0.22, 0.12, 0.17], at: [0, -0.017, -0.095], bevel: { bottom: 0.018 }, mat: 'body', maxLod: 1, tag: 'ladle' }),
            box({ size: [0.18, 0.022, 0.2], at: [0, 0.021, -0.265], mat: 'dark', maxLod: 0, tag: 'ladle' }),
            mirrorX(box({ size: [0.027, 0.06, 0.2], at: [0.09, 0.04, -0.265], mat: 'copper', maxLod: 0, tag: 'ladle' })),
            mirrorX(box({ size: [0.042, 0.15, 0.055], at: [0.288, 0.104, -0.055], mat: 'body', maxLod: 0, tag: 'ladle' })),
            // Schlackefüllung (dunkel) knapp unter dem Rand: macht die Öffnung von oben als dunkle Scheibe lesbar
            cylinder({ radius: 0.134, height: 0.12, at: [0, 0.14, 0], segments: 12, caps: 'top', mat: 'dark', smooth: 55, maxLod: 1 }),
          ],
          { at: [0, LADLE_PIVOT[1] + 0.03, LADLE_PIVOT[2] + 0.16], rot: [18, 0, 0] },
        ),
      ],
    },
  ],
  notes: 'Kelle kippt beim Schuss nach vorn oben (Pitch um das Kupfer-Gelenk), glüht nur beim Schuss (flowGlow). Sichtbare Laufrollen, Kettenschuhe, Lafettenwangen, Hydraulik und Ladebahn in LOD0; vereinfachte Kettenhülle und offene Kelle in der Entfernung.',
});
