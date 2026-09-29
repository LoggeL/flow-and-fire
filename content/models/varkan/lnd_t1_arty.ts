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
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes, tube } from '@faf/modelkit';

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

export default defineModel({
  id: 'core:lnd_t1_arty',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.2, axis: 'x', at: [0.35, 0, 0], mat: 'dark', tag: 'tracks' })),
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
        // Gegengewicht am Heck (Pflichtteil Artillerie)
        beveledBox({ size: [0.76, CW_TOP - DECK_TOP, 0.34], at: [0, (CW_TOP + DECK_TOP) / 2, -0.53], bevel: { top: 0.06, topBack: 0.08 }, mat: 'body', tag: 'hull' }),
        // Kupferkrümmer an der Rückseite des Gegengewichts + Glutschlitz
        box({ size: [0.7, 0.08, 0.08], at: [0, DECK_TOP + 0.06, -0.72], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.3, 0.03], at: [0, DECK_TOP + 0.104, -0.72], mat: 'glow', maxLod: 1 }),
        // Kupferleitungen längs der Deckkanten zum Drehkranz
        mirrorX(cylinder({ radius: 0.075, height: 0.62, axis: 'z', at: [0.39, DECK_TOP + 0.01, -0.05], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' })),
        stripes({ count: 1, width: 0.56, at: [0, CW_TOP + 0.004, -0.51] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, PLATE_TOP, BOOM_Z],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.22, height: 0.06, at: [0, PLATE_TOP + 0.03, BOOM_Z], segments: 8, caps: 'top', mat: 'dark', maxLod: 1, tag: 'boom' }),
        // Schwenkarm (Lafette, 0,22 WU breit) schräg nach vorn oben
        box({ size: [0.22, 0.13, 0.58], at: [0, 0.585, BOOM_Z + 0.21], rot: [-40, 0, 0], mat: 'body', tag: 'boom' }),
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
            // Kelle Ø 0,62 WU, Wand 0,17 WU, Boden 0,08 WU; Außenseite = Bannerfläche
            tube({ outer: 0.31, inner: 0.14, height: 0.24, floor: 0.08, segments: 8, at: [0, 0.12, 0], mat: 'team', keep: true, tag: 'ladle' }),
            // Schlackefüllung (dunkel) knapp unter dem Rand: macht die Öffnung von oben als dunkle Scheibe lesbar
            cylinder({ radius: 0.134, height: 0.12, at: [0, 0.14, 0], segments: 8, caps: 'top', mat: 'dark', maxLod: 1 }),
          ],
          { at: [0, LADLE_PIVOT[1] + 0.03, LADLE_PIVOT[2] + 0.16], rot: [18, 0, 0] },
        ),
      ],
    },
  ],
  notes: 'Kelle kippt beim Schuss nach vorn oben (Pitch um das Kupfer-Gelenk), glüht nur beim Schuss (flowGlow).',
});
