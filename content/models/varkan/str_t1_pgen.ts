/**
 * Glutkessel I (core:str_t1_pgen) – Varkan-Kraftwerk T1; Grundform der Glutkessel-Familie (II/III importieren
 * `pgenParts`).
 *
 * Roster: „Liegender Kessel mit einem Schlot (Zahl der Schlote = Tech, Schlothöhe ≥ 1,5 × Kessel-Ø), glühende Krone,
 * Ruß-Gradient.“ faction.md §5.2 Pgen: liegender `boiler` mit 1–3 `stack`, Glutkronen. Kessel = Team-Part.
 * II (6×6) und III (8×8) sind Neubauten: dasselbe Modell im Basismaß 2×2, der Roster-Maßstab (3,0 / 4,0, Höhe ×1,2 /
 * ×1,4) wird beim Export eingebacken.
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Gusssockel 2×2, zwei Sättel (dunkel), liegender Kessel quer (Eisen-Mantel, Teamfarbe als Mantelplatte), Feuerloch
 *   mit Glutschlitz vorn, Schlote hinten (Eisenfuß, dunkler Schaft, Glutkrone), Kupferleitung Kessel → Schlot,
 *   Tech-Streifen (Keramik) hinten; II/III: Schürzenplatten.
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  quad,
  stripes,
  type PartDef,
  type Shape,
} from "@faf/modelkit";

const TOP = 0.16;
const BOILER_R = 0.36;
const BOILER_Y = TOP + 0.1 + BOILER_R;
const BOILER_Z = 0.22;

export function pgenParts(tech: 1 | 2 | 3): PartDef[] {
  const stackX =
    tech === 1 ? [0] : tech === 2 ? [0.42, -0.42] : [0.56, 0, -0.56];
  const stackH = 1.25; // ≥ 1,5 × Kessel-Ø (0,72)
  const stackZ = -0.56;
  const hull: Shape[] = [
    beveledBox({
      size: [1.96, TOP, 1.96],
      at: [0, TOP / 2, 0],
      bevel: { top: 0.08 },
      mat: "body",
      tag: "hull",
    }),
    // Sättel
    box({
      size: [0.2, 0.16, 0.62],
      at: [0.42, TOP + 0.08, BOILER_Z],
      mat: "soot",
      maxLod: 0,
    }),
    box({
      size: [0.2, 0.16, 0.62],
      at: [-0.42, TOP + 0.08, BOILER_Z],
      mat: "soot",
      maxLod: 0,
    }),
    // liegender Kessel: Eisenkern (Stirnseiten) + teamfarbener Mantel
    cylinder({
      radius: BOILER_R - 0.02,
      height: 1.5,
      axis: "x",
      segments: 8,
      at: [0, BOILER_Y, BOILER_Z],
      mat: "body",
      keep: true,
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: BOILER_R,
      height: 1.24,
      axis: "x",
      segments: 8,
      caps: false,
      at: [0, BOILER_Y, BOILER_Z],
      mat: "team",
      keep: true,
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: BOILER_R,
      height: 1.5,
      axis: "x",
      segments: 8,
      at: [0, BOILER_Y, BOILER_Z],
      mat: "team",
      keep: true,
      minLod: 2,
      tag: "boiler",
    }),
    // Feuerloch vorn: Gussblock + Glutschlitz (Glutkern)
    beveledBox({
      size: [0.5, 0.26, 0.2],
      at: [0, TOP + 0.13, BOILER_Z + BOILER_R + 0.02],
      bevel: { topFront: 0.08 },
      mat: "body",
      maxLod: 0,
    }),
    quad({
      size: [0.4, 0.14],
      at: [0, TOP + 0.12, BOILER_Z + BOILER_R + 0.125],
      rot: [90, 0, 0],
      mat: "glow",
      maxLod: 0,
    }),
    // Tech-Streifen (Keramik) hinten rechts neben den Schloten
    stripes({
      count: tech,
      width: 0.36,
      at: [
        tech === 1 ? 0.62 : 0,
        TOP + 0.004,
        tech === 1 ? -0.62 : -0.26 - (tech - 1) * 0.1,
      ],
    }),
  ];
  for (const x of stackX) {
    hull.push(
      // Schlotfuß (Eisen) + Kupferleitung vom Kessel
      box({
        size: [0.4, 0.24, 0.4],
        at: [x, TOP + 0.12, stackZ],
        mat: "copper",
        maxLod: 0,
        tag: "stack",
      }),
      box({
        size: [0.1, 0.1, 0.36],
        at: [x, BOILER_Y + 0.12, (stackZ + BOILER_Z) / 2 - 0.02],
        mat: "copper",
        maxLod: 0,
        tag: "barrel",
      }),
      // Schaft (dunkel, Ruß-Gradient im Shader) + Glutkrone
      cylinder({
        radius: 0.15,
        height: stackH,
        at: [x, TOP + stackH / 2, stackZ],
        segments: 6,
        caps: false,
        mat: "soot",
        keep: true,
        tag: "stack",
      }),
      cylinder({
        radius: 0.19,
        height: 0.26,
        at: [x, TOP + stackH + 0.02, stackZ],
        segments: 6,
        caps: "top",
        mat: "glow",
        keep: true,
        tag: "stack",
      }),
    );
  }
  if (tech >= 2) {
    // Schürzen: gefaste Platten an Front und Seiten
    hull.push(
      beveledBox({
        size: [1.9, 0.12, 0.22],
        at: [0, TOP + 0.06, 0.84],
        bevel: { topFront: 0.1 },
        mat: "body",
        maxLod: 1,
        tag: "hull",
      }),
    );
    if (tech === 3) {
      for (const x of [0.86, -0.86])
        hull.push(
          beveledBox({
            size: [0.2, 0.2, 1.1],
            at: [x, TOP + 0.1, 0.2],
            bevel: { top: 0.08 },
            mat: "body",
            maxLod: 1,
            tag: "hull",
          }),
        );
    }
  }
  return [{ name: "hull", shapes: hull }];
}

export default defineModel({
  id: "core:str_t1_pgen",
  parts: pgenParts(1),
  notes: "Grundform v_pgen (Basismaß 2×2).",
});
