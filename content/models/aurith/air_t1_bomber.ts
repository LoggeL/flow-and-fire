/**
 * Maikäfer (f4:air_t1_bomber) – Aurith-Bomber T1.
 *
 * Roster: „Breiter Fächer (Deckflügel-Muschel von oben, breit ≥ lang) mit Bauch-Linse; keine Pfeilung, keine Gabel.“
 * Parts lens [amber] (Bauch-Linse), shell [team] (Fächer), fin (Leitkamm, Teamfarbe), 1 Tonpunkt (Perlglas).
 * Rollen-Monopol Bomber (faction.md §5.2): breiter Fächer + Bauch-Linse, breit ≥ lang; verboten: Pfeilung, Gabel.
 * Abgrenzung (Pflichtpaare MS14): Zikade = schmales spitzes V (lang > breit), Grille = Kurzflügel + hoher Kamm,
 * Schwärmer = Pfeilblatt mit Gondeln. Der Maikäfer ist die einzige halbrunde Scheibe: gerade Vorderkante quer zur
 * Flugrichtung (Pfeilung 0°), hinten ein gewellter Halbkreis, darunter die dicke Bernstein-Bauchlinse, die vorn als
 * Kopf über die Fächerkante ragt.
 *
 * Aufbau (y = Boden, +Z = Bug), Spannweite 1,56 WU, Länge 1,20 WU (breit ≥ lang):
 *   hull – Fächer aus zwei Deckflügel-Hälften (Pechglas-Unterlage + Teamfarben-Oberseite, flaches Dach), gewellte
 *          Hinterkante (Fächerrippen), Glyphenbänder als Rippen, Bauch-Linse (Bernstein) mit Bernstein-Kante am
 *          Kopf, Leitkamm hinten mittig, 1 Tonpunkt. Keine animierten Parts (Roster: animatedParts 0).
 */
import {
  defineModel,
  extrude,
  glyphStrip,
  lens,
  mirrorX,
  type Vec2,
  type Vec3,
} from "@faf/modelkit";

const HINGE_Z = 0.3; // Vorderkante des Fächers (gerade, quer)
const R = 0.78; // Fächerradius
const RIBS = 4; // Rippen je Hälfte
/** Linke Fächerhälfte (Draufsicht [x, z]): Viertelkreis um den Scharnierpunkt, Hinterkante gewellt (Rippen). */
const FAN: Vec2[] = (() => {
  const pts: Vec2[] = [[0.0, HINGE_Z]];
  const n = RIBS * 2;
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (1 - i / n); // 90° (seitlich) → 0° (hinten)
    const r = i % 2 === 0 ? R : R * 0.94;
    pts.push([
      r * Math.sin(a) * (i === 0 ? 1 : 1),
      HINGE_Z - r * Math.cos(a) * 0.95,
    ]);
  }
  pts[1] = [R, HINGE_Z - 0.02];
  pts[pts.length - 1] = [0.0, HINGE_Z - R * 0.95];
  return pts;
})();

const FAN_Y = 0.3;
const ROOF = 5; // Grad: flaches Dach (Hälften nach außen leicht fallend)
const fan = (mat: string, dy: number, depth: number, extra: object = {}) =>
  extrude({
    profile: FAN,
    depth,
    axis: "y",
    at: [0, FAN_Y + dy, 0],
    rot: [0, 0, -ROOF],
    mat,
    keep: true,
    tag: "shell",
    ...extra,
  });

/** Leitkamm (Teamfarbe) hinten mittig, Seitenprofil [z, y]: flacher Bogen, läuft nach hinten aus. */
const FIN: Vec2[] = [
  [-0.16, FAN_Y + 0.02],
  [-0.32, FAN_Y + 0.13],
  [-0.52, FAN_Y + 0.15],
  [-0.66, FAN_Y + 0.06],
  [-0.6, FAN_Y + 0.0],
];

/** Glyphen-Rippe der linken Hälfte unter dem Winkel `deg` (0° = hinten, 90° = seitlich). */
function rib(deg: number) {
  const a = (deg * Math.PI) / 180;
  const roof = (x: number): number =>
    FAN_Y + 0.02 - x * Math.tan((ROOF * Math.PI) / 180);
  const p = (r: number): Vec3 => {
    const x = r * Math.sin(a);
    return [x, roof(x), HINGE_Z - r * Math.cos(a) * 0.95];
  };
  return glyphStrip({
    path: [p(0.3), p(0.66)],
    width: 0.05,
    pattern: [0.1, -0.05, 0.05, -0.04, 0.12],
    lift: 0.012,
    mat: "glyph",
    maxLod: 0,
    tag: "glyphs",
  });
}

export default defineModel({
  id: "f4:air_t1_bomber",
  parts: [
    {
      name: "hull",
      shapes: [
        // Fächer: zwei Deckflügel-Hälften, Teamfarbe auf der ganzen Oberseite (ab LOD1 eine Platte)
        mirrorX([
          fan("dark", -0.03, 0.03, { maxLod: 0 }),
          fan("team", 0, 0.03, { maxLod: 0 }),
          fan("team", -0.015, 0.06, { minLod: 1 }),
        ]),
        // Bauch-Linse (Bernstein): dicker Linsenkörper unter dem Fächer, ragt vorn als Kopf über die Vorderkante
        lens({
          radius: 0.33,
          thickness: 0.32,
          length: 1.12,
          segments: 8,
          rings: 4,
          at: [0, 0.17, 0.0],
          mat: "amber",
          keep: true,
          smooth: true,
          tag: "lens",
        }),
        // Kopf-Kante (Bernstein-Kante) und Bombenauge (Bernstein-Tiefe) unter dem Bauch
        lens({
          radius: 0.17,
          thickness: 0.16,
          length: 0.26,
          segments: 6,
          rings: 2,
          at: [0, 0.26, 0.46],
          mat: "amberedge",
          keep: true,
          smooth: true,
          tag: "lens",
        }),
        lens({
          radius: 0.12,
          thickness: 0.06,
          length: 0.3,
          segments: 6,
          rings: 2,
          at: [0, 0.03, -0.02],
          mat: "amberdeep",
          maxLod: 1,
          tag: "lens",
        }),
        // Leitkamm (Teamfarbe) hinten mittig, läuft nach hinten aus
        extrude({
          profile: FIN,
          depth: 0.08,
          mat: "team",
          keep: true,
          tag: "fin",
        }),
        // Glyphenbänder als Fächerrippen
        mirrorX([rib(22), rib(56)]),
        // 1 Tonpunkt (Perlglas) vor dem Leitkamm
        lens({
          radius: 0.06,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, FAN_Y + 0.025, -0.02],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
      ],
    },
  ],
  notes:
    "v_bomber: halbrunder Fächer (breit ≥ lang, Pfeilung 0°) + Bernstein-Bauchlinse; keine animierten Parts.",
});
