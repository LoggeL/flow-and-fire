/**
 * Tiegel (core:str_t2_arty) – Artilleriestellung T2, 2×2.
 *
 * Roster: „Große Kelle (Tiegel) auf Schwenkarm über Sockel, Gegengewicht.“ Artillerie-Monopol (faction.md §5.2):
 * offene Kelle auf Lafette, Gegengewicht am Heck; keine Glocke, kein waagerechtes Rohr, kein Schlot. Die Kelle ist
 * außen teamfarben, innen liegt dunkle Schlacke (glüht erst beim Schuss über `flowGlow`, nicht im Mesh).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull  – Fuß, Gusssockel mit Teamfarben-Randband, Kupferkranz, 2 Tech-Kerben
 *   boom  – Lafette: Drehteller, zwei Wangen mit Querhaupt, Gegengewicht (mit Glutschlitz); Yaw (PartStream 1)
 *   ladle – Tiegel (offene Schale Ø 1,0, Team) mit Schlacke, Ausguss und Kupferzapfen; Pitch um die Zapfen
 *           (PartStream 2), in Ruhe 25° nach vorn gekippt
 */
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes, tube } from '@faf/modelkit';

const TOP = 0.28;
const TT = TOP + 0.12; // Oberkante Drehteller
const PIV_Y = TT + 0.64; // Zapfenachse (Kelle ragt deutlich über den Sockel)
const PIV_Z = 0.12;
/** Seitenprofil [z, y] einer Lafettenwange: vorn und hinten angeschrägt, oben trägt sie die Zapfen. */
const CHEEK: readonly (readonly [number, number])[] = [
  [PIV_Z - 0.3, TT],
  [PIV_Z + 0.24, TT],
  [PIV_Z + 0.2, PIV_Y + 0.08],
  [PIV_Z + 0.06, PIV_Y + 0.14],
  [PIV_Z - 0.18, PIV_Y + 0.02],
];

export default defineModel({
  id: 'core:str_t2_arty',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [1.96, 0.1, 1.96], at: [0, 0.05, 0], bevel: { top: 0.04 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [1.86, TOP, 1.86], at: [0, TOP / 2, 0], bevel: { top: 0.1 }, mat: 'body', tag: 'hull' }),
        tube({ outer: 0.83 * Math.SQRT2, inner: 0.68 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [1.66, 0.03, 1.66], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        cylinder({ radius: 0.66, height: 0.04, at: [0, TOP + 0.02, 0], segments: 8, caps: false, mat: 'copper', maxLod: 1, tag: 'hull' }),
        stripes({ count: 2, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.755] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.62, height: 0.1, at: [0, TOP + 0.07, 0], segments: 8, caps: 'top', mat: 'body', tag: 'boom' }),
        // Wangen der Lafette (tragen die Zapfen)
        mirrorX(extrude({ profile: CHEEK, depth: 0.16, axis: 'x', at: [0.6, 0, 0], mat: 'body', tag: 'boom' })),
        box({ size: [1.2, 0.16, 0.18], at: [0, TT + 0.14, -0.28], mat: 'body', maxLod: 1, tag: 'boom' }),
        // Gegengewicht am Heck, Kupferband, Glutnaht
        beveledBox({ size: [0.9, 0.36, 0.38], at: [0, TT + 0.18, -0.58], bevel: { top: 0.08 }, mat: 'body', tag: 'hull' }),
        box({ size: [0.94, 0.07, 0.42], at: [0, TT + 0.14, -0.58], mat: 'copper', maxLod: 1, tag: 'hull' }),
        quad({ size: [0.5, 0.05], at: [0, TT + 0.25, -0.775], rot: [-90, 0, 0], mat: 'glow', maxLod: 0 }),
      ],
    },
    {
      name: 'ladle',
      parent: 'boom',
      pivot: [0, PIV_Y, PIV_Z],
      anim: 'pitch',
      shapes: [
        group(
          [
            // offene Schale: außen Team, Wand 0,15, Boden 0,1
            tube({ outer: 0.5, inner: 0.35, height: 0.52, floor: 0.1, segments: 8, mat: 'team', keep: true, tag: 'ladle' }),
            // Schlacke (dunkel) knapp unter dem Rand
            cylinder({ radius: 0.34, height: 0.02, at: [0, 0.12, 0], segments: 8, caps: 'top', mat: 'dark', maxLod: 0 }),
            // Ausguss vorn am Rand
            box({ size: [0.26, 0.08, 0.2], at: [0, 0.22, 0.5], mat: 'body', maxLod: 0, tag: 'ladle' }),
          ],
          { at: [0, PIV_Y, PIV_Z], rot: [25, 0, 0] },
        ),
        // Kupferzapfen in den Wangen
        cylinder({ radius: 0.1, height: 1.4, axis: 'x', at: [0, PIV_Y, PIV_Z], segments: 6, mat: 'copper', maxLod: 1, tag: 'ladle' }),
      ],
    },
  ],
});
