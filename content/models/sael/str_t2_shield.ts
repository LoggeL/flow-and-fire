/**
 * Perlmutt II (f3:str_t2_shield) – Schildgenerator T2, 6×6.
 *
 * Roster: „Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), flache Fußschale.“ faction.md §5.2 Perlmutt:
 * `mast` mit waagerechtem Ring als höchstem Punkt, verboten: Fächer. Paartest Warte↔Perlmutt: Ring gegen Fächer.
 * Ring Ø 5,0 WU (0,83 × Kante), Teamfarbe; er dreht sich langsam um den Mast (Yaw) und hängt an drei goldenen
 * Speichen an einer Perlmutt-Nabe. Kein Goldkern (kein Flow-Gebäude), Jade-Lichtnaht am Rand der Fußschale.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 6×6 (Emaille-Band), flache Perlmutt-Fußschale mit Lichtnaht, Perlglanz-Mast, 2 Streifen
 *   ring – Nabe (Perlmutt), drei Goldspeichen, Emitter-Ring (Team, Ø 5,0); Yaw (PartStream 1)
 *
 * Exportiert `emitter()` für Perlmutt III.
 */
import { cylinder, defineModel, ellipsoid, frustum, lens, strut, stripes, torus, type Shape } from '@faf/modelkit';
import { kissen } from './str_t1_pd.ts';

/** Emitter-Ring mit Nabe und drei Speichen um den Mittelpunkt [0, y, 0]. */
export function emitter(y: number, o: { readonly r: number; readonly tube: number; readonly hub: number; readonly segments?: number; readonly sides?: number }): Shape[] {
  const out: Shape[] = [
    torus({ radius: o.r, tube: o.tube, segments: o.segments ?? 12, sides: o.sides ?? 4, at: [0, y, 0], mat: 'enamel', keep: true, tag: 'ring' }),
    lens({ radius: o.hub, thickness: o.tube * 1.4, segments: 8, rings: 2, at: [0, y, 0], mat: 'nacre', keep: true, tag: 'ring' }),
  ];
  for (let i = 0; i < 3; i++) {
    const a = ((90 + 120 * i) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push(strut({ from: [o.hub * 0.8 * c, y, o.hub * 0.8 * s], to: [(o.r - o.tube * 0.6) * c, y, (o.r - o.tube * 0.6) * s], radius: 0.07, sides: 3, caps: false, mat: 'gold', maxLod: 1, tag: 'ring' }));
  }
  return out;
}

const H = 0.36;
const TOP = H;
const FOOT_H = 0.5;
const RING_Y = 3.3;

export default defineModel({
  id: 'f3:str_t2_shield',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...kissen({ size: [5.9, 5.9], height: H, bevel: 0.16, corner: 1.2, rim: 0.3, deck: 0, round: 1 }),
        // flache Perlmutt-Fußschale, Jade-Lichtnaht am Rand
        ellipsoid({ radii: [1.5, FOOT_H, 1.5], half: true, segments: 10, rings: 2, at: [0, TOP + FOOT_H / 2, 0], mat: 'nacre', tag: 'shell' }),
        cylinder({ radius: 1.505, height: 0.05, segments: 10, caps: false, at: [0, TOP + 0.04, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // Mast (Perlglanz), schlank bis unter den Ring
        frustum({ radius: 0.32, radiusTop: 0.2, height: RING_Y - TOP - FOOT_H + 0.1, segments: 6, caps: false, at: [0, (RING_Y + TOP + FOOT_H - 0.1) / 2, 0], mat: 'lustre', keep: true, tag: 'mast' }),
        stripes({ count: 2, width: 0.3, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, H + 0.005, -2.0] }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: emitter(RING_Y, { r: 2.5, tube: 0.2, hub: 0.42 }),
    },
  ],
  notes: 'v_shield: 1 animierter Part (Ring-Yaw). Ring Ø 5,0 = 0,83 × Kante, höchster Punkt.',
});
