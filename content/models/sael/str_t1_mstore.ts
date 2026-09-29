/**
 * Zisterne (f3:str_t1_mstore) – Sael-Massespeicher auf 2×2.
 *
 * Roster: „Flaches, offenes Oval-Becken (umgedrehte Schale), Goldrand; keine Laterne, kein Ring.“
 * faction.md §5.2 Storage: Mass = Zisterne, flaches offenes Oval-Becken (`shell` umgedreht), flach; verboten:
 * stehende Laterne, Ring. §3.2/§4.2: Kissen-Sockel füllt den Footprint, Teamfarbe am Sockelrand.
 * Pflichtpaar Zisterne↔Schrein: offenes, dunkel gefülltes Becken (Schrein: zwei liegende Leuchtlinsen).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 2×2 (Emaille-Rand, Perlmutt-Einlage), Oval-Becken (hohle Perlmutt-Schale, Öffnung oben) mit
 *          flacher goldener Randlippe, Füllung (Schalenrinde) mit Jade-Lichtnaht, Tech-Streifen (Tiefjade) hinten;
 *          keine beweglichen Teile.
 */
import { arcPoints, defineModel, domeShell, glyphStrip, stripes, torusArc, type Shape } from '@faf/modelkit';
import { circlePts, cushion, flatPoly } from './str_t1_mex.ts';

const CUSHION_H = 0.16;
const TOP = CUSHION_H + 0.006;
const BASIN_R = 0.78; // Kugelradius des Beckens (vor der Oval-Stauchung)
const BASIN_SZ = 0.66; // Stauchung in z: Oval
const BASIN_D = 0.3; // Beckentiefe nach der Stauchung in y
const RIM_Y = TOP + BASIN_D;

const hull: Shape[] = [
  ...cushion({ size: 1.96, height: CUSHION_H, inset: 0.14 }),
  // Becken: hohle Kugelkappe, umgedreht (Öffnung oben), flach und oval
  domeShell({ radius: BASIN_R, thickness: 0.06, arc: 62, segments: 12, rings: 2, rot: [180, 0, 0], scale: [1.12, 0.72, BASIN_SZ], at: [0, TOP + BASIN_D / 2, 0], mat: 'nacre', keep: true, tag: 'shell' }),
  // Füllung (dunkel, knapp unter dem Rand)
  flatPoly(circlePts(0.66, 12, 0.6 * BASIN_SZ), RIM_Y - 0.06, 'rind', 2),
  // Jade-Lichtnaht auf der Füllung (Speicher-Füllstand, ≤ 2 %)
  glyphStrip({ path: arcPoints(0.38, 200, 340, 5, 'y', [0, RIM_Y - 0.054, 0]).map(([x, y, z]) => [x, y, z * BASIN_SZ] as const), width: 0.05, pattern: [0.16, -0.07], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
  // goldene Randlippe (flacher Wulst, kein freistehender Ring)
  torusArc({ radius: 0.7, tube: 0.07, arc: 359, startDeg: 0, segments: 14, sides: 4, flatten: 0.45, axis: 'y', scale: [1.12, 1, BASIN_SZ + 0.01], at: [0, RIM_Y - 0.01, 0], mat: 'gold', keep: true, tag: 'wing' }),
  // Tech-Streifen (Tiefjade) hinten auf der Einlage
  stripes({ count: 1, width: 0.5, at: [0, TOP + 0.004, -0.72], mat: 'jade' }),
];

export default defineModel({
  id: 'f3:str_t1_mstore',
  parts: [{ name: 'hull', smooth: true, shapes: hull }],
  notes: 'v_mstore: offenes Oval-Becken mit Goldlippe, statisch.',
});
