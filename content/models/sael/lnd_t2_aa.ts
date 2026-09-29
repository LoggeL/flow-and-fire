/**
 * Seestern (f3:lnd_t2_aa) – Sael-Flugabwehr-Schweber T2 (v_aa, Maßstab 1,3 aus dem Roster).
 *
 * Roster: „Seeigel ×1,3 mit 4 Stacheln im Kranz und Schalenflügeln, 2 Tech-Streifen.“
 * faction.md §5.2 Flugabwehr: 3–5 dünne senkrechte Stacheln (≥ 75°) als Bogen quer zur Fahrtrichtung, kein Horn,
 * keine Perle. Pflichtpaar Brecher↔Seestern: vier dünne Stacheln senkrecht gegen zwei dicke Hörner schräg.
 *
 * Aufbau (y = Boden vor dem Anheben um 0,30 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale (Perlmuttrand + Emaille), zwei Schalenflügel, 2 Tech-Streifen, Lichtnaht
 *   turret – Stachelkranz mit vier Stacheln (`spineCrown` aus dem Seeigel), dreht um +Y (1 animierter Part)
 */
import { defineModel, ellipsoid, mirrorX } from '@faf/modelkit';
import { spineCrown } from './lnd_t1_aa.ts';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.44, ry: 0.3, rz: 0.58, y0: 0.06, drop: 0.3 };
const CROWN = spineCrown(
  SHELL,
  [
    { x: -0.28, h: 0.58, lean: 13 },
    { x: -0.09, h: 0.7, lean: 4 },
    { x: 0.09, h: 0.7, lean: 4 },
    { x: 0.28, h: 0.58, lean: 13 },
  ],
  -0.02,
  0.34,
);

export default defineModel({
  id: 'f3:lnd_t2_aa',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.63, 0.64),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // Schalenflügel: flache Perlmutt-Halbschalen an den Flanken
        mirrorX([ellipsoid({ radii: [0.13, 0.13, 0.36], half: true, drop: 0.3, segments: 8, rings: 2, at: [0.43, 0.125, -0.06], rot: [0, 0, -12], mat: 'nacre', tag: 'shell' })]),
        ...techStripes(SHELL, 2, -0.3),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    { name: 'turret', pivot: CROWN.pivot, anim: 'yaw', smooth: true, shapes: CROWN.shapes },
  ],
  notes: 'v_aa T2: Stachelkranz Yaw (1 animierter Part). Schwebehöhe 0,30 aus dem Roster.',
});
