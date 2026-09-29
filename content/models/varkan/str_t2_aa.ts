/**
 * Rost II (core:str_t2_aa) – Flakturm T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4, Basis = Rost I auf 1×1).
 *
 * Roster: „Rost ×1,3 mit 3 Rohren, 2 Tech-Streifen“ + Schürze. Gleiche Grundform wie Rost I (Sockel, Team-Rost,
 * senkrechter Rohrkamm quer zur Blickrichtung); T2 = breiterer Rost, 3 Rohre, Schürzenplatten, 2 Kerben.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn):
 *   hull  – Fuß, Gusssockel, Schürzenplatten, Kupferkranz, 2 Tech-Kerben, Glutschlitz am Heck
 *   grate – Rost-Platte (Team) mit Schlitzen, Joch, 3 senkrechte Rohre mit Kupfermündung; Yaw (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, mirrorX, quad, stripes } from '@faf/modelkit';

const TOP = 0.24;
const G_Y = TOP + 0.1;

const tubeAt = (x: number) => [
  cylinder({ radius: 0.085, height: 0.52, at: [x, G_Y + 0.34, 0.03], rot: [8, 0, 0], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
  cylinder({ radius: 0.1, height: 0.08, at: [x, G_Y + 0.57, 0.065], rot: [8, 0, 0], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' }),
];

export default defineModel({
  id: 'core:str_t2_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.88, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.07 }, mat: 'body', tag: 'hull' }),
        mirrorX(box({ size: [0.05, 0.19, 0.78], at: [0.465, 0.145, 0], rot: [0, 0, -10], mat: 'body', maxLod: 1, tag: 'hull' })),
        cylinder({ radius: 0.26, height: 0.07, at: [0, TOP + 0.035, 0], segments: 8, caps: false, mat: 'copper', tag: 'hull' }),
        quad({ size: [0.4, 0.05], at: [0, TOP - 0.035, -0.415], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        stripes({ count: 2, width: 0.1, rot: [0, 90, 0], at: [0, TOP + 0.004, -0.36] }),
      ],
    },
    {
      name: 'grate',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        beveledBox({ size: [0.8, 0.07, 0.58], at: [0, G_Y - 0.035, 0], bevel: { top: 0.02 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.64, 0.06], at: [0, G_Y + 0.004, 0.18], mat: 'dark', maxLod: 1 }),
        quad({ size: [0.64, 0.06], at: [0, G_Y + 0.004, -0.18], mat: 'dark', maxLod: 1 }),
        beveledBox({ size: [0.64, 0.1, 0.18], at: [0, G_Y + 0.05, 0], bevel: { top: 0.03 }, mat: 'copper', tag: 'hull' }),
        // 3 senkrechte Rohre Ø 0,17 (Basis), Kamm quer
        ...tubeAt(0),
        mirrorX(tubeAt(0.22)),
      ],
    },
  ],
  notes: 'Basis 1×1 wie Rost I; der Roster-Maßstab (xz 2,0 / y 2,4) macht daraus 2×2.',
});
