/**
 * Grollen (f4:lnd_t3_tank) – Aurith-Belagerungsgleiter T3, Hybrid Direktfeuer + Indirektfeuer (faction.md §5.3).
 *
 * Roster: „Überlanger Kiel, Gabel mit aufgesetztem kleinem Trichter (Primär Gabel ≥ 1,5 × Trichterlänge),
 * Doppelkamm, 3 Tonpunkte; kein Kristall.“
 * Hybrid-Regel: Gabel (primär, Zinken 0,9 WU) und kleiner Trichter (sekundär, 0,34 WU, 50°) tragen je ihre feste
 * Bedeutung; T3-Merkmale (§3.4): überlanger Kiel (1,5 WU), Doppelkamm, 3 Tonpunkte. Maßstab 1,7 eingebacken
 * (2×2-Footprint: Basis ≤ 2,35 WU). Paartest Grollen↔Heuler: Doppelkamm, Trichter auf der Gabel, gestreckter Kiel.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – überlanger Kiel, Oberschale (Team), Doppelkamm (Team), Glyphenbänder, 3 Tonpunkte
 *   fork – Drehfuß mit Gabel, dreht um +Y (PartStream 1)
 *   horn – kleiner Trichter auf dem Gabelsteg, kippt (PartStream 2)
 */
import { defineModel, GLIDE_HEIGHT, lens, type Vec2, type Vec3 } from '@faf/modelkit';
import { hornShapes } from './lnd_t1_arty.ts';
import { crest, forkTines, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.5, width: 0.76, height: 0.28, drop: 0.5, cap: { rx: 0.62, rz: 0.7, dz: -0.1 } });
const TOP = K.shape.capTop;
const TURRET_Z = 0.3;
const FORK_Y = TOP + 0.07;
const HORN_PIVOT: Vec3 = [0, FORK_Y + 0.06, TURRET_Z];

/** Doppelkamm: zwei parallele Kämme, lang und flach, Schweif bei z = −1,02. */
const CREST: Vec2[] = [
  [0.1, 0.36],
  [-0.12, 0.58],
  [-0.42, 0.8],
  [-0.72, 0.9],
  [-0.94, 0.82],
  [-1.02, 0.62],
  [-0.88, 0.56],
  [-0.72, 0.36],
  [-0.46, 0.26],
  [-0.1, 0.34],
];
const CREST_X = 0.13;

export default defineModel({
  id: 'f4:lnd_t3_tank',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...crest(CREST, { depth: 0.12, x: CREST_X }),
        ...crest(CREST, { depth: 0.12, x: -CREST_X }),
        ...shellGlyphs(K.shape, { th0: -66, th1: 44 }),
        ...toneDots(3, { from: [-0.5, 0.64], dir: [-1, 0.2], depth: 0.12, x: CREST_X, flanks: [1] }),
        ...toneDots(3, { from: [-0.5, 0.64], dir: [-1, 0.2], depth: 0.12, x: -CREST_X, flanks: [-1] }),
      ],
    },
    {
      name: 'fork',
      pivot: [0, TOP, TURRET_Z],
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.22, thickness: 0.13, segments: 8, rings: 2, at: [0, TOP, TURRET_Z], mat: 'pitch', smooth: true, tag: 'lens' }),
        // Gabel (primär): Zinken 0,9 WU, ragen 0,43 WU über die Kielspitze (z = 0,75)
        ...forkTines({ y: FORK_Y, z0: 0.28, len: 0.9, gap: 0.3, r: 0.075, bridge: 0.16 }),
      ],
    },
    {
      name: 'horn',
      parent: 'fork',
      pivot: HORN_PIVOT,
      anim: 'pitch',
      // kleiner Trichter (sekundär): 0,34 WU lang, Öffnung Ø 0,3 WU, 50° – Gabel 2,6 × so lang
      shapes: hornShapes({ neck: HORN_PIVOT, elev: 50, len: 0.34, r0: 0.07, r1: 0.15, segments: 6 }),
    },
  ],
  notes: 'v_tank Stufe 3: Hybrid Gabel + Trichter, Doppelkamm; Gabel-Yaw + Trichter-Pitch.',
});
