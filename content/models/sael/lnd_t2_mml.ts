/**
 * Brecher (f3:lnd_t2_mml) – Sael-Raketenschweber T2 (v_mml, Maßstab 1,3 aus dem Roster).
 *
 * Roster: „Horn-Paar nebeneinander (50°, an einem Drehkranz), Mündungen ≥ 2 × Stachel-Ø; keine Perle, keine Stacheln.“
 * faction.md §5.2 Artillerie: T2-Raketen = Horn-Paar nebeneinander. Pflichtpaare Brecher↔Seestern (zwei dicke
 * Schräghörner gegen vier dünne senkrechte Stacheln), Triton↔Brecher (schräg gegen waagerecht). Keine Gegenschale:
 * das unterscheidet ihn zusätzlich von Dünung und Woge.
 *
 * Aufbau (y = Boden vor dem Anheben um 0,30 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale 0,92 × 0,32 × 1,20 WU (Perlmuttrand + Emaille), 2 Tech-Streifen, Lichtnaht
 *   turret – breiter Drehkranz (Emaille), dreht um +Y                                     (PartStream 1)
 *   barrel – Horn-Paar 50° (`horn` aus der Dünung) mit goldenem Joch, kippt gemeinsam (PartStream 2)
 */
import { cylinder, defineModel, type Vec3 } from '@faf/modelkit';
import { horn } from './lnd_t1_arty.ts';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.46, ry: 0.32, rz: 0.6, y0: 0.06, drop: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const KRANZ_H = 0.07;
const ROOT: Vec3 = [0, TOP + KRANZ_H, 0.04];
const HORN_X = 0.21;
const HORN = { length: 0.6, r0: 0.09, r1: 0.19 };

export default defineModel({
  id: 'f3:lnd_t2_mml',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.51, 0.66),
        ...shell(SHELL, [
          { to: 20, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        ...techStripes(SHELL, 2, -0.3),
        seam(SHELL, 20, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, TOP, ROOT[2]],
      anim: 'yaw',
      smooth: true,
      shapes: [cylinder({ radius: 0.24, height: KRANZ_H + 0.05, segments: 8, caps: 'top', scale: [1.25, 1, 1], at: [0, TOP + (KRANZ_H - 0.05) / 2, ROOT[2]], mat: 'enamel', keep: true, tag: 'mast' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: ROOT,
      anim: 'pitch',
      smooth: true,
      shapes: [
        ...horn({ ...HORN, root: [HORN_X, ROOT[1] - 0.03, ROOT[2]] }),
        ...horn({ ...HORN, root: [-HORN_X, ROOT[1] - 0.03, ROOT[2]] }),
        // goldenes Joch: verbindet die Hornwurzeln, Achse des gemeinsamen Pitch
        cylinder({ radius: 0.06, height: 2 * HORN_X, segments: 6, axis: 'x', at: [0, ROOT[1], ROOT[2]], mat: 'gold', keep: true, tag: 'horn' }),
      ],
    },
  ],
  notes: 'v_mml: Drehkranz Yaw, Horn-Paar Pitch (2 animierte Parts; horn_rechts folgt horn_links im selben Part).',
});
