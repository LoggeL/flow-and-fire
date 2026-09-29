/**
 * Lichtkammer (f4:str_t1_estore) – Aurith-Energiespeicher auf 2×2.
 *
 * Roster: „Zwei gestapelte flache Linsen (Energy = rund), dazwischen eine leuchtende Fuge; keine stehenden
 * Kristalle.“ faction.md §5.2 Speicher: Energy rund; Paartests Resonator↔Lichtkammer (Spitze gegen flache Linsen) und
 * Bernsteinkammer↔Lichtkammer (eckig gegen rund). Weiche Normalen: alles gerundet.
 *
 * Aufbau (y = Boden, +Z = vorn): nur `hull`
 *   Dreipass-Sockel (team/Bernstein), Pechglas-Fuß, untere Linse (Bernstein-Tiefe), Pechglas-Hals mit Leuchtfuge
 *   (Resonanzkern-Reif), obere Linse aus hellem Bernstein mit Glyphenring (runder Kopf im Schattenriss), Tonpunkt.
 *   Der hohe Hals gibt der Lichtkammer eine Taille zwischen den Linsen: im 50°-Schattenriss steht ein runder Kopf
 *   über dem Sockel, die Bernsteinkammer bleibt ein flacher, eckiger Block (Pflichtpaar faction.md §5.4).
 */
import { arcPoints, cylinder, defineModel, glyphStrip, lens, torus, type Shape } from '@faf/modelkit';
import { dreipass, MEX_SOCKET, socketY, tonpunkte } from './str_t1_mex.ts';

const S = MEX_SOCKET;
const LOW_Y = socketY(S, 0, 0) + 0.14;
const LOW_T = 0.32;
const UP_T = 0.44;
const NECK = 0.62; // hoher Hals: die obere Linse steht mit Taille über dem Sockel (Schattenriss ≠ Bernsteinkammer)
const SEAM_Y = LOW_Y + LOW_T / 2 + NECK / 2 - 0.02;
const UP_Y = LOW_Y + LOW_T / 2 + NECK + UP_T / 2 - 0.06;

const shapes: Shape[] = [
  ...dreipass(S),
  // Pechglas-Fuß: trennt den Linsenstapel vom Sockel
  cylinder({ radius: 0.5, height: 0.14, segments: 10, caps: false, at: [0, LOW_Y - LOW_T / 2 + 0.02, 0], mat: 'pitch', smooth: true, keep: true, maxLod: 1, tag: 'lens' }),
  // untere Linse (breit, Bernstein-Tiefe)
  lens({ radius: 0.76, thickness: LOW_T, segments: 10, rings: 4, at: [0, LOW_Y, 0], mat: 'amberdeep', smooth: true, keep: true, tag: 'lens' }),
  // Hals aus Pechglas mit Leuchtfuge: hebt die obere Linse sichtbar ab (runder Kopf im Schattenriss)
  cylinder({ radius: 0.3, height: NECK + 0.1, segments: 8, caps: false, at: [0, SEAM_Y, 0], mat: 'pitch', smooth: true, keep: true, tag: 'lens' }),
  torus({ radius: 0.34, tube: 0.07, segments: 10, sides: 3, at: [0, SEAM_Y, 0], mat: 'phase', smooth: true, keep: true, tag: 'ring' }),
  // obere Linse (kleiner, helles Bernsteinglas)
  lens({ radius: 0.64, thickness: UP_T, segments: 10, rings: 4, at: [0, UP_Y, 0], mat: 'amber', smooth: true, keep: true, tag: 'lens' }),
  // Glyphenring auf der oberen Linse
  glyphStrip({
    path: arcPoints(0.36, 0, 360, 16, 'y', [0, UP_Y + (UP_T / 2) * Math.sqrt(1 - (0.36 / 0.64) ** 2) + 0.004, 0]),
    normal: [0, 1, 0],
    width: 0.06,
    pattern: [0.26, -0.09, 0.08, -0.07],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  }),
  ...tonpunkte(1, -0.8, (x, z) => socketY(S, x, z)),
];

export default defineModel({
  id: 'f4:str_t1_estore',
  parts: [{ name: 'hull', shapes }],
  notes: 'v_estore: zwei gestapelte Linsen (Energy = rund) mit Leuchtfuge.',
});
