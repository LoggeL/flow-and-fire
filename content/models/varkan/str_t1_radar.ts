/**
 * Horcher I (core:str_t1_radar) – Radar T1, 2×2.
 *
 * Roster: „Hoher dünner Mast mit rechteckiger Radarplatte (wing-Prisma 1,6 × 0,8 × 0,1 WU, 35° gekippt), rotierend;
 * kein Ring (Ring = Flow/Schild).“ Intel-Monopol (faction.md §5.1/5.2): Mast = Intel, Radar immer mit Platte.
 * Paartest Horcher↔Schirm: schräge Rechteckplatte auf dünnem Mast gegen waagerechten Ring.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Fuß, flacher Gusssockel mit Teamfarben-Randband, Mastsockel, Gerätehaus, Kupferleitung, Mast, 1 Kerbe
 *   wing – Lager (Kupfer), Joch, Radarplatte (Team, 35° aus der Senkrechten nach hinten gekippt) mit dunkler
 *          Rückenrippe; dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, frustum, stripes, tube } from '@faf/modelkit';

const TOP = 0.2; // Sockeldach
const MAST_TOP = 2.05;
/** Roster-Höhenfaktor; die Plattenneigung wird so vorverzerrt, dass sie nach dem Maßstab 35° beträgt. */
const SY = 1.0;
const TILT = Math.atan(SY * Math.tan((35 * Math.PI) / 180));
const PLATE_L = 0.8 * Math.hypot(Math.sin((35 * Math.PI) / 180), Math.cos((35 * Math.PI) / 180) / SY);
const TILT_DEG = (TILT * 180) / Math.PI;
const PY = MAST_TOP + 0.16 + (PLATE_L / 2) * Math.cos(TILT);
const PZ = -(PLATE_L / 2) * Math.sin(TILT);

export default defineModel({
  id: 'core:str_t1_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [1.96, 0.08, 1.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [1.88, TOP, 1.88], at: [0, TOP / 2, 0], bevel: { top: 0.06 }, mat: 'body', tag: 'hull' }),
        tube({ outer: 0.86 * Math.SQRT2, inner: 0.7 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [1.72, 0.03, 1.72], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        // Mastsockel + Gerätehaus hinten
        beveledBox({ size: [0.62, 0.22, 0.62], at: [0, TOP + 0.11, 0.05], bevel: { top: 0.08 }, mat: 'body', tag: 'hull' }),
        beveledBox({ size: [0.5, 0.26, 0.34], at: [0, TOP + 0.13, -0.5], bevel: { top: 0.06 }, mat: 'body', maxLod: 1, tag: 'hull' }),
        box({ size: [0.14, 0.12, 0.3], at: [0, TOP + 0.2, -0.24], mat: 'copper', maxLod: 1, tag: 'barrel' }),
        // Mast: dunkler Fuß + dünner Kupferschaft (Flow-Leitung zum Horcher)
        frustum({ radius: 0.2, radiusTop: 0.12, height: 0.24, at: [0, TOP + 0.34, 0.05], segments: 6, caps: false, mat: 'dark', tag: 'mast' }),
        cylinder({ radius: 0.1, height: MAST_TOP - TOP - 0.46, at: [0, (MAST_TOP + TOP + 0.46) / 2, 0.05], segments: 6, caps: 'top', mat: 'copper', keep: true, tag: 'mast' }),
        stripes({ count: 1, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.78] }),
      ],
    },
    {
      name: 'wing',
      pivot: [0, MAST_TOP, 0.05],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.15, height: 0.1, at: [0, MAST_TOP + 0.05, 0.05], segments: 6, mat: 'copper', tag: 'mast' }),
        beveledBox({ size: [0.2, 0.12, 0.34], at: [0, MAST_TOP + 0.14, 0.0], bevel: { top: 0.03 }, mat: 'body', tag: 'boom' }),
        // Radarplatte 1,6 × 0,8 × 0,1 (Team), 35° nach hinten gekippt, mit Rückenrippe
        box({ size: [1.6, PLATE_L, 0.08], at: [0, PY, PZ], rot: [-TILT_DEG, 0, 0], mat: 'team', keep: true, tag: 'wing' }),
        box({ size: [1.2, PLATE_L * 0.6, 0.08], at: [0, PY - 0.04 * Math.sin(TILT), PZ - 0.07], rot: [-TILT_DEG, 0, 0], mat: 'dark', maxLod: 1, tag: 'wing' }),
      ],
    },
  ],
});
