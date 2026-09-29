/**
 * Schlehe I (f2:str_t1_aa) – Flugabwehrturm T1, 1×1.
 *
 * Roster: „Kruste mit Dornenkamm aus 2 senkrechten Dornen.“ faction.md §5.2 Flugabwehr: Dornenkamm = senkrechte
 * Dornen (≥ 75°) quer zur Schussrichtung, Dorn-Ø ≥ 0,17 WU; verboten: Linse, Schwanz, Kapsel, Druse.
 * Paartests: Falle↔Schlehe (flache Falltür + waagerechte Linse gegen hohe Dornen), Schlehe↔Hecke (hohe, dünne
 * Dornen auf schmalem Kammsockel gegen flachen Block mit Stummeldornen).
 * Teamfarbe: Krustenrand (Roster `crust: team`) + Kammplatte oben auf dem Sockel; Sehnen-Manschetten an den
 * Dornwurzeln; 1 Quarz-Kerbe auf dem Krustenboden hinten; keine Glut.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull   – Kruste, 1 Kerbe
 *   turret – Kammsockel (Chitin-Keilriegel quer, Teamplatte) + 2 Dornen (Chitin, 86°); dreht um +Y   (PartStream 1)
 */
import { defineModel, extrude, spike, stripes, strut } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const K = crust({ size: [0.97, 0.97], h: 0.2, seed: 5 });
const F = K.floor;
const RIDGE_H = 0.2;
const R_TOP = F + RIDGE_H;
const THORN_X = 0.16;
const THORN_TIP = 1.02;

export default defineModel({
  id: 'f2:str_t1_aa',
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, stripes({ count: 1, width: 0.12, rot: [0, 90, 0], at: [0, F + 0.005, -0.27] })],
    },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        // Kammsockel: Keilriegel quer (Vorderansicht [x, y]), oben schmal
        extrude({
          profile: [
            [-0.34, F - 0.02],
            [0.34, F - 0.02],
            [0.24, R_TOP],
            [-0.24, R_TOP],
          ],
          depth: 0.3,
          axis: 'z',
          mat: 'chitin',
          keep: true,
          tag: 'neck',
        }),
        // Kammplatte (Team) auf dem Riegel
        extrude({
          profile: [
            [-0.26, -0.13],
            [0.26, -0.13],
            [0.2, 0.13],
            [-0.2, 0.13],
          ],
          depth: 0.03,
          axis: 'y',
          at: [0, R_TOP + 0.01, 0],
          mat: 'team',
          tag: 'neck',
        }),
        // Dornenkamm: 2 senkrechte Dornen (86°), Wurzel in einer Sehnen-Manschette
        ...[1, -1].flatMap((s) => [
          strut({ from: [s * THORN_X, R_TOP - 0.04, 0], to: [s * THORN_X, R_TOP + 0.08, 0], radius: 0.16, sides: 4, caps: 'end', mat: 'sinew', maxLod: 1, tag: 'spike' }),
          spike({ from: [s * THORN_X, R_TOP, 0], to: [s * (THORN_X + 0.05), THORN_TIP, 0.02], radius: 0.13, mat: 'chitin', keep: true, tag: 'spike' }),
        ]),
      ],
    },
  ],
  notes: 'v_aa_struct: Dornenkamm (Yaw), Kruste mit Teamrand.',
});
