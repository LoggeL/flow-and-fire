/**
 * Mantel (core:exp_str_shield) – Varkan-Experimental: Großschild (T4, Post-MVP PM2, Game-Ender-Konter). In Spielgröße
 * modelliert (Maßstab 1,0), Footprint 8×8, Kuppel Radius 60 WU.
 *
 * Roster: „Schildturm auf 8×8: dicker Mast mit drei gestaffelten waagerechten Ringen (oberster = größter, Ø ≈ 7 WU,
 * team; Schild-Monopol), Generatorkessel am Fuß, Schürze. Höhe ≈ 9 WU. Keramik-Klammer am Sockel, kein Schlot.“
 * Schirm-Grammatik (Mast + waagerechter Ring als höchster Punkt, Ring Ø ≥ 0,8 × Footprint-Kante), gesteigert zu einer
 * umgedrehten Stufenpyramide aus Ringen: von der Seite ein „Y“/Kelch, von oben ein großer Team-Ring mit Speichen.
 *
 * Aufbau (y = Boden):
 *   hull    – Sockel, Randband (team), Schürze, stehender Generatorkessel mit Kupferbändern, Mast, unterer Ring
 *             (statisch), Keramik-Klammer
 *   ring_m  – mittlerer Ring (Kupfer) mit Speichen, spin                                      (PartStream 1)
 *   ring_t  – oberer Ring (team, Ø 7,6 WU) mit Speichen und Mastkappe, spin gegenläufig      (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, frustum, radial, tube } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TOP = 0.6;
const MAST_TOP = 9.0;
const RING_L = 4.2;
const RING_M = 6.3;
const RING_T = 8.5;

export default defineModel({
  id: 'core:exp_str_shield',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [7.9, 0.2, 7.9], at: [0, 0.1, 0], bevel: { top: 0.06 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [7.7, TOP, 7.7], at: [0, TOP / 2, 0], bevel: { top: 0.25 }, mat: 'body', keep: true, tag: 'hull' }),
        tube({ outer: 3.7 * Math.SQRT2, inner: 3.25 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [7.0, 0.04, 7.0], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        // Schürze + Generatorkessel (stehend) mit Kupferbändern
        frustum({ radius: 2.9, radiusTop: 2.2, height: 0.7, at: [0, TOP + 0.35, 0], segments: 12, caps: 'top', mat: 'body', keep: true, tag: 'hull' }),
        cylinder({ radius: 1.7, height: 1.8, at: [0, TOP + 1.6, 0], segments: 12, caps: 'top', mat: 'body', keep: true, tag: 'boiler' }),
        cylinder({ radius: 1.76, height: 0.24, at: [0, TOP + 1.2, 0], segments: 12, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 1.76, height: 0.24, at: [0, TOP + 2.1, 0], segments: 12, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        // Mast bis unter die Kappe
        cylinder({ radius: 0.5, height: MAST_TOP - 2.5, at: [0, 2.5 + (MAST_TOP - 2.5) / 2, 0], segments: 10, caps: false, mat: 'dark', keep: true, tag: 'mast' }),
        // unterer Ring (statisch) mit vier Speichen
        tube({ outer: 2.5, inner: 2.1, height: 0.3, segments: 14, at: [0, RING_L, 0], mat: 'body', keep: true, tag: 'ring' }),
        radial(box({ size: [1.7, 0.18, 0.22], at: [1.2, 0, 0], mat: 'body' }), { count: 4, startDeg: 45, at: [0, RING_L, 0], maxLod: 1 }),
        ceramicBracket({ x: 3.55, y: TOP + 0.04, z: 0, len: 5.2, w: 0.34, arm: 1.0 }),
      ],
    },
    {
      name: 'ring_m',
      pivot: [0, RING_M, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 3.2, inner: 2.8, height: 0.34, segments: 16, at: [0, RING_M, 0], mat: 'copper', keep: true, tag: 'ring' }),
        radial(box({ size: [2.4, 0.18, 0.24], at: [1.6, 0, 0], mat: 'body' }), { count: 3, at: [0, RING_M, 0], maxLod: 1 }),
      ],
    },
    {
      name: 'ring_t',
      pivot: [0, RING_T, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 3.8, inner: 3.25, height: 0.4, segments: 18, at: [0, RING_T, 0], mat: 'team', keep: true, tag: 'ring' }),
        radial(box({ size: [2.9, 0.22, 0.3], at: [1.85, 0, 0], mat: 'body' }), { count: 4, at: [0, RING_T, 0], keep: true }),
        frustum({ radius: 0.8, radiusTop: 0.4, height: 0.7, at: [0, MAST_TOP - 0.05, 0], segments: 10, caps: 'top', mat: 'copper', keep: true, tag: 'mast' }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Oberster Ring = höchster Punkt bis auf die Mastkappe (Schild-Grammatik), zwei Spin-Parts.',
});
