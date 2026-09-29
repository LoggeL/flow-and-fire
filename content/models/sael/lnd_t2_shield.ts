/**
 * Muschel (f3:lnd_t2_shield) – Sael-Mobilschild T2 (v_shield_mobile, Maßstab 1,3 aus dem Roster).
 *
 * Roster: „Mast mit waagerechtem Ring (Ø ≥ 1,2 × Rumpfbreite) als höchstem Punkt, darunter zwei aufgeklappte
 * Schalenhälften; keine Lanze, keine Perle.“
 * faction.md §5.2 Mobiler Schild: `mast` mit waagerechtem Ring als höchstem Punkt, darunter zwei aufgeklappte
 * Schalenhälften; verboten: Lanze, Perle. §5.1 Nr. 5: Ring = Schild. Pflichtpaar Glimmer↔Muschel: Ring oben und
 * aufgeklappte Hälften gegen eine spitze Nadel.
 *
 * Basismaß vor dem Maßstab: Schale 0,84 × 0,28 × 1,16 WU, Ring Ø 1,18 WU außen (1,4 × Rumpfbreite).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,30 WU, +Z = vorn, +X = linke Seite):
 *   hull – Schwebeteller, Schale (Perlmuttrand + Emaille), zwei aufgeklappte Perlmutt-Schalenhälften links und rechts
 *          des Mastes (45° nach außen geklappt), Mast (Perlglanz, Goldfuß), 2 Tech-Streifen, Lichtnaht
 *   ring – waagerechter Ring (Teamfarbe) mit goldenem Quersteg auf der Mastspitze, dreht um +Y (1 animierter Part)
 */
import { cylinder, defineModel, ellipsoid, mirrorX, strut, torus } from '@faf/modelkit';
import { pad, seam, shell, surf, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.42, ry: 0.28, rz: 0.58, y0: 0.06, drop: 0.3 };
const MAST_Z = -0.04;
const MAST_Y0 = surf(SHELL, 0, MAST_Z).p[1];
const RING_Y = MAST_Y0 + 0.66;
const RING_R = 0.5;

export default defineModel({
  id: 'f3:lnd_t2_shield',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.47, 0.64),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // zwei aufgeklappte Schalenhälften: am Mastfuß angeschlagen, 45° nach außen geklappt, Wölbung außen oben
        mirrorX([ellipsoid({ radii: [0.24, 0.13, 0.32], half: true, segments: 8, rings: 2, rot: [0, 0, -45], at: [0.2, MAST_Y0 + 0.16, MAST_Z], mat: 'nacre', keep: true, tag: 'shell' })]),
        cylinder({ radius: 0.09, height: 0.08, segments: 6, caps: 'top', at: [0, MAST_Y0 + 0.01, MAST_Z], mat: 'gold', keep: true, tag: 'mast' }),
        strut({ from: [0, MAST_Y0, MAST_Z], to: [0, RING_Y, MAST_Z], radius: 0.065, radiusEnd: 0.05, sides: 5, caps: 'end', mat: 'lustre', keep: true, tag: 'mast' }),
        ...techStripes(SHELL, 2, -0.3),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, MAST_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [
        torus({ radius: RING_R, tube: 0.09, segments: 12, sides: 3, at: [0, RING_Y, MAST_Z], mat: 'enamel', keep: true, tag: 'ring' }),
        // goldener Quersteg: trägt den Ring auf der Mastspitze
        cylinder({ radius: 0.04, height: 2 * RING_R, segments: 4, axis: 'x', at: [0, RING_Y, MAST_Z], mat: 'gold', maxLod: 1, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_shield_mobile: Ring Yaw (1 animierter Part). Schildkuppel per Shader. Schwebehöhe 0,30 aus dem Roster.',
});
