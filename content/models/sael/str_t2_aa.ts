/**
 * Seelilie II (f3:str_t2_aa) – Flakturm T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4).
 *
 * Roster: „Seelilie ×1,3 mit 4 Stacheln und Schürzenschale, 2 Tech-Streifen.“ Gleiche Grundform wie Seelilie I
 * (teamfarbenes Kissen, schwebende Linse, Stachelbogen quer zur Schussrichtung); T2 = vier Stacheln, seitliche
 * Schürzenschalen (§3.4), 2 Streifen. Stacheln bleiben dünn (Ø 0,26 WU, höchstens halb so dick wie eine
 * Horn-Mündung), damit die Rolle nicht mit Artillerie verwechselt wird.
 *
 * Gebaut in Spielmaßen (WU) über `inGame(2, 2,4)`.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull   – Kissen 2×2 mit breitem Emaille-Band, Schürzenschalen (Team) links/rechts, 2 Streifen
 *   turret – schwebende Linse mit Jade-Lichtnaht, vier Stacheln im Bogen; Yaw (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, frustum, lens, mirrorX, spike, stripes, type Vec3 } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';

const G = inGame(2.0, 2.4);
const H = 0.3;
const TOP = H + 0.05;
const HUB_Y = TOP + 0.28 + 0.1;
const HUB_R = 0.52;
const SPINES: readonly { base: [number, number]; tip: Vec3 }[] = [
  { base: [-0.4, -0.08], tip: [-0.62, 1.12, -0.14] },
  { base: [-0.14, 0.06], tip: [-0.2, 1.3, 0.1] },
  { base: [0.14, 0.06], tip: [0.2, 1.3, 0.1] },
  { base: [0.4, -0.08], tip: [0.62, 1.12, -0.14] },
];

export default defineModel({
  id: 'f3:str_t2_aa',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.13, corner: 0.42, rim: 0.15, deck: 0.05 }),
        // Schürzenschalen (T2): flache, nach außen gekippte Schalenflügel, Emaille (Teamfarbe)
        mirrorX(ellipsoid({ radii: [0.2, 0.12, 0.56], half: true, drop: 0.3, segments: 6, rings: 2, rot: [0, 0, -14], at: [0.5, TOP + 0.08, -0.05], mat: 'enamel', tag: 'shell' })),
        stripes({ count: 2, width: 0.22, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, TOP + 0.052, -0.5] }),
      ]),
    },
    {
      name: 'turret',
      pivot: G.pv([0, HUB_Y, 0]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([
        lens({ radius: HUB_R, thickness: 0.2, segments: 10, rings: 4, at: [0, HUB_Y, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        cylinder({ radius: HUB_R + 0.006, height: 0.03, segments: 10, caps: false, at: [0, HUB_Y, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        ...SPINES.flatMap(({ base, tip }) => {
          const from: Vec3 = [base[0], HUB_Y + 0.05, base[1]];
          const to: Vec3 = [tip[0], HUB_Y + tip[1], tip[2]];
          return [
            spike({ from, to, radius: 0.13, sides: 5, mat: 'lustre', keep: true, tag: 'spine' }),
            frustum({ radius: 0.155, radiusTop: 0.135, height: 0.1, segments: 5, caps: false, at: [from[0], from[1] + 0.05, from[2]], mat: 'gold', maxLod: 1, tag: 'spine' }),
          ];
        }),
      ]),
    },
  ],
  notes: 'v_aa_struct T2: 1 animierter Part (Stachelkranz-Yaw). In Spielmaßen gebaut (inGame).',
});
