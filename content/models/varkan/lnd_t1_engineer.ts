/**
 * Lehrling (core:lnd_t1_engineer) – Varkan-Engineer T1; die Grundform der Engineer-Familie (Geselle T2, Meister T3
 * importieren `engineerParts`).
 *
 * Roster: „Kurze breite Wanne mit Keramik-Deck, ein diagonaler Kupfer-Kranarm mit Glut-Emitter, liegender Kessel mit
 * teamfarbenem Bauchband; 1 Tech-Streifen graphit auf dem Keramik-Deck.“
 * Rollen-Monopol Engineer (faction.md §5.2): Kranarm (Kupfer) diagonal über dem Deck + Keramik-Deckplatte, Glutkern
 * an der Armspitze, asymmetrisch, Arme = Tech (verschieden lang), kein Turm mittig, keine Waffenform.
 * Teamfarbe: gefaste Wannen-Seitenbänder + Kessel-Bauchband (≥ 25 % der Draufsicht).
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite):
 *   hull    – Ketten, Unterwanne (dunkel), Wanne mit 45°-Fasen (team = Seitenband), Keramik-Deck, liegender Kessel
 *             (Eisen) mit Bauchband (team), Tech-Streifen graphit; T3: dritter, statischer Arm
 *   boom    – Kranarm 1 (lang): Drehkranz links hinten, zwei Kupferglieder diagonal nach vorn rechts   (PartStream 1)
 *   emitter – Glut-Emitter an der Armspitze, kippt (nur T1; bei T2/T3 statisch im Arm)                 (PartStream 2)
 *   boom2   – Kranarm 2 (kurz), rechts hinten (T2/T3)                                                   (PartStream 2)
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  extrude,
  frustum,
  group,
  mirrorX,
  quad,
  sphere,
  strut,
  sweep,
  tube,
  stripes,
  type PartDef,
  type Shape,
  type Vec3,
} from "@faf/modelkit";

/** Seitenprofil einer Kette [z, y]. */
const TRACK: readonly (readonly [number, number])[] = [
  [-0.42, 0],
  [0.42, 0],
  [0.52, 0.2],
  [-0.52, 0.2],
];

export const ENG_DECK = 0.41;

interface ArmSpec {
  /** Drehkranz (Pivot) im Modellraum. */
  readonly at: Vec3;
  /** Gierwinkel in Grad (0 = nach vorn, negativ = nach rechts/−X). */
  readonly yaw: number;
  /** Länge des Vorderglieds (verschieden lange Arme). */
  readonly reach: number;
}

/** Kranarm lokal entlang +Z: Drehkranz, steigendes Glied, fallendes Glied. */
function armShapes(
  a: ArmSpec,
  withTip: boolean,
  tipMaxLod: 0 | 1 | 2 = 2,
): Shape {
  const r = a.reach;
  const elbowZ = 0.45;
  const elbowY = 0.5;
  const tipY = 0.36;
  const fall = Math.atan2(elbowY - tipY, r) * (180 / Math.PI);
  const kids: Shape[] = [
    frustum({
      radius: 0.11,
      radiusTop: 0.07,
      height: 0.08,
      at: [0, 0.04, 0],
      segments: 6,
      caps: false, // Deck und steigendes Glied schließen die schmalen Enden.
      mat: "copper",
      maxLod: 0,
      tag: "boom",
    }),
    box({
      size: [0.17, 0.12, 0.62],
      at: [0, 0.26, 0.22],
      rot: [-47, 0, 0],
      mat: "copper",
      keep: true,
      maxLod: 1,
      tag: "boom",
    }),
    box({
      size: [0.17, 0.1, r + 0.06],
      at: [0, (elbowY + tipY) / 2, elbowZ + r / 2],
      rot: [fall, 0, 0],
      mat: "copper",
      keep: true,
      maxLod: 1,
      tag: "boom",
    }),
    // Querliegender Gusskragen am sichtbaren Ellbogen, nur im nahen LOD.
    cylinder({
      radius: 0.08,
      height: 0.21,
      axis: "x",
      at: [0, elbowY - 0.03, elbowZ - 0.01],
      segments: 6,
      caps: false,
      mat: "body",
      maxLod: 0,
      tag: "boom",
    }),
    // LOD2: ein gerades Glied vom Drehkranz zur Spitze
    box({
      size: [0.17, 0.12, Math.hypot(elbowZ + r, tipY - 0.1)],
      at: [0, (tipY + 0.1) / 2 + 0.05, (elbowZ + r) / 2],
      rot: [-Math.atan2(tipY - 0.1, elbowZ + r) * (180 / Math.PI), 0, 0],
      mat: "copper",
      keep: true,
      minLod: 2,
      tag: "boom",
    }),
  ];
  if (withTip) kids.push(...tipShapes(elbowZ + r, tipY, tipMaxLod));
  return group(kids, { at: a.at, rot: [0, a.yaw, 0] });
}

/** Glut-Emitter: Kupferkragen + Glutkern (lokal, am Ende des Arms). */
function tipShapes(z: number, y: number, maxLod: 0 | 1 | 2 = 2): Shape[] {
  return [
    sphere({
      radius: 0.125,
      segments: 6,
      rings: 3,
      at: [0, y - 0.06, z],
      mat: "glow",
      keep: true,
      maxLod,
      tag: "ring",
    }),
  ];
}

/** Welt-Position der Armspitze (für den Emitter-Pivot). */
function tipWorld(a: ArmSpec): Vec3 {
  const z = 0.45 + a.reach;
  const t = (a.yaw * Math.PI) / 180;
  return [a.at[0] + z * Math.sin(t), a.at[1] + 0.3, a.at[2] + z * Math.cos(t)];
}

const ARM1: ArmSpec = { at: [0.27, ENG_DECK, -0.26], yaw: -30, reach: 0.62 };
const ARM2: ArmSpec = { at: [-0.25, ENG_DECK, -0.28], yaw: -35, reach: 0.2 };
const ARM3: ArmSpec = { at: [0.22, ENG_DECK, 0.02], yaw: 22, reach: 0.08 };

/** T1 detail stays local: the larger engineers retain their original family geometry. */
function detailedEngineerParts(): PartDef[] {
  const trackProfile = [
    [-0.43, 0], [0.43, 0], [0.51, 0.065], [0.51, 0.165],
    [0.43, 0.23], [-0.43, 0.23], [-0.51, 0.165], [-0.51, 0.065],
  ] as const;
  const runningGear: Shape[] = [
    extrude({
      profile: trackProfile,
      depth: 0.2,
      axis: "x",
      at: [0.37, 0, 0],
      mat: "dark",
      tag: "tracks",
    }),
    // One continuous recessed web behind the exposed hubs.
    extrude({
      profile: [[-0.39, 0.055], [0.39, 0.055], [0.44, 0.115], [0.39, 0.185], [-0.39, 0.185], [-0.44, 0.115]],
      depth: 0.008,
      axis: "x",
      at: [0.474, 0, 0],
      mat: "body",
      maxLod: 0,
    }),
  ];
  for (const z of [-0.34, 0, 0.34]) {
    runningGear.push(
      cylinder({
        radius: 0.075,
        height: 0.025,
        axis: "x",
        segments: 6,
        caps: "top",
        at: [0.48, 0.115, z],
        mat: "body",
        smooth: 45,
        maxLod: 0,
        tag: "tracks",
      }),
      cylinder({
        radius: 0.026,
        height: 0.029,
        axis: "x",
        segments: 4,
        caps: "top",
        at: [0.483, 0.115, z],
        mat: "copper",
        smooth: 45,
        maxLod: 0,
      }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const z = -0.375 + i * 0.15;
    runningGear.push(box({ size: [0.216, 0.022, 0.044], at: [0.37, 0.231, z], mat: "body", maxLod: 0, tag: "tracks" }));
  }
  // Wrap the shoes around the sloping sprocket ends instead of stacking blocks on the sides.
  for (const z of [-0.48, 0.48]) {
    runningGear.push(box({ size: [0.216, 0.022, 0.06], at: [0.37, 0.192, z], rot: [z < 0 ? 39 : -39, 0, 0], mat: "body", maxLod: 0 }));
  }
  const hull: Shape[] = [
    mirrorX(runningGear),
    box({
      size: [0.54, 0.14, 0.86],
      at: [0, 0.14, 0],
      mat: "dark",
      maxLod: 1,
      tag: "hull",
    }),
    beveledBox({
      size: [0.98, 0.16, 1],
      at: [0, 0.28, 0],
      bevel: { top: 0.09, topFront: 0.12 },
      mat: "team",
      tag: "hull",
    }),
    beveledBox({
      size: [0.76, 0.05, 0.78],
      at: [0, ENG_DECK - 0.025, -0.01],
      bevel: { top: 0.015 },
      mat: "ceramic",
      maxLod: 1,
      tag: "hull",
    }),
    quad({
      size: [0.8, 0.84],
      at: [0, 0.364, -0.01],
      mat: "ceramic",
      minLod: 2,
    }),
    // Boiler saddles and end plates make the transverse pressure vessel part of the chassis.
    mirrorX(box({
      size: [0.065, 0.085, 0.22],
      at: [0.23, 0.425, 0.2],
      mat: "dark",
      maxLod: 0,
    })),
    cylinder({
      radius: 0.14,
      height: 0.62,
      axis: "x",
      segments: 10,
      caps: false,
      at: [0.02, 0.56, 0.2],
      mat: "body",
      smooth: 45,
      maxLod: 0,
      tag: "boiler",
    }),
    cylinder({
      radius: 0.14,
      height: 0.62,
      axis: "x",
      segments: 8,
      at: [0.02, 0.56, 0.2],
      mat: "body",
      smooth: 45,
      minLod: 1,
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: 0.148,
      height: 0.34,
      axis: "x",
      segments: 10,
      caps: false,
      at: [0.02, 0.56, 0.2],
      mat: "team",
      smooth: 45,
      keep: true,
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: 0.14,
      height: 0.62,
      axis: "x",
      segments: 8,
      at: [0.02, 0.56, 0.2],
      mat: "team",
      keep: true,
      minLod: 2,
      tag: "boiler",
    }),
    mirrorX(cylinder({
      radius: 0.141,
      height: 0.013,
      axis: "x",
      segments: 8,
      caps: "top",
      at: [0.34, 0.56, 0.2],
      mat: "copper",
      smooth: 45,
      maxLod: 0,
    })),
    mirrorX(cylinder({
      radius: 0.068,
      height: 0.018,
      axis: "x",
      segments: 8,
      caps: "top",
      at: [0.348, 0.56, 0.2],
      mat: "dark",
      smooth: 45,
      maxLod: 0,
    })),
    // Recessed equipment tray, rear radiator and ceramic coaming.
    box({
      size: [0.28, 0.008, 0.18],
      at: [-0.2, 0.416, -0.24],
      mat: "dark",
      maxLod: 0,
    }),
    mirrorX(box({
      size: [0.027, 0.038, 0.2],
      at: [0.33, 0.425, -0.24],
      mat: "ceramic",
      maxLod: 0,
    })),
    beveledBox({
      size: [0.235, 0.105, 0.18],
      at: [-0.19, 0.464, -0.255],
      bevel: { top: 0.025 },
      mat: "body",
      maxLod: 0,
    }),
    box({
      size: [0.175, 0.01, 0.13],
      at: [-0.19, 0.52, -0.255],
      mat: "dark",
      maxLod: 0,
    }),
    stripes({
      count: 1,
      width: 0.3,
      gap: 0.1,
      at: [0.02, ENG_DECK + 0.004, -0.33],
      mat: "soot",
    }),
    // Front optical recess and narrow towing jaw; both retain the compact hull outline.
    box({
      size: [0.16, 0.046, 0.028],
      at: [0, 0.29, 0.49],
      mat: "dark",
      maxLod: 0,
    }),
    box({
      size: [0.083, 0.028, 0.006],
      at: [0, 0.295, 0.507],
      mat: "glass",
      maxLod: 0,
    }),
    mirrorX(strut({
      from: [0.07, 0.18, 0.43],
      to: [0.055, 0.18, 0.52],
      radius: 0.018,
      sides: 4,
      mat: "copper",
      maxLod: 0,
    })),
  ];
  for (let i = 0; i < 3; i++) {
    hull.push(box({ size: [0.17, 0.013, 0.012], at: [-0.19, 0.528, -0.3 + i * 0.03], mat: "ceramic", maxLod: 0 }));
  }

  const boomKids: Shape[] = [
    cylinder({
      radius: 0.115,
      height: 0.06,
      at: [0, 0.035, 0],
      segments: 10,
      caps: false,
      mat: "dark",
      smooth: 45,
      maxLod: 1,
      tag: "boom",
    }),
    cylinder({
      radius: 0.09,
      height: 0.077,
      at: [0, 0.058, 0],
      segments: 10,
      caps: false,
      mat: "copper",
      smooth: 45,
      maxLod: 0,
    }),
    // Two separated forged cheeks surround a visible dark structural web.
    box({
      size: [0.09, 0.082, 0.61],
      at: [0, 0.26, 0.22],
      rot: [-47, 0, 0],
      mat: "dark",
      keep: true,
      maxLod: 1,
    }),
    box({
      size: [0.09, 0.072, 0.68],
      at: [0, 0.43, 0.76],
      rot: [12.72, 0, 0],
      mat: "dark",
      keep: true,
      maxLod: 1,
    }),
    mirrorX(extrude({
      profile: [[-0.025, 0.095], [0.07, 0.095], [0.505, 0.467], [0.465, 0.542], [0.394, 0.495]],
      depth: 0.034,
      axis: "x",
      at: [0.071, 0, 0],
      mat: "copper",
      keep: true,
      maxLod: 1,
      tag: "boom",
    })),
    mirrorX(extrude({
      profile: [[0.42, 0.515], [0.5, 0.533], [1.08, 0.396], [1.08, 0.322], [0.46, 0.435]],
      depth: 0.034,
      axis: "x",
      at: [0.071, 0, 0],
      mat: "copper",
      keep: true,
      maxLod: 1,
      tag: "boom",
    })),
    cylinder({
      radius: 0.082,
      height: 0.207,
      axis: "x",
      segments: 8,
      caps: false,
      at: [0, 0.5, 0.45],
      mat: "body",
      smooth: 45,
      maxLod: 0,
    }),
    mirrorX(cylinder({
      radius: 0.037,
      height: 0.014,
      axis: "x",
      segments: 6,
      caps: "top",
      at: [0.112, 0.5, 0.45],
      mat: "copper",
      smooth: 45,
      maxLod: 0,
    })),
    // Hydraulic ram is anchored to the rotating cradle, so yaw never tears it off the boom.
    strut({
      from: [0, 0.102, 0.055],
      to: [0, 0.233, 0.24],
      radius: 0.045,
      sides: 6,
      caps: false,
      mat: "body",
      smooth: 45,
      maxLod: 0,
    }),
    strut({
      from: [0, 0.225, 0.229],
      to: [0, 0.43, 0.442],
      radius: 0.018,
      sides: 6,
      caps: false,
      mat: "copper",
      smooth: 45,
      maxLod: 0,
    }),
    sweep({
      path: [[0.098, 0.12, 0.045], [0.113, 0.32, 0.23], [0.113, 0.556, 0.45], [0.106, 0.488, 0.64], [0.098, 0.39, 0.99]],
      radius: 0.013,
      sides: 4,
      mat: "dark",
      maxLod: 0,
    }),
    box({
      size: [0.085, 0.008, 0.22],
      at: [0, 0.495, 0.78],
      rot: [12.72, 0, 0],
      mat: "ceramic",
      maxLod: 0,
    }),
    box({
      size: [0.17, 0.12, Math.hypot(1.07, 0.26)],
      at: [0, 0.28, 0.535],
      rot: [-Math.atan2(0.26, 1.07) * 180 / Math.PI, 0, 0],
      mat: "copper",
      keep: true,
      minLod: 2,
      tag: "boom",
    }),
  ];
  // The complete tool assembly belongs to emitter, including its wrist, yoke and jaw tips.
  const toolKids: Shape[] = [
    cylinder({
      radius: 0.066,
      height: 0.188,
      axis: "x",
      segments: 6,
      caps: false,
      at: [0, 0.3, 1.07],
      mat: "body",
      smooth: 45,
      maxLod: 0,
    }),
    mirrorX(extrude({
      profile: [[1.015, 0.336], [1.125, 0.336], [1.18, 0.195], [1.1, 0.175], [1.042, 0.222]],
      depth: 0.033,
      axis: "x",
      at: [0.087, 0, 0],
      mat: "copper",
      maxLod: 0,
      tag: "ring",
    })),
    tube({
      outer: 0.087,
      inner: 0.052,
      height: 0.08,
      axis: "y",
      segments: 6,
      at: [0, 0.235, 1.085],
      mat: "body",
      smooth: 45,
      maxLod: 0,
    }),
    sphere({
      radius: 0.061,
      segments: 6,
      rings: 3,
      at: [0, 0.205, 1.085],
      mat: "glow",
      smooth: 45,
      keep: true,
      maxLod: 0,
      tag: "ring",
    }),
    ...tipShapes(1.07, 0.26).map(shape => ({ ...shape, minLod: 1 })),
  ];
  return [
    { name: "hull", shapes: hull },
    { name: "boom", pivot: ARM1.at, anim: "yaw", shapes: [group(boomKids, { at: ARM1.at, rot: [0, ARM1.yaw, 0] })] },
    { name: "emitter", parent: "boom", pivot: tipWorld(ARM1), anim: "pitch", shapes: [group(toolKids, { at: ARM1.at, rot: [0, ARM1.yaw, 0] })] },
  ];
}


/** Engineer-Parts für Tech 1–3 (Maßstab kommt aus dem Roster: 1,0 / 1,3 / 1,4). */
export function engineerParts(tech: 1 | 2 | 3): PartDef[] {
  // Tech-Streifen: 0,10 WU × Maßstab, Abstand 0,10 WU absolut ⇒ im Basismaß 0,10 / Maßstab
  const scale = tech === 1 ? 1 : tech === 2 ? 1.3 : 1.4;
  const gap = 0.1 / scale;
  const stripeAt = -0.33 + ((tech - 1) / 2) * (0.1 + gap);
  const hull: Shape[] = [
    mirrorX(
      extrude({
        profile: TRACK,
        depth: 0.2,
        axis: "x",
        at: [0.37, 0, 0],
        mat: "dark",
        tag: "tracks",
      }),
    ),
    box({
      size: [0.54, 0.14, 0.86],
      at: [0, 0.14, 0],
      mat: "dark",
      maxLod: 1,
      tag: "hull",
    }),
    // Wanne: breite Fasen = teamfarbenes Seitenband (von oben sichtbar), steile Bugfase zeigt die Fahrtrichtung
    beveledBox({
      size: [0.98, 0.16, 1.0],
      at: [0, 0.28, 0],
      bevel: { top: 0.09, topFront: 0.12 },
      mat: "team",
      tag: "hull",
    }),
    // Keramik-Deckplatte (Klassenkennung Engineer)
    beveledBox({
      size: [0.76, 0.05, 0.78],
      at: [0, ENG_DECK - 0.025, -0.01],
      bevel: { top: 0.015 },
      mat: "ceramic",
      maxLod: 1,
      tag: "hull",
    }),
    quad({
      size: [0.8, 0.84],
      at: [0, 0.364, -0.01],
      mat: "ceramic",
      minLod: 2,
    }),
    // liegender Kessel quer über dem Vorderdeck: Eisen-Kapsel mit teamfarbenem Bauchband
    cylinder({
      radius: 0.14,
      height: 0.62,
      axis: "x",
      segments: 8,
      at: [0.02, ENG_DECK + 0.15, 0.2],
      mat: "body",
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: 0.148,
      height: 0.34,
      axis: "x",
      segments: 8,
      caps: false,
      at: [0.02, ENG_DECK + 0.15, 0.2],
      mat: "team",
      keep: true,
      maxLod: 1,
      tag: "boiler",
    }),
    cylinder({
      radius: 0.14,
      height: 0.62,
      axis: "x",
      segments: 8,
      at: [0.02, ENG_DECK + 0.15, 0.2],
      mat: "team",
      keep: true,
      minLod: 2,
      tag: "boiler",
    }),
    // Tech-Streifen graphit auf Keramik
    stripes({
      count: tech,
      width: 0.3,
      gap,
      at: [-0.06, ENG_DECK + 0.004, stripeAt],
      mat: "soot",
    }),
  ];
  if (tech === 3) hull.push(armShapes(ARM3, true, 1));
  const parts: PartDef[] = [
    { name: "hull", shapes: hull },
    {
      name: "boom",
      pivot: ARM1.at,
      anim: "yaw",
      shapes: [armShapes(ARM1, tech !== 1)],
    },
  ];
  if (tech === 1) {
    const tip = tipWorld(ARM1);
    parts.push({
      name: "emitter",
      parent: "boom",
      pivot: tip,
      anim: "pitch",
      shapes: [
        group(tipShapes(0.45 + ARM1.reach, 0.26), {
          at: ARM1.at,
          rot: [0, ARM1.yaw, 0],
        }),
      ],
    });
  } else {
    parts.push({
      name: "boom2",
      pivot: ARM2.at,
      anim: "yaw",
      shapes: [armShapes(ARM2, true)],
    });
  }
  return parts;
}

export default defineModel({
  id: "core:lnd_t1_engineer",
  parts: detailedEngineerParts(),
  budget: { tris: [1600, 450, 160] },
  notes:
    "T1-Detailausbau: Kettenschuhe, Laufrollen, Druckkessel, Hydraulikarm und gegabeltes Emitterwerkzeug; lokales Detailbudget, kompakte Fern-LODs. Geselle/Meister behalten engineerParts().",
});
