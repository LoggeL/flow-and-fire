/**
 * Triton (f3:lnd_t2_tank) – Sael-Direktfeuer-Schweber T2 (v_tank, Maßstab 1,3 aus dem Roster).
 *
 * Roster: „Kauri ×1,3, lange Schale, große Perle mit zwei parallelen Lanzen (an der Perle geparentet), seitliche
 * Schalenflügel, 2 Tech-Streifen; ab K10 Schildhülle (Shader).“
 * faction.md §3.4 T2: zweite, parallele Lanze, größere Perle, seitliche Schalenflügel; §5.2 Direktfeuer: Lanzen
 * waagerecht, ≥ 60 % der Rumpflänge, über die Tropfenspitze hinaus. Pflichtpaare: Triton↔Brecher (Lanzen waagerecht
 * gegen Horn-Paar schräg), Konus↔Triton (zwei Lanzen + Flügel gegen eine Langlanze auf schmaler Schale).
 *
 * Basismaß vor dem Maßstab: Schale 0,92 × 0,34 × 1,04 WU, Lanzen 0,79 WU (76 %), Gesamtlänge 1,53 WU (× 1,3 =
 * 1,99 WU ≤ 2 × Footprint-Kante). Die Perle sitzt vor der Mitte und die Schale ist kürzer als zuvor (Review
 * 2026-09-29): nur so ragen die Lanzenspitzen in der Spielkamera (50°) über den Teller hinaus, sonst liest sich der
 * Triton in der Silhouette als runder Klumpen wie der Brecher.
 *
 * Aufbau (y = Boden vor dem Anheben um 0,30 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale (Perlmuttrand + Emaille), zwei Schalenflügel (Perlmutt, Goldkante), 2 Tech-Streifen,
 *            Lichtnaht am Heck
 *   turret – große Perle (Teamfarbe) mit zwei parallelen Lanzen und goldenem Querschaft; dreht um +Y (1 animierter Part)
 */
import { cone, cylinder, defineModel, ellipsoid, mirrorX, sphere } from '@faf/modelkit';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.46, ry: 0.34, rz: 0.52, y0: 0.06, drop: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const ORB_R = 0.26;
const ORB_Y = TOP + 0.11;
const ORB_Z = 0.04; // Perle vor der Mitte: die Lanzenspitzen ragen auch in der Spielkamera über den Teller
const LANCE_Y = ORB_Y - 0.02;
const LANCE_X = 0.11;
const LANCE_Z0 = 0.14;
const LANCE_L = 0.79;

export default defineModel({
  id: 'f3:lnd_t2_tank',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.64, 0.58, -0.02),
        ...shell(SHELL, [
          { to: 31.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // Schalenflügel: flache Perlmutt-Halbschalen an den Flanken, leicht nach außen gekippt
        mirrorX([
          ellipsoid({ radii: [0.13, 0.14, 0.34], half: true, drop: 0.3, segments: 8, rings: 2, at: [0.44, 0.13, -0.06], rot: [0, 0, -12], mat: 'nacre', tag: 'shell' }),
        ]),
        ...techStripes(SHELL, 2, -0.24),
        seam(SHELL, 31.8, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [
        sphere({ radius: ORB_R, segments: 10, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' }),
        // zwei parallele Lanzen, an der Perle geparentet (Spitzen bei z = 0,93, Schale endet bei 0,52)
        mirrorX([cone({ radius: 0.085, height: LANCE_L, segments: 6, axis: 'z', at: [LANCE_X, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' })]),
        // goldener Querschaft vor der Perle, fasst beide Lanzenwurzeln
        cylinder({ radius: 0.075, height: 0.36, segments: 6, axis: 'x', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.02], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_tank T2: Perle Yaw, Lanzen fest an der Perle (1 animierter Part). Schildhülle ab K10 per Shader.',
});
