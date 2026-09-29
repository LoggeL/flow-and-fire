/**
 * Glimmzelle (f2:str_t1_estore) – Skarn-Energiespeicher T1 auf 2×2.
 *
 * Roster: „Zwei flache Sechseckzellen mit Deckelglimmen (Nervennaht, kein Herzkern); keine Druse, keine Spule.“
 * faction.md §5.2 Storage: Energy (Glimmzelle) = zwei flache Sechseckzellen mit Deckelglimmen (Nervennaht ≤ 2 %),
 * flach; verboten: Druse, Spule. Pflicht-Paartests Druse ↔ Glimmzelle (flache Zellen statt hoher Glutkristalle) und
 * Wabe ↔ Glimmzelle (zwei runde Sechseckzellen nebeneinander statt eines eckigen Stufen-Stapels).
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Kruste (Achteck, Krustengrau) mit gezackter Teamkante, zwei Sechseckzellen (Wände Team) links/rechts, darauf je
 *   ein facettierter Chitindeckel; zwischen Zelle und Deckel eine schmale Nervennaht (glow2) als Deckelglimmen,
 *   Tech-Streifen (Quarz) hinten auf der Kruste.
 */
import { defineModel, loftShape, stripes, type Shape, type Vec2 } from '@faf/modelkit';
import { crust } from './str_t1_mex.ts';

const CRUST_H = 0.16;
const CELL_H = 0.22;

function hex(r: number): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < 6; j++) {
    const t = (j / 6) * Math.PI * 2; // Ecke nach ±X: die Zellen stoßen mit den Spitzen aneinander
    out.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return out;
}

function cell(x: number): Shape[] {
  const top = CRUST_H + CELL_H;
  const at = (pts: Vec2[]): Vec2[] => pts.map(([u, v]): Vec2 => [u + x, v]);
  return [
    // Zellwand (Team), Sechseck mit Ecke nach außen
    loftShape({
      rings: [
        { y: CRUST_H - 0.02, pts: at(hex(0.5)) },
        { y: top, pts: at(hex(0.46)) },
      ],
      caps: { bottom: false },
      mat: 'team',
      keep: true,
      tag: 'crust',
    }),
    // Nervennaht: schmaler Glimmring (Sechseck-Kranz) um den Deckelrand
    loftShape({
      rings: [
        { y: top + 0.012, pts: at(hex(0.43)) },
        { y: top + 0.012, pts: at(hex(0.39)) },
      ],
      caps: { bottom: false, top: false },
      mat: 'nerve',
      maxLod: 1,
      tag: 'crust',
    }),
    // facettierter Chitindeckel (flache Sechseck-Pyramide mit Plateau)
    loftShape({
      rings: [
        { y: top + 0.03, pts: at(hex(0.39)) },
        { y: top + 0.1, pts: at(hex(0.22)) },
      ],
      caps: { bottom: false },
      mat: 'chitin',
      keep: true,
      tag: 'crust',
    }),
  ];
}

export default defineModel({
  id: 'f2:str_t1_estore',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...crust({ radius: 1.07, height: CRUST_H, crest: { lo: 0.04, hi: 0.14, width: 0.1 }, seed: 53, crestMaxLod: 1 }),
        ...cell(0.45),
        ...cell(-0.45),
        stripes({ count: 1, width: 0.34, at: [0, CRUST_H + 0.004, -0.66], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'v_estore: zwei Sechseckzellen mit Nervennaht-Deckelglimmen (kein Herzkern).',
});
