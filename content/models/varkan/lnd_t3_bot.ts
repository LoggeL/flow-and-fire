/**
 * Fallhammer (core:lnd_t3_bot) – Varkan-Belagerungsläufer T3.
 *
 * Roster: „Überlange Wanne auf Beinen, Doppelaufbau aus zwei Glocken, 3 Tech-Streifen; kein Schlot (Glut-Monopol).“
 * Grundform = Stichel (Wanne auf zwei Gussbeinen, Glocke mit waagerechtem Rohr über den Bug); T3-Merkmale (faction.md
 * §3.4): überlange Wanne (1,5 WU), Doppelaufbau aus zwei Glocken (hintere überhöht, feuert über die vordere),
 * 3 Tech-Streifen, Maßstab 1,7 (eingebacken, 2×2-Footprint). Kein Heckschlot, Glut nur als Nähte.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull            – Torso-Wanne mit Bugfase, Deckplatte (team), Heckkrümmer + Glutschlitz, Sockel der hinteren
 *                     Glocke, 3 Tech-Streifen
 *   legs_l / legs_r – schwere Gussbeine (Oberschenkel, Unterschenkel, Fuß; LOD1/2 vereinfacht)
 *   turret          – vordere Glocke (team) mit Rohr, dreht um +Y      (Rohre fest an der Glocke, roster)
 *   turret2         – hintere, überhöhte Glocke (team) mit Rohr, dreht um +Y
 */
import { beveledBox, box, cylinder, defineModel, frustum, quad, sphere, stripes, type Shape } from '@faf/modelkit';

const HIP_Y = 0.5;
const LEG_X = 0.37;
const HULL_BOTTOM = 0.46;
const DECK_TOP = 0.76;
const PLATE_TOP = 0.79;
const FRONT_Z = 0.44;
const REAR_Z = -0.04;
const REAR_Y = PLATE_TOP + 0.2;
const BELL_R = 0.26;

/** Schweres Gussbein (Knie vorn). LOD0 detailliert, LOD1 Säule + Fuß, LOD2 nur Säule. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    box({ size: [0.18, 0.3, 0.2], at: [x, HIP_Y - 0.1, 0.05], rot: [-22, 0, 0], mat: 'body', maxLod: 0, tag: 'legs' }),
    box({ size: [0.2, 0.28, 0.21], at: [x, 0.19, 0.06], rot: [14, 0, 0], mat: 'dark', maxLod: 0, tag: 'legs' }),
    box({ size: [0.2, HIP_Y, 0.22], at: [x, HIP_Y / 2, 0.05], mat: 'dark', minLod: 1, tag: 'legs' }),
    box({ size: [0.26, 0.08, 0.44], at: [x, 0.04, 0.07], mat: 'dark', maxLod: 1, tag: 'legs' }),
  ];
}

/** Glocke (team) mit Blende und Rohr, Rohr waagerecht nach +Z. */
function bell(y: number, z: number, barrelFrom: number, barrelTo: number): Shape[] {
  const by = y + 0.15;
  const len = barrelTo - barrelFrom;
  return [
    frustum({ radius: BELL_R + 0.01, radiusTop: BELL_R - 0.01, height: 0.08, at: [0, y + 0.04, z], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
    sphere({ radius: BELL_R - 0.01, hemi: true, segments: 8, rings: 2, scale: [1, 0.66, 1], at: [0, y + 0.08 + 0.083, z], mat: 'team', tag: 'bell' }),
    box({ size: [0.22, 0.14, 0.12], at: [0, by, z + BELL_R - 0.02], mat: 'body', maxLod: 1 }),
    cylinder({ radius: 0.075, height: len, axis: 'z', at: [0, by, barrelFrom + len / 2], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.092, height: 0.1, axis: 'z', at: [0, by, barrelTo - 0.05], segments: 6, caps: false, mat: 'copper', maxLod: 0, tag: 'barrel' }),
    quad({ size: [0.1, 0.1], at: [0, by, barrelTo + 0.004], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
  ];
}

export default defineModel({
  id: 'core:lnd_t3_bot',
  parts: [
    {
      name: 'hull',
      shapes: [
        box({ size: [0.6, 0.14, 1.2], at: [0, HULL_BOTTOM + 0.07, -0.05], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [0.8, DECK_TOP - 0.56, 1.5],
          at: [0, (DECK_TOP + 0.56) / 2, -0.05],
          bevel: { top: 0.05, topFront: 0.12, topBack: 0.04 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.66, PLATE_TOP - DECK_TOP, 1.34], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.1], mat: 'team' }),
        // Sockel der hinteren, überhöhten Glocke
        cylinder({ radius: 0.22, height: 0.2, at: [0, PLATE_TOP + 0.1, REAR_Z], segments: 8, caps: false, mat: 'dark', maxLod: 1, tag: 'bell' }),
        // Heckkrümmer an der Heckfase + Glutschlitz
        box({ size: [0.7, 0.08, 0.06], at: [0, 0.68, -0.8], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        quad({ size: [0.36, 0.04], at: [0, 0.68, -0.832], rot: [-90, 0, 0], mat: 'glow', maxLod: 1 }),
        stripes({ count: 3, width: 0.56, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.54] }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(-1) },
    { name: 'turret', pivot: [0, PLATE_TOP, FRONT_Z], anim: 'yaw', shapes: bell(PLATE_TOP, FRONT_Z, FRONT_Z + 0.2, 1.14) },
    { name: 'turret2', pivot: [0, REAR_Y, REAR_Z], anim: 'yaw', shapes: bell(REAR_Y, REAR_Z, REAR_Z + 0.2, 0.84) },
  ],
  notes: 'Doppelaufbau: hintere Glocke 0,2 WU überhöht, ihr Rohr läuft über die Kuppel der vorderen. Rohre fest an den Glocken (roster).',
});
