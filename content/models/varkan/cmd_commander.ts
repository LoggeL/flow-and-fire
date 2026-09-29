/**
 * Vogt (core:cmd_commander) – Varkan-Kommandant.
 *
 * Roster: „Lot-Kopf auf Bot-Beinen, Torso-Wanne mit Schulterplatten (Team), Rücken-Schlot als stärkster Glutpunkt;
 * Glocke mit Rohr auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter (kein Waffen-/Bauarm-Schema).
 * Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.“
 * faction.md §5.2 Vogt: Lot-Kopf (umgekehrter Kegel + Kugel) = Monopol, größte Landeinheit bis T2, Schlot im Rücken;
 * verboten: Waffenarm rechts + Bauarm links (FA-ACU-Schema). Teamfarbe: Schulterplatten, Torso-Deckplatte, Brustband
 * (≥ 35 % der Draufsicht). Keine Tech-Streifen. Asymmetrisch (Glocke rechts, Kran links).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite ⇒ rechte Schulter bei −X):
 *   hull   – Becken (dunkel)
 *   legs_l – linkes Bein: Oberschenkel, Unterschenkel, Fuß, schwingt um die Hüfte   (PartStream 1, legs)
 *   legs_r – rechtes Bein                                                            (PartStream 2, legs)
 *   torso  – Torso-Wanne, Brustband + Deckplatte + Schulterplatten (team), Lot-Kopf (team), Rücken-Schlot mit Glutkrone,
 *            Glocke (team) auf der rechten Schulter, Kupfer-Krümmer; dreht um +Y        (PartStream 3, yaw)
 *   barrel – Rohr + Kupfermündung der Schulterglocke, kippt (Pitch)                    (PartStream 4)
 *   boom   – Keramik-Rückenkran über die linke Schulter mit Glut-Emitter, kippt (Bauen) (PartStream 5)
 */
import {
  beveledBox,
  box,
  cone,
  cylinder,
  defineModel,
  frustum,
  quad,
  sphere,
  wedge,
  type Place,
  type Shape,
  type Vec3,
} from "@faf/modelkit";

const HIP_Y = 1.24;
const LEG_X = 0.46;
const TORSO_Y0 = 1.42; // Unterkante Torso (Yaw-Pivot)
const TORSO_Y1 = 2.24; // Oberkante Torso
const SHOULDER_X = 0.86;
const BELL_Y = 2.3;
const BARREL_Y = BELL_Y + 0.14;

const DEG = 180 / Math.PI;

/** Balken (Box entlang +Z) von `a` nach `b`. */
function beam(a: Vec3, b: Vec3, w: number, h: number, place: Place): Shape {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const horiz = Math.hypot(d[0], d[2]);
  const len = Math.hypot(horiz, d[1]);
  return box({
    size: [w, h, len],
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: [-Math.atan2(d[1], horiz) * DEG, Math.atan2(d[0], d[2]) * DEG, 0],
    ...place,
  });
}

function leg(x: number): Shape[] {
  return [
    // Fuß mit gefaster Spitze
    wedge({
      size: [0.44, 0.2, 0.8],
      front: 0.08,
      at: [x, 0.1, 0.08],
      mat: "soot",
      keep: true,
      maxLod: 1,
      tag: "legs",
    }),
    // Unterschenkel (leicht nach hinten geneigt) und Oberschenkel
    beam([x, 0.16, 0.02], [x, 0.8, -0.1], 0.34, 0.36, {
      mat: "body",
      keep: true,
      maxLod: 0,
      tag: "legs",
    }),
    beam([x, 0.74, -0.12], [x, HIP_Y + 0.06, 0.02], 0.38, 0.4, {
      mat: "body",
      keep: true,
      maxLod: 0,
      tag: "legs",
    }),
    // LOD1/2: ein Block pro Bein
    box({
      size: [0.38, HIP_Y - 0.1, 0.44],
      at: [x, (HIP_Y + 0.1) / 2, -0.04],
      mat: "body",
      minLod: 1,
    }),
  ];
}

const BOOM_A: Vec3 = [0.5, TORSO_Y1 - 0.08, -0.46];
const BOOM_B: Vec3 = [0.72, 3.0, -0.3];
const BOOM_C: Vec3 = [0.84, 2.92, 0.62];

export default defineModel({
  id: "core:cmd_commander",
  parts: [
    {
      name: "hull",
      shapes: [
        beveledBox({
          size: [1.14, 0.34, 0.64],
          at: [0, HIP_Y + 0.03, 0],
          bevel: { bottom: 0.1 },
          mat: "soot",
          keep: true,
          maxLod: 1,
          tag: "hull",
        }),
      ],
    },
    {
      name: "legs_l",
      pivot: [LEG_X, HIP_Y, 0],
      anim: "legs",
      shapes: leg(LEG_X),
    },
    {
      name: "legs_r",
      pivot: [-LEG_X, HIP_Y, 0],
      anim: "legs",
      shapes: leg(-LEG_X),
    },
    {
      name: "torso",
      pivot: [0, TORSO_Y0, 0],
      anim: "yaw",
      shapes: [
        // Torso-Wanne: 45°-Fasen, steile Brustfase nach vorn
        beveledBox({
          size: [1.36, TORSO_Y1 - TORSO_Y0, 1.02],
          at: [0, (TORSO_Y0 + TORSO_Y1) / 2, -0.04],
          bevel: { top: 0.16, topFront: 0.3 },
          mat: "body",
          keep: true,
          maxLod: 1,
          tag: "hull",
        }),
        // LOD2: Torso + Schultern als ein Block mit teamfarbener Deckfläche
        box({
          size: [2.24, TORSO_Y1 - TORSO_Y0 + 0.04, 1.0],
          at: [0, (TORSO_Y0 + TORSO_Y1) / 2 + 0.02, -0.04],
          mat: "body",
          minLod: 2,
        }),
        quad({
          size: [2.2, 0.96],
          at: [0, TORSO_Y1 + 0.044, -0.04],
          mat: "team",
          minLod: 2,
        }),
        // Brustband (Frontfläche) und Torso-Deckplatte (Teamfarbe)
        quad({
          size: [1.2, 0.2],
          at: [0, TORSO_Y0 + 0.24, 0.475],
          rot: [90, 0, 0],
          mat: "team",
          maxLod: 0,
        }),
        quad({
          size: [0.96, 0.54],
          at: [0, TORSO_Y1 + 0.004, -0.13],
          mat: "team",
          keep: true,
          maxLod: 1,
        }),
        // Schulterplatten (Teamfarbe) – Schulterbreite 2,24 WU
        beveledBox({
          size: [0.56, 0.3, 0.9],
          at: [SHOULDER_X, TORSO_Y1 - 0.12, -0.04],
          bevel: { top: 0.1 },
          mat: "team",
          keep: true,
          maxLod: 1,
          tag: "hull",
        }),
        beveledBox({
          size: [0.56, 0.3, 0.9],
          at: [-SHOULDER_X, TORSO_Y1 - 0.12, -0.04],
          bevel: { top: 0.1 },
          mat: "team",
          keep: true,
          maxLod: 1,
          tag: "hull",
        }),
        // Lot-Kopf: umgekehrter Kegel + Kugel (Monopol des Vogts)
        cone({
          radius: 0.3,
          height: 0.42,
          segments: 6,
          at: [0, TORSO_Y1 + 0.21, 0.1],
          rot: [180, 0, 0],
          mat: "team",
          keep: true,
          tag: "plumb",
        }),
        sphere({
          radius: 0.3,
          segments: 6,
          rings: 3,
          at: [0, TORSO_Y1 + 0.5, 0.1],
          mat: "team",
          keep: true,
          tag: "plumb",
        }),
        // Rücken-Schlot (stärkster Glutpunkt): dunkler Schaft + große Glutkrone
        cylinder({
          radius: 0.18,
          height: 0.86,
          at: [0, TORSO_Y1 + 0.2, -0.44],
          segments: 6,
          caps: false,
          mat: "soot",
          keep: true,
          tag: "stack",
        }),
        cylinder({
          radius: 0.25,
          height: 0.3,
          at: [0, TORSO_Y1 + 0.75, -0.44],
          segments: 6,
          caps: "top",
          mat: "glow",
          keep: true,
          tag: "stack",
        }),
        // Kupfer-Krümmer: Schlotfuß zu den Schultern (der Flow)
        box({
          size: [1.3, 0.14, 0.16],
          at: [0, TORSO_Y1 - 0.02, -0.5],
          mat: "copper",
          maxLod: 0,
          tag: "barrel",
        }),
        // Glocke auf der rechten Schulter (−X): Schürze + Kuppel (Teamfarbe)
        frustum({
          radius: 0.3,
          radiusTop: 0.28,
          height: 0.12,
          at: [-SHOULDER_X, BELL_Y + 0.06, 0],
          segments: 8,
          caps: false,
          mat: "team",
          maxLod: 1,
          tag: "bell",
        }),
        sphere({
          radius: 0.28,
          hemi: true,
          segments: 8,
          rings: 2,
          scale: [1, 0.75, 1],
          at: [-SHOULDER_X, BELL_Y + 0.12 + 0.105, 0],
          mat: "team",
          keep: true,
          tag: "bell",
        }),
      ],
    },
    {
      name: "barrel",
      parent: "torso",
      pivot: [-SHOULDER_X, BARREL_Y, 0.2],
      anim: "pitch",
      shapes: [
        cylinder({
          radius: 0.1,
          height: 0.96,
          axis: "z",
          at: [-SHOULDER_X, BARREL_Y, 0.66],
          segments: 6,
          caps: "top",
          mat: "dark",
          keep: true,
          tag: "barrel",
        }),
        cylinder({
          radius: 0.125,
          height: 0.14,
          axis: "z",
          at: [-SHOULDER_X, BARREL_Y, 1.1],
          segments: 6,
          caps: false,
          mat: "copper",
          maxLod: 0,
          tag: "barrel",
        }),
      ],
    },
    {
      name: "boom",
      parent: "torso",
      pivot: BOOM_A,
      anim: "pitch",
      shapes: [
        // Keramik-Rückenkran: steigt hinter dem Rücken auf und greift über die linke Schulter nach vorn
        beam(BOOM_A, BOOM_B, 0.2, 0.2, {
          mat: "ceramic",
          keep: true,
          maxLod: 0,
          tag: "boom",
        }),
        beam(BOOM_B, BOOM_C, 0.18, 0.18, {
          mat: "ceramic",
          keep: true,
          maxLod: 0,
          tag: "boom",
        }),
        // LOD1/2: ein gerades Kranglied
        beam(BOOM_A, BOOM_C, 0.2, 0.2, {
          mat: "ceramic",
          keep: true,
          minLod: 1,
          tag: "boom",
        }),
        // Glut-Emitter an der Kranspitze
        box({
          size: [0.2, 0.22, 0.2],
          at: [BOOM_C[0], BOOM_C[1] - 0.2, BOOM_C[2]],
          mat: "glow",
          keep: true,
          maxLod: 1,
          tag: "boom",
        }),
      ],
    },
  ],
  notes:
    "v_cmd: Beine als eigene Parts (anim legs), Torso-Yaw, Rohr-Pitch, Rückenkran-Pitch (5 von 8 PartStream-Slots).",
});
