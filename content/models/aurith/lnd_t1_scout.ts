/**
 * Pfiff (f4:lnd_t1_scout) – Aurith-Kampfspäher T1, Hybrid aus Späher und leichtem Direktfeuer (faction.md §5.3).
 *
 * Roster: „Kleinster Kiel, hoher dünner Mast ≥ 1,0 × Kiellänge, kurze waagerechte Gabel (Primär Direktfeuer
 * ≥ 1,5 × Mast-Ø); Kamm niedriger als der Mast, kein Reif.“
 * Hybrid-Regel: beide Monopol-Merkmale – Mast (Intel, sekundär, Ø 0,11 WU) und kurze Gabel (Direktfeuer, primär,
 * Zinken-Ø 0,17 WU = 1,5 × Mast-Ø). Paartests: Pfiff↔Chorist (Mast + Gabel gegen Perlglas-Kuppel + Sichel),
 * Pfiff↔Triller (halb so langer Kiel, Mast statt hohem Kamm), Pfiff↔Stille (Mast ohne Reif).
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – Kiel 0,95 × 0,62 WU (Bernstein, Oberschale Team), niedriger Kamm, Horchmast 1,0 WU mit Kopf-Linse,
 *          Glyphenbänder, 1 Tonpunkt
 *   fork – Drehfuß mit kurzer Gabel (Zinken 0,5 WU), dreht um +Y (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, GLIDE_HEIGHT, lens, type Vec2 } from '@faf/modelkit';
import { crest, forkTines, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 0.95, width: 0.62, height: 0.25, drop: 0.45, cap: { rx: 0.66, rz: 0.7, dz: -0.1 } });
const TOP = K.shape.capTop;
const TURRET_Z = 0.14;
const MAST_Z = -0.2;
const MAST_TOP = 1.34;

/** Niedriger Kamm: bleibt weit unter dem Mastkopf, läuft über das Heck aus. */
const CREST: Vec2[] = [
  [-0.02, 0.3],
  [-0.2, 0.46],
  [-0.4, 0.58],
  [-0.58, 0.58],
  [-0.7, 0.46],
  [-0.62, 0.4],
  [-0.46, 0.22],
  [-0.2, 0.26],
];

export default defineModel({
  id: 'f4:lnd_t1_scout',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...crest(CREST, { depth: 0.18 }),
        // Horchmast: dünner Pechglas-Stab (Länge 1,0 WU ≥ Kiellänge), Bernstein-Linse als Kopf
        cylinder({ radius: 0.055, height: MAST_TOP - 0.3, segments: 5, caps: false, at: [0, (MAST_TOP + 0.3) / 2, MAST_Z], mat: 'pitch', keep: true, tag: 'mast' }),
        ellipsoid({ radii: [0.1, 0.13, 0.1], segments: 6, rings: 4, at: [0, MAST_TOP, MAST_Z], mat: 'amberedge', smooth: true, keep: true, tag: 'mast' }),
        ...shellGlyphs(K.shape, { phi: 60, th0: -55, th1: 40, width: 0.05, pattern: [0.14, -0.05, 0.05, -0.05, 0.18, -0.08] }),
        ...toneDots(1, { from: [-0.48, 0.44], depth: 0.18 }),
      ],
    },
    {
      name: 'fork',
      pivot: [0, TOP, TURRET_Z],
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.16, thickness: 0.11, segments: 8, rings: 2, at: [0, TOP, TURRET_Z], mat: 'pitch', smooth: true, tag: 'lens' }),
        // kurze Gabel: 0,5 WU, ragt 0,16 WU über die Kielspitze (z = 0,475)
        ...forkTines({ y: TOP + 0.05, z0: 0.14, len: 0.5, gap: 0.23, bridge: 0.1 }),
      ],
    },
  ],
  notes: 'v_scout: Hybrid Mast + kurze Gabel; Gabel-Yaw als einziger animierter Part.',
});
