/**
 * Hochlilie (f3:str_t3_sam) – Raketenabwehr T3, 2×2 (Roster-Maßstab xz 2,0 / y 2,8).
 *
 * Roster: „Kissen-Sockel auf 2×2 mit doppelt so vielen, dickeren Stacheln (6), 3 Tech-Streifen.“ faction.md §5.2
 * Seelilie/Hochlilie: Stachelkranz auf teamfarbenem Sockel; Hochlilie mit doppelt so vielen, dickeren Stacheln.
 * Die sechs Stacheln stehen hier als geschlossener Kranz (Seelilie: offener Bogen), leicht nach außen geneigt
 * (≥ 78°), abwechselnd hoch und niedrig – die Krone liest sich auch aus der Draufsicht als Sechserstern.
 * Stachel-Ø 0,36 WU (dicker als Seelilie II, aber schlanker als jede Horn-Mündung).
 *
 * Gebaut in Spielmaßen (WU) über `inGame(2, 2,8)`.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull   – Kissen 2×2 mit breitem Emaille-Band, Perlmutt-Deck, 3 Streifen
 *   turret – schwebende Linse mit Jade-Lichtnaht und Perlmutt-Kuppel, Kranz aus sechs Stacheln; Yaw (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, frustum, lens, spike, stripes, type Shape, type Vec3 } from '@faf/modelkit';
import { inGame, kissen } from './str_t1_pd.ts';

const G = inGame(2.0, 2.8);
const H = 0.3;
const TOP = H + 0.05;
const HUB_Y = TOP + 0.32 + 0.11;
const HUB_R = 0.6;
const RING_R = 0.4; // Stachelfüße

function crown(): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((90 + 60 * i) * Math.PI) / 180; // erster Stachel vorn (+Z)
    const high = i % 2 === 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const from: Vec3 = [RING_R * c, HUB_Y + 0.08, RING_R * s];
    const lean = high ? 0.22 : 0.3;
    const h = high ? 1.5 : 1.2;
    const to: Vec3 = [(RING_R + lean) * c, HUB_Y + h, (RING_R + lean) * s];
    out.push(spike({ from, to, radius: 0.18, sides: 5, mat: 'lustre', keep: true, tag: 'spine' }));
    out.push(frustum({ radius: 0.21, radiusTop: 0.185, height: 0.12, segments: 5, caps: false, at: [from[0], from[1] + 0.06, from[2]], mat: 'gold', maxLod: 1, tag: 'spine' }));
  }
  return out;
}

export default defineModel({
  id: 'f3:str_t3_sam',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: G.wrap([
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.13, corner: 0.42, rim: 0.15, deck: 0.05 }),
        stripes({ count: 3, width: 0.22, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, TOP + 0.052, -0.52] }),
      ]),
    },
    {
      name: 'turret',
      pivot: G.pv([0, HUB_Y, 0]),
      anim: 'yaw',
      smooth: true,
      shapes: G.wrap([
        lens({ radius: HUB_R, thickness: 0.22, segments: 10, rings: 4, at: [0, HUB_Y, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        cylinder({ radius: HUB_R + 0.006, height: 0.035, segments: 10, caps: false, at: [0, HUB_Y, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // flache Perlmutt-Kuppel in der Kranzmitte (Raketenmagazin)
        ellipsoid({ radii: [0.26, 0.2, 0.26], half: true, segments: 6, rings: 2, at: [0, HUB_Y + 0.1 + 0.1, 0], mat: 'lustre', tag: 'shell' }),
        ...crown(),
      ]),
    },
  ],
  notes: 'v_aa_struct T3: 1 animierter Part (Kranz-Yaw). In Spielmaßen gebaut (inGame).',
});
