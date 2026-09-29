/**
 * Diskant (f4:lnd_t3_sniper) – Aurith-Präzisionsläufer T3.
 *
 * Roster: „Schlankes Dreibein, Gabel mit extrem langen, eng stehenden Zinken (≥ 1,2 × Rumpflänge), schmaler Kamm;
 * Maßstab 1,4 (1×1-Deckel), 3 Tonpunkte.“
 * faction.md §5.2 Präzisionsläufer: Gabel mit extrem langen Zinken auf schlankem Dreibein, eng stehende Zinken, kein
 * breiter Kamm. Zinken 0,74 WU = 1,54 × Torsolänge (0,48 WU), Zinkenabstand 0,17 WU (fast geschlossen), Kamm 0,14 WU
 * dünn. Beine länger und dünner als beim Brüller (Hüfte 0,84 WU). Paartest Diskant↔Brüller: hohes, schlankes Dreibein
 * mit Nadelgabel gegen gedrungenes Dreibein mit breiter Gabel. Maßstab 1,4 eingebacken (Basis ≤ 1,43 WU).
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite):
 *   hull   – Becken (Pechglas)
 *   legs_l / legs_r / legs_b – Dreibein (PartStream 1–3, legs)
 *   torso  – schlanker Kiel-Torso, Oberschale (Team), schmaler Kamm, Glyphenbänder, 3 Tonpunkte; Yaw (PartStream 4)
 *   fork   – Nadelgabel, kippt (PartStream 5)
 */
import { defineModel, ellipsoid, type Vec2 } from '@faf/modelkit';
import { tripod, walkerTorso } from './lnd_t2_bot.ts';
import { crest, forkTines, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

const HIP_Y = 0.84;
const TORSO_Y = 1.02;
const T = walkerTorso({ radii: [0.18, 0.15, 0.24], at: [0, TORSO_Y, 0], cap: [0.16, 0.08, 0.22], segments: 8 });
const FORK_Y = 1.03;

/** Schmaler Kamm: hoch und kurz, nach hinten ausgezogen. */
const CREST: Vec2[] = [
  [0.0, 1.1],
  [-0.12, 1.26],
  [-0.26, 1.38],
  [-0.42, 1.44],
  [-0.5, 1.34],
  [-0.44, 1.22],
  [-0.3, 1.1],
  [-0.12, 1.04],
];

export default defineModel({
  id: 'f4:lnd_t3_sniper',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [ellipsoid({ radii: [0.17, 0.11, 0.16], segments: 8, rings: 2, at: [0, HIP_Y, -0.02], mat: 'pitch', keep: true, maxLod: 1, tag: 'keel' })],
    },
    ...tripod({ front: [0.12, HIP_Y, 0.04], footOut: 0.31, splay: 6, backHip: [0, HIP_Y, -0.08], backFoot: [0, 0.029, -0.45], radius: [0.08, 0.07, 0.06], kneeBack: 0.24, footY: 0.029 }),
    {
      name: 'torso',
      pivot: [0, HIP_Y, 0],
      anim: 'yaw',
      shapes: [...T.shapes, ...crest(CREST, { depth: 0.14 }), ...shellGlyphs(T.shape, { phi: 72, th0: -50, th1: 40, width: 0.05 }), ...toneDots(3, { from: [-0.08, 1.12], dir: [-1, 0.55], depth: 0.14, size: 0.1 })],
    },
    {
      name: 'fork',
      parent: 'torso',
      pivot: [0, FORK_Y, 0.2],
      anim: 'pitch',
      // Nadelgabel: 0,74 WU lang, Zinkenabstand 0,17 WU
      shapes: forkTines({ y: FORK_Y, z0: 0.1, len: 0.74, gap: 0.17, r: 0.058, bridge: 0.1 }),
    },
  ],
  notes: 'v_sniper: Dreibein (3 Bein-Parts), Torso-Yaw, Gabel-Pitch; ein Modell für beide Feuermodi.',
});
