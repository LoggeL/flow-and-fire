/**
 * Landwerk I (core:str_t1_fac_land) – Varkan-Landfabrik T1 auf 8×8; Grundform aller Werke (`worksParts`, auch für
 * die Luftwerke).
 *
 * Roster: „U-Portal mit Rampe (offene Seite = Ausgang), glühendes Werkhallentor.“ faction.md §5.2 Fabrik: U-Portal
 * (offene Seite = Ausgang), Land mit Rampe, Luft mit Landescheibe, Werkhallentor = Glutkern. Strukturen: Teamfarbe
 * auf dem Randband des Dachs (Wandkappen) und dem Dachzentrum (20–30 % der Draufsicht). In-Place-Upgrades (II/III)
 * wachsen nur in der Höhe (Roster-Maßstab y 1,2 / 1,4) und bekommen Schlote, Schürzen und Streifen.
 *
 * Aufbau (y = Boden, +Z = Ausgang):
 *   hull – Gusssockel (Land: vorn Rampe zwischen zwei Sockelwangen; Luft: voller Sockel mit Landescheibe), Wände
 *          links/rechts mit 45°-Fasen und teamfarbenen Kappen, Rückwand, Dach über der hinteren Halle (Dachzentrum
 *          team), Kupferleitungen auf dem Dach, Tech-Streifen (Keramik) hinten auf dem Dach; T2/T3: Schlote auf den
 *          Wänden, T3: Schürzen außen an den Wänden
 *   gate – Werkhallentor: Glutfläche mit Eisenrippen unter der Dachkante, klappt nach oben (Pitch)  (PartStream 1)
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  extrude,
  mirrorX,
  quad,
  stripes,
  wedge,
  type PartDef,
  type Shape,
} from "@faf/modelkit";

const TOP = 0.3; // Sockelhöhe
const WALL_H = 1.8;
const WALL_X = 2.95;
const WALL_Z = -0.7; // Wandmitte (z −3,9 … 2,5)
const WALL_D = 6.4;
const ROOF_Y = TOP + WALL_H + 0.4; // Dachoberkante
const ROOF_Z0 = -3.9;
const ROOF_Z1 = -0.4;
const GATE_Z = ROOF_Z1 - 0.12;

export function worksParts(tech: 1 | 2 | 3, kind: "land" | "air"): PartDef[] {
  const hull: Shape[] = [];
  if (kind === "land") {
    // Sockel hinten + Rampe vorn zwischen zwei Sockelwangen (Footprint bleibt voll)
    hull.push(
      beveledBox({
        size: [7.9, TOP, 6.6],
        at: [0, TOP / 2, -0.65],
        bevel: { top: 0.2 },
        mat: "body",
        maxLod: 1,
        tag: "hull",
      }),
      wedge({
        size: [4.1, TOP, 1.3],
        at: [0, TOP / 2, 3.3],
        mat: "body",
        keep: true,
        tag: "hull",
      }),
      // Kupfer-Kanten der Rampe
      mirrorX(
        wedge({
          size: [0.2, TOP + 0.08, 1.3],
          at: [2.0, (TOP + 0.08) / 2, 3.3],
          mat: "copper",
          maxLod: 1,
          tag: "hull",
        }),
      ),
      mirrorX(
        box({
          size: [1.9, TOP, 1.3],
          at: [3.0, TOP / 2, 3.3],
          mat: "body",
          maxLod: 1,
          tag: "hull",
        }),
      ),
      // LOD2: ein voller Sockelblock
      box({
        size: [7.9, TOP - 0.02, 7.9],
        at: [0, (TOP - 0.02) / 2, 0],
        mat: "body",
        minLod: 2,
      }),
      quad({
        size: [4.1, 3.0],
        at: [0, TOP + 0.004, 1.0],
        mat: "soot",
        maxLod: 0,
      }),
      // Gießrinne: Glutbahn vom Werkhallentor zur Rampe (Glutkern, von oben lesbar)
      quad({
        size: [0.7, 2.9],
        at: [0, TOP + 0.01, 1.0],
        mat: "glow",
        maxLod: 1,
      }),
    );
  } else {
    hull.push(
      beveledBox({
        size: [7.9, TOP, 7.9],
        at: [0, TOP / 2, 0],
        bevel: { top: 0.2 },
        mat: "body",
        maxLod: 1,
        tag: "hull",
      }),
      box({
        size: [7.9, TOP, 7.9],
        at: [0, TOP / 2, 0],
        mat: "body",
        minLod: 2,
      }),
      // Landescheibe (Ring) mit dunkler Mitte und vier Glut-Landefeuern
      cylinder({
        radius: 2.05,
        height: 0.24,
        at: [0, TOP + 0.12, 1.6],
        segments: 12,
        caps: "top",
        mat: "copper",
        keep: true,
        tag: "ring",
      }),
      cylinder({
        radius: 1.72,
        height: 0.02,
        at: [0, TOP + 0.25, 1.6],
        segments: 12,
        caps: "top",
        mat: "soot",
        maxLod: 1,
        tag: "ring",
      }),
      ...[
        [1.87, 1.6],
        [-1.87, 1.6],
        [0, 3.47],
        [0, -0.27],
      ].map(([x, z]) =>
        quad({
          size: [0.44, 0.44],
          at: [x!, TOP + 0.245, z!],
          mat: "glow",
          maxLod: 0,
        }),
      ),
    );
  }
  hull.push(
    // Wände links/rechts (45°-Fasen) mit teamfarbenen Kappen = Randband des Dachs
    mirrorX(
      extrude({
        // A clipped nose and rear shoulder keep the factory from reading as two solid bricks.
        profile: [
          [ROOF_Z0, TOP], [2.5, TOP], [2.5, TOP + 1.15],
          [1.85, TOP + WALL_H], [-3.55, TOP + WALL_H], [ROOF_Z0, TOP + 1.45],
        ],
        depth: 1.5,
        axis: "x",
        at: [WALL_X, 0, 0],
        mat: "body",
        keep: true,
        tag: "hull",
      }),
    ),
    mirrorX(
      quad({
        size: [0.8, WALL_D - 1.2],
        at: [WALL_X, TOP + WALL_H + 0.004, WALL_Z - 0.15],
        mat: "team",
        keep: true,
      }),
    ),
    // Rückwand (geschlossene Seite des U)
    box({
      size: [4.5, WALL_H, 0.6],
      at: [0, TOP + WALL_H / 2, ROOF_Z0 + 0.3],
      mat: "body",
      maxLod: 1,
      tag: "hull",
    }),
    // Dach über der hinteren Halle, Dachzentrum teamfarben
    beveledBox({
      size: [4.7, 0.5, ROOF_Z1 - ROOF_Z0],
      at: [0, ROOF_Y - 0.25, (ROOF_Z0 + ROOF_Z1) / 2],
      bevel: { top: 0.2 },
      mat: "body",
      keep: true,
      tag: "hull",
    }),
    // Raised, chamfered roof cassettes leave a visible central service channel.
    ...(tech === 3
      ? [
          beveledBox({
            size: [2.6, 0.08, 1.7], at: [0, ROOF_Y + 0.04, -1.75],
            bevel: { top: 0.06 }, mat: "team", keep: true, maxLod: 0, tag: "hull",
          }),
          quad({
            size: [0.12, 1.55], at: [0, ROOF_Y + 0.084, -1.75],
            mat: "soot", maxLod: 0,
          }),
        ]
      : [
          mirrorX(beveledBox({
            size: [1.24, 0.08, 1.7], at: [0.68, ROOF_Y + 0.04, -1.75],
            bevel: { top: 0.06 }, mat: "team", keep: true, maxLod: 0, tag: "hull",
          })),
        ]),
    box({
      size: [2.6, 0.08, 1.7], at: [0, ROOF_Y + 0.04, -1.75],
      mat: "team", keep: true, minLod: 1, maxLod: 1, tag: "hull",
    }),
    // Portal lintel and sloping knee supports expose the working bay beneath the roof.
    box({
      size: [4.3, 0.22, 0.26],
      at: [0, TOP + WALL_H - 0.11, GATE_Z + 0.2],
      mat: "copper",
      maxLod: 0,
    }),
    mirrorX(
      wedge({
        size: [0.3, 1.1, 1.0],
        at: [2.12, TOP + 0.55, 1.65],
        mat: "body",
        maxLod: 0,
        tag: "hull",
      }),
    ),
    quad({
      size: [2.6, 1.7],
      at: [0, ROOF_Y + 0.004, -1.75],
      mat: "team",
      minLod: 2,
    }),
    // Kupferleitungen längs über das Dach (der Flow in die Halle)
    mirrorX(
      cylinder({
        radius: 0.16,
        height: 3.1,
        axis: "z",
        at: [1.62, ROOF_Y + 0.1, (ROOF_Z0 + ROOF_Z1) / 2],
        segments: 6,
        caps: false,
        mat: "copper",
        maxLod: 0,
        tag: "barrel",
      }),
    ),
    stripes({
      count: tech,
      width: 2.6,
      at: [0, ROOF_Y + 0.004, -3.45 + (tech - 1) * 0.1],
      maxLod: 1,
    }),
  );
  // Schlote (nur Flow-Einheiten): T2 einer auf der rechten Wand, T3 zwei
  const stacks = tech === 1 ? [] : tech === 2 ? [-WALL_X] : [-WALL_X, WALL_X];
  for (const x of stacks) {
    hull.push(
      cylinder({
        radius: 0.42,
        height: 1.9,
        at: [x, TOP + WALL_H + 0.95, -3.0],
        segments: 8,
        caps: false,
        mat: "soot",
        keep: true,
        tag: "stack",
      }),
      cylinder({
        radius: 0.5,
        height: 0.4,
        at: [x, TOP + WALL_H + 1.99, -3.0],
        segments: 8,
        caps: "top",
        mat: "glow",
        keep: true,
        tag: "stack",
      }),
    );
  }
  if (tech === 3) {
    // Schürzen außen an den Wänden
    hull.push(
      mirrorX(
        wedge({
          size: [0.3, 1.0, 5.2],
          at: [3.8, TOP + 0.5, -0.9],
          mat: "body",
          maxLod: 0,
          tag: "hull",
        }),
      ),
    );
  }
  const gateY = TOP + (WALL_H - 0.1) / 2;
  const gate: Shape[] = [
    quad({
      size: [4.3, WALL_H - 0.1],
      at: [0, gateY, GATE_Z],
      rot: [90, 0, 0],
      mat: "glow",
      keep: true,
      tag: "hull",
    }),
    ...[-1.1, 1.1].map((x) =>
      box({
        size: [0.22, WALL_H - 0.1, 0.12],
        at: [x, gateY, GATE_Z + 0.06],
        mat: "body",
        maxLod: 0,
        tag: "hull",
      }),
    ),
  ];
  return [
    { name: "hull", shapes: hull },
    {
      name: "gate",
      pivot: [0, TOP + WALL_H, GATE_Z],
      anim: "pitch",
      shapes: gate,
    },
  ];
}

export default defineModel({
  id: "core:str_t1_fac_land",
  parts: worksParts(1, "land"),
  notes:
    'Grundform v_fac_land (und v_fac_air über worksParts(…, "air")); Werkhallentor = Roster-Anim „tilt“ → Pitch.',
});
