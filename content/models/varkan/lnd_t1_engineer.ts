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
  parts: engineerParts(1),
  notes:
    "Grundform der Engineer-Familie (v_eng); Geselle/Meister importieren engineerParts().",
});
