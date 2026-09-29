/**
 * Einsiedler (f3:lnd_t3_bot) – Sael-Läufer T3 (v_bot, Maßstab 1,7, Footprint 2×2 aus dem Roster).
 *
 * Roster: „Überbreiter Rückenschild auf Beinen, Perle mit zwei Lanzen, obenauf eine gewundene Schale (Schild-Emitter
 * ab K10), 3 Tech-Streifen; keine zweite Perle (Budget).“
 * faction.md §3.3/§5.2 Läufer: vier Beinpaare beim Einsiedler, Pflicht: gewundene Schale auf dem Rücken; verboten:
 * Schwebeteller. Pflichtpaar (T4) Karkinos↔Einsiedler: hier kein Riesenmaß, sondern die Wendelschale als Merkmal.
 *
 * Basismaß vor dem Maßstab: Schild 1,24 × 0,26 × 0,88 WU (überbreit), Füße auf 1,76 WU Spur (× 1,7 = 2,99 WU auf
 * 2×2), Wendelschale 0,55 WU hoch auf dem hinteren Schild.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull            – Rückenschild (Goldrand + Emaille), gewundene Schale (Perlmutt, Spitze nach hinten oben),
 *                     3 Tech-Streifen, Lichtnaht am Heck
 *   legs_l / legs_r – je vier spitze Krebsbeine (`crabLegs`, LOD0 3-kantig wegen Budget)
 *   turret          – Perle (Teamfarbe) vorn auf dem Schild, dreht um +Y        (PartStream 1)
 *   barrel          – zwei parallele Lanzen mit goldenem Querschaft, kippen     (PartStream 2)
 */
import { cone, cylinder, defineModel, mirrorX, sphere, sweep, type Vec3 } from '@faf/modelkit';
import { crabLegs } from './lnd_t1_bot.ts';
import { seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.62, ry: 0.26, rz: 0.44, y0: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const HIP_Y = 0.33;
const LEGS = crabLegs({
  hips: [
    [0.3, HIP_Y, 0.27],
    [0.34, HIP_Y, 0.09],
    [0.34, HIP_Y, -0.09],
    [0.3, HIP_Y, -0.27],
  ],
  footOut: 0.54,
  splay: 0.35,
  kneeUp: 0.32,
  radius: 0.07,
  sides: 3,
});
const ORB_R = 0.2;
const ORB_Y = TOP + 0.04;
const ORB_Z = 0.16;
const LANCE_Y = ORB_Y - 0.02;
const LANCE_X = 0.1;
const LANCE_Z0 = 0.24;
const LANCE_L = 0.6;

/** Wendelschale: Querschnitt schrumpft entlang einer steigenden Schraube (1¼ Windungen), Spitze hinten oben. */
const WHORL: Vec3[] = [];
const WHORL_R: number[] = [];
for (let i = 0; i <= 4; i++) {
  const t = i / 4;
  const a = ((200 + 450 * t) * Math.PI) / 180;
  const rr = 0.19 * (1 - 0.85 * t);
  WHORL.push([rr * Math.cos(a), TOP - 0.08 + 0.52 * t, -0.18 - 0.16 * t + rr * Math.sin(a)]);
  WHORL_R.push(0.25 * (1 - 0.85 * t));
}

export default defineModel({
  id: 'f3:lnd_t3_bot',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...shell(SHELL, [
          { to: 10, bands: [1, 1, 1], mat: 'gold' },
          { to: 90, bands: [2, 2, 1], mat: 'enamel' },
        ], 'shell', [10, 7, 6]),
        // gewundene Schale (Schild-Emitter ab K10) auf dem hinteren Schild
        sweep({ path: WHORL, radius: WHORL_R, samples: 7, sides: 5, caps: 'start', mat: 'nacre', keep: true, tag: 'shell' }),
        // Streifen seitlich der Wendelschale sichtbar (die Schale deckt nur die Mitte)
        ...techStripes(SHELL, 3, -0.06, 0.86, 0.17, 0.09),
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
        // zwei parallele Lanzen, Spitzen bei z = 0,84, Schild endet bei 0,44
        mirrorX([cone({ radius: 0.075, height: LANCE_L, segments: 6, axis: 'z', at: [LANCE_X, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' })]),
        cylinder({ radius: 0.065, height: 0.32, segments: 4, axis: 'x', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.01], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_bot T3: Perle Yaw, Lanzenpaar Pitch; Beine als legs_l/legs_r (Anim-Regel „max. 2“ offen). Schildhülle ab K10.',
});
