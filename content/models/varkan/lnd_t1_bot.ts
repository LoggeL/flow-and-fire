/**
 * Stichel (core:lnd_t1_bot) – Varkan-Leichter Sturmläufer T1.
 *
 * Roster: „Kleine Wanne auf Beinen, Glocke mit kurzem waagerechtem Rohr.“ Rollen-Monopol Direktfeuer (faction.md
 * §5.2): Glocke mit waagerechtem Rohr, Rohr ≥ 60 % der Rumpflänge (0,50 von 0,78 WU), ragt über den Bug. Tempo am
 * Fahrwerk (§5.1 Nr. 3): zwei gedrungene Gussbeine statt Ketten. Grundform der Bot-Familie (Zange T2, Fallhammer T3).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull            – Torso-Wanne (unten dunkel, gefastes Deck), Deckplatte (team), Heckkrümmer + Glutschlitze,
 *                     Hüftblock, 1 Tech-Streifen
 *   legs_l / legs_r – Hüftgelenk, Oberschenkel, Unterschenkel, Fuß (Knie nach vorn), Pivot im Hüftgelenk
 *   turret          – Glocke (team), dreht um +Y
 *   barrel          – Blende + Rohr + Kupfermündung, kippt (Pitch)
 */
import { beveledBox, box, cylinder, defineModel, frustum, quad, sphere, stripes, type Shape } from '@faf/modelkit';

const HIP_Y = 0.44;
const LEG_X = 0.31;
const HULL_BOTTOM = 0.4;
const DECK_TOP = 0.68;
const PLATE_TOP = 0.71;
const BELL_Y = PLATE_TOP;
const BARREL_Y = 0.86;

/** Ein Gussbein bei x = side·LEG_X (Knie vorn, Fuß flach). */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    cylinder({ radius: 0.1, height: 0.14, axis: 'x', at: [x, HIP_Y, 0], segments: 6, mat: 'dark', maxLod: 0 }),
    box({ size: [0.14, 0.26, 0.16], at: [x, HIP_Y - 0.1, 0.05], rot: [-22, 0, 0], mat: 'body', maxLod: 1, tag: 'legs' }),
    box({ size: [0.16, 0.24, 0.17], at: [x, 0.16, 0.05], rot: [14, 0, 0], mat: 'dark', maxLod: 1, tag: 'legs' }),
    box({ size: [0.2, 0.07, 0.34], at: [x, 0.035, 0.05], mat: 'dark', maxLod: 1, tag: 'legs' }),
    // LOD2: ein Block pro Bein
    box({ size: [0.17, HIP_Y, 0.2], at: [x, HIP_Y / 2, 0.05], mat: 'dark', minLod: 2, tag: 'legs' }),
  ];
}

export default defineModel({
  id: 'core:lnd_t1_bot',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Torso-Wanne: dunkler Unterbau + gefastes Deck
        box({ size: [0.5, 0.12, 0.62], at: [0, HULL_BOTTOM + 0.06, -0.02], mat: 'dark', tag: 'hull' }),
        beveledBox({
          size: [0.68, DECK_TOP - 0.5, 0.78],
          at: [0, (DECK_TOP + 0.5) / 2, 0],
          bevel: { top: 0.04, topFront: 0.1, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        beveledBox({ size: [0.56, PLATE_TOP - DECK_TOP, 0.58], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.03], bevel: { top: 0.01 }, mat: 'team' }),
        // Hüftblock zwischen den Beinen
        box({ size: [0.5, 0.12, 0.22], at: [0, HIP_Y, 0], mat: 'dark', maxLod: 0 }),
        // Heckkrümmer mit Glutschlitzen
        box({ size: [0.64, 0.07, 0.1], at: [0, DECK_TOP + 0.035, -0.34], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.34, 0.035], at: [0, DECK_TOP + 0.074, -0.34], mat: 'glow', maxLod: 1 }),
        stripes({ count: 1, width: 0.46, at: [0, PLATE_TOP + 0.004, -0.23] }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(-1) },
    {
      name: 'turret',
      pivot: [0, BELL_Y, 0.02],
      anim: 'yaw',
      shapes: [
        frustum({ radius: 0.25, radiusTop: 0.235, height: 0.08, at: [0, BELL_Y + 0.04, 0.02], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
        sphere({ radius: 0.235, hemi: true, segments: 8, rings: 3, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.08 + 0.082, 0.02], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, 0.2],
      anim: 'pitch',
      shapes: [
        box({ size: [0.2, 0.13, 0.12], at: [0, BARREL_Y, 0.22], mat: 'body' }),
        cylinder({ radius: 0.07, height: 0.5, axis: 'z', at: [0, BARREL_Y, 0.5], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.088, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.72], segments: 6, mat: 'copper', tag: 'barrel' }),
        quad({ size: [0.1, 0.1], at: [0, BARREL_Y, 0.775], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
});
