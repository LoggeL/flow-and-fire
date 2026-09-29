/**
 * Glimmer (f3:lnd_t1_scout) – Sael-Land-Späher T1 (v_scout).
 *
 * Roster: „Kleinste Schale (Einlage teamfarben) auf Schwebeteller, hohe dünne Nadel ≥ 1,0 × Rumpflänge ohne Kopfteil,
 * Lichtnaht an der Spitze.“
 * faction.md §5.2 Land-Späher: kleinste Schale + hohe dünne Nadel (`mast`), Nadel ≥ 1,0 × Rumpflänge, ohne Kopfteil;
 * verboten: Perle, Ring, Horn. Pflichtpaare Novize↔Glimmer (Nadel gegen Goldsichel), Glimmer↔Muschel (spitze Nadel
 * gegen Mast mit waagerechtem Ring).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,25 WU, +Z = vorn, +X = linke Seite):
 *   hull – Schwebeteller, kleinste Schale 0,60 × 0,20 × 0,90 WU (Perlmuttrand + Emaille), Nadel 1,0 WU
 *          (Perlglanz, Goldfuß) mit Jade-Lichtnaht an der Spitze, 1 Tech-Streifen, Lichtnaht am Heck
 *          (keine animierten Parts)
 */
import { cylinder, defineModel, spike, strut } from '@faf/modelkit';
import { pad, seam, shell, surf, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

const SHELL: ShellSpec = { rx: 0.3, ry: 0.2, rz: 0.45, y0: 0.06, drop: 0.35 };
const NEEDLE_Z = -0.1;
const NEEDLE_Y0 = surf(SHELL, 0, NEEDLE_Z).p[1];
const NEEDLE_H = 1.0; // ≥ 1,0 × Rumpflänge (0,90 WU)
const TIP_H = 0.14;

export default defineModel({
  id: 'f3:lnd_t1_scout',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.33, 0.5),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        // Nadel: dünner, spitz zulaufender Mast ohne Kopfteil, Goldfuß in der Schale
        cylinder({ radius: 0.09, height: 0.08, segments: 6, caps: 'top', at: [0, NEEDLE_Y0 + 0.01, NEEDLE_Z], mat: 'gold', keep: true, tag: 'mast' }),
        strut({ from: [0, NEEDLE_Y0, NEEDLE_Z], to: [0, NEEDLE_Y0 + NEEDLE_H - TIP_H, NEEDLE_Z], radius: 0.065, radiusEnd: 0.04, sides: 5, caps: false, mat: 'lustre', keep: true, tag: 'mast' }),
        // Lichtnaht an der Spitze (Jade, ≤ 2 %)
        spike({ from: [0, NEEDLE_Y0 + NEEDLE_H - TIP_H, NEEDLE_Z], to: [0, NEEDLE_Y0 + NEEDLE_H, NEEDLE_Z], radius: 0.04, sides: 5, mat: 'seam', keep: true, tag: 'seam' }),
        ...techStripes(SHELL, 1, -0.28),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
  ],
  notes: 'v_scout: keine animierten Parts; Nadel als Intel-Mast (Winkel-Code: Mast = Intel). Schwebehöhe 0,25.',
});
