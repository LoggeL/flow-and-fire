/**
 * Landwerk II (core:str_t2_fac_land), Varkan-Landfabrik T2 auf 8×8.
 * Eigenes Detailpaket für Fahrzeugrampe, Werkhalle, Schlot, Kühlung und topgelagertes Tor.
 * worksParts bleibt die gemeinsame Grundform für die übrigen Werke.
 */
import {
  beveledBox, box, cylinder, defineModel, extrude, frustum, quad, strut,
  sweep, tube, type PartDef, type Shape,
} from "@faf/modelkit";
import { worksParts } from "./str_t1_fac_land.ts";

const DECK = 0.3;
const ROOF = 2.5;
const HINGE_Y = 2.1;
const GATE_Z = -0.52;

/** Außenliegende Kühler, gerundete Rohrbögen und tragende Wandrippen. */
function sideServices(side: 1 | -1): Shape[] {
  const x = side * 3.735;
  const result: Shape[] = [
    // Große gestufte Panzerkassetten folgen dem Wandprofil statt als aufgesetzte Rechtecke zu enden.
    extrude({ profile: [[-3.55, 0.64], [-3.55, 1.57], [-3.24, 1.92], [-1.42, 1.92], [-1.12, 1.54], [-1.12, 0.64]], depth: 0.075, at: [x, 0, 0], mat: "body", maxLod: 0, tag: "wall-armor" }),
    extrude({ profile: [[-0.42, 0.57], [-0.42, 1.72], [1.53, 1.72], [2.31, 1.1], [2.31, 0.57]], depth: 0.075, at: [x, 0, 0], mat: "body", maxLod: 0, tag: "wall-armor" }),
    beveledBox({ size: [0.17, 0.32, 6.1], bevel: { top: 0.06, bottom: 0.04 }, at: [side * 3.66, 0.51, -0.68], mat: "dark", maxLod: 0, tag: "wall-plinth" }),
    // Seitlicher Axiallüfter in einer tiefen Glocke mit Ringrand und sichtbarem Rotor.
    frustum({ radius: 0.57, radiusTop: 0.46, height: 0.19, axis: "x", at: [side * 3.76, 1.17, -0.76], segments: 12, caps: false, mat: "dark", smooth: 65, maxLod: 0, tag: "fan-cowl" }),
    tube({ outer: 0.46, inner: 0.385, height: 0.055, axis: "x", at: [side * 3.865, 1.17, -0.76], segments: 12, mat: "copper", smooth: 65, maxLod: 0, tag: "fan-rim" }),
    cylinder({ radius: 0.125, height: 0.095, axis: "x", at: [side * 3.88, 1.17, -0.76], segments: 10, mat: "body", smooth: 65, maxLod: 0, tag: "fan-hub" }),
    cylinder({ radius: 0.385, height: 0.008, axis: "x", at: [side * 3.842, 1.17, -0.76], segments: 12, caps: side > 0 ? "top" : "bottom", mat: "dark", maxLod: 0, tag: "fan-recess" }),
    // Ein kurzer LOD1-Rahmen erhält die Kühlerzone ohne den Rotor.
    box({ size: [0.14, 0.7, 1.3], at: [side * 3.72, 1.17, -0.8], mat: "dark", minLod: 1, maxLod: 1, keep: true }),
  ];
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    result.push(strut({
      from: [side * 3.86, 1.17 + 0.14 * Math.cos(a), -0.76 + 0.14 * Math.sin(a)],
      to: [side * 3.86, 1.17 + 0.355 * Math.cos(a + 0.22), -0.76 + 0.355 * Math.sin(a + 0.22)],
      radius: 0.045, radiusEnd: 0.075, sides: 4, mat: "body", maxLod: 0, tag: "fan-blade",
    }));
  }
  for (const z of [-3.05, -1.92, 0.15, 1.46]) {
    result.push(
      strut({ from: [side * 3.8, 0.6, z - 0.23], to: [side * 3.8, 1.69, z + 0.21], radius: 0.063, sides: 4, mat: "dark", maxLod: 0, tag: "wall-rib" }),
      box({ size: [0.15, 0.15, 0.3], at: [side * 3.75, 0.61, z - 0.23], mat: "copper", maxLod: 0, tag: "rib-shoe" }),
    );
  }
  // Die breite obere Leitung biegt in den Kühler ab. Manschetten schließen ihre Übergänge.
  result.push(sweep({ path: [[side * 3.77, 1.73, -3.33], [side * 3.81, 1.9, -2.95], [side * 3.81, 1.9, -1.36], [side * 3.81, 1.61, -1.04]], radius: 0.075, sides: 8, samples: 7, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "coolant-duct" }));
  for (const z of [-2.65, -1.65]) result.push(cylinder({ radius: 0.096, height: 0.115, axis: "z", at: [side * 3.81, 1.9, z], segments: 10, caps: false, mat: "dark", smooth: 65, maxLod: 0, tag: "duct-collar" }));
  // Nach innen gerichtete Portalwange mit abgeschrägter Konsole hält den Durchgang frei.
  result.push(
    extrude({ profile: [[-0.74, DECK], [-0.74, HINGE_Y], [-0.31, HINGE_Y], [0.02, 1.76], [-0.04, 0.52], [-0.28, DECK]], depth: 0.2, at: [side * 2.2, 0, 0], mat: "dark", maxLod: 1, keep: true, tag: "portal-post" }),
    cylinder({ radius: 0.145, height: 0.21, axis: "x", at: [side * 2.2, HINGE_Y, GATE_Z], segments: 10, mat: "copper", smooth: 65, maxLod: 0, tag: "hinge-bearing" }),
  );
  return result;
}

function roofServices(): Shape[] {
  const result: Shape[] = [
    // Die bestehende Teamfläche bleibt zwischen Rohrkanälen und dem hinteren Servicejoch sichtbar.
    ...[-1, 1].flatMap((side): Shape[] => [
      beveledBox({ size: [0.78, 0.13, 2.75], bevel: { top: 0.075, topFront: 0.11 }, at: [side * 2.83, 2.14, -1.3], mat: "team", maxLod: 0, tag: "wall-cap-armor" }),
      beveledBox({ size: [0.43, 0.16, 2.8], bevel: { top: 0.07 }, at: [side * 1.91, ROOF + 0.04, -2.1], mat: "body", maxLod: 0, tag: "roof-armor" }),
      sweep({ path: [[side * 1.62, 2.6, -3.51], [side * 1.62, 2.83, -3.32], [side * 1.62, 2.83, -3.02], [side * 1.32, 2.72, -2.92]], radius: 0.12, sides: 8, samples: 7, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "roof-duct" }),
      ...[-2.98, -1.08].map((z) => cylinder({ radius: 0.2, height: 0.11, axis: "z", at: [side * 1.62, 2.6, z], segments: 10, caps: false, mat: "dark", smooth: 65, maxLod: 0, tag: "roof-pipe-collar" })),
    ]),
    beveledBox({ size: [1.12, 0.16, 0.58], bevel: { top: 0.04, side: 0.05 }, at: [0, 2.63, -2.9], mat: "dark", maxLod: 0, tag: "radiator-plenum" }),
    box({ size: [1.26, 0.12, 0.08], at: [0, 2.68, -3.22], mat: "copper", maxLod: 0, tag: "radiator-header" }),
    // Offenes Servicejoch aus zwei Gurten und diagonalen Stegen, kein geschlossener Dachblock.
    strut({ from: [-2.03, 2.69, -3.59], to: [2.03, 2.69, -3.59], radius: 0.055, sides: 4, mat: "dark", maxLod: 0, tag: "service-frame" }),
    strut({ from: [-2.03, 3.03, -3.59], to: [2.03, 3.03, -3.59], radius: 0.055, sides: 4, mat: "body", maxLod: 0, tag: "service-frame" }),
  ];
  for (const x of [-1.94, 1.94]) result.push(strut({ from: [x, ROOF, -3.59], to: [x, 3.03, -3.59], radius: 0.085, sides: 4, mat: "body", maxLod: 0, tag: "service-support" }));
  for (let i = 0; i < 6; i++) result.push(strut({ from: [-1.95 + i * 0.65, 2.69, -3.59], to: [-1.3 + i * 0.65, 3.03, -3.59], radius: 0.03, sides: 4, mat: "copper", maxLod: 0, tag: "service-lattice" }));
  for (let i = 0; i < 8; i++) result.push(box({ size: [0.056, 0.22, 0.49], at: [-0.49 + i * 0.14, 2.79, -2.9], mat: "copper", maxLod: 0, tag: "radiator-fin" }));
  return result;
}

/** Alles unterhalb der Scharnierachse schwenkt als starres, unterstütztes Tor nach vorn oben. */
function movingGate(): Shape[] {
  const result: Shape[] = [
    // Geschlossene Rückplatte, darüber drei Gussfelder mit sichtbaren Glutfugen.
    box({ size: [3.96, 1.63, 0.085], at: [0, 1.155, GATE_Z - 0.046], mat: "dark", maxLod: 1, keep: true, tag: "gate-backing" }),
    cylinder({ radius: 0.1, height: 4.38, axis: "x", at: [0, HINGE_Y, GATE_Z], segments: 12, caps: false, mat: "dark", smooth: 65, maxLod: 1, keep: true, tag: "hinge-shaft" }),
    ...[-1.7, 0, 1.7].map((x) => cylinder({ radius: 0.14, height: 0.26, axis: "x", at: [x, HINGE_Y, GATE_Z], segments: 12, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "hinge-knuckle" })),
    ...[-1.39, 0, 1.39].map((x) => beveledBox({ size: [1.21, 1.35, 0.12], bevel: { top: 0.06, bottom: 0.055, side: 0.055 }, at: [x, 1.155, GATE_Z + 0.065], mat: "body", maxLod: 0, tag: "gate-armor" })),
    // Oberer Torgurt sitzt unmittelbar auf der Achse; die Seiten schließen die Glutfläche ein.
    beveledBox({ size: [4.04, 0.15, 0.19], bevel: { top: 0.04 }, at: [0, 1.988, GATE_Z + 0.066], mat: "body", maxLod: 0, tag: "gate-header" }),
    beveledBox({ size: [4.04, 0.16, 0.18], bevel: { bottom: 0.045 }, at: [0, 0.416, GATE_Z + 0.058], mat: "dark", maxLod: 0, tag: "gate-sill" }),
  ];
  for (const side of [-1, 1]) {
    result.push(
      box({ size: [0.12, 1.52, 0.19], at: [side * 2.02, 1.2, GATE_Z + 0.053], mat: "copper", maxLod: 0, tag: "gate-edge" }),
      // Die Kniehebel sind am Tor befestigt und enden unterhalb der Drehachse.
      strut({ from: [side * 1.91, 1.94, GATE_Z + 0.15], to: [side * 1.63, 1.66, GATE_Z + 0.31], radius: 0.058, sides: 6, mat: "dark", smooth: 65, maxLod: 0, tag: "gate-lift-arm" }),
      strut({ from: [side * 1.63, 1.66, GATE_Z + 0.31], to: [side * 1.91, 0.64, GATE_Z + 0.16], radius: 0.042, sides: 6, mat: "copper", smooth: 65, maxLod: 0, tag: "gate-lift-arm" }),
      cylinder({ radius: 0.089, height: 0.1, axis: "x", at: [side * 1.63, 1.66, GATE_Z + 0.31], segments: 10, mat: "dark", smooth: 65, maxLod: 0, tag: "gate-lift-joint" }),
    );
  }
  // Schräge Lastverteilung liegt auf der Rückseite und klappt mit dem Tor mit.
  result.push(
    strut({ from: [-1.87, 0.49, GATE_Z - 0.11], to: [0, 1.96, GATE_Z - 0.11], radius: 0.04, sides: 4, mat: "body", maxLod: 0, tag: "gate-back-brace" }),
    strut({ from: [1.87, 0.49, GATE_Z - 0.11], to: [0, 1.96, GATE_Z - 0.11], radius: 0.04, sides: 4, mat: "body", maxLod: 0, tag: "gate-back-brace" }),
    box({ size: [4.04, 1.58, 0.13], at: [0, 1.17, GATE_Z + 0.034], mat: "body", minLod: 1, keep: true, tag: "gate-armor" }),
    quad({ size: [3.92, 0.07], at: [0, 0.93, GATE_Z + 0.105], rot: [90, 0, 0], mat: "glow", minLod: 1, keep: true, tag: "gate-seam" }),
  );
  return result;
}

/** Geteilte Gussplatten lassen die bestehende Glutbahn zwischen den Fahrspuren frei. */
function reinforcedRamp(): Shape[] {
  return [
    ...[-1, 1].flatMap((side): Shape[] => [
      ...[0.02, 0.67, 1.32, 1.97].map((z) => beveledBox({ size: [1.48, 0.07, 0.55], bevel: { top: 0.03 }, at: [side * 1.13, 0.337, z], mat: "body", maxLod: 0, tag: "launch-deck-cassette" })),
      extrude({ profile: [[2.68, 0.3], [3.91, 0.01], [3.91, 0.052], [2.68, 0.362]], depth: 1.69, at: [side * 1.09, 0, 0], mat: "body", maxLod: 0, tag: "ramp-tread" }),
      strut({ from: [side * 1.9, 0.33, -0.28], to: [side * 1.9, 0.33, 2.43], radius: 0.032, sides: 4, mat: "copper", maxLod: 0, tag: "launch-deck-rail" }),
      // Gefasste Freigabeleuchten neben dem Ausgang, ohne Hindernisse in der Fahrspur.
      beveledBox({ size: [0.25, 0.14, 0.34], bevel: { top: 0.04 }, at: [side * 2.14, 0.4, 2.43], mat: "dark", maxLod: 0, tag: "exit-light-housing" }),
      cylinder({ radius: 0.07, height: 0.027, at: [side * 2.14, 0.481, 2.43], segments: 8, caps: "top", mat: "glow", maxLod: 0, tag: "exit-light" }),
      extrude({ profile: [[2.75, 0.42], [3.83, 0.17], [3.83, 0.27], [2.75, 0.61]], depth: 0.16, at: [side * 2.03, 0, 0], mat: "dark", maxLod: 0, tag: "ramp-cheek" }),
    ]),
    // Mittelrinne folgt dem gleichen Gefälle wie die Rampenplatten.
    extrude({ profile: [[2.7, 0.295], [3.86, 0.014], [3.86, 0.026], [2.7, 0.307]], depth: 0.5, mat: "glow", maxLod: 0, tag: "ramp-flow-channel" }),
  ];
}

/** Gestufte Schlotfassung, Außenrippen und Wartungsleiter stützen die originale T2-Silhouette. */
function chimneyService(): Shape[] {
  const x = -2.95;
  const z = -3;
  const result: Shape[] = [
    frustum({ radius: 0.59, radiusTop: 0.45, height: 0.33, at: [x, 2.265, z], segments: 12, caps: false, mat: "body", maxLod: 0, tag: "chimney-foot" }),
    cylinder({ radius: 0.465, height: 0.15, at: [x, 2.46, z], segments: 12, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "chimney-collar" }),
    cylinder({ radius: 0.48, height: 0.14, at: [x, 3.85, z], segments: 12, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "chimney-collar" }),
    tube({ outer: 0.56, inner: 0.465, height: 0.07, at: [x, 4.0, z], segments: 12, mat: "body", smooth: 65, maxLod: 0, tag: "chimney-rim" }),
    sweep({ path: [[-1.91, 2.59, -3.15], [-2.21, 2.7, -3.15], [-2.4, 2.85, -3.15], [-2.46, 3.08, -3.15]], radius: 0.095, sides: 8, samples: 6, caps: false, mat: "copper", smooth: 65, maxLod: 0, tag: "chimney-feed" }),
    // Außenleiter liegt auf der freien Wandseite, oberhalb des Axiallüfters.
    strut({ from: [-3.82, 1.72, -3.27], to: [-3.82, 3.58, -3.27], radius: 0.03, sides: 6, mat: "copper", smooth: 65, maxLod: 0, tag: "service-ladder" }),
    strut({ from: [-3.82, 1.72, -2.73], to: [-3.82, 3.58, -2.73], radius: 0.03, sides: 6, mat: "copper", smooth: 65, maxLod: 0, tag: "service-ladder" }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    result.push(strut({ from: [x + 0.45 * Math.cos(a), 2.55, z + 0.45 * Math.sin(a)], to: [x + 0.45 * Math.cos(a), 3.77, z + 0.45 * Math.sin(a)], radius: 0.029, sides: 4, mat: "body", maxLod: 0, tag: "chimney-rib" }));
  }
  for (let i = 0; i < 6; i++) result.push(strut({ from: [-3.825, 1.89 + i * 0.3, -3.27], to: [-3.825, 1.89 + i * 0.3, -2.73], radius: 0.022, sides: 6, mat: "dark", smooth: 65, maxLod: 0, tag: "ladder-rung" }));
  return result;
}

/** Private Kopie, damit alle übrigen Werke unverändert worksParts verwenden können. */
function detailedT2LandFactoryParts(): PartDef[] {
  return worksParts(2, "land").map((part) => ({
    ...part,
    shapes: part.name === "gate"
      ? [...part.shapes, ...movingGate()]
      : [...part.shapes, ...reinforcedRamp(), ...sideServices(1), ...sideServices(-1), ...roofServices(), ...chimneyService()],
  }));
}

export default defineModel({
  id: "core:str_t2_fac_land",
  budget: { tris: [4000, 1000, 300] },
  parts: detailedT2LandFactoryParts(),
  notes: "Eigenes Landwerk-II-Detailbudget: verstärkte Fahrspuren und Rampe, Wandpanzerung, Axiallüfter, Rohrbögen, Kühlrippen, offenes Servicejoch und gestufte Schlotfassung. Torpanzerung, Scharnierwelle und Kniehebel bleiben im vorhandenen topgelagerten Pitch-Part. worksParts bleibt für andere Werke unverändert.",
});
