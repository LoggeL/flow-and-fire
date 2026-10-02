/**
 * Erzspeicher (core:str_t1_mstore) – Varkan-Massenspeicher T1 auf 2×2.
 *
 * Roster: „Niedriger eckiger Stapel (Mass = eckig), kein Schlot.“ faction.md §5.2 Storage: niedrige Stapel, Mass
 * eckig (`hull`), flach; verboten: Schlot, liegender Kessel. Pflicht-Paartest Erzspeicher ↔ Glutspeicher (rund).
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Gusssockel 2×2, untere Lage: drei Erzbarren längs (Eisen), obere Lage: zwei Barren quer (Teamfarbe),
 *   Kupfer-Spannbänder, Tech-Streifen (Keramik) hinten.
 */
import { beveledBox, box, defineModel, mirrorX, stripes } from "@faf/modelkit";

const TOP = 0.16;
const L1 = 0.24; // Höhe untere Lage
const L2 = 0.22; // Höhe obere Lage

export default defineModel({
  id: "core:str_t1_mstore",
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
        // untere Lage: drei Barren längs
        ...[-0.5, 0, 0.5].map((x) =>
          beveledBox({
            size: [0.44, L1, 1.5],
            at: [x, TOP + L1 / 2, 0],
            bevel: { top: 0.07, topFront: 0.1, topBack: 0.1 },
            mat: "body",
            tag: "hull",
          }),
        ),
        // obere Lage: zwei Barren quer (Teamfarbe)
        ...[-0.3, 0.3].map((z) =>
          beveledBox({
            size: [1.24, L2, 0.46],
            at: [0, TOP + L1 + L2 / 2, z],
            bevel: { top: 0.07 },
            mat: "team",
            keep: true,
            tag: "hull",
          }),
        ),
        // Chamfered retaining jaws and recessed end hatches make the stack a contained industrial store.
        mirrorX(beveledBox({
          size: [0.14, 0.4, 0.2], at: [0.7, TOP + 0.2, 0],
          bevel: { top: 0.05 }, mat: "copper", maxLod: 0, tag: "hull",
        })),
        ...[-0.82, 0.82].map((z) => beveledBox({
          size: [0.75, 0.18, 0.12], at: [0, TOP + 0.12, z],
          bevel: { top: 0.04 }, mat: "soot", maxLod: 0, tag: "hull",
        })),
        // Kupfer-Spannbänder über den Stapel
        ...[0.46, -0.46].map((x) =>
          box({
            size: [0.12, 0.05, 1.1],
            at: [x, TOP + L1 + L2 + 0.005, 0],
            mat: "copper",
            maxLod: 0,
            tag: "barrel",
          }),
        ),
        stripes({ count: 1, width: 0.8, at: [0, TOP + 0.004, -0.86] }),
      ],
    },
  ],
  notes: "v_mstore: eckiger Barrenstapel, kein Schlot, keine Glut.",
});
