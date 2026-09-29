/**
 * Seeigel (f3:lnd_t1_aa) – Sael-Flugabwehr-Schweber T1; Grundform der AA-Familie (Seestern T2, Diadem T3 importieren
 * `spineCrown`).
 *
 * Roster: „Schale auf Schwebeteller, Stachelkranz aus 3 dünnen senkrechten Stacheln (≥ 75°, Ø ≥ 0,17 WU) als Bogen
 * quer zur Fahrtrichtung.“
 * faction.md §5.2 Flugabwehr: Stachelkranz aus 3–5 dünnen senkrechten Stacheln (≥ 75°) quer zur Fahrtrichtung;
 * Stachel höchstens halb so dick wie eine Horn-Mündung; verboten: Horn, Perle, einzelner dicker Stachel.
 * Pflichtpaare Kauri↔Seeigel (senkrechter Fächer gegen Perle + waagerechte Lanze), Dünung↔Seeigel (dünne Stacheln
 * gegen dickes Schräghorn), Kreuz Seeigel↔Sieb (senkrecht = gegen Luft).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,25 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale 0,92 × 0,30 × 1,24 WU (Perlmuttrand 10 %, Emaille bis zum Scheitel), 1 Tech-Streifen,
 *            Lichtnaht
 *   turret – Stachelkranz: goldener Querbund mit drei Perlglanz-Stacheln (Mitte senkrecht, außen 12° gespreizt),
 *            dreht um +Y (1 animierter Part)
 */
import { defineModel, ellipsoid, spike, type Shape, type Vec3 } from '@faf/modelkit';
import { pad, seam, shell, surf, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

export interface Spine {
  /** Fußpunkt quer zur Fahrtrichtung. */
  readonly x: number;
  /** Höhe der Spitze über dem Fuß. */
  readonly h: number;
  /** Spreizung nach außen in Grad (≤ 15° ⇒ ≥ 75° Anstellwinkel). */
  readonly lean: number;
}

/** Stachelkranz auf der Schale bei `z`: goldener Querbund + dünne Stacheln (Ø 0,18 WU, 5 Seiten). */
export function spineCrown(sp: ShellSpec, spines: readonly Spine[], z: number, bund: number): { shapes: Shape[]; pivot: Vec3 } {
  const top = surf(sp, 0, z).p[1];
  const shapes: Shape[] = [
    ellipsoid({ radii: [bund, 0.05, 0.1], segments: 8, rings: 3, at: [0, top + 0.01, z], mat: 'gold', keep: true, tag: 'spine' }),
  ];
  for (const s of spines) {
    const y0 = surf(sp, s.x, z).p[1] - 0.03;
    const dx = Math.sign(s.x) * s.h * Math.tan((s.lean * Math.PI) / 180);
    shapes.push(spike({ from: [s.x, y0, z], to: [s.x + dx, y0 + s.h, z], radius: 0.09, sides: 5, mat: 'lustre', keep: true, tag: 'spine' }));
  }
  return { shapes, pivot: [0, top, z] };
}

const SHELL: ShellSpec = { rx: 0.46, ry: 0.3, rz: 0.62, y0: 0.06, drop: 0.3 };
const CROWN = spineCrown(
  SHELL,
  [
    { x: -0.2, h: 0.6, lean: 12 },
    { x: 0, h: 0.72, lean: 0 },
    { x: 0.2, h: 0.6, lean: 12 },
  ],
  -0.04,
  0.27,
);

export default defineModel({
  id: 'f3:lnd_t1_aa',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.51, 0.68),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        ...techStripes(SHELL, 1, -0.4),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    { name: 'turret', pivot: CROWN.pivot, anim: 'yaw', smooth: true, shapes: CROWN.shapes },
  ],
  notes: 'v_aa: Stachelkranz Yaw (1 animierter Part). Schwebehöhe 0,25 aus dem Roster.',
});
