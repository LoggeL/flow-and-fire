/**
 * Seelilie I (f3:str_t1_aa) – Flugabwehrturm T1, 1×1.
 *
 * Roster: „Stachelkranz (3 Stacheln) auf teamfarbenem Kissen-Sockel.“ faction.md §5.2: Flugabwehr-Monopol =
 * Stachelkranz, 3–5 dünne senkrechte Stacheln (≥ 75°) als Bogen quer zur Schussrichtung; verboten: Horn, Perle,
 * einzelner dicker Stachel, Laterne. Paartest Riff↔Seelilie: senkrechte Stacheln ohne Perle gegen Perle mit
 * waagerechter Lanze. Stachel-Ø 0,17 WU (Mindestmaß §3.2).
 * Teamfarbe (§4.2): breites Emaille-Band des Kissens (bei AA-Stellungen trägt der Sockel die Teamfarbe).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull   – Kissen mit breitem Emaille-Band, Perlmutt-Deck, 1 Tech-Streifen
 *   turret – schwebende Perlmutt-Linse mit Jade-Lichtnaht, drei Stacheln (Perlglanz, Goldfuß) im Bogen; Yaw (PartStream 1)
 */
import { cylinder, defineModel, frustum, lens, spike, stripes, type Vec3 } from '@faf/modelkit';
import { kissen } from './str_t1_pd.ts';

const H = 0.16;
const TOP = H + 0.03;
const HUB_Y = TOP + 0.22 + 0.05; // Linse schwebt 0,22 über dem Deck
const HUB_R = 0.25;
/** Stacheln: Fuß [x, z], Spitze [x, y über der Linse, z]; Bogen quer zur Schussrichtung (Mitte vorn, höher). */
const SPINES: readonly { base: [number, number]; tip: Vec3 }[] = [
  { base: [-0.17, -0.03], tip: [-0.27, 0.56, -0.05] },
  { base: [0, 0.04], tip: [0, 0.64, 0.05] },
  { base: [0.17, -0.03], tip: [0.27, 0.56, -0.05] },
];

export default defineModel({
  id: 'f3:str_t1_aa',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...kissen({ size: [0.96, 0.96], height: H, bevel: 0.07, corner: 0.2, rim: 0.085 }),
        stripes({ count: 1, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.24] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, HUB_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // schwebende Perlmutt-Linse (Stachelträger) mit Jade-Lichtnaht am Rand
        lens({ radius: HUB_R, thickness: 0.12, segments: 10, rings: 4, at: [0, HUB_Y, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        cylinder({ radius: HUB_R + 0.004, height: 0.018, segments: 10, caps: false, at: [0, HUB_Y, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        ...SPINES.flatMap(({ base, tip }) => {
          const from: Vec3 = [base[0], HUB_Y + 0.03, base[1]];
          const to: Vec3 = [tip[0], HUB_Y + tip[1], tip[2]];
          return [
            // Stachel Ø 0,17, ≥ 75° (seitlich 80°), Perlglanz
            spike({ from, to, radius: 0.085, sides: 5, mat: 'lustre', keep: true, tag: 'spine' }),
            // Goldfuß (Kante) am Stachelansatz
            frustum({ radius: 0.1, radiusTop: 0.088, height: 0.06, segments: 5, caps: false, at: [from[0], from[1] + 0.03, from[2]], mat: 'gold', maxLod: 1, tag: 'spine' }),
          ];
        }),
      ],
    },
  ],
  notes: 'v_aa_struct: 1 animierter Part (Stachelkranz-Yaw, Roster). Stacheln 80–90° (Winkel-Code senkrecht = Luft).',
});
