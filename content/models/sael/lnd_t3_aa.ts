/**
 * Diadem (f3:lnd_t3_aa) – Sael-Flugabwehr-Schweber T3 (v_aa, Maßstab 1,4 = Deckel für 1×1-Footprint).
 *
 * Roster: „Seeigel ×1,4 (1×1-Deckel) mit 5 Stacheln im Kranz, 3 Tech-Streifen.“
 * faction.md §5.2 Flugabwehr: 3–5 dünne senkrechte Stacheln (≥ 75°) als Bogen quer zur Fahrtrichtung. Fünf
 * Stacheln mit nach außen fallender Höhe bilden das Diadem; die Stachelzahl wächst mit der Stufe (3/4/5).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,35 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale 0,92 × 0,30 × 1,24 WU (Perlmuttrand + Emaille), 3 Tech-Streifen, Lichtnaht
 *   turret – Stachelkranz mit fünf Stacheln (`spineCrown` aus dem Seeigel), dreht um +Y (1 animierter Part)
 */
import { defineModel } from '@faf/modelkit';
import { spineCrown } from './lnd_t1_aa.ts';
import { pad, seam, shell, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.46, ry: 0.3, rz: 0.62, y0: 0.06, drop: 0.3 };
const CROWN = spineCrown(
  SHELL,
  [
    { x: -0.34, h: 0.52, lean: 15 },
    { x: -0.17, h: 0.64, lean: 8 },
    { x: 0, h: 0.74, lean: 0 },
    { x: 0.17, h: 0.64, lean: 8 },
    { x: 0.34, h: 0.52, lean: 15 },
  ],
  0.02,
  0.4,
);

export default defineModel({
  id: 'f3:lnd_t3_aa',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.51, 0.68),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        ...techStripes(SHELL, 3, -0.16),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    { name: 'turret', pivot: CROWN.pivot, anim: 'yaw', smooth: true, shapes: CROWN.shapes },
  ],
  notes: 'v_aa T3: Stachelkranz Yaw (1 animierter Part). Schwebehöhe 0,35 aus dem Roster.',
});
