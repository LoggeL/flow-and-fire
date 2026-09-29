/**
 * Zange (core:lnd_t2_bot) – Varkan-Sturmläufer T2.
 *
 * Roster: „Stichel ×1,3 mit Schürzenplatten und 2 Tech-Streifen.“ Grundform = Stichel (kleine Wanne auf zwei
 * Gussbeinen, Glocke mit waagerechtem Rohr über den Bug); T2-Merkmale: Schürzenplatten über den Hüften, 2 Tech-Streifen,
 * Glut-Gatling (dickeres Rohr mit Kupfer-Trommel an der Mündung), Maßstab 1,3 (eingebacken).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull            – Torso-Wanne, Deckplatte (team), Schürzenplatten links/rechts, Heckkrümmer an der Heckfase,
 *                     2 Tech-Streifen
 *   legs_l / legs_r – Hüftgelenk, Oberschenkel, Unterschenkel, Fuß (Knie vorn), Pivot im Hüftgelenk
 *   turret          – Glocke (team), dreht um +Y
 *   barrel          – Blende + Gatling-Rohr + Kupfer-Trommel, kippt (Pitch)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes, type Shape } from '@faf/modelkit';

const HIP_Y = 0.44;
const LEG_X = 0.31;
const HULL_BOTTOM = 0.4;
const DECK_TOP = 0.68;
const PLATE_TOP = 0.71;
const BELL_Y = PLATE_TOP;
const BELL_Z = 0.08;
const BARREL_Y = 0.86;

/** Ein Gussbein bei x = side·LEG_X (Knie vorn, Fuß flach) – wie Stichel. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    cylinder({ radius: 0.1, height: 0.14, axis: 'x', at: [x, HIP_Y, 0], segments: 6, mat: 'dark', maxLod: 0 }),
    box({ size: [0.14, 0.26, 0.16], at: [x, HIP_Y - 0.1, 0.05], rot: [-22, 0, 0], mat: 'body', maxLod: 1, tag: 'legs' }),
    box({ size: [0.16, 0.24, 0.17], at: [x, 0.16, 0.05], rot: [14, 0, 0], mat: 'dark', maxLod: 1, tag: 'legs' }),
    box({ size: [0.2, 0.07, 0.34], at: [x, 0.035, 0.05], mat: 'dark', maxLod: 1, tag: 'legs' }),
    box({ size: [0.17, HIP_Y, 0.2], at: [x, HIP_Y / 2, 0.05], mat: 'dark', minLod: 2, tag: 'legs' }),
  ];
}

export default defineModel({
  id: 'core:lnd_t2_bot',
  parts: [
    {
      name: 'hull',
      shapes: [
        box({ size: [0.5, 0.12, 0.62], at: [0, HULL_BOTTOM + 0.06, -0.02], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [0.68, DECK_TOP - 0.5, 0.78],
          at: [0, (DECK_TOP + 0.5) / 2, 0],
          bevel: { top: 0.04, topFront: 0.1, topBack: 0.03 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.56, PLATE_TOP - DECK_TOP, 0.66], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.04], mat: 'team' }),
        // Schürzenplatten über den Hüften (T2-Merkmal)
        mirrorX(extrude({ profile: [[-0.32, 0.44], [0.28, 0.44], [0.36, 0.66], [-0.38, 0.66]], depth: 0.05, axis: 'x', at: [0.365, 0, 0], mat: 'body', maxLod: 1, tag: 'hull' })),
        box({ size: [0.5, 0.12, 0.22], at: [0, HIP_Y, 0], mat: 'dark', maxLod: 0 }),
        // Heckkrümmer an der Heckfase + Glutschlitz
        box({ size: [0.6, 0.07, 0.06], at: [0, 0.6, -0.4], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.34, 0.035], at: [0, 0.6, -0.432], rot: [-90, 0, 0], mat: 'glow', maxLod: 1 }),
        stripes({ count: 2, width: 0.46, stripe: 0.09, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.27] }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(-1) },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BELL_Z],
      anim: 'yaw',
      shapes: [
        frustum({ radius: 0.25, radiusTop: 0.235, height: 0.08, at: [0, BELL_Y + 0.04, BELL_Z], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
        sphere({ radius: 0.235, hemi: true, segments: 8, rings: 3, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.08 + 0.082, BELL_Z], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, BELL_Z + 0.18],
      anim: 'pitch',
      shapes: [
        box({ size: [0.22, 0.15, 0.12], at: [0, BARREL_Y, BELL_Z + 0.2], mat: 'body' }),
        // Gatling: dickeres Rohr (Ø 0,18) + Kupfer-Trommel mit Glutmündung
        cylinder({ radius: 0.09, height: 0.46, axis: 'z', at: [0, BARREL_Y, BELL_Z + 0.46], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.115, height: 0.16, axis: 'z', at: [0, BARREL_Y, BELL_Z + 0.66], segments: 6, mat: 'copper', tag: 'barrel' }),
        quad({ size: [0.12, 0.12], at: [0, BARREL_Y, BELL_Z + 0.744], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
});
