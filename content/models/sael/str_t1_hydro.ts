/**
 * Quellbogen (f3:str_t1_hydro) – Sael-Dampfkraftwerk auf 6×6 (ID `hydro` bleibt intern, faction.md §2.5).
 *
 * Roster: „Ring mit drei Bögen, die sich über dem Spot treffen; Goldkern (umschlossene Perle) im Scheitel.“
 * faction.md §5.2 Quellbogen: `ring` mit drei Bögen (`arch`), die sich über dem Spot treffen, Goldkern im Scheitel;
 * verboten: Laterne. §3.2: Kissen-Sockel füllt den Footprint, Teamfarbe am Sockelrand (20–30 % der Draufsicht).
 * Pflichtpaar Brunnen III↔Quellbogen: drei Bögen über dem Ring (Brunnen: Doppelring, Kelch, keine Bögen).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 6×6 (Emaille-Rand, Perlmutt-Einlage), dunkler Spot, goldener Kranz um den Spot, drei
 *          Perlmutt-Bögen (je ein Viertelkreis vom Kranz zum Scheitel, 120° versetzt, zur Spitze verjüngt),
 *          Goldkern-Perle im Scheitel, von den Bogenenden umschlossen, Tech-Streifen (Tiefjade) hinten links;
 *          keine beweglichen Teile.
 */
import { defineModel, sphere, stripes, torus, torusArc, type Shape } from '@faf/modelkit';
import { circlePts, cushion, flatPoly } from './str_t1_mex.ts';

const CUSHION_H = 0.3;
const TOP = CUSHION_H + 0.006;
const RING_R = 2.05;
const ARCH_R = RING_R; // Viertelkreis: Fuß auf dem Kranz, Scheitel über dem Spot
const ARCH_Y = TOP + 0.14; // Bogenmittelpunkt (Kranzoberkante)
const APEX_Y = ARCH_Y + ARCH_R;

/** Bogen: Viertelkreis in der senkrechten Ebene, Fuß außen auf dem Kranz (Richtung `deg`), Scheitel über dem Spot. */
function arch(deg: number, segments: number, sides: number, lod: 0 | 1 | 2): Shape {
  return torusArc({
    radius: ARCH_R,
    tube: 0.26,
    arc: 90,
    startDeg: 270, // lokal: 270° = Scheitel (oben), 360° = Fuß (+x)
    segments,
    sides,
    flatten: 0.8,
    taper: 1.6, // am Bogenende (Fuß) breiter als am Scheitel
    axis: 'z',
    rot: [0, deg, 0],
    at: [0, ARCH_Y, 0],
    mat: 'nacre',
    keep: true,
    minLod: lod,
    maxLod: lod,
    tag: 'arch',
  });
}

const hull: Shape[] = [
  ...cushion({ size: 5.9, height: CUSHION_H, inset: 0.36 }),
  // Spot (dunkel) im Kranz
  flatPoly(circlePts(1.7, 12), TOP + 0.004, 'rind', 1),
  // Kranz (Gold) um den Spot
  torus({ radius: RING_R, tube: 0.2, segments: 12, sides: 3, scale: [1, 0.7, 1], at: [0, TOP + 0.12, 0], mat: 'gold', keep: true, tag: 'ring' }),
  // drei Bögen: Viertelkreis in der senkrechten Ebene, Fuß außen auf dem Kranz, Scheitel über dem Spot
  ...[90, 210, 330].flatMap((deg) => [arch(deg, 6, 4, 0), arch(deg, 6, 3, 1), arch(deg, 6, 3, 2)]),
  // Goldkern im Scheitel, von den drei Bogenenden umschlossen
  sphere({ radius: 0.5, segments: 8, rings: 3, at: [0, APEX_Y - 0.04, 0], mat: 'light', keep: true, tag: 'orb' }),
  // Tech-Streifen (Tiefjade) auf der Einlage hinten links
  stripes({ count: 1, width: 0.9, at: [1.9, TOP + 0.004, -2.3], mat: 'jade' }),
];

export default defineModel({
  id: 'f3:str_t1_hydro',
  parts: [{ name: 'hull', smooth: true, shapes: hull }],
  notes: 'v_hydro: Kranz + drei Bögen + Scheitel-Goldkern, statisch.',
});
