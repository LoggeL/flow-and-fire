/**
 * Perlmutt III (f3:str_t3_shield) – Schildgenerator T3, 6×6 (Roster-Maßstab xz 1,0 / y 1,17; Upgrade von
 * Perlmutt II).
 *
 * Roster: „Perlmutt auf 6×6 (Höhe ×1,4) mit zweitem Ring und Schürzenschale, 3 Tech-Streifen.“ Gleiche Grundform
 * wie Perlmutt II (Kissen, Fußschale, Mast, Emitter-Ring Ø 5,2 als höchster Punkt); T3 = zweiter, kleinerer
 * Goldring darunter (schwebt frei um den Mast), Schürzenschalen links/rechts der Fußschale, höher, 3 Streifen.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(1, 1,17)`.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 6×6, Fußschale mit Lichtnaht, zwei Schürzenschalen, Mast, 3 Streifen
 *   ring – Emitter-Ring (Team) mit Nabe und Speichen + zweiter Ring (Gold); Yaw (PartStream 1)
 */
import { defineModel, ellipsoid, frustum, glyphStrip, arcPoints, mirrorX, stripes, torus } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';
import { emitter } from './str_t2_shield.ts';

const G = inGame(1.0, 1.17);
const H = 0.38;
const TOP = H;
const FOOT_H = 0.56;
const RING_Y = 4.0;
const RING2_Y = 2.75;

export default defineModel({
  id: 'f3:str_t3_shield',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [5.9, 5.9], height: H, bevel: 0.16, corner: 1.2, rim: 0.3, deck: 0, round: 1 }),
        ellipsoid({ radii: [1.55, FOOT_H, 1.55], half: true, segments: 8, rings: 2, at: [0, TOP + FOOT_H / 2, 0], mat: 'nacre', tag: 'shell' }),
        // Schürzenschalen (T3-Zusatz): flache Schalenflügel links/rechts der Fußschale, Emaille (Teamfarbe)
        mirrorX(ellipsoid({ radii: [0.7, 0.26, 1.5], half: true, drop: 0.25, segments: 6, rings: 2, rot: [0, 0, -12], at: [2.0, TOP + 0.14, 0], mat: 'enamel', tag: 'shell' })),
        // Jade-Lichtnaht: gestrichelter Bogen am hinteren Fußschalenrand
        glyphStrip({ path: arcPoints(1.62, 200, 340, 6, 'y', [0, TOP + 0.01, 0]), width: 0.12, pattern: [0.34, -0.2], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        frustum({ radius: 0.34, radiusTop: 0.2, height: RING_Y - TOP - FOOT_H + 0.1, segments: 6, caps: false, at: [0, (RING_Y + TOP + FOOT_H - 0.1) / 2, 0], mat: 'lustre', keep: true, tag: 'mast' }),
        stripes({ count: 3, width: 0.3, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, H + 0.005, -2.0] }),
      ]),
    },
    {
      name: 'ring',
      pivot: G.pv([0, RING_Y, 0]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([
        ...emitter(RING_Y, { r: 2.6, tube: 0.21, hub: 0.42, sides: 3, segments: 10 }),
        // zweiter Ring (Gold), schwebt frei um den Mast
        torus({ radius: 1.7, tube: 0.15, segments: 8, sides: 3, at: [0, RING2_Y, 0], mat: 'gold', keep: true, tag: 'ring' }),
      ]),
    },
  ],
  notes: 'v_shield T3: 1 animierter Part (beide Ringe drehen gemeinsam). In Spielmaßen gebaut (inGame).',
});
