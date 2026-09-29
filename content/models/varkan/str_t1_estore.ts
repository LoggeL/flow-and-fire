/**
 * Glutspeicher (core:str_t1_estore) – Varkan-Energiespeicher T1 auf 2×2.
 *
 * Roster: „Zwei stehende, flache Trommeln (Ø 0,8 × Kante, Höhe ≤ 0,3 × Kante; Energy = rund), kein liegender Kessel,
 * kein Schlot.“ Pflicht-Paartests Glutkessel ↔ Glutspeicher und Erzspeicher ↔ Glutspeicher.
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Gusssockel 2×2, untere Trommel (Eisen), Glutfuge, obere Trommel (Teamfarbe) mit Eisendeckel (Teamfarbe bleibt als
 *   Randband sichtbar), zwei Kupfer-Steigleitungen, Tech-Streifen (Keramik) hinten.
 */
import { beveledBox, cylinder, defineModel, stripes } from "@faf/modelkit";

const TOP = 0.16;
const R = 0.8; // Ø 1,6 = 0,8 × Kante
const H = 0.24; // ≤ 0,3 × Kante je Trommel

export default defineModel({
  id: "core:str_t1_estore",
  parts: [
    {
      name: "hull",
      shapes: [
        beveledBox({
          size: [1.96, TOP, 1.96],
          at: [0, TOP / 2, 0],
          bevel: { top: 0.08 },
          mat: "body",
          tag: "hull",
        }),
        // untere Trommel (Eisen)
        cylinder({
          radius: R,
          height: H,
          at: [0, TOP + H / 2, 0],
          segments: 12,
          caps: false,
          mat: "body",
          keep: true,
          tag: "boiler",
        }),
        // Glutfuge zwischen den Trommeln
        cylinder({
          radius: R - 0.02,
          height: 0.06,
          at: [0, TOP + H + 0.03, 0],
          segments: 12,
          caps: false,
          mat: "glow",
          maxLod: 1,
        }),
        // obere Trommel (Teamfarbe) + Eisendeckel
        cylinder({
          radius: R,
          height: H,
          at: [0, TOP + H + 0.06 + H / 2, 0],
          segments: 12,
          caps: "top",
          mat: "team",
          keep: true,
          tag: "boiler",
        }),
        cylinder({
          radius: 0.56,
          height: 0.05,
          at: [0, TOP + 2 * H + 0.06 + 0.025, 0],
          segments: 12,
          caps: "top",
          mat: "body",
          tag: "boiler",
        }),
        // Kupfer-Steigleitungen vorn links/rechts, an der Trommelwand
        ...[0.585, -0.585].map((x) =>
          cylinder({
            radius: 0.09,
            height: 2 * H + 0.12,
            at: [x, TOP + H + 0.06, 0.585],
            segments: 6,
            caps: "top",
            mat: "copper",
            maxLod: 0,
            tag: "barrel",
          }),
        ),
        stripes({ count: 1, width: 0.5, at: [0, TOP + 0.004, -0.88] }),
      ],
    },
  ],
  notes:
    "v_estore: zwei flache stehende Trommeln, Glutfuge; kein Schlot, kein liegender Kessel.",
});
