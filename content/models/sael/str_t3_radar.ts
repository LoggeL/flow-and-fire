/**
 * Warte III (f3:str_t3_radar) – Radar T3, 2×2 (Roster-Maßstab xz 1,0 / y 1,4; Upgrade von Warte II).
 *
 * Roster: „Warte auf 2×2 (Höhe ×1,4) mit zweitem Fächer, 3 Tech-Streifen.“ Gleiche Grundform wie Warte II
 * (Doppelmast mit Goldbogen); T3 = zweiter Fächer, beide als Dach (Λ) gegeneinander gestellt (von oben ein
 * volles Oval statt eines Halbkreises), noch höher, 3 Streifen. Kein Ring.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(1, 1,4)`.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen, Fußschale mit Lichtnaht, Doppelmast mit Goldbogen und Goldringen, 3 Streifen
 *   fan  – Lager, Goldsteg, zwei Fächer (Team) als Dach; Yaw (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, frustum, lens, mirrorX, strut, stripes, torusArc } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';
import { fan } from './str_t1_radar.ts';

const G = inGame(1.0, 1.4);
const H = 0.26;
const TOP = H + 0.04;
const MAST_X = 0.22;
const MAST_TOP = 3.0;
const ARCH_R = MAST_X;
const PIV_Y = MAST_TOP + ARCH_R + 0.06;

export default defineModel({
  id: 'f3:str_t3_radar',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.1, corner: 0.42, rim: 0.1, deck: 0.04, round: 1 }),
        ellipsoid({ radii: [0.54, 0.24, 0.46], half: true, segments: 8, rings: 2, at: [0, TOP + 0.12, 0], mat: 'nacre', tag: 'shell' }),
        cylinder({ radius: 0.5, height: 0.03, segments: 8, caps: false, scale: [1, 1, 0.46 / 0.5], at: [0, TOP + 0.02, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        mirrorX(frustum({ radius: 0.13, radiusTop: 0.09, height: MAST_TOP - TOP - 0.15, segments: 6, caps: false, at: [MAST_X, (MAST_TOP + TOP + 0.15) / 2, 0], mat: 'lustre', keep: true, tag: 'mast' })),
        torusArc({ radius: ARCH_R, tube: 0.08, arc: 180, startDeg: 180, segments: 6, sides: 3, axis: 'z', at: [0, MAST_TOP, 0], mat: 'gold', keep: true, tag: 'mast' }),
        stripes({ count: 3, width: 0.2, stripe: 0.12, gap: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.66] }),
      ]),
    },
    {
      name: 'fan',
      pivot: G.pv([0, PIV_Y, 0]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([
        lens({ radius: 0.16, thickness: 0.12, segments: 8, rings: 2, at: [0, PIV_Y, 0], mat: 'gold', keep: true, tag: 'mast' }),
        // zwei Fächer als Dach (Λ): Standkanten vorn/hinten, Oberkanten treffen sich über dem Mast
        fan([0, PIV_Y + 0.06, 0.46], { ribs: false }),
        fan([0, PIV_Y + 0.06, -0.46], { back: true, ribs: false }),
        strut({ from: [0, PIV_Y + 0.06, -0.46], to: [0, PIV_Y + 0.06, 0.46], radius: 0.06, sides: 4, caps: false, mat: 'gold', keep: true, maxLod: 1, tag: 'fan' }),
      ]),
    },
  ],
  notes: 'v_radar T3: 1 animierter Part (Doppelfächer-Yaw). In Spielmaßen gebaut (inGame).',
});
