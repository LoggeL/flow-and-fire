/**
 * Languste (f3:lnd_t2_bot) – Sael-Läufer T2 (v_bot, Maßstab 1,3 aus dem Roster).
 *
 * Roster: „Knallkrebs ×1,3 mit zweiter paralleler Lanze und seitlichen Schalenflügeln, 2 Tech-Streifen.“
 * faction.md §3.4 T2: zweite, parallele Lanze, seitliche Schalenflügel; §3.2 Läufer: Schild breiter als lang, spitze
 * Beine (3 Paare), kein Schwebeteller. Die beiden Lanzen stehen wie die Fühler der Languste nach vorn.
 *
 * Basismaß vor dem Maßstab: Schild 0,96 × 0,25 × 0,80 WU, Füße auf 1,44 WU Spur (× 1,3 = 1,87 WU ≤ 2 × Footprint).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull            – Rückenschild (Goldrand + Emaille), zwei Schalenflügel (Perlmutt) über den Beinwurzeln,
 *                     2 Tech-Streifen, Lichtnaht am Heck
 *   legs_l / legs_r – je drei spitze Krebsbeine (`crabLegs` aus dem Knallkrebs)
 *   turret          – Perle (Teamfarbe), dreht um +Y                             (PartStream 1)
 *   barrel          – zwei parallele Lanzen mit goldenem Querschaft, kippen      (PartStream 2)
 */
import { cone, cylinder, defineModel, ellipsoid, mirrorX, sphere } from '@faf/modelkit';
import { crabLegs } from './lnd_t1_bot.ts';
import { seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.48, ry: 0.25, rz: 0.4, y0: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const HIP_Y = 0.33;
const LEGS = crabLegs({
  hips: [
    [0.26, HIP_Y, 0.21],
    [0.29, HIP_Y, 0],
    [0.26, HIP_Y, -0.21],
  ],
  footOut: 0.44,
  kneeUp: 0.3,
  radius: 0.065,
});
const ORB_R = 0.2;
const ORB_Y = TOP + 0.05;
const ORB_Z = 0.08;
const LANCE_Y = ORB_Y - 0.02;
const LANCE_X = 0.1;
const LANCE_Z0 = 0.16;
const LANCE_L = 0.62;

export default defineModel({
  id: 'f3:lnd_t2_bot',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...shell(SHELL, [
          { to: 10, bands: [1, 1, 1], mat: 'gold' },
          { to: 90, bands: [2, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // Schalenflügel: flache Perlmutt-Halbschalen seitlich auf dem Schildrand, nach außen geneigt
        mirrorX([ellipsoid({ radii: [0.14, 0.12, 0.3], half: true, segments: 6, rings: 2, at: [0.44, 0.36, -0.03], rot: [0, 0, -18], mat: 'nacre', tag: 'shell' })]),
        ...techStripes(SHELL, 2, -0.16, 0.8),
        seam(SHELL, 10, 10, 6, 8),
      ],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', smooth: true, shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', smooth: true, shapes: LEGS.right },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 8, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, LANCE_Y, ORB_Z + 0.1],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // zwei parallele Lanzen (Fühler), Spitzen bei z = 0,78, Schild endet bei 0,40
        mirrorX([cone({ radius: 0.075, height: LANCE_L, segments: 6, axis: 'z', at: [LANCE_X, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' })]),
        cylinder({ radius: 0.065, height: 0.32, segments: 6, axis: 'x', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.01], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_bot T2: Perle Yaw, Lanzenpaar Pitch; Beine als legs_l/legs_r (Anim-Regel „max. 2“ offen).',
});
