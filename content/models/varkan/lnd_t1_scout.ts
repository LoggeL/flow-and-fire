/**
 * Funke (core:lnd_t1_scout) – Varkan-Späher T1.
 *
 * Roster: „Kleinster Rumpf (Deck teamfarben), hoher dünner Mast ≥ 1,0 × Rumpflänge ohne Kopfteil, Glutnaht an der
 * Spitze.“ Rollen-Monopol Land-Späher (faction.md §5.2): kleinster Rumpf + hoher `mast`, kein Turm, kein Ring,
 * nichts Breites. Das Rumpf-MG sitzt starr im Bug (dunkle Bugluke mit Mündungsschlitz), keine Glocke.
 *
 * Aufbau (y = Boden, +Z = Bug), alles `hull` (keine drehenden Teile):
 *   Ketten (dunkel), Wanne unten, Deck mit steiler Bugfase, Deckplatte (team, fast das ganze Deck),
 *   Kupfermast 1,0 WU (≈ 1,1 × Rumpflänge) mit Gusskragen und Glutkappe, Heckkrümmer mit Glutschlitz, 1 Tech-Streifen.
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, stripes } from '@faf/modelkit';

/** Seitenprofil einer Kette [z, y] (verkürzte Punze-Kette). */
const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.36, 0],
  [0.34, 0],
  [0.45, 0.1],
  [0.4, 0.2],
  [-0.41, 0.2],
  [-0.45, 0.1],
];

const DECK_TOP = 0.33;
const PLATE_TOP = 0.36;
const MAST_Z = -0.12;
const MAST_BASE = PLATE_TOP;
const MAST_TOP = MAST_BASE + 1.0;

export default defineModel({
  id: 'core:lnd_t1_scout',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.17, axis: 'x', at: [0.245, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.34, 0.14, 0.74], at: [0, 0.13, 0], mat: 'dark', tag: 'hull' }),
        // Deck mit steiler Bugfase (Fahrtrichtung)
        beveledBox({
          size: [0.68, DECK_TOP - 0.19, 0.88],
          at: [0, (DECK_TOP + 0.19) / 2, 0],
          bevel: { top: 0.04, topFront: 0.11, topBack: 0.05 },
          mat: 'body',
          tag: 'hull',
        }),
        // Deckplatte (Teamfarbe) – beim Funken ist fast das ganze Deck Bannerplatte
        beveledBox({ size: [0.58, PLATE_TOP - DECK_TOP, 0.66], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.02], bevel: { top: 0.012 }, mat: 'team' }),
        // Starres Bug-MG: dunkle Luke in der Bugfase + Mündungsschlitz
        beveledBox({ size: [0.24, 0.09, 0.1], at: [0, 0.27, 0.43], bevel: { topFront: 0.03 }, mat: 'dark', maxLod: 1 }),
        quad({ size: [0.12, 0.03], at: [0, 0.279, 0.487], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
        // Mast: Gusskragen + Kupfermast (Ø 0,13) + Glutkappe an der Spitze
        frustum({ radius: 0.13, radiusTop: 0.085, height: 0.1, at: [0, MAST_BASE + 0.05, MAST_Z], segments: 6, caps: 'top', mat: 'body', tag: 'mast' }),
        cylinder({ radius: 0.065, height: MAST_TOP - MAST_BASE, axis: 'y', at: [0, (MAST_TOP + MAST_BASE) / 2, MAST_Z], segments: 6, caps: false, mat: 'copper', keep: true, tag: 'mast' }),
        cylinder({ radius: 0.07, height: 0.05, at: [0, MAST_TOP + 0.025, MAST_Z], segments: 6, caps: 'top', mat: 'glow', keep: true, tag: 'mast' }),
        // Heckkrümmer (Kupfer) mit Glutschlitz
        beveledBox({ size: [0.6, 0.06, 0.1], at: [0, DECK_TOP + 0.03, -0.37], bevel: { top: 0.015 }, mat: 'copper', tag: 'manifold' }),
        quad({ size: [0.3, 0.035], at: [0, DECK_TOP + 0.064, -0.37], mat: 'glow' }),
        stripes({ count: 1, width: 0.5, at: [0, PLATE_TOP + 0.004, -0.25] }),
      ],
    },
  ],
  notes: 'Kein Turm (Monopol-Regel): Rumpf-MG starr im Bug. Mast ohne Kopfteil, Glutkappe = Glutnaht an der Spitze.',
});
