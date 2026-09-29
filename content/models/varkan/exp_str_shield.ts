/**
 * Mantel (core:exp_str_shield) – Varkan-Experimental: Großschild (T4, Post-MVP PM2, Game-Ender-Konter). In Spielgröße
 * modelliert (Maßstab 1,0), Footprint 8×8, Kuppel Radius 60 WU. Feature-IDs/Mechaniken: K10, E3, C15, C17, U21,
 * XM8, XM9 (docs/design/experimentals.md §4.6).
 *
 * Roster: „Schildturm auf 8×8: dicker Mast mit drei gestaffelten waagerechten Ringen (oberster = größter, Ø ≈ 7 WU,
 * team; Schild-Monopol), Generatorkessel am Fuß, Schürze. Höhe ≈ 9 WU. Keramik-Klammer am Sockel, kein Schlot.“
 * Schirm-Grammatik (Mast + waagerechter Ring als höchster Punkt, Ring Ø ≥ 0,8 × Footprint-Kante), gesteigert zu
 * einem Kelch: Die Schürze ist ein gefalteter Gussmantel (der Hitzemantel der Gießer), vier Strebepfeiler tragen
 * den unteren Ring, darüber zwei gegenläufig drehende Ringe, der oberste in Teamfarbe (Ø 8 WU). Von der Seite ein
 * „Y“/Kelch, 11,6 WU hoch (≈ 2,7× Schirm III), von oben ein großer Team-Ring mit Speichen.
 *
 * Aufbau (y = Boden):
 *   hull    – Sockel, Randband (team), Faltenschürze, Generatorkessel mit Kupferbändern, vier Strebepfeiler, Mast mit
 *             Kupfer-Isolatoren, unterer Ring (statisch), Keramik-Klammer
 *   ring_m  – mittlerer Ring (Kupfer) mit Speichen, spin                                      (PartStream 1)
 *   ring_t  – oberer Ring (team, Ø 8 WU) mit Speichen und Mastkappe, spin gegenläufig        (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, loftShape, radial, tube } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TOP = 0.6; // Sockeloberkante
const SKIRT_TOP = TOP + 2.6;
const KESSEL_TOP = SKIRT_TOP + 1.5;
const MAST_TOP = 11.1;
const RING_L = 5.9;
const RING_M = 8.1;
const RING_T = 10.4;

/** Faltenschürze: Ringe mit abwechselndem Radius (Falten), Punkte nach Winkel geordnet. */
function pleat(y: number, rOut: number, rIn: number, n: number): { y: number; pts: [number, number][] } {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { y, pts };
}
const SKIRT: readonly (readonly [number, number, number])[] = [
  [TOP, 3.35, 2.95],
  [TOP + 1.0, 2.75, 2.4],
  [TOP + 2.0, 2.05, 1.85],
  [SKIRT_TOP, 1.75, 1.75],
];

/** Strebepfeiler als Bogen (Seitenprofil [radial, y]): Fuß auf der Sockelecke, schwingt frei über der Schürze
 *  nach innen und trägt den unteren Ring. */
const BUTTRESS: readonly (readonly [number, number])[] = [
  [3.75, TOP],
  [4.7, TOP],
  [4.7, TOP + 0.5],
  [3.8, 2.3],
  [3.25, 4.0],
  [3.05, RING_L - 0.25],
  [3.1, RING_L + 0.25],
  [2.35, RING_L + 0.25],
  [2.45, 4.2],
  [2.9, 2.5],
];

export default defineModel({
  id: 'core:exp_str_shield',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [7.95, 0.22, 7.95], at: [0, 0.11, 0], bevel: { top: 0.08 }, mat: 'dark', maxLod: 1, tag: 'hull' }),
        beveledBox({ size: [7.7, TOP - 0.22, 7.7], at: [0, 0.22 + (TOP - 0.22) / 2, 0], bevel: { top: 0.2 }, mat: 'body', keep: true, tag: 'hull' }),
        tube({ outer: 3.7 * Math.SQRT2, inner: 3.25 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [7.0, 0.04, 7.0], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        // Faltenschürze (der Mantel, lackiert in Teamfarbe): 16 / 12 Punkte, LOD2 glatter Kegelstumpf
        loftShape({ rings: SKIRT.map(([y, a, b]) => pleat(y, a, b, 16)), caps: { top: true }, mat: 'team', maxLod: 0, keep: true, tag: 'hull' }),
        loftShape({ rings: SKIRT.map(([y, a, b]) => pleat(y, a, b, 12)), caps: { top: true }, mat: 'team', minLod: 1, maxLod: 1, keep: true, tag: 'hull' }),
        frustum({ radius: 3.2, radiusTop: 1.75, height: SKIRT_TOP - TOP, at: [0, (TOP + SKIRT_TOP) / 2, 0], segments: 8, caps: 'top', mat: 'team', minLod: 2, tag: 'hull' }),
        // Generatorkessel (stehend) mit zwei Kupferbändern
        cylinder({ radius: 1.55, height: KESSEL_TOP - SKIRT_TOP, at: [0, (SKIRT_TOP + KESSEL_TOP) / 2, 0], segments: 12, caps: 'top', mat: 'body', keep: true, tag: 'boiler' }),
        cylinder({ radius: 1.61, height: 0.22, at: [0, SKIRT_TOP + 0.4, 0], segments: 12, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 1.61, height: 0.22, at: [0, KESSEL_TOP - 0.35, 0], segments: 12, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        // vier Strebepfeiler auf den Diagonalen bis unter den unteren Ring
        radial(extrude({ profile: BUTTRESS, depth: 0.45, axis: 'x', mat: 'body', tag: 'hull' }), { count: 4, startDeg: 45, keep: true }),
        // Mast mit Kupfer-Isolatoren
        cylinder({ radius: 0.62, height: MAST_TOP - KESSEL_TOP, at: [0, (KESSEL_TOP + MAST_TOP) / 2, 0], segments: 10, caps: false, mat: 'dark', keep: true, tag: 'mast' }),
        cylinder({ radius: 1.0, height: 0.22, at: [0, (RING_L + RING_M) / 2, 0], segments: 10, mat: 'copper', maxLod: 0, tag: 'mast' }),
        cylinder({ radius: 1.0, height: 0.22, at: [0, (RING_M + RING_T) / 2, 0], segments: 10, mat: 'copper', maxLod: 0, tag: 'mast' }),
        // unterer Ring (statisch), auf den Strebepfeilern
        tube({ outer: 3.05, inner: 2.6, height: 0.4, segments: 16, at: [0, RING_L, 0], mat: 'body', keep: true, tag: 'ring' }),
        ceramicBracket({ x: 3.55, y: TOP + 0.04, z: 0, len: 5.0, w: 0.34, arm: 0.95 }),
      ],
    },
    {
      name: 'ring_m',
      pivot: [0, RING_M, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 3.55, inner: 3.15, height: 0.36, segments: 16, at: [0, RING_M, 0], mat: 'copper', keep: true, tag: 'ring' }),
        radial(box({ size: [2.6, 0.2, 0.26], at: [1.85, 0, 0], mat: 'body' }), { count: 3, at: [0, RING_M, 0], maxLod: 1 }),
      ],
    },
    {
      name: 'ring_t',
      pivot: [0, RING_T, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 4.05, inner: 3.45, height: 0.55, segments: 18, at: [0, RING_T, 0], mat: 'team', keep: true, tag: 'ring' }),
        radial(box({ size: [3.0, 0.26, 0.34], at: [2.0, 0, 0], mat: 'body' }), { count: 4, at: [0, RING_T, 0], keep: true, maxLod: 1 }),
        // Nieten-/Klauenkranz außen am Team-Ring (Maßstab, Rotation sichtbar)
        radial(box({ size: [0.36, 0.7, 0.5], at: [4.05, 0, 0], mat: 'body' }), { count: 8, startDeg: 22.5, at: [0, RING_T, 0], maxLod: 0 }),
        frustum({ radius: 0.95, radiusTop: 0.45, height: 0.8, at: [0, MAST_TOP + 0.3, 0], segments: 10, caps: 'top', mat: 'copper', keep: true, tag: 'mast' }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Oberster Ring = höchster Punkt bis auf die Mastkappe (Schild-Grammatik), zwei Spin-Parts gegenläufig.',
});
