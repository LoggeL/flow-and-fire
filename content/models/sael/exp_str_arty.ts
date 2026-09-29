/**
 * Kreuzsee (f3:exp_str_arty) – Fernartillerie (Game-Ender), Großschale (T4, Post-MVP).
 *
 * Roster/experimentals.md §6: teamfarbener Kissen-Sockel über den ganzen 10 × 10-Footprint, darauf eine niedrige
 * Lafette (dreht), die den Hornkranz trägt: drei Hörner (je 6 WU, Mündung Ø 2,4 WU, Goldkante an der Mündung) als
 * Trommel um eine gemeinsame Achse unter 50° (Winkel-Code: Horn schräg = indirekt); hinten eine hohe Gegenschale
 * (8 WU), unter der Lafette die Tiefjade-Kammerschale. Keine Perle, keine Lanze, keine Laterne, kein Goldkern
 * (Kampfeinheit; die feuernde Mündung leuchtet nur zur Laufzeit jadefarben). **Monopol:** Hornkranz.
 * **Pflichtpaar:** Kreuzsee ↔ Sintflut (drei Hörner als Trommel gegen ein großes Horn). Höhe 9 WU.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`, Maße in WU). Die Registry liest seit dem Review 2026-09-29 auch `experimentals[]`
 * aus dem Roster (Abgleich von Icon und Footprint per Warnung); Name, Rolle, Klasse, Tech, Footprint und Icon stehen
 * trotzdem explizit im Modell.
 *
 * Aufbau (y = Boden, +Z = Mündungsrichtung, +X = linke Seite):
 *   hull   – Kissen-Sockel (Teamfarbe) mit Perlmutt-Deckplatte, Kammerschale (Tiefjade), Klammerbögen (Tiefjade),
 *            Lichtnaht
 *   mount  – Lafette (Perlmutt, Goldsaum) mit Schildzapfen und Gegenschale, dreht um +Y   (PartStream 1, yaw)
 *   horns  – Hornkranz: Nabe, drei Hörner (Perlmutt) mit Goldkante und dunklem Schlund, kippt (Pitch)
 *                                                                                           (PartStream 2)
 */
import { defineModel, disc, ellipsoid, glyphStrip, group, sphere, strut, sweep, torus, type Shape, type Vec3 } from '@faf/modelkit';

const CUSH_R = 4.9; // Kissen über den ganzen Footprint (10 × 10)
const CUSH_H = 0.9;
const PLATE_R = 4.15;
const PLATE_TOP = CUSH_H + 0.18;
const MOUNT_Y = PLATE_TOP + 0.75; // Oberkante Kammerschale / Unterkante Lafette
const MOUNT_H = 0.7;
const TRUNNION: Vec3 = [0, MOUNT_Y + MOUNT_H + 0.85, -0.9]; // Kippachse des Hornkranzes
const ELEV = 50; // Achse der Trommel unter 50°
const HORN_LEN = 6;
const MOUTH_R = 1.2; // Mündung Ø 2,4 WU
const THROAT_R = 0.55;
const DRUM_OFF = 1.28; // Abstand Hornachse ↔ Trommelachse
const AXIS_BACK = 1.2; // Trommel beginnt hinter der Kippachse

/** Ein Horn in Trommel-Koordinaten (Trommelachse = +Y, Kippachse im Ursprung), um `deg` um die Achse gedreht. */
function horn(deg: number, segs: number, lod: { readonly maxLod?: 0 | 1 | 2; readonly minLod?: 0 | 1 | 2 }, rims = true): Shape[] {
  const a = (deg * Math.PI) / 180;
  const x = DRUM_OFF * Math.cos(a);
  const z = DRUM_OFF * Math.sin(a);
  const y0 = -AXIS_BACK;
  const y1 = y0 + HORN_LEN;
  // Horn: Schalltrichter, der sich erst zur Mündung hin weitet (Querschnitt r = Schlund + (Mündung − Schlund) · t²)
  const ts = rims ? [0, 0.5, 0.8, 1] : [0, 0.6, 1];
  const body = sweep({
    ...lod,
    path: ts.map((t): Vec3 => [x, y0 + HORN_LEN * t, z]),
    radius: ts.map((t) => THROAT_R + (MOUTH_R - THROAT_R) * t ** 2.2),
    sides: segs,
    up: [0, 0, 1],
    caps: rims ? 'start' : true,
    mat: 'nacre',
    keep: true,
    tag: 'horn',
  });
  if (!rims) return [body];
  const out: Shape[] = [
    body,
    // dunkler Schlund knapp unter der Mündung (verdeckt den Blick in das offene Horn)
    disc({ ...lod, radius: MOUTH_R * 0.9, height: 0.06, bevel: 0, segments: segs, at: [x, y1 - 0.3, z], mat: 'rind', keep: true, tag: 'horn' }),
    // Goldkante an der Mündung
    torus({ ...lod, radius: MOUTH_R, tube: 0.13, segments: segs, sides: 3, at: [x, y1, z], mat: 'gold', keep: true, tag: 'horn' }),
  ];
  return out;
}

/** Punkt/Normale auf der Deckplatte hinten (flach). */
const BR_Z = -PLATE_R + 0.55;
function bracket(side: 1 | -1): Shape[] {
  const xa = side * 0.6;
  const xb = side * 1.05;
  const y = PLATE_TOP + 0.002;
  const lines: [Vec3, Vec3][] = [
    [
      [xa, y, BR_Z + 0.3],
      [xb, y, BR_Z + 0.3],
    ],
    [
      [xb, y, BR_Z + 0.3],
      [xb, y, BR_Z - 0.3],
    ],
    [
      [xb, y, BR_Z - 0.3],
      [xa, y, BR_Z - 0.3],
    ],
  ];
  return lines.map(([a, b]) =>
    glyphStrip({ path: [a, b], width: 0.22, pattern: [Math.hypot(b[0] - a[0], b[2] - a[2]) + 0.11], widths: [1], lift: 0.01, mat: 'jade', maxLod: 1, tag: 'techmarker' }),
  );
}

export default defineModel({
  id: 'f3:exp_str_arty',
  name: 'Kreuzsee',
  role: 'Fernartillerie',
  class: 'struct',
  tech: 4,
  footprint: [10, 10],
  icon: 'struct_arty_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Kissen-Sockel (Teamfarbe): flache, gerundete Scheibe über den Footprint
        disc({ radius: CUSH_R, height: CUSH_H, bevel: 0.4, segments: 22, at: [0, CUSH_H / 2, 0], mat: 'enamel', keep: true, tag: 'shell' }),
        // Perlmutt-Deckplatte: die nächste Schicht, lässt einen Emaille-Saum stehen
        disc({ radius: PLATE_R, height: 0.36, bevel: 0.16, segments: 20, at: [0, PLATE_TOP - 0.18, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        // Kammerschale (Tiefjade) unter der Lafette
        ellipsoid({ radii: [2.9, 0.75, 2.9], half: true, segments: 14, rings: 2, at: [0, PLATE_TOP + 0.375, 0], mat: 'jade', keep: true, tag: 'shell' }),
        // Tech-Marker T4: Klammerbögen hinten auf der Deckplatte
        ...bracket(1),
        ...bracket(-1),
        // Jade-Lichtnaht vorn am Plattenrand (≤ 2 %)
        glyphStrip({
          path: [-40, -20, 0, 20, 40].map((d): Vec3 => {
            const a = ((90 + d) * Math.PI) / 180;
            return [Math.cos(a) * (PLATE_R - 0.35), PLATE_TOP + 0.002, Math.sin(a) * (PLATE_R - 0.35)];
          }),
          width: 0.14,
          pattern: [0.5, -0.25],
          widths: [1],
          mat: 'seam',
          maxLod: 0,
          tag: 'seam',
        }),
      ],
    },
    {
      name: 'mount',
      pivot: [0, MOUNT_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Lafette: niedrige Perlmutt-Scheibe mit Goldsaum
        disc({ radius: 2.5, height: MOUNT_H, bevel: 0.25, segments: 16, at: [0, MOUNT_Y + MOUNT_H / 2, 0], mat: 'nacre', keep: true, tag: 'mast' }),
        torus({ radius: 2.45, tube: 0.1, segments: 16, sides: 3, at: [0, MOUNT_Y + MOUNT_H * 0.55, 0], mat: 'gold', maxLod: 1, tag: 'mast' }),
        // Schildzapfen links/rechts: tragen die Kippachse
        ...[1, -1].map((s) =>
          strut({ from: [s * 1.25, MOUNT_Y + MOUNT_H - 0.05, TRUNNION[2] + 0.1], to: [s * 1.25, TRUNNION[1], TRUNNION[2]], radius: 0.42, radiusEnd: 0.32, sides: 6, mat: 'nacre', keep: true, tag: 'mast' }),
        ),
        // Gegenschale: hohe, stehende Halbschale hinten (8 WU), Wölbung nach hinten, Perlglanz-Scheitel
        ellipsoid({ radii: [2.7, 1.25, 4.0], half: true, axis: 'z', segments: 14, rings: 3, at: [0, 5.1, -2.95], rot: [0, 180, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        ellipsoid({ radii: [1.1, 0.35, 1.6], half: true, axis: 'z', segments: 10, rings: 2, at: [0, MOUNT_Y + 5.4, -3.9], rot: [0, 180, 0], mat: 'lustre', maxLod: 1, tag: 'shell' }),
      ],
    },
    {
      name: 'horns',
      parent: 'mount',
      pivot: TRUNNION,
      anim: 'pitch',
      smooth: true,
      shapes: [
        group(
          [
            // Nabe der Trommel mit Querachse
            sphere({ radius: 1.05, segments: 10, rings: 5, at: [0, 0, 0], mat: 'nacre', keep: true, tag: 'horn' }),
            strut({ from: [-1.45, 0, 0], to: [1.45, 0, 0], radius: 0.34, sides: 6, mat: 'gold', maxLod: 1, tag: 'horn' }),
            ...[90, 210, 330].flatMap((d) => horn(d, 12, { maxLod: 0 })),
            ...[90, 210, 330].flatMap((d) => horn(d, 8, { minLod: 1, maxLod: 1 })),
            ...[90, 210, 330].flatMap((d) => horn(d, 6, { minLod: 2 }, false)),
          ],
          { at: TRUNNION, rot: [90 - ELEV, 0, 0] },
        ),
      ],
    },
  ],
  notes: 'v_exp_crosssea: Lafetten-Yaw, Hornkranz-Pitch (2 animierte Parts). Die 120°-Drehung der Trommel nach jedem Schuss ist Render-Sache (Rotation um die Trommelachse, kein eigener Part).',
});
