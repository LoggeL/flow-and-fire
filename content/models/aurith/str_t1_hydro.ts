/**
 * Äolsharfe (f4:str_t1_hydro) – Aurith-Dampfkraftwerk auf 6×6 (ID `hydro` bleibt intern, faction.md §2.4).
 *
 * Roster: „Reif mit drei gebogenen Kämmen (Harfenbogen) um einen Kristall; keine senkrechten Pfeifen.“
 * faction.md §5.2 Äolsharfe: Reif + drei Harfenbögen + Kristall; Paartest Stimmstock III↔Äolsharfe (doppelter Reif
 * ohne Bögen gegen Bögen). Winkel-Code §5.1: Reif ohne Mast = Flow-Anschluss.
 *
 * Aufbau (y = Boden, +Z = vorn): nur `hull`
 *   Dreipass-Sockel 6×6 (team/Bernstein), Reif aus Pechglas mit Glyphenband, drei Harfenbögen aus Bernstein-Kante
 *   (steigen außen vom Reif auf und krümmen sich über den Kristall), Pechglas-Fuß mit zentralem Resonanzkristall,
 *   ein Tonpunkt Perlglas hinten.
 */
import { arcPoints, bezier, crystal, cylinder, defineModel, glyphStrip, sweep, torus, type Shape, type Vec3 } from '@faf/modelkit';
import { dreipass, socketY, tonpunkte, type SocketSpec } from './str_t1_mex.ts';

const SOCKET: SocketSpec = { half: 3, team: 0.16, amber: 0.26 };
const RING_R = 1.45;
const RING_Y = socketY(SOCKET, RING_R, 0) + 0.1;
const CORE_Y = socketY(SOCKET, 0, 0);

/** Harfenbogen im Winkel `deg` (von +X nach +Z): steigt außen am Reif auf, neigt sich über die Mitte. */
function harpBow(deg: number): Shape[] {
  const a = (deg * Math.PI) / 180;
  const P = (r: number, y: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];
  const ctrl = [P(RING_R + 0.05, RING_Y), P(2.45, 1.9), P(2.1, 4.3), P(0.75, 4.2)];
  const up: Vec3 = [-Math.sin(a), 0, Math.cos(a)]; // Profil-Breite in der Bogenebene, Dicke quer dazu
  // Querschnitt [Breite in der Bogenebene, Dicke quer]; spitz auslaufend (kein Deckel nötig)
  const w = (f: number): [number, number] => [0.34 * (1 - 0.8 * f) + 0.01, 0.15 * (1 - 0.6 * f)];
  const secs = (n: number): [number, number][] => Array.from({ length: n + 1 }, (_, i) => w(i / n));
  return [
    sweep({ path: bezier(ctrl, 4), radius: secs(4), sides: 4, caps: false, up, mat: 'amberedge', smooth: 60, keep: true, maxLod: 0, tag: 'fin' }),
    sweep({ path: bezier(ctrl, 3), radius: secs(3), sides: 3, caps: false, up, mat: 'amberedge', smooth: 60, keep: true, minLod: 1, maxLod: 1, tag: 'fin' }),
    sweep({ path: bezier(ctrl, 2), radius: secs(2), sides: 3, caps: false, up, mat: 'amberedge', keep: true, minLod: 2, tag: 'fin' }),
  ];
}

const shapes: Shape[] = [
  ...dreipass(SOCKET),
  // Reif (Pechglas) mit Glyphenband
  torus({ radius: RING_R, tube: 0.17, segments: 10, sides: 3, scale: [1, 0.8, 1], at: [0, RING_Y, 0], mat: 'pitch', keep: true, tag: 'ring' }),
  glyphStrip({
    path: arcPoints(RING_R, 0, 360, 30, 'y', [0, RING_Y + 0.14, 0]),
    width: 0.09,
    pattern: [0.5, -0.18, 0.16, -0.14, 0.34, -0.2],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  }),
  // drei Harfenbögen, dreizählig (über den Kerben zwischen den Lappen)
  ...[30, 150, 270].flatMap(harpBow),
  // Pechglas-Fuß und zentraler Resonanzkristall
  cylinder({ radius: 0.5, height: 0.34, segments: 6, caps: 'top', at: [0, CORE_Y + 0.12, 0], mat: 'pitch', keep: true, maxLod: 1, tag: 'crystal' }),
  crystal({ radius: 0.34, height: 1.7, tip: 0.55, at: [0, CORE_Y + 0.26 + 1.1, 0], mat: 'phase', keep: true, maxLod: 1, tag: 'crystal' }),
  crystal({ radius: 0.38, height: 1.9, tip: 0.55, sides: 3, at: [0, CORE_Y + 1.25, 0], mat: 'phase', keep: true, minLod: 2, tag: 'crystal' }),
  ...tonpunkte(1, -2.35, (x, z) => socketY(SOCKET, x, z), 0.24, 0.16),
];

export default defineModel({
  id: 'f4:str_t1_hydro',
  parts: [{ name: 'hull', shapes }],
  notes: 'v_hydro: Reif + drei Harfenbögen um einen Resonanzkristall.',
});
