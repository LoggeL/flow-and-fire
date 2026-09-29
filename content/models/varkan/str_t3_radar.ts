/**
 * Horcher III (core:str_t3_radar) – Radar T3, 2×2 (Roster-Maßstab xz 1,0 / y 1,4; Upgrade von Horcher II).
 *
 * Roster: „Horcher auf 2×2 (Höhe ×1,4) mit zweiter Radarplatte, 3 Tech-Streifen; kein Schlot (Glut-Monopol).“
 * Gleiche Grundform wie Horcher I/II (Sockel, Gerätehaus, Doppelmast, 35°-Platte); T3 = zweite, kleinere Platte
 * als Aufsatz über der Hauptplatte (gestufter Umriss, aus jeder Richtung sichtbar), 3 Kerben, größte Höhe.
 *
 * Aufbau (Basis-Maße vor y ×1,4, y = Boden, +Z = vorn):
 *   hull – Fuß, Sockel mit Randband, Mastsockel, Gerätehaus, Kupferleitung, Doppelmast + Querjoch, 3 Kerben
 *   wing – Lager, Joch, Hauptplatte (Team) + zweite Platte (Team, darüber, mit Spalt), dunkle Rückenrippe;
 *          dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, stripes, tube } from '@faf/modelkit';

const TOP = 0.2;
const MAST_TOP = 2.05;
const SY = 1.4;
const RAD = Math.PI / 180;
const TILT = Math.atan(SY * Math.tan(35 * RAD));
const TILT_DEG = TILT / RAD;
const plateLen = (l: number): number => l * Math.hypot(Math.sin(35 * RAD), Math.cos(35 * RAD) / SY);
const L1 = plateLen(0.8);
const L2 = plateLen(0.5);
const GAP = plateLen(0.1);
const PZ0 = 0.12; // Unterkante der Platten (z)
const BASE = MAST_TOP + 0.26;
const MX = 0.26;

export default defineModel({
  id: 'core:str_t3_radar',
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
        mirrorX([
          frustum({ radius: 0.18, radiusTop: 0.11, height: 0.22, at: [MX, TOP + 0.33, 0.05], segments: 6, caps: false, mat: 'dark', tag: 'mast' }),
          cylinder({ radius: 0.09, height: MAST_TOP - TOP - 0.44, at: [MX, (MAST_TOP + TOP + 0.44) / 2, 0.05], segments: 6, caps: false, mat: 'copper', keep: true, tag: 'mast' }),
        ]),
        box({ size: [0.74, 0.14, 0.2], at: [0, MAST_TOP + 0.03, 0.05], mat: 'body', keep: true, tag: 'mast' }),
        stripes({ count: 3, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.78] }),
      ],
    },
    {
      name: 'wing',
      pivot: [0, MAST_TOP + 0.1, 0.05],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.15, height: 0.1, at: [0, MAST_TOP + 0.15, 0.05], segments: 6, mat: 'copper', tag: 'mast' }),
        beveledBox({ size: [0.2, 0.12, 0.34], at: [0, MAST_TOP + 0.24, 0.0], bevel: { top: 0.03 }, mat: 'body', tag: 'boom' }),
        // Hauptplatte 1,6 × 0,8 (Team), Fläche nach vorn-oben (35° aus der Senkrechten), wie Horcher I/II
        box({ size: [1.6, L1, 0.08], at: [0, BASE + (L1 / 2) * Math.cos(TILT), PZ0 - (L1 / 2) * Math.sin(TILT)], rot: [-TILT_DEG, 0, 0], mat: 'team', keep: true, tag: 'wing' }),
        // zweite Platte 1,2 × 0,5 (T3-Merkmal) als Aufsatz über der Hauptplatte, gleiche Neigung, mit Spalt
        box({ size: [1.2, L2, 0.08], at: [0, BASE + (L1 + GAP + L2 / 2) * Math.cos(TILT), PZ0 - (L1 + GAP + L2 / 2) * Math.sin(TILT)], rot: [-TILT_DEG, 0, 0], mat: 'team', keep: true, tag: 'wing' }),
        // Rückenrippe (dunkel) verbindet beide Platten
        box({ size: [0.16, L1 + GAP + L2 * 0.8, 0.1], at: [0, BASE + ((L1 + GAP + L2 * 0.8) / 2) * Math.cos(TILT) - 0.07 * Math.sin(TILT), PZ0 - ((L1 + GAP + L2 * 0.8) / 2) * Math.sin(TILT) - 0.07 * Math.cos(TILT)], rot: [-TILT_DEG, 0, 0], mat: 'dark', tag: 'wing' }),
      ],
    },
  ],
  notes: 'Plattenneigung wird um den Höhenfaktor 1,4 vorverzerrt, damit sie im Spiel 35° beträgt.',
});
