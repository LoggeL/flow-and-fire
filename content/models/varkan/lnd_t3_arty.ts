/**
 * Pfanne (core:lnd_t3_arty) – Varkan-Schwere Artillerie T3.
 *
 * Roster: „Kelle ×1,7 auf überlanger Wanne, 3 Tech-Streifen; kein Schlot (Glut-Monopol).“ Grundform = Kelle (lange
 * Wanne, offene Kelle auf kurzem Schwenkarm, Gegengewicht am Heck, keine Glocke, kein waagerechtes Rohr);
 * T3-Merkmale (faction.md §3.4): überlange Wanne 1,9 WU (Kelle 1,5), doppelt tiefes Gegengewicht mit 3 Tech-Streifen,
 * etwas größere Kelle (Ø 0,66), Maßstab 1,7 (eingebacken, 2×2-Footprint). Kein Heckschlot.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten, Wanne, lange Deckplatte (team), Gegengewicht-Block mit Kupferkrümmer + Glutschlitz,
 *            Kupferleitungen, 3 Tech-Streifen auf dem Gegengewicht
 *   boom   – Drehkranz + Schwenkarm (Lafette) mit Kupfer-Gelenk, dreht um +Y   (PartStream 1)
 *   ladle  – offene Kelle (Außenseite team, Schlackenboden dunkel), Pitch      (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes, tube } from '@faf/modelkit';

/** Seitenprofil einer Kette [z, y]: lang und flach. */
const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.84, 0],
  [0.82, 0],
  [0.94, 0.11],
  [0.88, 0.22],
  [-0.88, 0.22],
  [-0.94, 0.11],
];

const DECK_TOP = 0.35;
const PLATE_TOP = 0.38;
const CW_TOP = 0.6;
const BOOM_Z = 0.16;
const LADLE_PIVOT: readonly [number, number, number] = [0, 0.76, 0.58];

export default defineModel({
  id: 'core:lnd_t3_arty',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.2, axis: 'x', at: [0.35, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.5, 0.16, 1.7], at: [0, 0.14, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [0.9, DECK_TOP - 0.21, 1.9],
          at: [0, (DECK_TOP + 0.21) / 2, 0],
          bevel: { top: 0.04, topFront: 0.12, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        // Bannerplatte (team) über die ganze vordere Decklänge
        beveledBox({ size: [0.72, PLATE_TOP - DECK_TOP, 1.14], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.2], bevel: { topFront: 0.02 }, mat: 'team' }),
        // Doppelt tiefes Gegengewicht am Heck (Pflichtteil Artillerie, T3)
        beveledBox({ size: [0.78, CW_TOP - DECK_TOP, 0.58], at: [0, (CW_TOP + DECK_TOP) / 2, -0.61], bevel: { top: 0.06, topBack: 0.06 }, mat: 'body', tag: 'hull' }),
        // Kupferkrümmer an der Rückseite des Gegengewichts + Glutschlitz
        box({ size: [0.7, 0.08, 0.08], at: [0, DECK_TOP + 0.06, -0.92], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.3, 0.03], at: [0, DECK_TOP + 0.104, -0.92], mat: 'glow', maxLod: 1 }),
        // Kupferleitungen längs der Deckkanten zum Drehkranz
        mirrorX(cylinder({ radius: 0.075, height: 0.8, axis: 'z', at: [0.39, DECK_TOP + 0.01, 0.0], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' })),
        stripes({ count: 3, width: 0.56, stripe: 0.1, gap: 0.05, at: [0, CW_TOP + 0.004, -0.6] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, PLATE_TOP, BOOM_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.22, height: 0.06, at: [0, PLATE_TOP + 0.03, BOOM_Z], segments: 8, caps: 'top', mat: 'dark', maxLod: 1, tag: 'boom' }),
        // Schwenkarm (Lafette, 0,22 WU breit) schräg nach vorn oben
        beveledBox({ size: [0.22, 0.13, 0.58], at: [0, 0.585, BOOM_Z + 0.21], rot: [-40, 0, 0], bevel: { top: 0.035 }, mat: 'body', tag: 'boom' }),
        // Zwei Hydraulikzylinder flankieren die gefaste Lafette.
        mirrorX(cylinder({ radius: 0.05, height: 0.38, axis: 'z', at: [0.16, 0.57, BOOM_Z + 0.2], rot: [-40, 0, 0], segments: 6, caps: false, mat: 'copper', maxLod: 0, tag: 'boom' })),
        cylinder({ radius: 0.075, height: 0.36, axis: 'x', at: [LADLE_PIVOT[0], LADLE_PIVOT[1], LADLE_PIVOT[2]], segments: 6, mat: 'copper', maxLod: 1, tag: 'boom' }),
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
            // Kelle Ø 0,66 WU, Wand 0,18 WU, Boden 0,08 WU; Außenseite = Bannerfläche
            tube({ outer: 0.33, inner: 0.15, height: 0.26, floor: 0.08, segments: 8, at: [0, 0.13, 0], mat: 'team', keep: true, tag: 'ladle' }),
            // Schlacke im Kellenboden (dunkel)
            cylinder({ radius: 0.144, height: 0.14, at: [0, 0.15, 0], segments: 8, caps: 'top', mat: 'dark', maxLod: 1 }),
          ],
          { at: [0, LADLE_PIVOT[1] + 0.03, LADLE_PIVOT[2] + 0.17], rot: [18, 0, 0] },
        ),
      ],
    },
  ],
  notes: 'Kelle kippt beim Schuss nach vorn oben (Pitch um das Kupfer-Gelenk), glüht nur beim Schuss (flowGlow).',
});
