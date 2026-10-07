/**
 * Zapfstelle I (core:str_t1_mex) – Varkan-Massenextraktor T1; Grundform der Zapfstellen-Familie (II/III importieren
 * `mexParts`).
 *
 * Roster: „Ring um den Spot, zentraler glühender Pumpenkopf (Pumpentakt-Animation), niedrig.“
 * faction.md §5.2 Mex: `ring` um den Spot + zentraler Pumpenkopf (Glutkern), niedrig, bleibt auf 2×2; T3 mit
 * doppeltem Kranz; kein Heckschlot. Strukturen: gefaster Gusssockel füllt 100 % des Footprints, Teamfarbe als Kranz
 * (20–30 % der Draufsicht). In-Place-Upgrade: II/III wachsen nur in der Höhe (Roster-Maßstab y 1,2 / 1,4).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Gusssockel 2×2, Kranz (team, Torus) um den Spot, vier Kupfer-Speichen zum Pumpenkopf, Tech-Streifen
 *          (Keramik, hinten); II: Schürzenplatten links/rechts; III: zweiter Kranz (Eisen)
 *   pump – Pumpenkopf: Gusssäule, Kupferkragen, glühende Krone; nickt im Pumpentakt (Pitch)      (PartStream 1)
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  frustum,
  mirrorX,
  radial,
  stripes,
  wedge,
  torus,
  tube,
  group,
  sweep,
  type PartDef,
  type Shape,
} from "@faf/modelkit";

export const MEX_TOP = 0.16;

export function mexParts(tech: 1 | 2 | 3): PartDef[] {
  const pumpH = tech === 1 ? 0.44 : tech === 2 ? 0.5 : 0.56;
  const hull: Shape[] = [
    beveledBox({
      size: [1.96, MEX_TOP, 1.96],
      at: [0, MEX_TOP / 2, 0],
      bevel: { top: 0.08 },
      mat: "body",
      tag: "hull",
    }),
    // Spot-Öffnung (dunkel) unter dem Kranz
    cylinder({
      radius: 0.5,
      height: 0.02,
      at: [0, MEX_TOP + 0.01, 0],
      segments: 8,
      caps: "top",
      mat: "soot",
      maxLod: 0,
    }),
    // Kranz um den Spot (Teamfarbe)
    torus({
      radius: 0.56,
      tube: 0.13,
      segments: 8,
      sides: 4,
      scale: [1, 0.8, 1],
      at: [0, MEX_TOP + 0.1, 0],
      mat: "team",
      keep: true,
      tag: "ring",
    }),
    // Kupfer-Streben (Kreuz): der Flow vom Kranz in den Pumpenkopf
    radial(
      box({
        size: [0.12, 0.08, 1.02],
        at: [0, MEX_TOP + 0.12, 0],
        mat: "copper",
        tag: "barrel",
      }),
      { count: 2, startDeg: 45, maxLod: 0 },
    ),
    // Four sloping jaw housings clamp the ring to the drill platform.
    radial(
      wedge({
        size: [0.2, 0.18, 0.28], at: [0, MEX_TOP + 0.12, 0.76],
        mat: "body", maxLod: 0, tag: "hull",
      }),
      { count: 4 },
    ),
    // Two exposed piston guides flank the reciprocating pump, below its glowing crown.
    mirrorX(cylinder({
      radius: 0.04, height: pumpH + 0.1, segments: 4, caps: false,
      at: [0.26, MEX_TOP + (pumpH + 0.1) / 2, 0],
      mat: "copper", keep: true, maxLod: 0, tag: "barrel",
    })),
    // Tech-Streifen (Keramik) im hinteren Drittel, quer zwischen Kranz und Sockelkante
    stripes({
      count: tech,
      width: 0.2,
      at: [0, MEX_TOP + 0.004, -0.8],
      rot: [0, 90, 0],
    }),
  ];
  if (tech >= 2) {
    // Schürzenplatten links/rechts (flach, gefast)
    for (const x of [0.83, -0.83]) {
      hull.push(
        beveledBox({
          size: [0.28, 0.16, 1.5],
          at: [x, MEX_TOP + 0.08, 0],
          bevel: { top: 0.08 },
          mat: "body",
          maxLod: 1,
          tag: "hull",
        }),
      );
    }
  }
  if (tech === 3) {
    // zweiter Kranz (Eisen) über dem ersten
    hull.push(
      torus({
        radius: 0.36,
        tube: 0.09,
        segments: 8,
        sides: 4,
        at: [0, MEX_TOP + 0.26, 0],
        mat: "body",
        keep: true,
        tag: "ring",
      }),
    );
  }
  const pump: Shape[] = [
    frustum({
      radius: 0.3,
      radiusTop: 0.22,
      height: pumpH,
      at: [0, MEX_TOP + pumpH / 2, 0],
      segments: 8,
      caps: false,
      mat: "body",
      keep: true,
      tag: "stack",
    }),
    cylinder({
      radius: 0.25,
      height: 0.08,
      at: [0, MEX_TOP + pumpH - 0.03, 0],
      segments: 8,
      caps: false,
      mat: "copper",
      maxLod: 0,
      tag: "stack",
    }),
    // glühende Krone (Glutkern)
    cylinder({
      radius: 0.2,
      height: 0.26,
      at: [0, MEX_TOP + pumpH + 0.13, 0],
      segments: 8,
      caps: "top",
      mat: "glow",
      keep: true,
      tag: "stack",
    }),
  ];
  return [
    { name: "hull", shapes: hull },
    {
      name: "pump",
      pivot: [0, MEX_TOP + 0.05, 0],
      anim: "pitch",
      shapes: pump,
    },
  ];
}

/** T1-Nahmodell; mexParts bleibt die unveränderte Geometriequelle für II und III. */
function detailedT1MexParts(): PartDef[] {
  const family = mexParts(1);
  const oldHull = family[0]!.shapes;
  const oldPump = family[1]!;
  const hull: Shape[] = [
    oldHull[0]!, oldHull[1]!, oldHull[2]!, oldHull[6]!,
    // Versenkter Lagerkranz: Öffnung mit Spiel für +/- 5 Grad Pumpenhub.
    tube({ outer: 0.368, inner: 0.335, height: 0.095, segments: 12,
      at: [0, 0.2175, 0], mat: "body", maxLod: 0, smooth: 60, tag: "ring" }),
    // Acht austauschbare Kranzpanzer sitzen auf dem tragenden Team-Torus.
    radial(beveledBox({ size: [0.19, 0.055, 0.18], bevel: { top: 0.02 },
      at: [0, 0.366, 0.55], mat: "team", maxLod: 0 }), { count: 8 }),
    // Vier verschraubte Spannbacken drücken den Kranz auf den Gusssockel.
    radial(group([
      wedge({ size: [0.24, 0.18, 0.29], at: [0, 0.25, 0.765],
        mat: "body", maxLod: 0, tag: "hull" }),
      box({ size: [0.19, 0.035, 0.13], at: [0, 0.349, 0.79],
        mat: "team", maxLod: 0 }),
      cylinder({ radius: 0.045, height: 0.265, axis: "x", segments: 6,
        at: [0, 0.306, 0.77], mat: "copper", maxLod: 0, smooth: true }),
      cylinder({ radius: 0.024, height: 0.025, segments: 4,
        at: [0, 0.378, 0.79], mat: "body", maxLod: 0 }),
    ]), { count: 4 }),
    // Kurze hydraulische Versorgungsbögen führen über dem Kranz zum Lagergehäuse.
    radial(sweep({ path: [[0, 0.32, 0.8], [0, 0.405, 0.71],
        [0, 0.405, 0.49], [0, 0.285, 0.355]], radius: 0.026,
      sides: 6, caps: false, mat: "copper", maxLod: 0, smooth: true }),
      { count: 4, startDeg: 45 }),
    // Zwei stationäre Führungen stehen außerhalb des gesamten Pumpen-Schwenkbereichs.
    mirrorX([
      beveledBox({ size: [0.12, 0.11, 0.17], bevel: { top: 0.025 },
        at: [0.423, 0.227, 0], mat: "body", maxLod: 0 }),
      cylinder({ radius: 0.037, height: 0.26, segments: 8, caps: false,
        at: [0.423, 0.407, 0], mat: "copper", maxLod: 0, smooth: true }),
      cylinder({ radius: 0.022, height: 0.12, segments: 6, caps: false,
        at: [0.423, 0.593, 0], mat: "metal", maxLod: 0, smooth: true }),
      cylinder({ radius: 0.049, height: 0.044, segments: 6,
        at: [0.423, 0.537, 0], mat: "body", maxLod: 0 }),
      box({ size: [0.12, 0.04, 0.11], at: [0.423, 0.672, 0],
        mat: "team", maxLod: 0 }),
    ]),
    // Wartungsgehäuse mit vertiefter Kühlfläche und drei getrennten Kühlrippen.
    radial(group([
      beveledBox({ size: [0.27, 0.13, 0.3], bevel: { top: 0.035 },
        at: [0, 0.23, 0.78], mat: "body", maxLod: 0 }),
      box({ size: [0.205, 0.012, 0.205], at: [0, 0.3005, 0.78],
        mat: "dark", maxLod: 0 }),
      ...[-0.064, 0, 0.064].map((x) => box({ size: [0.028, 0.026, 0.185],
        at: [x, 0.315, 0.78], mat: "body", maxLod: 0 })),
      box({ size: [0.18, 0.055, 0.025], at: [0, 0.244, 0.941],
        mat: "team", maxLod: 0 }),
    ]), { count: 4, startDeg: 45 }),
    // Service-Zugang auf dem vorderen Sockel, hintere Tech-Keramik bleibt lesbar.
    box({ size: [0.42, 0.014, 0.085], at: [0, 0.167, 0.899],
      mat: "dark", maxLod: 0 }),
    ...[-0.14, 0, 0.14].map((x) => box({ size: [0.075, 0.018, 0.065],
      at: [x, 0.183, 0.899], mat: "body", maxLod: 0 })),
  ];
  const pump: Shape[] = [
    ...oldPump.shapes,
    // Bewegtes unteres Lager und acht Längsrippen gehören vollständig zum pump-Part.
    cylinder({ radius: 0.313, height: 0.043, segments: 10, caps: false,
      at: [0, 0.249, 0], mat: "copper", maxLod: 0, smooth: true }),
    radial(box({ size: [0.05, 0.265, 0.046], at: [0, 0.431, 0.274],
      rot: [-8, 0, 0], mat: "body", maxLod: 0 }), { count: 8 }),
    // Geteiltes Pumpenjoch, Schmieranschluss und kleine Team-Schilde um den Glutkern.
    mirrorX(beveledBox({ size: [0.105, 0.075, 0.18], bevel: { top: 0.018 },
      at: [0.27, 0.554, 0], mat: "body", maxLod: 0 })),
    radial(box({ size: [0.11, 0.18, 0.037], at: [0, 0.697, 0.222],
      mat: "team", maxLod: 0 }), { count: 4, startDeg: 45 }),
    tube({ outer: 0.246, inner: 0.205, height: 0.045, segments: 10,
      at: [0, 0.793, 0], mat: "body", maxLod: 0, smooth: true }),
    sweep({ path: [[0.12, 0.36, 0.24], [0.13, 0.48, 0.245],
        [0.11, 0.565, 0.21]], radius: 0.018, sides: 6, caps: false,
      mat: "copper", maxLod: 0, smooth: true }),
  ];
  return [{ name: "hull", shapes: hull }, { ...oldPump, shapes: pump }];
}

export default defineModel({
  id: "core:str_t1_mex",
  budget: { tris: [2200, 600, 180] },
  parts: detailedT1MexParts(),
  notes:
    "Lokales T1-Detailbudget für Spannbacken, Lager, Hydraulik, Kühler und Pumpenjoch. Alle bewegten Anbauten folgen pump mit unverändertem Pitch-Pivot; LOD1/2 nutzen den schlanken Familienkern. mexParts für T2/T3 bleibt unverändert.",
});
