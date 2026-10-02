/**
 * Horcher II (core:str_t2_radar) – Radar T2, 2×2 (Roster-Maßstab xz 1,0 / y 1,2; Upgrade von Horcher I).
 *
 * Roster: „Horcher auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.“ Gleiche Grundform wie Horcher I (Sockel,
 * Gerätehaus, 35°-Radarplatte auf dem Mast); T2 = zwei Masten mit Querjoch, 2 Kerben, höher.
 *
 * Aufbau (Basis-Maße vor y ×1,2, y = Boden, +Z = vorn):
 *   hull – Fuß, Sockel mit Randband, breiter Mastsockel, Gerätehaus, Kupferleitung, Doppelmast + Querjoch, 2 Kerben
 *   wing – Lager, Joch, Radarplatte (Team, nach dem Maßstab 35°) mit Rückenrippe; Yaw (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, stripes, strut, tube } from '@faf/modelkit';

const TOP = 0.2;
const MAST_TOP = 2.05;
const SY = 1.2;
const TILT = Math.atan(SY * Math.tan((35 * Math.PI) / 180));
const PLATE_L = 0.8 * Math.hypot(Math.sin((35 * Math.PI) / 180), Math.cos((35 * Math.PI) / 180) / SY);
const TILT_DEG = (TILT * 180) / Math.PI;
const PY = MAST_TOP + 0.26 + (PLATE_L / 2) * Math.cos(TILT);
const PZ = -(PLATE_L / 2) * Math.sin(TILT);
const MX = 0.26; // Mastabstand

export default defineModel({
  id: 'core:str_t2_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [1.96, 0.08, 1.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [1.88, TOP, 1.88], at: [0, TOP / 2, 0], bevel: { top: 0.06 }, mat: 'body', tag: 'hull' }),
        tube({ outer: 0.86 * Math.SQRT2, inner: 0.7 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [1.72, 0.03, 1.72], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        beveledBox({ size: [0.9, 0.22, 0.6], at: [0, TOP + 0.11, 0.05], bevel: { top: 0.08 }, mat: 'body', tag: 'hull' }),
        beveledBox({ size: [0.5, 0.26, 0.34], at: [0, TOP + 0.13, -0.5], bevel: { top: 0.06 }, mat: 'body', maxLod: 1, tag: 'hull' }),
        box({ size: [0.14, 0.12, 0.3], at: [0, TOP + 0.2, -0.24], mat: 'copper', maxLod: 1, tag: 'barrel' }),
        // Doppelmast (T2-Merkmal, Kupfer) mit dunklen Füßen und Querjoch unter dem Lager
        mirrorX([
          frustum({ radius: 0.18, radiusTop: 0.11, height: 0.22, at: [MX, TOP + 0.33, 0.05], segments: 6, caps: false, mat: 'dark', tag: 'mast' }),
          cylinder({ radius: 0.09, height: MAST_TOP - TOP - 0.44, at: [MX, (MAST_TOP + TOP + 0.44) / 2, 0.05], segments: 6, caps: false, mat: 'copper', keep: true, tag: 'mast' }),
        ]),
        box({ size: [0.74, 0.14, 0.2], at: [0, MAST_TOP + 0.03, 0.05], mat: 'body', keep: true, tag: 'mast' }),
        // Cross bracing makes the upgraded twin mast read as an engineered tower.
        mirrorX(strut({
          from: [MX, TOP + 0.5, 0.05], to: [-MX, TOP + 1.25, 0.05],
          radius: 0.04, sides: 4, caps: false, mat: "body", maxLod: 0,
        })),
        stripes({ count: 2, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.78] }),
      ],
    },
    {
      name: 'wing',
      pivot: [0, MAST_TOP + 0.1, 0.05],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.15, height: 0.1, at: [0, MAST_TOP + 0.15, 0.05], segments: 6, mat: 'copper', tag: 'mast' }),
        beveledBox({ size: [0.2, 0.12, 0.34], at: [0, MAST_TOP + 0.24, 0.0], bevel: { top: 0.03 }, mat: 'body', tag: 'boom' }),
        extrude({ profile: [
          [-0.70, -PLATE_L / 2], [0.70, -PLATE_L / 2],
          [0.8, -PLATE_L / 2 + 0.1], [0.8, PLATE_L / 2 - 0.1],
          [0.70, PLATE_L / 2], [-0.70, PLATE_L / 2],
          [-0.8, PLATE_L / 2 - 0.1], [-0.8, -PLATE_L / 2 + 0.1],
        ], depth: 0.08, axis: "z", at: [0, PY, PZ], rot: [-TILT_DEG, 0, 0], mat: 'team', keep: true, tag: 'wing' }),
        box({ size: [1.2, PLATE_L * 0.6, 0.08], at: [0, PY - 0.04 * Math.sin(TILT), PZ - 0.07], rot: [-TILT_DEG, 0, 0], mat: 'dark', maxLod: 1, tag: 'wing' }),
      ],
    },
  ],
  notes: 'Plattenneigung wird um den Höhenfaktor 1,2 vorverzerrt, damit sie im Spiel 35° beträgt.',
});
