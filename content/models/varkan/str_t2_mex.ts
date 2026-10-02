/**
 * Zapfstelle II (core:str_t2_mex), Varkan-Massenextraktor T2.
 *
 * Gestufter Pumpenzylinder, schwere Spannbacken, geschützte Kupferleitungen und Kühler.
 * Die T2-Geometrie ist privat; mexParts bleibt die gemeinsame Familienbasis.
 * Roster-Maßstab y ×1,2, originale Team-Kranzform und zwei Tech-Streifen bleiben erhalten.
 */
import {
  beveledBox, box, cylinder, defineModel, extrude, frustum, group,
  mirrorX, radial, sweep, tube, wedge, type PartDef, type Shape,
} from "@faf/modelkit";
import { mexParts } from "./str_t1_mex.ts";

/** T2-Anbauten folgen entweder dem Sockel oder vollständig der bewegten Pumpe. */
function detailedT2MexParts(): PartDef[] {
  const family = mexParts(2);
  const oldPump = family[1]!;
  const hull: Shape[] = [
    // Die alten T1-Backen und die innenliegenden Führungen werden durch T2-Baugruppen ersetzt.
    ...family[0]!.shapes.filter((_, index) => index !== 4 && index !== 5),
    // Festes, versenktes Lagergehäuse mit Freiraum für den Pumpenhub von +/-5 Grad.
    tube({ outer: 0.413, inner: 0.368, height: 0.115, segments: 12,
      at: [0, 0.2425, 0], mat: "body", maxLod: 0, smooth: 65, tag: "bearing-housing" }),
    cylinder({ radius: 0.35, height: 0.023, segments: 12, caps: false,
      at: [0, 0.1775, 0], mat: "copper", maxLod: 0, smooth: 65, tag: "bearing-seat" }),
    // Acht geformte Panzersegmente schützen den originalen Teamkranz.
    radial(extrude({ profile: [[0.425, 0.3], [0.466, 0.386], [0.6, 0.407],
        [0.69, 0.326], [0.659, 0.278], [0.486, 0.266]], depth: 0.185,
      mat: "team", maxLod: 0, tag: "ring-armor" }), { count: 8 }),
    // Schwere Backen mit schräger Lastlinie, Querzapfen und vorderer Servicelasche.
    radial(group([
      extrude({ profile: [[0.592, 0.183], [0.892, 0.183], [0.921, 0.273],
          [0.793, 0.399], [0.704, 0.399], [0.592, 0.295]], depth: 0.274,
        mat: "body", maxLod: 0, tag: "service-jaw" }),
      beveledBox({ size: [0.233, 0.048, 0.146], bevel: { topFront: 0.018 },
        at: [0, 0.409, 0.747], mat: "team", maxLod: 0, tag: "jaw-armor" }),
      cylinder({ radius: 0.058, height: 0.299, axis: "x", segments: 8,
        at: [0, 0.315, 0.782], mat: "dark", maxLod: 0, smooth: 65, tag: "jaw-bearing" }),
      ...[-1, 1].map((side) => cylinder({ radius: 0.039, height: 0.022, axis: "x", segments: 6,
        at: [side * 0.159, 0.315, 0.782], mat: "copper", maxLod: 0, smooth: 65, tag: "jaw-pin" })),
      box({ size: [0.134, 0.074, 0.021], at: [0, 0.236, 0.929],
        mat: "dark", maxLod: 0, tag: "service-recess" }),
      box({ size: [0.083, 0.022, 0.031], at: [0, 0.259, 0.944],
        mat: "copper", maxLod: 0, tag: "service-latch" }),
    ]), { count: 4 }),
    // T2-Schürzen tragen abgesetzte, nach unten offene Panzerflächen.
    mirrorX([
      extrude({ profile: [[-0.69, 0.243], [-0.6, 0.37], [0.56, 0.37],
          [0.699, 0.258], [0.59, 0.223], [-0.61, 0.223]], depth: 0.077,
        at: [0.889, 0, 0], mat: "body", maxLod: 0, tag: "skirt-armor" }),
      box({ size: [0.033, 0.036, 0.89], at: [0.933, 0.282, -0.018],
        mat: "copper", maxLod: 0, tag: "skirt-coolant" }),
      ...[-0.48, -0.12, 0.24].map((z) => beveledBox({ size: [0.021, 0.074, 0.216],
        bevel: { top: 0.009 }, at: [0.955, 0.302, z],
        mat: "team", maxLod: 0, tag: "skirt-panel" })),
    ]),
    // Zwei gebogene Versorgungsleitungen liegen geschützt zwischen Kranz und Kühlkammern.
    radial(sweep({ path: [[0, 0.287, 0.835], [0, 0.438, 0.756],
        [0, 0.46, 0.528], [0, 0.328, 0.395]], radius: 0.033,
      sides: 6, caps: false, mat: "copper", maxLod: 0, smooth: 65, tag: "supply-pipe" }),
      { count: 4, startDeg: 45 }),
    // Stationäre Führungen stehen außerhalb des geschwenkten Pumpenkopfs.
    mirrorX([
      beveledBox({ size: [0.154, 0.117, 0.18], bevel: { top: 0.025 },
        at: [0.47, 0.2285, 0], mat: "body", maxLod: 0, tag: "guide-foot" }),
      cylinder({ radius: 0.045, height: 0.286, segments: 8, caps: false,
        at: [0.47, 0.43, 0], mat: "dark", maxLod: 0, smooth: 65, tag: "guide-cylinder" }),
      tube({ outer: 0.054, inner: 0.031, height: 0.041, segments: 8,
        at: [0.47, 0.5775, 0], mat: "copper", maxLod: 0, smooth: 65, tag: "guide-bearing" }),
      cylinder({ radius: 0.027, height: 0.166, segments: 8, caps: false,
        at: [0.47, 0.676, 0], mat: "metal", maxLod: 0, smooth: 65, tag: "guide-rod" }),
      beveledBox({ size: [0.126, 0.061, 0.139], bevel: { top: 0.012 },
        at: [0.47, 0.7845, 0], mat: "team", maxLod: 0, tag: "guide-head" }),
    ]),
    // Kühler in den vier Sockelecken, mit vertiefter Lamellenfläche und geformter Haube.
    radial(group([
      beveledBox({ size: [0.32, 0.137, 0.318], bevel: { topFront: 0.035, topBack: 0.025 },
        at: [0, 0.2535, 0.926], mat: "body", maxLod: 0, tag: "cooling-chamber" }),
      box({ size: [0.251, 0.012, 0.229], at: [0, 0.328, 0.917],
        mat: "dark", maxLod: 0, tag: "cooling-recess" }),
      ...[-0.086, -0.0287, 0.0287, 0.086].map((x) => box({ size: [0.028, 0.04, 0.216],
        at: [x, 0.347, 0.917], mat: "copper", maxLod: 0, tag: "cooling-fin" })),
      box({ size: [0.205, 0.043, 0.026], at: [0, 0.253, 1.086],
        mat: "team", maxLod: 0, tag: "cooling-front" }),
    ]), { count: 4, startDeg: 45 }),
    // In mittlerer Entfernung bleiben Backen, Führungen und T2-Panzerschürzen sichtbar.
    radial(wedge({ size: [0.23, 0.18, 0.26], at: [0, 0.265, 0.765],
      mat: "body", minLod: 1, maxLod: 1, keep: true }), { count: 4 }),
    mirrorX([
      box({ size: [0.12, 0.06, 0.75], at: [0.887, 0.347, 0],
        mat: "team", minLod: 1, maxLod: 1, keep: true }),
      cylinder({ radius: 0.043, height: 0.49, segments: 6, caps: false,
        at: [0.47, 0.511, 0], mat: "copper", minLod: 1, maxLod: 1, keep: true, smooth: 65 }),
    ]),
    radial(box({ size: [0.24, 0.09, 0.25], at: [0, 0.237, 0.924],
      mat: "body", minLod: 1, maxLod: 1, keep: true }), { count: 4, startDeg: 45 }),
    radial(box({ size: [0.23, 0.16, 0.25], at: [0, 0.24, 0.765],
      mat: "body", minLod: 2, keep: true }), { count: 4 }),
    mirrorX(box({ size: [0.23, 0.12, 1.35], at: [0.83, 0.26, 0],
      mat: "body", minLod: 2, keep: true })),
  ];
  const pump: Shape[] = [
    ...oldPump.shapes,
    // Gestuftes bewegtes Druckgehäuse mit Lagerfuß und acht separaten Gussrippen.
    cylinder({ radius: 0.321, height: 0.054, segments: 12, caps: false,
      at: [0, 0.236, 0], mat: "copper", maxLod: 0, smooth: 65, tag: "pump-bearing" }),
    frustum({ radius: 0.326, radiusTop: 0.29, height: 0.134, segments: 8, caps: false,
      at: [0, 0.346, 0], mat: "body", maxLod: 0, tag: "pressure-chamber" }),
    frustum({ radius: 0.282, radiusTop: 0.239, height: 0.196, segments: 8, caps: false,
      at: [0, 0.513, 0], mat: "body", maxLod: 0, tag: "pressure-chamber" }),
    radial(extrude({ profile: [[0.294, 0.273], [0.339, 0.298], [0.272, 0.596],
        [0.239, 0.614], [0.248, 0.49]], depth: 0.052,
      mat: "body", maxLod: 0, tag: "pump-rib" }), { count: 8 }),
    tube({ outer: 0.275, inner: 0.229, height: 0.047, segments: 10,
      at: [0, 0.6365, 0], mat: "copper", maxLod: 0, smooth: 65, tag: "pump-collar" }),
    // Ein offenes Schutzjoch lässt den ursprünglichen Glutkern zwischen den Schilden sehen.
    radial(group([
      beveledBox({ size: [0.13, 0.204, 0.039], bevel: { top: 0.012 },
        at: [0, 0.778, 0.235], mat: "team", maxLod: 0, tag: "crown-shield" }),
      box({ size: [0.043, 0.239, 0.045], at: [0, 0.7895, 0.262],
        mat: "body", maxLod: 0, tag: "crown-support" }),
    ]), { count: 4, startDeg: 45 }),
    tube({ outer: 0.272, inner: 0.208, height: 0.046, segments: 12,
      at: [0, 0.916, 0], mat: "body", maxLod: 0, smooth: 65, tag: "crown-cap" }),
    // Bewegte Schmierleitungen enden am eigenen Gehäuse, ohne Verbindung zum Sockel.
    mirrorX(sweep({ path: [[0.12, 0.33, 0.294], [0.14, 0.437, 0.273],
        [0.13, 0.576, 0.23], [0.11, 0.65, 0.22]], radius: 0.018,
      sides: 6, caps: false, mat: "copper", maxLod: 0, smooth: 65, tag: "pump-oil-line" })),
    // Vereinfachte Stufe und Schildgruppe folgen auch in LOD1 dem Pumpentakt.
    cylinder({ radius: 0.318, height: 0.05, segments: 6, caps: false,
      at: [0, 0.25, 0], mat: "copper", minLod: 1, maxLod: 1, keep: true, smooth: 65 }),
    radial(box({ size: [0.12, 0.19, 0.042], at: [0, 0.786, 0.237],
      mat: "team", minLod: 1, maxLod: 1, keep: true }), { count: 4, startDeg: 45 }),
  ];
  return [{ ...family[0]!, shapes: hull }, { ...oldPump, shapes: pump }];
}

export default defineModel({
  id: "core:str_t2_mex",
  budget: { tris: [2600, 700, 220] },
  parts: detailedT2MexParts(),
  notes: "Privater T2-Aufbau mit gestufter Druckkammer, Spannbacken, Panzerschürzen, Leitungsbögen, Führungen und Kühlern. Teamkranz, Tech-Keramik und originale hull/pump-Parts bleiben erhalten; alle Pumpenanbauten folgen dem Pitch-Pivot. Freiraum für +/-5 Grad Pumpentakt.",
});
