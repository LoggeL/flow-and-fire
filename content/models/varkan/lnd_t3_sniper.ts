/**
 * Reißnadel (core:lnd_t3_sniper) – Varkan-Präzisionsläufer T3.
 *
 * Roster: „Schlanke Beine, Glocke mit extrem langem waagerechtem Rohr (≥ 1,2 × Rumpflänge), kein zweites Rohr;
 * Maßstab 1,4 (1×1-Deckel).“ Rollen-Monopol Sniper-Bot (faction.md §5.2). Rumpf 0,72 WU, Rohr 0,90 WU ab Glockenmitte
 * (1,25×), ragt 0,70 WU über den Bug. Schlanke, hohe Vogelbeine (Knie nach hinten) unterscheiden die Reißnadel von der
 * Stichel-Familie (Tempo am Fahrwerk). Maßstab 1,4 eingebacken; Länge samt Rohr 1,42 × 1,4 = 1,99 WU (≤ 200 %).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull            – schmale Torso-Wanne mit Bugfase, Deckplatte (team), Heckkrümmer + Glutschlitz, 3 Tech-Streifen
 *   legs_l / legs_r – schlanke Vogelbeine (Oberschenkel nach hinten, Lauf nach vorn, Fuß)
 *   turret          – kleine Glocke (team) mit Kupfer-Gegengewicht hinten, dreht um +Y
 *   barrel          – Blende + Langrohr + Kupfer-Mündungsbremse, kippt (Pitch)
 */
import { beveledBox, box, cylinder, defineModel, frustum, quad, sphere, stripes, type Shape } from '@faf/modelkit';

const HIP_Y = 0.62;
const LEG_X = 0.25;
const HIP_Z = -0.06;
const HULL_BOTTOM = 0.58;
const DECK_TOP = 0.82;
const PLATE_TOP = 0.85;
const BELL_Y = PLATE_TOP;
const BELL_Z = 0.14;
const BELL_R = 0.19;
const BARREL_Y = BELL_Y + 0.12;
const MUZZLE_Z = 0.97;

/** Schlankes Vogelbein bei x = side·LEG_X: Knie hinten, Knöchel unter der Hüfte. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    cylinder({ radius: 0.08, height: 0.12, axis: 'x', at: [x, HIP_Y, HIP_Z], segments: 6, mat: 'dark', maxLod: 0 }),
    box({ size: [0.11, 0.34, 0.12], at: [x, 0.475, HIP_Z - 0.068], rot: [25, 0, 0], mat: 'body', maxLod: 1, tag: 'legs' }),
    box({ size: [0.11, 0.32, 0.11], at: [x, 0.195, HIP_Z - 0.068], rot: [-26, 0, 0], mat: 'dark', maxLod: 1, tag: 'legs' }),
    box({ size: [0.16, 0.06, 0.28], at: [x, 0.03, HIP_Z + 0.03], mat: 'dark', maxLod: 1, tag: 'legs' }),
    box({ size: [0.12, HIP_Y, 0.14], at: [x, HIP_Y / 2, HIP_Z - 0.04], mat: 'dark', minLod: 2, tag: 'legs' }),
  ];
}

export default defineModel({
  id: 'core:lnd_t3_sniper',
  parts: [
    {
      name: 'hull',
      shapes: [
        box({ size: [0.42, 0.1, 0.5], at: [0, HULL_BOTTOM + 0.05, -0.05], mat: 'dark', maxLod: 1, tag: 'hull' }),
        beveledBox({
          size: [0.6, DECK_TOP - 0.64, 0.72],
          at: [0, (DECK_TOP + 0.64) / 2, -0.04],
          bevel: { top: 0.04, topFront: 0.1, topBack: 0.03 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.5, PLATE_TOP - DECK_TOP, 0.6], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.07], mat: 'team' }),
        box({ size: [0.44, 0.1, 0.18], at: [0, HIP_Y, HIP_Z], mat: 'dark', maxLod: 0 }),
        // Heckkrümmer an der Heckfase + Glutschlitz
        box({ size: [0.5, 0.06, 0.05], at: [0, 0.75, -0.4], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.26, 0.03], at: [0, 0.75, -0.427], rot: [-90, 0, 0], mat: 'glow', maxLod: 1 }),
        stripes({ count: 3, width: 0.42, stripe: 0.08, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.2] }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, HIP_Z], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, HIP_Z], anim: 'legs', shapes: leg(-1) },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BELL_Z],
      anim: 'yaw',
      shapes: [
        frustum({ radius: BELL_R + 0.01, radiusTop: BELL_R - 0.005, height: 0.07, at: [0, BELL_Y + 0.035, BELL_Z], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
        sphere({ radius: BELL_R - 0.005, hemi: true, segments: 8, rings: 3, scale: [1, 0.75, 1], at: [0, BELL_Y + 0.07 + 0.069, BELL_Z], mat: 'team', tag: 'bell' }),
        // Kupfer-Gegengewicht hinter der Glocke (balanciert das Langrohr)
        box({ size: [0.2, 0.1, 0.12], at: [0, BELL_Y + 0.08, BELL_Z - BELL_R - 0.03], mat: 'copper', maxLod: 1 }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, BELL_Z + 0.14],
      anim: 'pitch',
      shapes: [
        box({ size: [0.17, 0.12, 0.12], at: [0, BARREL_Y, BELL_Z + 0.17], mat: 'body', maxLod: 1 }),
        cylinder({ radius: 0.062, height: MUZZLE_Z - 0.06 - (BELL_Z + 0.2), axis: 'z', at: [0, BARREL_Y, (MUZZLE_Z - 0.06 + BELL_Z + 0.2) / 2], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
        // Mündungsbremse (Kupfer, kantig)
        box({ size: [0.17, 0.12, 0.12], at: [0, BARREL_Y, MUZZLE_Z - 0.06], mat: 'copper', tag: 'barrel' }),
        quad({ size: [0.08, 0.08], at: [0, BARREL_Y, MUZZLE_Z + 0.004], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
});
