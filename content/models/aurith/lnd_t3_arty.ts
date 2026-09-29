/**
 * Heerhorn (f4:lnd_t3_arty) – Aurith-Schwere Artillerie T3.
 *
 * Roster: „Horn ×1,7 auf überlangem Kiel, Doppelkamm, 3 Tonpunkte; kein Kristall.“
 * Gleiche Form wie das Horn (offener Trichter 50° auf Schwenkfuß, Kamm als Gegengewicht), T3-Merkmale (§3.4):
 * überlanger Kiel (1,5 WU), Doppelkamm weit über das Heck, 3 Tonpunkte, größerer Trichter (Öffnung Ø 0,66 WU Basis =
 * 1,12 WU im Spiel). Maßstab 1,7 eingebacken (2×2-Footprint).
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – überlanger Kiel, Oberschale (Team), Doppelkamm, Glyphenbänder, 3 Tonpunkte
 *   ring – Schwenkfuß, dreht um +Y   (PartStream 1)
 *   horn – Trichter mit Innenschale (Pechglas), kippt (PartStream 2)
 */
import { defineModel, GLIDE_HEIGHT, type Vec2, type Vec3 } from '@faf/modelkit';
import { hornShapes, swivel } from './lnd_t1_arty.ts';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const K = keel({ len: 1.5, width: 0.84, height: 0.3, drop: 0.45, cap: { rx: 0.6, rz: 0.62, dz: -0.16 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP + 0.06, 0.12];

/** Doppelkamm als Gegengewicht, weit über das Heck (z = −1,12). */
const CREST: Vec2[] = [
  [-0.2, 0.38],
  [-0.42, 0.58],
  [-0.7, 0.76],
  [-0.96, 0.8],
  [-1.12, 0.68],
  [-1.12, 0.52],
  [-0.94, 0.5],
  [-0.74, 0.34],
  [-0.54, 0.24],
  [-0.32, 0.3],
];
const CREST_X = 0.14;

export default defineModel({
  id: 'f4:lnd_t3_arty',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...crest(CREST, { depth: 0.12, x: CREST_X }),
        ...crest(CREST, { depth: 0.12, x: -CREST_X }),
        ...shellGlyphs(K.shape, { th0: -66, th1: 40 }),
        ...toneDots(3, { from: [-0.62, 0.66], dir: [-1, 0.05], depth: 0.12, x: CREST_X, flanks: [1] }),
        ...toneDots(3, { from: [-0.62, 0.66], dir: [-1, 0.05], depth: 0.12, x: -CREST_X, flanks: [-1] }),
      ],
    },
    { name: 'ring', pivot: PIVOT, anim: 'yaw', smooth: true, shapes: swivel({ at: [PIVOT[0], PIVOT[1] - 0.03, PIVOT[2]], radius: 0.26, tube: 0.06 }) },
    {
      name: 'horn',
      parent: 'ring',
      pivot: PIVOT,
      anim: 'pitch',
      shapes: hornShapes({ neck: [PIVOT[0], PIVOT[1] - 0.02, PIVOT[2] - 0.07], elev: 50, len: 0.74, r0: 0.13, r1: 0.33 }),
    },
  ],
  notes: 'v_arty Stufe 3: überlanger Kiel, Doppelkamm; Schwenkfuß-Yaw + Trichter-Pitch.',
});
