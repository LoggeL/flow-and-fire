/**
 * Dampfquelle (core:str_t1_hydro) – Varkan-Hydrokarbon-Kraftwerk T1 auf 6×6.
 *
 * Roster: „Ring mit drei stehenden Schloten darin.“ faction.md §5.2 Hydro: `ring` mit drei stehenden `stack`.
 * Pflicht-Paartest Zapfstelle III ↔ Dampfquelle: hier drei hohe Schlote im großen Ring, bei der Zapfstelle keiner.
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Gusssockel 6×6, dunkle Quellschale, Ring (team), drei Schlote im Dreieck (Eisenfuß, dunkler Schaft, Glutkrone),
 *   Kupferleitungen Schlot → Ring, Tech-Streifen (Keramik) hinten.
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  group,
  radial,
  stripes,
  torus,
} from "@faf/modelkit";

const TOP = 0.3;
const STACK_H = 3.2;

export default defineModel({
  id: "core:str_t1_hydro",
  parts: [
    {
      name: "hull",
      shapes: [
        beveledBox({
          size: [5.9, TOP, 5.9],
          at: [0, TOP / 2, 0],
          bevel: { top: 0.2 },
          mat: "body",
          tag: "hull",
        }),
        // Quellschale (dunkel) mit Glutspalt in der Mitte
        cylinder({
          radius: 1.75,
          height: 0.06,
          at: [0, TOP + 0.03, 0],
          segments: 8,
          caps: "top",
          mat: "soot",
          maxLod: 0,
        }),
        cylinder({
          radius: 0.5,
          height: 0.04,
          at: [0, TOP + 0.07, 0],
          segments: 6,
          caps: "top",
          mat: "glow",
          maxLod: 0,
        }),
        // Ring (Teamfarbe)
        torus({
          radius: 2.15,
          tube: 0.36,
          segments: 12,
          sides: 4,
          scale: [1, 0.75, 1],
          at: [0, TOP + 0.27, 0],
          mat: "team",
          keep: true,
          tag: "ring",
        }),
        // drei Schlote im Ring
        radial(
          group([
            box({
              size: [1.0, 0.36, 1.0],
              at: [0, TOP + 0.18, 1.1],
              mat: "body",
              maxLod: 0,
              tag: "stack",
            }),
            cylinder({
              radius: 0.44,
              height: STACK_H,
              at: [0, TOP + STACK_H / 2, 1.1],
              segments: 8,
              caps: false,
              mat: "soot",
              keep: true,
              tag: "stack",
            }),
            cylinder({
              radius: 0.52,
              height: 0.24,
              at: [0, TOP + STACK_H + 0.02, 1.1],
              segments: 8,
              caps: "top",
              mat: "glow",
              keep: true,
              tag: "stack",
            }),
            box({
              size: [0.26, 0.26, 0.7],
              at: [0, TOP + 0.3, 1.8],
              mat: "copper",
              maxLod: 0,
              tag: "barrel",
            }),
          ]),
          { count: 3, startDeg: 180 },
        ),
        stripes({ count: 1, width: 1.6, at: [0, TOP + 0.004, -2.68] }),
      ],
    },
  ],
  notes:
    "v_hydro: Ring + drei Schlote; Glutkerne an den Schlotkronen und im Quellspalt.",
});
