/**
 * Warte II (f3:str_t2_radar) – Radar T2, 2×2 (Roster-Maßstab xz 1,0 / y 1,2; Upgrade von Warte I).
 *
 * Roster: „Warte auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.“ Gleiche Grundform wie Warte I (Kissen,
 * Fußschale, Fächer 1,6 × 0,8 WU, 35° gekippt); T2 = zwei Masten, oben durch einen goldenen Bogen verbunden (keine
 * rechten Winkel), höher, 2 Streifen. Kein Ring.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(1, 1,2)`: der Fächer steht nach dem Maßstab exakt 35° gekippt.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen, Fußschale mit Lichtnaht, Doppelmast (Perlglanz) mit Goldbogen, 2 Streifen
 *   fan  – Lager + Fächer (Team) mit Goldleiste und Rippen; Yaw (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, frustum, lens, mirrorX, stripes, torusArc } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';
import { fan } from './str_t1_radar.ts';

const G = inGame(1.0, 1.2);
const H = 0.24;
const TOP = H + 0.04;
const MAST_X = 0.2;
const MAST_TOP = 2.6; // Oberkante der Masten
const ARCH_R = MAST_X;
const PIV_Y = MAST_TOP + ARCH_R + 0.06;

export default defineModel({
  id: 'f3:str_t2_radar',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.1, corner: 0.42, rim: 0.1, deck: 0.04, round: 1 }),
        ellipsoid({ radii: [0.5, 0.22, 0.44], half: true, segments: 8, rings: 2, at: [0, TOP + 0.11, 0], mat: 'nacre', tag: 'shell' }),
        cylinder({ radius: 0.47, height: 0.03, segments: 8, caps: false, scale: [1, 1, 0.44 / 0.47], at: [0, TOP + 0.02, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // Doppelmast, oben durch einen goldenen Halbbogen verbunden
        mirrorX(frustum({ radius: 0.12, radiusTop: 0.085, height: MAST_TOP - TOP - 0.15, segments: 6, caps: false, at: [MAST_X, (MAST_TOP + TOP + 0.15) / 2, 0], mat: 'lustre', keep: true, tag: 'mast' })),
        torusArc({ radius: ARCH_R, tube: 0.075, arc: 180, startDeg: 180, segments: 6, sides: 3, axis: 'z', at: [0, MAST_TOP, 0], mat: 'gold', keep: true, tag: 'mast' }),
        stripes({ count: 2, width: 0.2, stripe: 0.12, gap: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.66] }),
      ]),
    },
    {
      name: 'fan',
      pivot: G.pv([0, PIV_Y, 0]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([lens({ radius: 0.15, thickness: 0.12, segments: 8, rings: 2, at: [0, PIV_Y, 0], mat: 'gold', keep: true, tag: 'mast' }), fan([0, PIV_Y + 0.06, 0.05])]),
    },
  ],
  notes: 'v_radar T2: 1 animierter Part (Fächer-Yaw). In Spielmaßen gebaut (inGame).',
});
