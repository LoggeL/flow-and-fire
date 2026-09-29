/**
 * Rost I (core:str_t1_aa) – Flugabwehrturm T1, 1×1.
 *
 * Roster: „Sockel mit Rost-Platte und 2 senkrechten Rohren.“ Flugabwehr-Monopol (faction.md §5.2): senkrechte Rohre
 * (≥ 75°) als Kamm quer zur Blickrichtung auf teamfarbenem `grate`; keine Glocke, keine Kelle, kein Schlot.
 * Paartest Riegel↔Rost: rund + waagerecht (Riegel) gegen eckige Platte + senkrecht (Rost).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull  – Fuß, Gusssockel, Kupferkranz, 1 Tech-Kerbe hinten, Glutschlitz am Heck
 *   grate – Rost-Platte (Team) mit dunklen Schlitzen, Rohrjoch, 2 senkrechte Rohre (8° vorgeneigt) mit
 *           Kupfermündung; dreht um +Y (PartStream 1)
 */
import { beveledBox, cylinder, defineModel, mirrorX, quad, stripes } from '@faf/modelkit';

const TOP = 0.24;
const G_Y = TOP + 0.1; // Oberkante Rost

export default defineModel({
  id: 'core:str_t1_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.9, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.07 }, mat: 'body', tag: 'hull' }),
        // Drehkranz (Kupfer) unter dem Rost
        cylinder({ radius: 0.22, height: 0.07, at: [0, TOP + 0.035, 0], segments: 8, caps: false, mat: 'copper', tag: 'hull' }),
        quad({ size: [0.36, 0.05], at: [0, TOP - 0.035, -0.415], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        stripes({ count: 1, width: 0.1, rot: [0, 90, 0], at: [0, TOP + 0.004, -0.34] }),
      ],
    },
    {
      name: 'grate',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        // Rost-Platte (Teamfarbe), Schlitzmaske als dunkle Decals vor und hinter dem Joch
        beveledBox({ size: [0.72, 0.07, 0.56], at: [0, G_Y - 0.035, 0], bevel: { top: 0.02 }, mat: 'team', tag: 'grate' }),
        quad({ size: [0.56, 0.06], at: [0, G_Y + 0.004, 0.17], mat: 'dark', maxLod: 1 }),
        quad({ size: [0.56, 0.06], at: [0, G_Y + 0.004, -0.17], mat: 'dark', maxLod: 1 }),
        // Rohrjoch (Kupfer)
        beveledBox({ size: [0.44, 0.1, 0.18], at: [0, G_Y + 0.05, 0], bevel: { top: 0.03 }, mat: 'copper', tag: 'hull' }),
        // 2 senkrechte Rohre (Ø 0,18), Kamm quer zur Blickrichtung, 8° vorgeneigt (≥ 75°)
        mirrorX([
          cylinder({ radius: 0.09, height: 0.5, at: [0.13, G_Y + 0.33, 0.03], rot: [8, 0, 0], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
          cylinder({ radius: 0.105, height: 0.08, at: [0.13, G_Y + 0.55, 0.06], rot: [8, 0, 0], segments: 6, caps: 'top', mat: 'copper', tag: 'barrel' }),
        ]),
      ],
    },
  ],
  notes: 'Rohre statisch auf dem Rost (Roster: 1 animierter Part = grate, Yaw).',
});
