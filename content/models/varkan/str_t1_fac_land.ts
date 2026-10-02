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
  strut,
  stripes,
  tube,
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

/** T1-Landwerk allein: Die gemeinsame Grundform bleibt für alle anderen Werke bytegleich. */
function detailedLandFactoryParts(): PartDef[] {
  const [baseHull, baseGate] = worksParts(1, "land");
  const hull: Shape[] = [...baseHull!.shapes];
  const gate: Shape[] = [...baseGate!.shapes];

  // Aufgeschraubte Panzerkassetten zwischen sichtbaren tragenden Wandrahmen.
  for (const z of [-2.8, -0.85, 1.02]) {
    hull.push(
      mirrorX(beveledBox({
        size: [0.16, 1.08, 1.5], at: [3.73, 1.05, z], bevel: { top: 0.06, bottom: 0.035, topFront: 0.15 },
        mat: "body", maxLod: 0, tag: "hull",
      })),
      mirrorX(box({ size: [0.025, 0.58, 1.12], at: [3.818, 1.04, z], mat: "soot", maxLod: 0 })),
      mirrorX(strut({ from: [3.846, 0.79, z - 0.49], to: [3.846, 1.29, z + 0.49], radius: 0.055, sides: 4, caps: false, mat: "body", maxLod: 0 })),
      mirrorX(box({ size: [0.05, 0.15, 0.48], at: [3.845, 1.49, z], mat: "copper", maxLod: 0 })),
    );
  }
  for (const z of [-3.72, -1.8, 0.15, 1.96]) {
    hull.push(
      mirrorX(box({ size: [0.21, 1.62, 0.19], at: [3.75, 1.17, z], mat: "body", maxLod: 1, tag: "hull" })),
      mirrorX(beveledBox({ size: [0.38, 0.18, 0.38], at: [3.72, 0.42, z], bevel: { top: 0.07 }, mat: "copper", maxLod: 0 })),
    );
  }

  // Portalpfosten und untere Knie tragen den oberen Torzapfen tatsächlich bis zum Sockel.
  hull.push(
    mirrorX(box({ size: [0.21, 1.69, 0.28], at: [2.17, 1.195, GATE_Z], mat: "copper", maxLod: 1, tag: "hull" })),
    mirrorX(strut({ from: [2.17, 0.4, 0.12], to: [2.17, 1.01, GATE_Z], radius: 0.13, sides: 4, caps: false, mat: "body", maxLod: 0 })),
    mirrorX(beveledBox({ size: [0.36, 0.35, 0.4], at: [2.2, 2.04, GATE_Z], bevel: { top: 0.09 }, mat: "body", maxLod: 1 })),
    mirrorX(tube({ outer: 0.145, inner: 0.082, height: 0.09, axis: "x", at: [2.255, 2.1, GATE_Z], segments: 12, mat: "copper", smooth: true, maxLod: 0 })),
    // Tiefe obere Hallenträger bleiben hinter dem Tor und öffnen den vorderen Arbeitsbereich.
    mirrorX(box({ size: [0.17, 0.23, 3.11], at: [2.07, 1.88, -2.18], mat: "body", maxLod: 1 })),
    box({ size: [4.14, 0.18, 0.23], at: [0, 1.87, -3.52], mat: "copper", maxLod: 0 }),
  );

  // Zwei Kühlaggregate auf den Wandkappen: Hohlkragen, Lüfter und abgesetzte Luftkanäle.
  hull.push(
    mirrorX(beveledBox({ size: [1.03, 0.27, 1.44], at: [2.95, 2.235, -2.66], bevel: { top: 0.075 }, mat: "team", maxLod: 1 })),
    // Teamfarbene Wartungskassetten bleiben zwischen den Leitungen als Dachfläche lesbar.
    beveledBox({ size: [2.56, 0.06, 0.58], at: [0, 2.53, -3.0], bevel: { top: 0.025 }, mat: "team", maxLod: 0 }),
    beveledBox({ size: [2.56, 0.06, 0.39], at: [0, 2.53, -0.72], bevel: { top: 0.025 }, mat: "team", maxLod: 0 }),
    mirrorX(tube({ outer: 0.42, inner: 0.35, height: 0.085, at: [2.95, 2.41, -2.61], segments: 16, mat: "copper", smooth: true, maxLod: 0 })),
    mirrorX(cylinder({ radius: 0.35, height: 0.024, at: [2.95, 2.375, -2.61], segments: 16, caps: "top", mat: "soot", smooth: true, maxLod: 0 })),
    mirrorX(cylinder({ radius: 0.087, height: 0.046, at: [2.95, 2.411, -2.61], segments: 8, caps: "top", mat: "body", smooth: true, maxLod: 0 })),
  );
  for (const angle of [0, 60, 120]) {
    hull.push(mirrorX(box({ size: [0.6, 0.025, 0.055], at: [2.95, 2.396, -2.61], rot: [0, angle, 0], mat: "body", maxLod: 0 })));
  }
  for (const z of [-1.5, -1.28, -1.06, -0.84, -0.62]) {
    hull.push(
      mirrorX(box({ size: [0.84, 0.035, 0.12], at: [2.95, 2.135, z], mat: "soot", maxLod: 0 })),
      mirrorX(box({ size: [0.045, 0.06, 0.14], at: [3.28, 2.151, z], mat: "copper", maxLod: 0 })),
    );
  }

  // Flow-Verteiler: dicke Rohrleitungen mit Flanschen und befestigten Ventilgehäusen.
  for (const z of [-3.12, -1.19]) {
    hull.push(
      mirrorX(cylinder({ radius: 0.205, height: 0.13, axis: "z", at: [1.62, 2.6, z], segments: 12, caps: false, mat: "body", smooth: true, maxLod: 0 })),
      mirrorX(box({ size: [0.43, 0.13, 0.24], at: [1.62, 2.47, z], mat: "body", maxLod: 0 })),
    );
  }
  hull.push(
    mirrorX(strut({ from: [1.62, 2.6, -2.65], to: [2.4, 2.32, -2.65], radius: 0.1, sides: 10, caps: false, mat: "copper", smooth: true, maxLod: 0 })),
    mirrorX(cylinder({ radius: 0.18, height: 0.45, axis: "z", at: [3.7, 0.67, -2.7], segments: 12, mat: "copper", smooth: true, maxLod: 0 })),
    mirrorX(strut({ from: [3.78, 0.85, -2.7], to: [3.78, 1.7, -2.7], radius: 0.07, sides: 8, caps: false, mat: "copper", smooth: true, maxLod: 0 })),
    // Hintere Wartungsluke und ein Doppelrahmen um die zugängliche Motorkassette.
    beveledBox({ size: [2.7, 1.14, 0.15], at: [0, 1.02, -3.84], bevel: { top: 0.055 }, mat: "body", maxLod: 0 }),
    box({ size: [2.1, 0.68, 0.022], at: [0, 1.03, -3.929], mat: "soot", maxLod: 0 }),
    mirrorX(box({ size: [0.16, 0.22, 0.065], at: [0.78, 0.93, -3.917], mat: "copper", maxLod: 0 })),
  );
  for (const x of [-0.64, -0.32, 0, 0.32, 0.64]) {
    hull.push(box({ size: [0.1, 0.44, 0.035], at: [x, 1.06, -3.93], mat: "body", maxLod: 0 }));
  }

  // Zwei Förderbahnen rahmen die Gießrinne; Querrippen laufen über die geneigte Ausfahrt.
  hull.push(
    mirrorX(box({ size: [0.13, 0.11, 2.9], at: [1.77, 0.361, 1], mat: "copper", maxLod: 1 })),
    mirrorX(box({ size: [0.075, 0.045, 2.9], at: [0.46, 0.336, 1], mat: "body", maxLod: 0 })),
    cylinder({ radius: 0.105, height: 3.25, axis: "x", at: [0, 0.26, 2.45], segments: 12, caps: false, mat: "body", smooth: true, maxLod: 0 }),
    mirrorX(beveledBox({ size: [0.42, 0.17, 0.62], at: [3.0, 0.365, 3.26], bevel: { top: 0.05 }, mat: "body", maxLod: 0 })),
  );
  for (const z of [-0.24, 0.14, 0.52, 0.9, 1.28, 1.66, 2.04, 2.42]) {
    hull.push(mirrorX(box({ size: [1.14, 0.032, 0.16], at: [1.06, 0.329, z], mat: "body", maxLod: 0 })));
  }
  for (const z of [2.82, 3.05, 3.28, 3.51, 3.74]) {
    hull.push(box({ size: [3.8, 0.027, 0.075], at: [0, TOP * (3.95 - z) / 1.3 + 0.017, z], rot: [13, 0, 0], mat: "body", maxLod: 0 }));
  }

  // Ein echtes Torblatt hinter dem Glutpaneel, komplett am unveränderten oberen Pitch-Scharnier.
  const gateY = TOP + (WALL_H - 0.1) / 2;
  gate.push(
    box({ size: [4.2, 1.64, 0.1], at: [0, gateY, GATE_Z - 0.09], mat: "body", maxLod: 1, tag: "hull" }),
    cylinder({ radius: 0.079, height: 4.36, axis: "x", at: [0, TOP + WALL_H, GATE_Z], segments: 12, caps: false, mat: "copper", smooth: true, maxLod: 1 }),
    mirrorX(box({ size: [0.14, 1.72, 0.17], at: [2.04, gateY, GATE_Z + 0.065], mat: "body", maxLod: 1 })),
    mirrorX(beveledBox({ size: [0.43, 0.24, 0.19], at: [1.77, 0.49, GATE_Z + 0.075], bevel: { top: 0.05 }, mat: "copper", maxLod: 0 })),
  );
  for (const y of [0.36, 0.82, 1.49, 1.94]) {
    gate.push(box({ size: [4.12, 0.09, 0.16], at: [0, y, GATE_Z + 0.06], mat: "body", maxLod: 0 }));
  }
  for (const x of [-1.51, -0.53, 0.53, 1.51]) {
    gate.push(strut({ from: [x - 0.35, 0.88, GATE_Z + 0.075], to: [x + 0.35, 1.43, GATE_Z + 0.075], radius: 0.035, sides: 4, caps: false, mat: "body", maxLod: 0 }));
  }
  return [{ ...baseHull!, shapes: hull }, { ...baseGate!, shapes: gate }];
}

export default defineModel({
  id: "core:str_t1_fac_land",
  budget: { tris: [4000, 1000, 300] },
  parts: detailedLandFactoryParts(),
  notes:
    'Landwerk I mit Wandkassetten, tragendem Portal, Dachkühlung, Flow-Verteilern und Förderbahnen. Werkhallentor = Roster-Anim „tilt“ → Pitch am unveränderten oberen Scharnier; Zusatzdetails gelten nur für dieses Modell.',
});
