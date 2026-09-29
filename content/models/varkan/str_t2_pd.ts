/**
 * Riegel II (core:str_t2_pd) – Punktverteidigung T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4, Basis = Riegel I auf 1×1).
 *
 * Roster: „Riegel ×1,3, breitere Glocke, zwei Rohre, 2 Tech-Streifen“ + seitliche Schürzenplatten (faction.md §3.4).
 * Gleiche Grundform wie Riegel I (Sockel + Randband + Glocke mit waagerechten Rohren); T2 liest man an der breiteren
 * Glocke, dem Rohrpaar, den Schürzen und 2 Kerben.
 *
 * Aufbau (Basis-Maße vor dem Maßstab, y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Fuß, Gusssockel, Schürzenplatten links/rechts, Teamfarben-Randband, Kupferkranz + Leitungen, 2 Kerben
 *   turret – breite Glocke (r 0,37), dreht um +Y                                (PartStream 1)
 *   barrel – Blende + zwei parallele Rohre mit Kupfermündung, kippt (Pitch)       (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, quad, sphere, stripes, tube } from '@faf/modelkit';

const TOP = 0.26;
const BZ = -0.1;
const BELL_Y = TOP + 0.03;
const BARREL_Y = BELL_Y + 0.2;

export default defineModel({
  id: 'core:str_t2_pd',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.88, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.09 }, mat: 'body', tag: 'hull' }),
        // Schürzenplatten (T2-Zusatz): flach, leicht nach außen gekippt, links/rechts am Sockel
        mirrorX(box({ size: [0.05, 0.2, 0.78], at: [0.465, 0.15, 0], rot: [0, 0, -10], mat: 'body', maxLod: 1, tag: 'hull' })),
        tube({ outer: 0.35 * Math.SQRT2, inner: 0.24 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [0.70, 0.03, 0.70], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        cylinder({ radius: 0.28, height: 0.03, at: [0, TOP + 0.015, BZ], segments: 8, caps: 'top', mat: 'copper', maxLod: 1 }),
        mirrorX(cylinder({ radius: 0.055, height: 0.6, axis: 'z', at: [0.4, TOP - 0.035, -0.03], segments: 6, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' })),
        quad({ size: [0.4, 0.05], at: [0, TOP - 0.045, -0.405], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        // 2 Tech-Kerben auf dem hinteren Randband
        stripes({ count: 2, width: 0.11, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.295] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BZ],
      anim: 'yaw',
      shapes: [
        // breitere Glocke (×1,2 gegenüber Riegel I)
        frustum({ radius: 0.37, radiusTop: 0.35, height: 0.1, at: [0, BELL_Y + 0.05, BZ], segments: 8, caps: 'bottom', mat: 'team', tag: 'bell' }),
        cylinder({ radius: 0.36, height: 0.025, at: [0, BELL_Y + 0.1125, BZ], segments: 8, caps: false, mat: 'body', maxLod: 0 }),
        sphere({ radius: 0.35, hemi: true, segments: 8, rings: 3, scale: [1, 0.6, 1], at: [0, BELL_Y + 0.125 + 0.105, BZ], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, BZ + 0.28],
      anim: 'pitch',
      shapes: [
        beveledBox({ size: [0.36, 0.16, 0.14], at: [0, BARREL_Y, BZ + 0.3], bevel: { topFront: 0.05 }, mat: 'body' }),
        // zwei parallele Rohre (Ø 0,15 Basis = 0,30 WU im Spiel), enden innerhalb der Footprint-Kante
        mirrorX([
          cylinder({ radius: 0.075, height: 0.4, axis: 'z', at: [0.095, BARREL_Y, 0.35], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
          cylinder({ radius: 0.09, height: 0.09, axis: 'z', at: [0.095, BARREL_Y, 0.5], segments: 6, caps: false, mat: 'copper', tag: 'barrel' }),
          cylinder({ radius: 0.05, height: 0.01, axis: 'z', at: [0.095, BARREL_Y, 0.55], segments: 6, caps: 'top', mat: 'glow', maxLod: 0 }),
        ]),
      ],
    },
  ],
  notes: 'Basis 1×1 wie Riegel I; der Roster-Maßstab (xz 2,0 / y 2,4) macht daraus 2×2. Rohre als ein Pitch-Part (Roster: 1 animierter Part; Pitch ist optional nutzbar).',
});
