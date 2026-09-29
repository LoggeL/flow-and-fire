/**
 * Kokon III (f2:str_t3_shield) – Schildgenerator T3, 6×6 (Roster-Maßstab y 1,17).
 *
 * Roster: „Kokon auf 6×6 (Höhe × 1,4/1,2) mit zweitem Netzring und Seitenplatten, 3 Tech-Streifen.“ Grundform wie
 * Kokon II (Kruste, Fühler-Dreibein, drehender teamfarbener Sechskant-Netzring mit Speichen um den Knoten); T3 = ein
 * zweiter, fester Netzring (Chitin) auf Kniehöhe, der die drei Knie verbindet, drei Chitin-Seitenplatten zwischen den
 * Dreibein-Füßen, 3 Kerben und die Höhe × 1,17 aus dem Roster-Maßstab.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn):
 *   hull – Kruste (Teamrand), Seitenplatten, Dreibein, zweiter Netzring, 3 Kerben
 *   ring – Netzring (Team) + 6 Speichen + Knoten; dreht um +Y   (PartStream 1)
 */
import { defineModel, plate, prism, radial, stripes, strut } from '@faf/modelkit';
import { crust, feeler, hexRing } from './_wehr.ts';

const K = crust({ size: [5.88, 5.88], h: 0.42, rim: 0.34, sink: 0.12, jag: 0.1, seed: 59 });
const F = K.floor;
const RING_Y = 3.0;
const RING_OUT = 2.6;
const RING_IN = 2.2;
const KNEE_R = 1.95;
const KNEE_Y = 1.6;
const HUB_R = 0.42;
const rad = (a: number): number => (a * Math.PI) / 180;
const LEGS = [90, 210, 330];

function leg(a: number): ReturnType<typeof feeler> {
  const at = (r: number, y: number): [number, number, number] => [r * Math.cos(rad(a)), y, r * Math.sin(rad(a))];
  return feeler({ root: at(1.5, F - 0.05), knee: at(KNEE_R, KNEE_Y), tip: at(0.3, RING_Y - 0.1), radius: [0.28, 0.25, 0.16], collars: false });
}

export default defineModel({
  id: 'f2:str_t3_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        // Seitenplatten (T3): drei Chitin-Schilde zwischen den Dreibein-Füßen, nach außen abfallend
        ...[30, 150, 270].map((a) =>
          plate({
            size: [1.5, 0.9],
            thickness: 0.12,
            arch: 0.1,
            segments: [1, 1],
            at: [1.55 * Math.cos(rad(a)), F + 0.3, 1.55 * Math.sin(rad(a))],
            rot: [0, 90 - a, 0],
            scale: 1,
            mat: 'chitin',
            maxLod: 0,
            tag: 'carapace',
          }),
        ),
        ...LEGS.flatMap((a) => leg(a)),
        // zweiter Netzring (fest, Chitin) auf Kniehöhe, Ecken an den Knien
        hexRing({ outer: KNEE_R + 0.2, inner: KNEE_R - 0.18, height: 0.18, at: [0, KNEE_Y, 0], startDeg: 90, mat: 'chitin', maxLod: 1 }),
        stripes({ count: 3, width: 0.45, stripe: 0.2, gap: 0.14, rot: [0, 90, 0], at: [0.34, F + 0.01, -1.95], maxLod: 1 }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, 0],
      anim: 'yaw',
      shapes: [
        hexRing({ outer: RING_OUT, inner: RING_IN, height: 0.22, at: [0, RING_Y, 0], mat: 'team' }),
        radial(strut({ from: [HUB_R - 0.05, RING_Y, 0], to: [RING_IN + 0.05, RING_Y, 0], radius: 0.1, sides: 3, caps: false, mat: 'sinew', maxLod: 0, tag: 'webring' }), {
          count: 6,
          startDeg: 30,
        }),
        prism({ sides: 6, radius: HUB_R, height: 0.44, at: [0, RING_Y + 0.02, 0], mat: 'chitin', keep: true, maxLod: 1, tag: 'webring' }),
      ],
    },
  ],
  notes: 'v_shield T3: Ring-Ø 5,2 WU, zweiter Ring fest im Rumpf (Roster: 1 animierter Part), Roster-Maßstab y 1,17.',
});
