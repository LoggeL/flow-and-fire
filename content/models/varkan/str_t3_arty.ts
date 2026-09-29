/**
 * Hochofen (core:str_t3_arty) – Schwere Artilleriestellung T3, 8×8 (Roster-Maßstab xz 4,0 / y 4,67, Basis = Tiegel
 * auf 2×2; alle Maße unten in Basis-Einheiten, im Spiel ×4 bzw. ×4,67).
 *
 * Roster: „Tiegel-Silhouette auf 8×8: Lafette, Kelle Ø 3,0 WU (Team), Steilrohr 7 WU × Ø 0,6 aus der Kelle (an die
 * Kelle geparentet), Gegengewicht; kein Schlot, 3 Tech-Streifen.“ Gleiche Grundform wie der Tiegel (Sockel,
 * Drehteller, Wangen, Gegengewicht, offene Kelle); T3 = Steilrohr, 3 Kerben, riesiger Maßstab.
 * Paartest Hochofen↔Glutkessel III: Kelle + schräges Rohr gegen liegenden Kessel mit Schloten.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull  – Fuß, Gusssockel mit Teamfarben-Randband, Kupferkranz, 3 Tech-Kerben
 *   boom  – Lafette: Drehteller, Wangen, Querhaupt, Gegengewicht (Glutschlitz); Yaw (PartStream 1)
 *   ladle – Kelle (Ø 0,75 Basis = 3,0 WU, Team) + Steilrohr (Ø 0,15 Basis = 0,6 WU, im Spiel 7 WU lang und 65°
 *           steil), Kupferkragen und Mündung; Pitch um die Zapfen (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, group, mirrorX, quad, stripes, tube } from '@faf/modelkit';

const TOP = 0.16;
const TT = TOP + 0.08;
const PIV_Y = TT + 0.36;
const PIV_Z = -0.05;
/** Steilrohr: im Spiel 65° über der Waagerechten (< 75° = Flugabwehr-Winkel), 7 WU lang ⇒ vorverzerrt um y/xz = 4,67/4. */
const ELEV_DEG = 65;
const SY = 4.67 / 4;
const RAD = Math.PI / 180;
const ELEV = Math.atan(Math.tan(ELEV_DEG * RAD) / SY); // Basis-Elevation
const B_LEN = Math.hypot((7 * Math.cos(ELEV_DEG * RAD)) / 4, (7 * Math.sin(ELEV_DEG * RAD)) / 4.67);
const TILT_DEG = 90 - ELEV / RAD; // Neigung aus der Senkrechten nach vorn
const DIR: [number, number] = [Math.cos(ELEV), Math.sin(ELEV)]; // [z, y]
const B0 = 0.02;
/** Seitenprofil [z, y] einer Lafettenwange. */
const CHEEK: readonly (readonly [number, number])[] = [
  [PIV_Z - 0.24, TT],
  [PIV_Z + 0.2, TT],
  [PIV_Z + 0.16, PIV_Y + 0.06],
  [PIV_Z + 0.04, PIV_Y + 0.11],
  [PIV_Z - 0.14, PIV_Y + 0.02],
]; // Rohrstart über der Zapfenachse (im Kellenboden)
const along = (t: number): [number, number, number] => [0, PIV_Y + B0 + DIR[1] * t, PIV_Z + DIR[0] * t];

export default defineModel({
  id: 'core:str_t3_arty',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [1.96, 0.05, 1.96], at: [0, 0.025, 0], bevel: { top: 0.02 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [1.88, TOP, 1.88], at: [0, TOP / 2, 0], bevel: { top: 0.06 }, mat: 'body', tag: 'hull' }),
        tube({ outer: 0.86 * Math.SQRT2, inner: 0.74 * Math.SQRT2, height: 0.02, segments: 4, at: [0, TOP + 0.01, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [1.72, 0.02, 1.72], at: [0, TOP + 0.01, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        stripes({ count: 3, width: 0.09, stripe: 0.06, gap: 0.06, rot: [0, 90, 0], at: [0, TOP + 0.024, -0.8] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.66, height: 0.08, at: [0, TOP + 0.04, 0], segments: 8, caps: 'top', mat: 'body', tag: 'boom' }),
        mirrorX(extrude({ profile: CHEEK, depth: 0.13, axis: 'x', at: [0.46, 0, 0], mat: 'body', tag: 'boom' })),
        box({ size: [0.9, 0.14, 0.16], at: [0, TT + 0.1, -0.34], mat: 'body', maxLod: 1, tag: 'boom' }),
        beveledBox({ size: [1.0, 0.36, 0.36], at: [0, TT + 0.18, -0.6], bevel: { top: 0.08 }, mat: 'body', tag: 'hull' }),
        box({ size: [1.04, 0.06, 0.4], at: [0, TT + 0.13, -0.6], mat: 'copper', maxLod: 1, tag: 'hull' }),
        quad({ size: [0.5, 0.04], at: [0, TT + 0.26, -0.785], rot: [-90, 0, 0], mat: 'glow', maxLod: 0 }),
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
            tube({ outer: 0.375, inner: 0.27, height: 0.34, floor: 0.08, segments: 8, mat: 'team', keep: true, tag: 'ladle' }),
            cylinder({ radius: 0.26, height: 0.02, at: [0, 0.06, 0], segments: 8, caps: 'top', mat: 'dark', maxLod: 0 }),
          ],
          { at: [0, PIV_Y, PIV_Z], rot: [12, 0, 0] },
        ),
        cylinder({ radius: 0.07, height: 0.9, axis: 'x', at: [0, PIV_Y, PIV_Z], segments: 6, mat: 'copper', maxLod: 1, tag: 'ladle' }),
        // Steilrohr aus der Kelle: Mantel (dick) + Rohr + Kupfermündung
        cylinder({ radius: 0.11, height: 0.66, at: along(0.37), rot: [TILT_DEG, 0, 0], segments: 6, caps: 'top', mat: 'body', maxLod: 1, tag: 'barrel' }),
        cylinder({ radius: 0.145, height: 0.09, at: along(0.7), rot: [TILT_DEG, 0, 0], segments: 6, caps: false, mat: 'copper', tag: 'barrel' }),
        cylinder({ radius: 0.075, height: B_LEN, at: along(B_LEN / 2), rot: [TILT_DEG, 0, 0], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.095, height: 0.1, at: along(B_LEN - 0.05), rot: [TILT_DEG, 0, 0], segments: 6, caps: 'top', mat: 'copper', tag: 'barrel' }),
      ],
    },
  ],
  notes: 'Steilrohr (Kitbash-Part barrel) liegt im Kellen-Part, weil es fest an der Kelle hängt (Roster: an die Kelle geparentet, nicht eigens animiert).',
});
