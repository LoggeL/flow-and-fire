/**
 * Kokon II (f2:str_t2_shield) – Schildgenerator T2, 6×6.
 *
 * Roster: „Netzring waagerecht (Ø ≥ 0,8 × Footprint-Kante) auf Fühler-Dreibein; kein V.“ faction.md §5.2
 * Schildgenerator: Netzring waagerecht auf Fühler-Dreibein, Ring-Ø ≥ 4,8 WU; verboten: V-Fühler.
 * Drei geknickte Fühler (Kitbash `antenna`) stehen auf der Kruste, knicken mit hohem Knie nach außen und laufen
 * oben in einem Sehnenknoten zusammen. Um den Knoten liegt waagerecht der teamfarbene Sechskant-Netzring (Ø 5,1 WU),
 * mit sechs Sehnen-Speichen als Netz; Ring, Speichen und Knoten drehen sich langsam (Yaw); LOD2 ohne Speichen und Knoten. Paartest Fühler↔Kokon:
 * geschlossener Ring als höchster, breitester Umriss gegen das offene V. Keine Glut (keine Flow-Einheit).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kruste (Teamrand), Dreibein aus drei Fühlern, 2 Kerben
 *   ring – Netzring (Team) + 6 Speichen + Knoten; dreht um +Y   (PartStream 1)
 */
import { defineModel, prism, radial, stripes, strut } from '@faf/modelkit';
import { crust, feeler, hexRing } from './_wehr.ts';

const K = crust({ size: [5.88, 5.88], h: 0.42, rim: 0.34, sink: 0.12, jag: 0.1, seed: 53 });
const F = K.floor;
const RING_Y = 3.0;
const RING_OUT = 2.55;
const RING_IN = 2.15;
const HUB_R = 0.4;
const rad = (a: number): number => (a * Math.PI) / 180;

/** Dreibein-Fühler bei Winkel a (0° = +X, 90° = vorn): Wurzel r 1,5, Knie außen r 1,95, Spitze am Knoten. */
function leg(a: number): ReturnType<typeof feeler> {
  const at = (r: number, y: number): [number, number, number] => [r * Math.cos(rad(a)), y, r * Math.sin(rad(a))];
  return feeler({ root: at(1.5, F - 0.05), knee: at(1.95, 1.6), tip: at(0.3, RING_Y - 0.1), radius: [0.28, 0.25, 0.16] });
}

export default defineModel({
  id: 'f2:str_t2_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...leg(90),
        ...leg(210),
        ...leg(330),
        stripes({ count: 2, width: 0.45, stripe: 0.2, gap: 0.16, rot: [0, 90, 0], at: [0.18, F + 0.01, -1.95] }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, 0],
      anim: 'yaw',
      shapes: [
        // Netzring: flacher Sechskant-Ring (Kitbash `webring`), Teamfarbe
        hexRing({ outer: RING_OUT, inner: RING_IN, height: 0.22, at: [0, RING_Y, 0], mat: 'team' }),
        // Netz: sechs Speichen (Sehne) vom Knoten zu den Ringecken
        radial(strut({ from: [HUB_R - 0.05, RING_Y, 0], to: [RING_IN + 0.05, RING_Y, 0], radius: 0.1, sides: 3, caps: false, mat: 'sinew', maxLod: 1, tag: 'webring' }), {
          count: 6,
          startDeg: 30,
        }),
        // Knoten: Sechskant-Prisma, in dem die Dreibein-Spitzen zusammenlaufen
        prism({ sides: 6, radius: HUB_R, height: 0.42, at: [0, RING_Y + 0.02, 0], mat: 'chitin', keep: true, maxLod: 1, tag: 'webring' }),
      ],
    },
  ],
  notes: 'v_shield: Ring-Ø 5,1 WU (≥ 0,8 × 6). Dreibein statisch im Rumpf, Ring + Netz drehen (1 animierter Part).',
});
