/**
 * Riff II (f3:str_t2_pd) – Punktverteidigung T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4).
 *
 * Roster: „Riff ×1,3 mit zwei parallelen Lanzen (an der Perle geparentet) und Schürzenschale, 2 Tech-Streifen.“
 * Gleiche Grundform wie Riff I (Kissen, Wiege, schwebende Perle mit waagerechter Lanze); T2 liest man an der größeren
 * Perle, dem Lanzenpaar, den seitlichen Schürzenschalen (§3.4 „seitliche Schalenflügel“) und 2 Streifen.
 * Einzelschuss-Präzision (600 / 4 s): die Lanzen sind länger als bei Riff I.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(2, 2,4)`: runde Teile bleiben nach dem Roster-Maßstab rund.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kissen 2×2, Perlmutt-Wiege, zwei Schürzenschalen (Team) links/rechts, 2 Streifen
 *   turret – schwebende Perle (Team) mit zwei parallelen Lanzen (Perlglanz, Goldschaft) und Jade-Lichtnaht; Yaw (PartStream 1)
 */
import { cone, cylinder, defineModel, ellipsoid, mirrorX, sphere, stripes } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';

const G = inGame(2.0, 2.4);
const H = 0.3; // Sockelkante
const TOP = H + 0.05; // Deck
const ORB_R = 0.4;
const ORB_Z = -0.18;
const ORB_Y = TOP + 0.14 + 0.24 + ORB_R; // Wiege 0,14 hoch, Perle schwebt 0,24 darüber
const LANCE_L = 1.05;
const LANCE_X = 0.17;
const LANCE_Z0 = ORB_Z + ORB_R * 0.55;

export default defineModel({
  id: 'f3:str_t2_pd',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.13, corner: 0.42, rim: 0.05, deck: 0.05 }),
        // Perlmutt-Wiege unter der Perle
        ellipsoid({ radii: [0.36, 0.14, 0.36], half: true, segments: 8, rings: 2, at: [0, TOP + 0.07, ORB_Z], mat: 'nacre', tag: 'shell' }),
        // Schürzenschalen (T2): flache, nach außen gekippte Schalenflügel neben der Wiege, Emaille (Teamfarbe)
        mirrorX(ellipsoid({ radii: [0.24, 0.12, 0.6], half: true, drop: 0.3, segments: 6, rings: 2, rot: [0, 0, -14], at: [0.54, TOP + 0.08, -0.1], mat: 'enamel', tag: 'shell' })),
        // 2 Tech-Streifen (Tiefjade) hinten auf dem Deck
        stripes({ count: 2, width: 0.22, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, TOP + 0.052, -0.66] }),
      ]),
    },
    {
      name: 'turret',
      pivot: G.pv([0, ORB_Y, ORB_Z]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([
        sphere({ radius: ORB_R, segments: 10, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' }),
        // zwei parallele Lanzen Ø 0,26 (Perlglanz) mit Goldschaft, waagerecht, an der Perle geparentet
        mirrorX(cone({ radius: 0.13, height: LANCE_L, segments: 6, axis: 'z', at: [LANCE_X, ORB_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' })),
        mirrorX(cylinder({ radius: 0.155, height: 0.22, segments: 6, caps: 'top', axis: 'z', at: [LANCE_X, ORB_Y, ORB_Z + ORB_R + 0.06], mat: 'gold', keep: true, tag: 'lance' })),
        // Jade-Lichtnähte an den Lanzenwurzeln
        mirrorX(cylinder({ radius: 0.15, height: 0.04, axis: 'z', segments: 6, caps: false, at: [LANCE_X, ORB_Y, ORB_Z + ORB_R * 0.93], mat: 'seam', maxLod: 0, tag: 'seam' })),
      ]),
    },
  ],
  notes: 'v_pd T2: 1 animierter Part (Perlen-Yaw, Lanzen fest an der Perle, Roster). In Spielmaßen gebaut (inGame).',
});
