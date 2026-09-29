/**
 * Perle (f3:exp_str_eco) – Ressourcenperle (Endgame-Eco), Großschale (T4, Post-MVP).
 *
 * Roster/experimentals.md §7: teamfarbener Kissen-Sockel (8 × 8), darauf die untere Muschelschale (Perlmutt innen,
 * Schalenrinde außen), die obere Schale 40° aufgeklappt (öffnet sich beim Bau schichtweise, nur View); dazwischen
 * schwebt die Riesenperle (Ø 3,2 WU) mit Goldkern, umschlossen von beiden Schalen (Flow-Ausnahme faction.md §5.3
 * Nr. 6); über ihr kreist ein flacher Goldring. **Monopol:** offene Muschel mit Riesenperle. **Pflichtpaar:**
 * Perle ↔ Brunnen III (Muschel und Perle gegen Ring und Kelch). Höhe 6,5 WU.
 *
 * Die Schalen sind `domeShell` (hohle Kugelkappen mit Wandstärke): innen Perlmutt, die nach unten gewandte Außenseite
 * dunkelt der `body`-Shader zur Schalenrinde ab (faction.md §4, hell oben, dunkel unten). Das Schloss liegt hinten;
 * die obere Schale klappt um die Schlossachse nach oben und vorn auf.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`, Maße in WU). Die Registry liest seit dem Review 2026-09-29 auch `experimentals[]`
 * aus dem Roster (Abgleich von Icon und Footprint per Warnung); Name, Rolle, Klasse, Tech, Footprint und Icon stehen
 * trotzdem explizit im Modell.
 *
 * Aufbau (y = Boden, +Z = vorn (Öffnung), +X = linke Seite):
 *   hull  – Kissen-Sockel (Teamfarbe) mit Perlmutt-Deckplatte, untere Muschelschale, Schloss (Gold), Riesenperle
 *           (Goldkern), Klammerbögen (Tiefjade), Lichtnaht
 *   upper – obere Muschelschale mit Rippen-Goldkante, klappt um das Schloss (Pitch, Bauanimation)  (PartStream 1)
 *   ring  – flacher Goldring über der Perle, kreist                                 (PartStream 2, spin)
 */
import { defineModel, disc, domeShell, ellipsoid, glyphStrip, group, sphere, strut, torus, torusArc, type Shape, type Vec3 } from '@faf/modelkit';

const CUSH_R = 3.9; // Kissen 8 × 8
const CUSH_H = 0.7;
const PLATE_R = 3.3;
const PLATE_TOP = CUSH_H + 0.14;
const SHELL_R = 3.05; // Muschelradius
const SHELL_T = 0.22;
const SHELL_ARC = 62; // Öffnungswinkel der Kugelkappe
const DEPTH = SHELL_R * (1 - Math.cos((SHELL_ARC * Math.PI) / 180)); // Tiefe der Kappe
const RIM_R = SHELL_R * Math.sin((SHELL_ARC * Math.PI) / 180); // Randradius
const RIM_Y = PLATE_TOP + 0.25 + DEPTH; // Schalenrand der unteren Schale
const HINGE: Vec3 = [0, RIM_Y, -RIM_R + 0.1];
const OPEN = 40; // obere Schale aufgeklappt
const PEARL_R = 1.6; // Ø 3,2 WU
const PEARL: Vec3 = [0, RIM_Y + 0.35, 0.15];
const RING_Y = PEARL[1] + PEARL_R + 0.3;

/** Tech-Marker T4: „[“ / „]“ hinten auf der Deckplatte (Tiefjade-Decal). */
const BR_Z = -PLATE_R + 0.45;
function bracket(side: 1 | -1): Shape[] {
  const xa = side * 0.5;
  const xb = side * 0.9;
  const y = PLATE_TOP + 0.002;
  const lines: [Vec3, Vec3][] = [
    [
      [xa, y, BR_Z + 0.26],
      [xb, y, BR_Z + 0.26],
    ],
    [
      [xb, y, BR_Z + 0.26],
      [xb, y, BR_Z - 0.26],
    ],
    [
      [xb, y, BR_Z - 0.26],
      [xa, y, BR_Z - 0.26],
    ],
  ];
  return lines.map(([a, b]) =>
    glyphStrip({ path: [a, b], width: 0.2, pattern: [Math.hypot(b[0] - a[0], b[2] - a[2]) + 0.1], widths: [1], lift: 0.01, mat: 'jade', maxLod: 1, tag: 'techmarker' }),
  );
}

export default defineModel({
  id: 'f3:exp_str_eco',
  name: 'Perle',
  role: 'Ressourcenperle',
  class: 'struct',
  tech: 4,
  footprint: [8, 8],
  icon: 'struct_mass_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Kissen-Sockel (Teamfarbe) und Perlmutt-Deckplatte (Emaille-Saum bleibt stehen)
        disc({ radius: CUSH_R, height: CUSH_H, bevel: 0.3, segments: 20, at: [0, CUSH_H / 2, 0], mat: 'enamel', keep: true, tag: 'shell' }),
        disc({ radius: PLATE_R, height: 0.28, bevel: 0.12, segments: 18, at: [0, PLATE_TOP - 0.14, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        // Fuß der unteren Schale (Rinde)
        ellipsoid({ radii: [1.3, 0.3, 1.3], half: true, segments: 10, rings: 2, at: [0, PLATE_TOP + 0.15, 0], mat: 'rind', maxLod: 1, tag: 'shell' }),
        // untere Muschelschale: Schüssel (Kappe nach unten), innen Perlmutt
        domeShell({ radius: SHELL_R, thickness: SHELL_T, arc: SHELL_ARC, segments: 16, rings: 3, at: [0, RIM_Y - DEPTH / 2, 0], rot: [180, 0, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        // Goldkante am Schalenrand
        torus({ radius: RIM_R - SHELL_T / 2, tube: 0.1, segments: 18, sides: 3, at: [0, RIM_Y, 0], mat: 'gold', maxLod: 1, tag: 'rim' }),
        // Schloss hinten (Gold): Achse der oberen Schale
        strut({ from: [-0.9, HINGE[1], HINGE[2]], to: [0.9, HINGE[1], HINGE[2]], radius: 0.26, sides: 6, mat: 'gold', keep: true, tag: 'hinge' }),
        // Riesenperle mit Goldkern (ECONOMIC, umschlossen)
        sphere({ radius: PEARL_R, segments: 14, rings: 7, at: PEARL, mat: 'light', keep: true, tag: 'orb' }),
        // Tech-Marker T4
        ...bracket(1),
        ...bracket(-1),
        // Jade-Lichtnaht vorn auf der Deckplatte (≤ 2 %)
        glyphStrip({
          path: [-36, -18, 0, 18, 36].map((d): Vec3 => {
            const a = ((90 + d) * Math.PI) / 180;
            return [Math.cos(a) * (PLATE_R - 0.25), PLATE_TOP + 0.002, Math.sin(a) * (PLATE_R - 0.25)];
          }),
          width: 0.12,
          pattern: [0.42, -0.2],
          widths: [1],
          mat: 'seam',
          maxLod: 0,
          tag: 'seam',
        }),
      ],
    },
    {
      name: 'upper',
      pivot: HINGE,
      anim: 'pitch',
      smooth: true,
      shapes: [
        // obere Muschelschale (Kappe nach oben), um das Schloss 40° aufgeklappt; Goldkante am Rand
        group(
          [
            domeShell({ radius: SHELL_R, thickness: SHELL_T, arc: SHELL_ARC, segments: 16, rings: 3, at: [0, DEPTH / 2, -HINGE[2]], mat: 'nacre', keep: true, tag: 'shell' }),
            torus({ radius: RIM_R - SHELL_T / 2, tube: 0.1, segments: 18, sides: 3, at: [0, 0.02, -HINGE[2]], mat: 'gold', maxLod: 1, tag: 'rim' }),
            // Perlglanz-Scheitel: die jüngste Schicht
            ellipsoid({ radii: [1.1, 0.22, 1.1], half: true, segments: 10, rings: 2, at: [0, DEPTH - 0.04, -HINGE[2]], mat: 'lustre', maxLod: 1, tag: 'shell' }),
            // Schichtlinien (Rippen) auf der Oberseite
            ...[-40, 0, 40].map((d) =>
              torusArc({ radius: SHELL_R + 0.01, tube: 0.07, arc: 92, startDeg: 134, segments: 8, sides: 3, axis: 'x', at: [0, DEPTH - SHELL_R, -HINGE[2]], rot: [0, d, 0], mat: 'lustre', maxLod: 0, tag: 'shell' }),
            ),
          ],
          { at: HINGE, rot: [-OPEN, 0, 0] },
        ),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, PEARL[2]],
      anim: 'spin',
      smooth: true,
      shapes: [
        // flacher Goldring über der Perle
        torus({ radius: 1.15, tube: 0.14, segments: 16, sides: 4, at: [0, RING_Y, PEARL[2]], scale: [1, 0.6, 1], mat: 'gold', keep: true, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_exp_pearl: obere Schale Pitch (Bauanimation, schichtweise), Goldring Spin (2 animierte Parts). Goldkern verblasst beim Energy-Stall zu Perlgrau (Render).',
});
