/**
 * Posaune (f4:lnd_t2_mml) – Aurith-Raketenwerfer T2.
 *
 * Roster: „Kiel mit einer dicken Spindel (Ø ≥ 2 × Pfeifen-Ø), 50° geneigt, auf Schwenkfuß; ≥ 25° flacher als die
 * Pfeifen, kein Trichter.“
 * faction.md §5.2 Raketenwerfer: eine dicke Spindel, 50° geneigt, auf Schwenkfuß; verboten Trichter, Pfeifen.
 * Winkel-Code: schräg = indirekt. Spindel = sechskantiger Doppelkegel (`bipyramid`), Ø 0,38 WU = 2,2 × Pfeifen-Ø,
 * Bernstein-Kante mit Pechglas-Manschette in einer Gabelwiege. Paartests: Horn↔Posaune (offener Trichter gegen
 * geschlossene Spindel), Posaune↔Pfeife (eine dicke Spindel 50° gegen dünne senkrechte Pfeifen).
 * Maßstab 1,3 eingebacken.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull    – Kiel, Oberschale (Team), Rückenkamm, Glyphenbänder, 2 Tonpunkte
 *   ring    – Schwenkfuß mit Wiege (zwei Wangen), dreht um +Y (PartStream 1)
 *   spindle – Spindel mit Manschette, kippt (PartStream 2)
 */
import { bipyramid, box, defineModel, GLIDE_HEIGHT, mirrorX, torus, type Vec2, type Vec3 } from '@faf/modelkit';
import { swivel } from './lnd_t1_arty.ts';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.04, width: 0.72, height: 0.28, drop: 0.4, cap: { rx: 0.72, rz: 0.72, dz: -0.14 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP + 0.13, 0.08];
const ELEV = 50;
const E = (ELEV * Math.PI) / 180;
const DIR: Vec3 = [0, Math.sin(E), Math.cos(E)];
const along = (d: number): Vec3 => [PIVOT[0], PIVOT[1] + DIR[1] * d, PIVOT[2] + DIR[2] * d];
const SPINDLE_LEN = 1.15;
const SPINDLE_C = 0.36;

const CREST: Vec2[] = [
  [-0.16, 0.36],
  [-0.3, 0.56],
  [-0.46, 0.76],
  [-0.6, 0.8],
  [-0.66, 0.62],
  [-0.58, 0.5],
  [-0.46, 0.3],
  [-0.3, 0.3],
];

export default defineModel({
  id: 'f4:lnd_t2_mml',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST, { depth: 0.2 }), ...shellGlyphs(K.shape, { th1: 44 }), ...toneDots(2, { from: [-0.3, 0.5], dir: [-1, 0.3], depth: 0.2 })],
    },
    {
      name: 'ring',
      pivot: PIVOT,
      anim: 'yaw',
      smooth: true,
      shapes: [
        ...swivel({ at: [0, TOP + 0.02, PIVOT[2]], radius: 0.2 }),
        // Wiege: zwei Pechglas-Wangen links und rechts der Spindel
        mirrorX(box({ size: [0.05, 0.13, 0.13], at: [0.23, PIVOT[1] - 0.06, PIVOT[2]], mat: 'pitch', smooth: false, tag: 'ring' })),
      ],
    },
    {
      name: 'spindle',
      parent: 'ring',
      pivot: PIVOT,
      anim: 'pitch',
      shapes: [
        // Spindel: Doppelkegel, Ø 0,38 WU, 1,15 WU lang, Spitze vorn länger und über den Bug hinaus
        bipyramid({ radius: 0.19, length: SPINDLE_LEN, front: 0.6, sides: 6, axis: 'z', at: along(SPINDLE_C), rot: [-ELEV, 0, 0], mat: 'amberedge', keep: true, tag: 'spindle' }),
        // Manschette (Pechglas) um die dickste Stelle
        torus({ radius: 0.18, tube: 0.045, segments: 6, sides: 3, axis: 'z', at: along(SPINDLE_C - SPINDLE_LEN * 0.1), rot: [-ELEV, 0, 0], mat: 'pitch', maxLod: 1, tag: 'spindle' }),
      ],
    },
  ],
  notes: 'v_mml: Schwenkfuß-Yaw + Spindel-Pitch (2 animierte Parts wie im Roster).',
});
