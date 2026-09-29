/**
 * Konus (f3:lnd_t3_sniper) – Sael-Präzisionsschweber T3 (v_sniper, Maßstab 1,4 = Deckel für 1×1-Footprint).
 *
 * Roster: „Schmale, lange Schale, Perle mit extrem langer Lanze (≥ 1,4 × Rumpflänge), keine zweite Lanze;
 * Maßstab 1,4 (1×1-Deckel).“
 * faction.md §5.2 Präzisionsschweber: Perle mit extrem langer Lanze, schmale lange Schale, verboten: zweite Lanze.
 * Pflichtpaar Konus↔Triton: eine Langlanze auf schmaler Kegelschale gegen zwei kurze Lanzen mit Schalenflügeln.
 *
 * Schale wie eine Kegelschnecke: stark tropfenförmig (drop 0,55), 0,56 × 0,26 × 0,76 WU. Lanze 1,07 WU = 1,4 ×
 * Rumpflänge, die Wurzel steckt in der Perle; Gesamtlänge 1,41 WU (× 1,4 = 1,97 WU ≤ 2 × Footprint-Kante).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,35 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Kegelschale (Perlmuttrand + Emaille), 3 Tech-Streifen, Lichtnaht am Heck
 *   turret – Perle (Teamfarbe), dreht um +Y                                     (PartStream 1)
 *   barrel – Langlanze (Perlglanz) mit goldenem Schaft, kippt (Pitch)            (PartStream 2)
 */
import { cone, cylinder, defineModel, sphere } from '@faf/modelkit';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.28, ry: 0.26, rz: 0.38, y0: 0.06, drop: 0.55 };
const TOP = SHELL.y0 + SHELL.ry;
const ORB_R = 0.16;
const ORB_Y = TOP + 0.08;
const ORB_Z = 0.03;
const LANCE_Y = ORB_Y - 0.01;
const LANCE_Z0 = -0.08; // Wurzel in der Perle
const LANCE_L = 1.07;

export default defineModel({
  id: 'f3:lnd_t3_sniper',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.31, 0.42),
        ...shell(SHELL, [
          { to: 31.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // kurze Schale: Streifen 0,07 WU im Abstand 0,05 WU, damit alle drei hinter der Perle liegen
        ...techStripes(SHELL, 3, -0.1, 0.86, 0.12, 0.07),
        seam(SHELL, 31.8, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 10, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, LANCE_Y, ORB_Z + 0.1],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Langlanze: Spitze bei z = 0,99, Schalenbug bei 0,38
        cone({ radius: 0.08, height: LANCE_L, segments: 6, axis: 'z', at: [0, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        cylinder({ radius: 0.095, height: 0.2, segments: 6, axis: 'z', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.06], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_sniper: Perle Yaw, Langlanze Pitch (2 animierte Parts). Schwebehöhe 0,35 aus dem Roster.',
});
