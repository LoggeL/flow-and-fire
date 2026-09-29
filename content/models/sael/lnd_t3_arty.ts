/**
 * Woge (f3:lnd_t3_arty) – Sael-Artillerie-Schweber T3 (v_arty, Maßstab 1,7, Footprint 2×2 aus dem Roster).
 *
 * Roster: „Dünung ×1,7 mit überlanger Schale, 3 Tech-Streifen.“
 * faction.md §3.4 T3: überlange Schale statt neuer Form; §5.2 Artillerie: Horn 50° mittig, Heck-Gegenschale, keine
 * Perle, keine waagerechte Lanze, keine Stacheln. Das Horn sitzt etwas vor der Mitte, damit die lange Heckschale mit
 * drei Streifen und Gegenschale frei bleibt.
 *
 * Basismaß vor dem Maßstab: Schale 0,96 × 0,34 × 1,76 WU (Dünung 1,24), Gesamtlänge 1,94 WU (× 1,7 = 3,30 WU auf 2×2).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,35 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, überlange Schale (Perlmuttrand + Emaille), Heck-Gegenschale, 3 Tech-Streifen, Lichtnaht
 *   turret – Drehkranz (Emaille), dreht um +Y                                            (PartStream 1)
 *   barrel – Horn 50° (`horn` aus der Dünung), kippt (Pitch)                   (PartStream 2)
 */
import { cylinder, defineModel, type Vec3 } from '@faf/modelkit';
import { counterShell, horn } from './lnd_t1_arty.ts';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.48, ry: 0.34, rz: 0.88, y0: 0.06, drop: 0.35 };
const TOP = SHELL.y0 + SHELL.ry;
const KRANZ_H = 0.07;
const HORN_Z = 0.12;
const ROOT: Vec3 = [0, TOP + KRANZ_H, HORN_Z];

export default defineModel({
  id: 'f3:lnd_t3_arty',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.53, 0.97),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        counterShell(SHELL, 1.1),
        ...techStripes(SHELL, 3, -0.08),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, TOP, HORN_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [cylinder({ radius: 0.19, height: KRANZ_H + 0.05, segments: 8, caps: 'top', at: [0, TOP + (KRANZ_H - 0.05) / 2, HORN_Z], mat: 'enamel', keep: true, tag: 'mast' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: ROOT,
      anim: 'pitch',
      smooth: true,
      shapes: horn({ root: [0, ROOT[1] - 0.04, ROOT[2]], length: 0.78, r0: 0.12, r1: 0.26 }),
    },
  ],
  notes: 'v_arty T3: Drehkranz Yaw, Horn Pitch (2 animierte Parts). Schwebehöhe 0,35 aus dem Roster.',
});
