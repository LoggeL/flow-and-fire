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
  radial,
  stripes,
  torus,
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
      segments: 12,
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

export default defineModel({
  id: "core:str_t1_mex",
  parts: mexParts(1),
  notes:
    "Grundform v_mex; Pumpentakt = Pitch des Pumpenkopfs (Roster-Anim „tilt“).",
});
