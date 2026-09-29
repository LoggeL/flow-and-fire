/**
 * Hochrost (core:str_t3_sam) – Raketenabwehr T3, 2×2 (Roster-Maßstab xz 2,0 / y 2,8, Basis = Rost I auf 1×1).
 *
 * Roster: „Rost auf 2×2 mit doppelt so vielen, dickeren Rohren (4), 3 Tech-Streifen; kein Schlot (Glut-Monopol).“
 * Gleiche Grundform wie Rost I/II (Sockel, Team-Rost, senkrechter Rohrkamm quer); T3 = 4 dickere Startrohre
 * (Ø 0,22 statt 0,17) in einem Kastenrahmen, Schürzen, 3 Kerben, größte Höhe der Familie.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn):
 *   hull  – Fuß, Gusssockel, Schürzenplatten, Kupferkranz, 3 Tech-Kerben, Glutschlitz am Heck
 *   grate – Rost-Platte (Team), Joch, Rückenrahmen, 4 Startrohre mit Kupferkragen und dunklem Deckel; Yaw (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, mirrorX, quad, stripes } from '@faf/modelkit';

const TOP = 0.24;
const G_Y = TOP + 0.1;

const tubeAt = (x: number) => [
  cylinder({ radius: 0.11, height: 0.54, at: [x, G_Y + 0.35, 0.04], rot: [6, 0, 0], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
  cylinder({ radius: 0.125, height: 0.08, at: [x, G_Y + 0.58, 0.07], rot: [6, 0, 0], segments: 6, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' }),
];

export default defineModel({
  id: 'core:str_t3_sam',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.88, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.07 }, mat: 'body', tag: 'hull' }),
        mirrorX(box({ size: [0.05, 0.19, 0.78], at: [0.465, 0.145, 0], rot: [0, 0, -10], mat: 'body', maxLod: 1, tag: 'hull' })),
        cylinder({ radius: 0.28, height: 0.07, at: [0, TOP + 0.035, 0], segments: 8, caps: false, mat: 'copper', tag: 'hull' }),
        quad({ size: [0.4, 0.05], at: [0, TOP - 0.035, -0.415], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        stripes({ count: 3, width: 0.1, rot: [0, 90, 0], at: [0, TOP + 0.004, -0.36] }),
      ],
    },
    {
      name: 'grate',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        beveledBox({ size: [0.86, 0.07, 0.6], at: [0, G_Y - 0.035, 0], bevel: { top: 0.02 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.7, 0.06], at: [0, G_Y + 0.004, 0.22], mat: 'dark', maxLod: 1 }),
        beveledBox({ size: [0.84, 0.1, 0.22], at: [0, G_Y + 0.05, 0.02], bevel: { top: 0.03 }, mat: 'copper', tag: 'hull' }),
        // Rückenrahmen hinter dem Rohrkamm (hält die 4 Startrohre zusammen)
        beveledBox({ size: [0.84, 0.36, 0.08], at: [0, G_Y + 0.28, -0.12], bevel: { topBack: 0.05 }, mat: 'body', tag: 'hull' }),
        // 4 dickere Startrohre (Ø 0,22), Kamm quer
        mirrorX([...tubeAt(0.1), ...tubeAt(0.31)]),
      ],
    },
  ],
  notes: 'Basis 1×1 wie Rost I; der Roster-Maßstab (xz 2,0 / y 2,8) macht daraus 2×2. Rohre statisch auf dem Rost.',
});
