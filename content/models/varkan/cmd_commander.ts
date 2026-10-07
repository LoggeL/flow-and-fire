/**
 * Vogt (core:cmd_commander): gegossener Varkan-Kommandant.
 * Lot-Kopf, Schulterglocke rechts und Keramik-Rückenkran links bleiben die Rollensignaturen.
 * Nah-LOD: geschichtete Gussplatten, offene Lager und hydraulischer Rückenkran.
 * Die sechs bestehenden Animationsgruppen und ihre Pivots bleiben unverändert.
 */
import {
  beveledBox,
  box,
  cone,
  cylinder,
  defineModel,
  extrude,
  frustum,
  quad,
  sphere,
  strut,
  tube,
  wedge,
  type Place,
  type Shape,
  type Vec3,
} from "@faf/modelkit";

const HIP_Y = 1.24;
const LEG_X = 0.46;
const TORSO_Y0 = 1.42;
const TORSO_Y1 = 2.24;
const SHOULDER_X = 0.86;
const BELL_Y = 2.3;
const BARREL_Y = BELL_Y + 0.14;
const DEG = 180 / Math.PI;

/** Balken entlang einer Verbindung; alle Koordinaten bleiben im Modellraum. */
function beam(a: Vec3, b: Vec3, w: number, h: number, place: Place): Shape {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const horiz = Math.hypot(d[0], d[2]);
  return box({
    size: [w, h, Math.hypot(horiz, d[1])],
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: [-Math.atan2(d[1], horiz) * DEG, Math.atan2(d[0], d[2]) * DEG, 0],
    ...place,
  });
}

/** Runde Kolbenstange zwischen zwei Punkten, nur die gedrehten Metallflächen sind weich. */
function rod(a: Vec3, b: Vec3, radius: number, place: Place): Shape {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const horiz = Math.hypot(d[0], d[2]);
  return cylinder({
    radius,
    height: Math.hypot(horiz, d[1]),
    axis: "z",
    segments: 8,
    caps: false,
    smooth: 55,
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rot: [-Math.atan2(d[1], horiz) * DEG, Math.atan2(d[0], d[2]) * DEG, 0],
    ...place,
  });
}

/** Abgesetzte Lagerkränze mit sichtbarem Achsende auf der Außenseite. */
function bearing(x: number, y: number, z: number, radius: number, width: number): Shape[] {
  const side = Math.sign(x);
  return [
    cylinder({ radius, height: width, axis: "x", segments: 8, caps: false, at: [x, y, z], mat: "soot", smooth: 50, keep: true, maxLod: 1, tag: "legs" }),
    cylinder({ radius: radius * 0.87, height: 0.036, axis: "x", segments: 8, caps: side > 0 ? "top" : "bottom", at: [x + side * (width / 2 + 0.009), y, z], mat: "copper", maxLod: 0 }),
    cylinder({ radius: radius * 0.49, height: 0.042, axis: "x", segments: 6, caps: side > 0 ? "top" : "bottom", at: [x + side * (width / 2 + 0.025), y, z], mat: "body", maxLod: 0 }),
  ];
}

function leg(x: number): Shape[] {
  const side = Math.sign(x);
  const shapes: Shape[] = [
    // Sohlen und Zehen bilden zwei getrennte, belastbare Füße; die Mitte bleibt offen.
    extrude({ profile: [[-0.32, 0], [0.48, 0], [0.48, 0.065], [0.39, 0.16], [0.11, 0.2], [-0.25, 0.2], [-0.32, 0.12]], depth: 0.44, axis: "x", at: [x, 0, 0], mat: "soot", keep: true, maxLod: 1, tag: "legs" }),
    beveledBox({ size: [0.4, 0.11, 0.34], bevel: { topFront: 0.045 }, at: [x, 0.16, 0.28], mat: "body", keep: true, maxLod: 1 }),
    beveledBox({ size: [0.38, 0.12, 0.2], bevel: { top: 0.035 }, at: [x, 0.18, -0.19], mat: "body", maxLod: 0 }),
    box({ size: [0.34, 0.027, 0.04], at: [x, 0.215, 0.29], mat: "copper", maxLod: 0 }),
    // Offener Rahmen: die Lager ragen seitlich aus den schmaleren Gussgliedern.
    strut({ from: [x, 0.24, -0.03], to: [x, 0.76, -0.1], radius: 0.12, radiusEnd: 0.135, sides: 4, mat: "soot", keep: true, maxLod: 1, tag: "legs" }),
    strut({ from: [x, 0.76, -0.1], to: [x, HIP_Y, 0], radius: 0.135, radiusEnd: 0.15, sides: 4, mat: "soot", keep: true, maxLod: 1, tag: "legs" }),
    // Seitlich ausgeschnittene Schienbeinschale und geneigte Oberschenkelplatte.
    extrude({ profile: [[-0.08, 0.26], [0.14, 0.26], [0.22, 0.39], [0.14, 0.67], [0.05, 0.73], [-0.12, 0.65], [-0.15, 0.4]], depth: 0.34, axis: "x", at: [x, 0, 0], mat: "body", keep: true, maxLod: 1, tag: "legs" }),
    extrude({ profile: [[-0.12, 0.87], [0.075, 0.82], [0.22, 1.1], [0.15, 1.2], [-0.13, 1.17], [-0.19, 1.02]], depth: 0.36, axis: "x", at: [x, 0, 0], mat: "body", keep: true, maxLod: 1, tag: "legs" }),
    beveledBox({ size: [0.26, 0.3, 0.075], bevel: { top: 0.035, bottom: 0.025 }, at: [x, 0.5, 0.181], rot: [8, 0, 0], mat: "body", maxLod: 0 }),
    beveledBox({ size: [0.3, 0.19, 0.13], bevel: { top: 0.04, bottom: 0.03 }, at: [x, 0.79, 0.085], mat: "body", maxLod: 0 }),
    ...bearing(x, 0.24, -0.03, 0.11, 0.4),
    ...bearing(x, 0.76, -0.1, 0.155, 0.42),
    ...bearing(x, HIP_Y, 0, 0.16, 0.43),
    // Die unteren Zylinder sitzen hinter den Schalen; blanke Kolben bleiben sichtbar.
    rod([x + side * 0.19, 0.285, -0.095], [x + side * 0.19, 0.59, -0.225], 0.058, { mat: "body", maxLod: 0 }),
    rod([x + side * 0.19, 0.52, -0.215], [x + side * 0.19, 0.75, -0.23], 0.027, { mat: "copper", maxLod: 0 }),
    rod([x - side * 0.19, 0.86, -0.19], [x - side * 0.19, 1.11, -0.155], 0.055, { mat: "body", maxLod: 0 }),
    rod([x - side * 0.19, 1.03, -0.165], [x - side * 0.19, 1.23, -0.08], 0.025, { mat: "copper", maxLod: 0 }),
    // Fern-LOD bewahrt den Fuß und den gebeugten Zweigliedaufbau.
    wedge({ size: [0.44, 0.2, 0.8], front: 0.08, at: [x, 0.1, 0.08], mat: "soot", keep: true, minLod: 2, tag: "legs" }),
    strut({ from: [x, 0.16, 0.02], to: [x, 0.8, -0.1], radius: 0.36 / Math.SQRT2, radiusEnd: 0.28 / Math.SQRT2, sides: 4, mat: "body", keep: true, minLod: 2, tag: "legs" }),
    strut({ from: [x, 0.74, -0.12], to: [x, HIP_Y + 0.06, 0.02], radius: 0.32 / Math.SQRT2, radiusEnd: 0.4 / Math.SQRT2, sides: 4, mat: "body", keep: true, minLod: 2, tag: "legs" }),
  ];
  // Große, lesbare Traktionsrippen und zwei seitliche Wartungsdeckel.
  for (const z of [-0.23, -0.06, 0.11, 0.29]) {
    shapes.push(box({ size: [0.035, 0.07, 0.075], at: [x + side * 0.225, 0.08, z], mat: "body", maxLod: 0 }));
  }
  for (const y of [0.42]) {
    shapes.push(cylinder({ radius: 0.048, height: 0.03, axis: "x", segments: 6, at: [x + side * 0.185, y, 0.045], mat: "copper", maxLod: 0 }));
  }
  return shapes;
}

const BOOM_A: Vec3 = [0.5, TORSO_Y1 - 0.08, -0.46];
const BOOM_B: Vec3 = [0.72, 3.0, -0.3];
const BOOM_C: Vec3 = [0.84, 2.92, 0.62];

function torsoDetails(): Shape[] {
  const shapes: Shape[] = [];
  for (const side of [-1, 1]) {
    // Zweite Plattenlage unter dem Schulterbanner, geschützte Scharnierrollen vorne.
    shapes.push(
      beveledBox({ size: [0.46, 0.19, 0.73], bevel: { bottom: 0.055 }, at: [side * SHOULDER_X, 1.98, -0.06], mat: "soot", maxLod: 1 }),
      extrude({ profile: [[-0.29, -0.14], [0.29, -0.14], [0.27, 0.13], [0.16, 0.24], [-0.22, 0.24], [-0.29, 0.1]], depth: 0.1, axis: "z", at: [side * 0.315, 1.81, 0.438], mat: "team", keep: true, maxLod: 1 }),
      beveledBox({ size: [0.12, 0.4, 0.46], bevel: { bottom: 0.04, topFront: 0.05 }, at: [side * 0.645, 1.76, -0.08], mat: "body", maxLod: 0 }),
      cylinder({ radius: 0.065, height: 0.34, axis: "x", segments: 8, at: [side * SHOULDER_X, 2.065, 0.365], mat: "soot", smooth: 50, maxLod: 0 }),
      cylinder({ radius: 0.048, height: 0.04, axis: "z", segments: 8, at: [side * 0.47, 1.88, 0.499], mat: "copper", maxLod: 0 }),
      // Rückenkühlpakete bleiben innerhalb der ursprünglichen Heckkante.
      beveledBox({ size: [0.25, 0.58, 0.17], bevel: { top: 0.035 }, at: [side * 0.35, 1.86, -0.58], mat: "soot", maxLod: 0 }),
      rod([side * 0.57, 1.7, -0.46], [side * 0.57, 2.13, -0.51], 0.055, { mat: "copper", maxLod: 0 }),
      beveledBox({ size: [0.16, 0.12, 0.2], bevel: { top: 0.025 }, at: [side * 0.48, 2.2, -0.3], mat: "team", maxLod: 0 }),
    );
    for (let i = 0; i < 5; i++) {
      shapes.push(box({ size: [0.27, 0.031, 0.17], at: [side * 0.35, 1.64 + i * 0.095, -0.602], mat: "body", maxLod: 0 }));
    }
    // Der Schulterdeckel hat eine eingefasste Wartungsöffnung, keine lose Dekaltextur.
    shapes.push(beveledBox({ size: [0.21, 0.025, 0.28], bevel: { top: 0.008 }, at: [side * 0.86, 2.285, -0.29], mat: "body", maxLod: 0 }));
  }
  shapes.push(
    box({ size: [0.3, 0.115, 0.026], at: [0, 1.615, 0.488], mat: "soot", maxLod: 0 }),
    cylinder({ radius: 0.24, height: 0.065, at: [0, 2.3, -0.44], segments: 8, caps: false, mat: "body", smooth: 50, maxLod: 0 }),
    tube({ outer: 0.25, inner: 0.19, height: 0.06, at: [0, 3.11, -0.44], segments: 8, mat: "copper", smooth: 50, maxLod: 0, tag: "stack" }),
    cylinder({ radius: 0.22, height: 0.055, caps: false, at: [0, 2.68, -0.44], segments: 8, mat: "body", smooth: 50, maxLod: 0, tag: "stack" }),
    cylinder({ radius: 0.25, height: 0.07, at: [0, 2.12, 0.1], segments: 8, mat: "soot", smooth: 50, maxLod: 0 }),
    beveledBox({ size: [0.27, 0.065, 0.032], bevel: { side: 0.012 }, at: [0, 2.755, 0.393], mat: "glass", maxLod: 0 }),
    box({ size: [0.08, 0.014, 0.009], at: [0, 2.748, 0.413], mat: "glow", maxLod: 0 }),
  );
  for (const x of [-0.105, -0.035, 0.035, 0.105]) {
    shapes.push(box({ size: [0.025, 0.09, 0.014], at: [x, 1.615, 0.507], mat: "body", maxLod: 0 }));
  }
  for (const x of [-0.145, 0.145]) {
    shapes.push(box({ size: [0.045, 0.24, 0.08], at: [x, 2.97, -0.605], mat: "soot", maxLod: 0, tag: "stack" }));
  }
  return shapes;
}

export default defineModel({
  id: "core:cmd_commander",
  budget: { tris: [3200, 900, 300] },
  parts: [
    {
      name: "hull",
      shapes: [
        beveledBox({ size: [1.14, 0.34, 0.64], at: [0, HIP_Y + 0.03, 0], bevel: { bottom: 0.1 }, mat: "soot", keep: true, maxLod: 1, tag: "hull" }),
        cylinder({ radius: 0.42, height: 0.13, at: [0, 1.42, -0.03], segments: 8, caps: false, mat: "soot", smooth: 50, keep: true, maxLod: 1 }),
        frustum({ radius: 0.435, radiusTop: 0.34, height: 0.045, caps: false, at: [0, 1.455, -0.03], segments: 8, mat: "copper", smooth: 50, maxLod: 0 }),
        beveledBox({ size: [0.5, 0.19, 0.08], bevel: { bottom: 0.03 }, at: [0, 1.265, 0.305], mat: "body", maxLod: 0 }),
        box({ size: [1.05, 0.28, 0.59], at: [0, HIP_Y + 0.03, 0], mat: "soot", keep: true, minLod: 2 }),
      ],
    },
    { name: "legs_l", pivot: [LEG_X, HIP_Y, 0], anim: "legs", shapes: leg(LEG_X) },
    { name: "legs_r", pivot: [-LEG_X, HIP_Y, 0], anim: "legs", shapes: leg(-LEG_X) },
    {
      name: "torso",
      pivot: [0, TORSO_Y0, 0],
      anim: "yaw",
      shapes: [
        // Eine breite, gefaste Schulterwanne über einem schmaleren Bauchsegment.
        beveledBox({ size: [1.3, 0.65, 1.0], at: [0, 1.915, -0.04], bevel: { top: 0.14, topFront: 0.24 }, mat: "body", keep: true, maxLod: 1, tag: "hull" }),
        beveledBox({ size: [1.0, 0.27, 0.74], at: [0, 1.555, -0.03], bevel: { bottom: 0.07 }, mat: "body", keep: true, maxLod: 1 }),
        box({ size: [2.24, TORSO_Y1 - TORSO_Y0 + 0.04, 1.0], at: [0, (TORSO_Y0 + TORSO_Y1) / 2 + 0.02, -0.04], mat: "body", minLod: 2 }),
        quad({ size: [2.2, 0.96], at: [0, TORSO_Y1 + 0.044, -0.04], mat: "team", minLod: 2 }),
        // Brustband und Deck bleiben Teamflächen, dazwischen sind tiefe Trennfugen.
        beveledBox({ size: [1.02, 0.14, 0.07], bevel: { top: 0.025 }, at: [0, 1.575, 0.382], mat: "team", keep: true, maxLod: 1 }),
        wedge({ size: [0.96, 0.065, 0.54], at: [0, TORSO_Y1 + 0.025, -0.13], front: 0.018, mat: "team", keep: true, maxLod: 1 }),
        beveledBox({ size: [0.56, 0.3, 0.9], at: [SHOULDER_X, TORSO_Y1 - 0.12, -0.04], bevel: { top: 0.08, side: 0.045 }, mat: "team", keep: true, maxLod: 1, tag: "hull" }),
        beveledBox({ size: [0.56, 0.3, 0.9], at: [-SHOULDER_X, TORSO_Y1 - 0.12, -0.04], bevel: { top: 0.08, side: 0.045 }, mat: "team", keep: true, maxLod: 1, tag: "hull" }),
        cone({ radius: 0.3, height: 0.42, segments: 8, at: [0, TORSO_Y1 + 0.21, 0.1], rot: [180, 0, 0], mat: "team", keep: true, tag: "plumb" }),
        sphere({ radius: 0.3, segments: 12, rings: 4, at: [0, TORSO_Y1 + 0.5, 0.1], mat: "team", smooth: 35, keep: true, tag: "plumb" }),
        // Leuchtender Schlotkern wird von einer offenen Kupferkrone und Gussrippen gefasst.
        cylinder({ radius: 0.18, height: 0.86, at: [0, TORSO_Y1 + 0.2, -0.44], segments: 8, caps: false, mat: "soot", smooth: 50, keep: true, tag: "stack" }),
        cylinder({ radius: 0.205, height: 0.3, at: [0, TORSO_Y1 + 0.75, -0.44], segments: 8, caps: "top", mat: "glow", keep: true, tag: "stack" }),
        cylinder({ radius: 0.08, height: 1.3, axis: "x", segments: 8, caps: false, at: [0, TORSO_Y1 - 0.02, -0.5], mat: "copper", smooth: 50, maxLod: 0, tag: "barrel" }),
        // Schulterglocke sitzt auf einem gezahnten dunklen Drehkranz.
        cylinder({ radius: 0.29, height: 0.065, at: [-SHOULDER_X, BELL_Y + 0.012, 0], segments: 8, caps: false, mat: "soot", smooth: 50, maxLod: 0, tag: "bell" }),
        frustum({ radius: 0.3, radiusTop: 0.28, height: 0.12, at: [-SHOULDER_X, BELL_Y + 0.06, 0], segments: 8, caps: false, mat: "team", maxLod: 1, tag: "bell" }),
        sphere({ radius: 0.28, hemi: true, segments: 8, rings: 3, scale: [1, 0.75, 1], at: [-SHOULDER_X, BELL_Y + 0.12 + 0.105, 0], mat: "team", smooth: 45, keep: true, tag: "bell" }),
        ...torsoDetails(),
      ],
    },
    {
      name: "barrel",
      parent: "torso",
      pivot: [-SHOULDER_X, BARREL_Y, 0.2],
      anim: "pitch",
      shapes: [
        // Mantel, blanke Rücklaufstange, perforierte Kühlhülse und offene Mündung.
        beveledBox({ size: [0.3, 0.25, 0.23], bevel: { top: 0.05, side: 0.03 }, at: [-SHOULDER_X, BARREL_Y, 0.24], mat: "body", maxLod: 0 }),
        cylinder({ radius: 0.1, height: 0.96, axis: "z", at: [-SHOULDER_X, BARREL_Y, 0.66], segments: 8, caps: false, mat: "dark", smooth: 50, keep: true, tag: "barrel" }),
        cylinder({ radius: 0.145, height: 0.28, axis: "z", at: [-SHOULDER_X, BARREL_Y, 0.48], segments: 8, caps: false, mat: "body", smooth: 50, maxLod: 0 }),
        cylinder({ radius: 0.148, height: 0.055, axis: "z", caps: false, at: [-SHOULDER_X, BARREL_Y, 0.64], segments: 8, mat: "copper", smooth: 50, maxLod: 0 }),
        tube({ outer: 0.125, inner: 0.071, height: 0.14, axis: "z", at: [-SHOULDER_X, BARREL_Y, 1.1], segments: 8, mat: "copper", smooth: 50, keep: true, maxLod: 1, tag: "barrel" }),
        cylinder({ radius: 0.069, height: 0.008, axis: "z", at: [-SHOULDER_X, BARREL_Y, 1.094], segments: 8, caps: "top", mat: "soot", maxLod: 0 }),
        cylinder({ radius: 0.032, height: 0.43, axis: "z", at: [-SHOULDER_X, BARREL_Y - 0.14, 0.61], segments: 8, caps: false, mat: "copper", smooth: 50, maxLod: 0 }),
        box({ size: [0.07, 0.04, 0.14], at: [-SHOULDER_X, BARREL_Y + 0.126, 0.47], mat: "soot", maxLod: 0 }),
        ...[0.73, 0.82, 0.91].map((z) => cylinder({ radius: 0.116, height: 0.04, axis: "z", at: [-SHOULDER_X, BARREL_Y, z], segments: 8, caps: false, mat: "body", smooth: 50, maxLod: 0 })),
        ...[-1, 1].map((side) => box({ size: [0.018, 0.064, 0.18], at: [-SHOULDER_X + side * 0.146, BARREL_Y, 0.48], mat: "soot", maxLod: 0 })),
      ],
    },
    {
      name: "boom",
      parent: "torso",
      pivot: BOOM_A,
      anim: "pitch",
      shapes: [
        // Zweifach geführter Kran mit dunklem Rahmen unter den Keramikdeckeln.
        beam(BOOM_A, BOOM_B, 0.2, 0.2, { mat: "ceramic", keep: true, maxLod: 1, tag: "boom" }),
        beam(BOOM_B, BOOM_C, 0.18, 0.18, { mat: "ceramic", keep: true, maxLod: 1, tag: "boom" }),
        beam([0.5, 2.16, -0.53], [0.72, 2.9, -0.36], 0.24, 0.075, { mat: "soot", maxLod: 0 }),
        beam([0.72, 2.9, -0.3], [0.84, 2.82, 0.52], 0.075, 0.06, { mat: "soot", maxLod: 0 }),
        cylinder({ radius: 0.14, height: 0.29, axis: "x", segments: 8, at: [0.51, 2.22, -0.46], mat: "body", smooth: 50, maxLod: 0 }),
        cylinder({ radius: 0.13, height: 0.25, axis: "x", segments: 8, at: BOOM_B, mat: "soot", smooth: 50, maxLod: 0 }),
        cylinder({ radius: 0.11, height: 0.028, axis: "x", segments: 8, caps: "top", at: [0.86, 3.0, -0.3], mat: "copper", smooth: 50, maxLod: 0 }),
        rod([0.65, 2.33, -0.42], [0.8, 2.7, -0.34], 0.058, { mat: "body", maxLod: 0 }),
        rod([0.8, 2.65, -0.35], [0.84, 2.955, -0.2], 0.027, { mat: "copper", maxLod: 0 }),
        rod([0.65, 2.9, -0.17], [0.77, 2.87, 0.46], 0.029, { mat: "copper", maxLod: 0 }),
        beveledBox({ size: [0.22, 0.2, 0.23], bevel: { top: 0.045 }, at: [BOOM_C[0], 2.84, BOOM_C[2]], mat: "ceramic", maxLod: 0 }),
        cylinder({ radius: 0.115, height: 0.18, segments: 8, at: [BOOM_C[0], 2.7, BOOM_C[2]], mat: "soot", smooth: 50, maxLod: 0 }),
        tube({ outer: 0.1, inner: 0.057, height: 0.07, segments: 6, at: [BOOM_C[0], 2.6, BOOM_C[2]], mat: "copper", smooth: 50, maxLod: 0 }),
        cylinder({ radius: 0.052, height: 0.055, segments: 8, at: [BOOM_C[0], 2.592, BOOM_C[2]], mat: "glow", keep: true, maxLod: 0 }),
        box({ size: [0.2, 0.22, 0.2], at: [BOOM_C[0], BOOM_C[1] - 0.2, BOOM_C[2]], mat: "glow", keep: true, minLod: 1, maxLod: 1, tag: "boom" }),
        beam(BOOM_A, BOOM_C, 0.2, 0.2, { mat: "ceramic", keep: true, minLod: 2, tag: "boom" }),
      ],
    },
  ],
  notes: "Detailausbau auf Nutzerwunsch: eigenes Commander-Budget 3200/900/300. Geschichtete Gussrüstung, freie Lager und Hydraulik, Kühlhülsenkanone, mechanischer Keramik-Rückenkran. Bestehende PartStream-Verträge unverändert (5 von 8 Slots).",
});
