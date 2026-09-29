/**
 * Sintflut (f3:str_t3_arty) – Schwere Artilleriestellung T3, 8×8 (Roster-Maßstab xz 4,0 / y 4,67).
 *
 * Roster: „Brandungs-Silhouette auf 8×8: Lafette, Horn Ø 3,0 WU × 7 WU, Gegenschale; 3 Tech-Streifen.“
 * faction.md §5.2 Brandung/Sintflut: großes Horn auf Lafette, Pflicht Gegenschale; verboten Perle, Laterne.
 * Gleiche Grundform wie die Brandung (Kissen, Lafettenkuppel in Teamfarbe, goldener Wiegenbügel, Gegenschale,
 * Horn 50°); T3 = riesiger Maßstab, zusätzliche flache Lafettenschale unter der Kuppel, 3 Streifen.
 * Paartest Sintflut↔Laterne III: schräges Horn mit weiter Mündung gegen stehende Laternen.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(4, 4,67)`: Horn exakt Ø 3,0 × 7,0 WU und 50° nach dem Maßstab.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull – Kissen 8×8 (Emaille-Band), flache Lafettenschale (Perlmutt) mit Lichtnaht, 3 Streifen
 *   boom – Lafette: Kuppel (Team), Wiegenbügel (Gold), Gegenschale (Perlmutt); Yaw (PartStream 1)
 *   horn – Horn Ø 3,0 × 7,0 WU mit Goldkante, dunklem Schlund und Lichtnaht; Pitch (PartStream 2)
 */
import { arcPoints, defineModel, ellipsoid, glyphStrip, stripes } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';
import { horn, lafette } from './str_t2_arty.ts';

const G = inGame(4.0, 4.67);
const H = 0.7;
const TOP = H;
const LZ = -0.7;
const SHELL_H = 0.5;
const BASE_Y = TOP + SHELL_H * 0.7;
const PIV_Y = BASE_Y + 1.9;

export default defineModel({
  id: 'f3:str_t3_arty',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [7.9, 7.9], height: H, bevel: 0.32, corner: 1.7, rim: 0.42, deck: 0, round: 1 }),
        // flache Lafettenschale (Perlmutt) unter der Drehkuppel, Jade-Lichtnaht hinten am Rand
        ellipsoid({ radii: [2.5, SHELL_H, 2.5], half: true, segments: 10, rings: 2, at: [0, TOP + SHELL_H / 2, LZ], mat: 'nacre', keep: true, tag: 'shell' }),
        glyphStrip({ path: arcPoints(2.55, 210, 330, 6, 'y', [0, TOP + 0.02, LZ]), width: 0.2, pattern: [0.8, -0.45], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        stripes({ count: 3, width: 0.36, stripe: 0.36, gap: 0.36, rot: [0, 90, 0], at: [0, TOP + 0.01, -3.42] }),
      ]),
    },
    {
      name: 'boom',
      pivot: G.pv([0, BASE_Y, LZ]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap(lafette({ base: [0, BASE_Y - 0.1, LZ], domeR: 2.2, domeH: 1.1, pivotY: PIV_Y, yoke: 1.35, yokeTube: 0.28, counter: [1.6, 1.25, 0.75], counterZ: 1.65 })),
    },
    {
      name: 'horn',
      parent: 'boom',
      pivot: G.pv([0, PIV_Y, LZ]),
      anim: 'pitch',
      smooth: true,
      shapes: G.wrap(horn({ pivot: [0, PIV_Y, LZ], throat: 0.55, mouth: 1.5, length: 7.0, back: 1.5 })),
    },
  ],
  notes: 'v_arty_struct T3: Lafette-Yaw + Horn-Pitch. Horn Ø 3,0 × 7,0 WU, 50°. In Spielmaßen gebaut (inGame).',
});
