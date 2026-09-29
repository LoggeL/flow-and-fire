/**
 * Bernsteinkammer (f4:str_t1_mstore) – Aurith-Massespeicher auf 2×2.
 *
 * Roster: „Flaches Sechseckprisma aus Bernstein (Kristall-Primitiv mit Spitzenhöhe 0), Mass = eckig; keine Spitze,
 * kein Leuchten.“ faction.md §5.2 Speicher: Mass eckig (flaches Sechseckprisma), Energy rund (Lichtkammer); Paartest
 * Bernsteinkammer↔Lichtkammer. Flat Shading: der Block ist bewusst kantig (Gegenstück zu den runden Linsen).
 *
 * Aufbau (y = Boden, +Z = vorn): nur `hull`
 *   Dreipass-Sockel (team/Bernstein), Pechglas-Sockelplatte, Sechseckblock aus Bernsteinglas (Ecken zeigen in die
 *   Lappen), Deckplatte aus Bernstein-Tiefe mit Kante, Glyphenstriche auf drei Seitenflächen, Tonpunkt hinten.
 */
import { crystal, defineModel, glyphStrip, type Shape, type Vec3 } from '@faf/modelkit';
import { dreipass, MEX_SOCKET, socketY, tonpunkte } from './str_t1_mex.ts';

const S = MEX_SOCKET;
const BASE = socketY(S, 0.5, 0) - 0.02;
const R = 0.64; // Umkreis des Blocks
const H = 0.32;
const APO = R * Math.cos(Math.PI / 6);

/** Glyphenstrich senkrecht über die Seitenfläche mit Normalenrichtung `deg`. */
function sideGlyph(deg: number): Shape {
  const a = (deg * Math.PI) / 180;
  const n: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const t: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const c: Vec3 = [n[0] * APO, BASE + 0.06 + H / 2, n[2] * APO];
  return glyphStrip({
    path: [
      [c[0] - t[0] * 0.24, c[1], c[2] - t[2] * 0.24],
      [c[0] + t[0] * 0.24, c[1], c[2] + t[2] * 0.24],
    ],
    normal: n,
    width: 0.07,
    pattern: [0.14, -0.05, 0.06, -0.05, 0.12],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  });
}

const shapes: Shape[] = [
  ...dreipass(S),
  // Pechglas-Platte unter dem Block (dunkler Spalt, hebt den Block vom Sockel ab)
  crystal({ radius: R + 0.06, height: 0.08, tip: 0, at: [0, BASE + 0.04, 0], mat: 'pitch', keep: true, tag: 'crystal' }),
  // Sechseckblock aus Bernsteinglas (Kristall-Primitiv ohne Spitze), Ecken vorn und in den hinteren Lappen
  crystal({ radius: R, height: H, tip: 0, at: [0, BASE + 0.08 + H / 2, 0], mat: 'amber', keep: true, tag: 'crystal' }),
  // Deckplatte: Bernstein-Tiefe, leicht eingezogen, mit hellem Kantenring
  crystal({ radius: R * 0.8, height: 0.07, tip: 0, at: [0, BASE + 0.08 + H + 0.035, 0], mat: 'amberedge', keep: true, tag: 'crystal' }),
  crystal({ radius: R * 0.55, height: 0.04, tip: 0, at: [0, BASE + 0.08 + H + 0.09, 0], mat: 'amberdeep', maxLod: 1, tag: 'crystal' }),
  ...[0, 120, 240].map(sideGlyph),
  ...tonpunkte(1, -0.74, (x, z) => socketY(S, x, z)),
];

export default defineModel({
  id: 'f4:str_t1_mstore',
  parts: [{ name: 'hull', shapes }],
  notes: 'v_mstore: flaches Sechseckprisma (Mass = eckig), kein Resonanzkern.',
});
