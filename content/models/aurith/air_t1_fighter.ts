/**
 * Zikade (f4:air_t1_fighter) – Aurith-Abfangjäger T1.
 *
 * Roster: „Schmales Pfeilblatt aus zwei Kämmen zu einem spitzen V (lang > breit); keine Fächer, keine Gondeln.“
 * Parts keel [amber], fin [team] (Pfeilblatt links), fin [team] (Pfeilblatt rechts), 1 Tonpunkt (Perlglas).
 * Rollen-Monopol Abfangjäger (faction.md §5.2): schmales Pfeilblatt, lang > breit; verboten: Fächer, Gondeln.
 * Abgrenzung (Pflichtpaare MS14): Maikäfer = breiter Fächer (breit ≥ lang), Schwärmer = gleiches Pfeilblatt, aber
 * Linsen-Gondeln an den Spitzen und Maßstab 1,3, Grille = Kurzflügel + EIN senkrechter Kamm.
 *
 * Form: zwei geschwungene Kamm-Blätter treffen sich an der Kielspitze und laufen weit nach hinten auseinander
 * (spitzes V von oben, hinten offene Kerbe), leicht nach oben angestellt (V auch von vorn). Dazwischen der schlanke
 * Bernstein-Kiel als Tropfen (vorn spitz), unten Pechglas. Kurve = Körper; die Luftwaffe steckt unsichtbar im Kiel
 * (Kampfflieger tragen keine Waffenform, Richtung über den Grundriss, faction.md §3.2).
 *
 * Maße (y = Boden, +Z = Bug): Länge 1,30 WU, Spannweite 0,90 WU. Teamfarbe = gesamte Blattoberseite (≥ 45 %).
 *   hull – Kiel (Bernstein oben, Pechglas unten), 2 Pfeilblätter (Pechglas-Unterlage + Teamfarben-Oberseite),
 *          Glyphenband auf dem Kielrücken, 1 Tonpunkt. Keine animierten Parts (Roster: animatedParts 0).
 */
import {
  bezier,
  defineModel,
  ellipsoid,
  extrude,
  glyphStrip,
  lens,
  mirrorX,
  type Vec2,
  type Vec3,
} from "@faf/modelkit";

/** Bézier in der Draufsicht [x, z] → Punkte ohne den Endpunkt (für zusammengesetzte Profile). */
const curve = (ctrl: Vec2[], n: number, keepEnd = false): Vec2[] => {
  const pts = bezier(
    ctrl.map(([x, z]): Vec3 => [x, 0, z]),
    n,
  ).map(([x, , z]): Vec2 => [x, z]);
  return keepEnd ? pts : pts.slice(0, -1);
};

/** Linkes Pfeilblatt (Draufsicht [x, z]): Vorderkante von der Kielspitze weit nach hinten außen, Innenkante zurück. */
const BLADE: Vec2[] = [
  ...curve(
    [
      [0.02, 0.6],
      [0.2, 0.34],
      [0.38, -0.12],
      [0.45, -0.66],
    ],
    5,
  ),
  ...curve(
    [
      [0.45, -0.66],
      [0.36, -0.62],
      [0.14, -0.26],
      [0.04, 0.34],
    ],
    4,
    true,
  ),
];

const DIHEDRAL = 9; // Grad: Blätter außen angehoben
const BLADE_Y = 0.2;
const KEEL_Y = 0.16; // Unterkante der Bernsteinschale
const KEEL: Vec3 = [0.15, 0.18, 0.66];
const blade = (mat: string, dy: number, depth: number, extra: object = {}) =>
  extrude({
    profile: BLADE,
    depth,
    axis: "y",
    at: [0, BLADE_Y + dy, 0],
    rot: [0, 0, DIHEDRAL],
    mat,
    keep: true,
    tag: "fin",
    ...extra,
  });

export default defineModel({
  id: "f4:air_t1_fighter",
  parts: [
    {
      name: "hull",
      shapes: [
        // Pfeilblätter: Pechglas-Unterlage + Teamfarben-Oberseite (LOD2: nur die Teamfläche)
        mirrorX([
          blade("dark", -0.03, 0.03, { maxLod: 1 }),
          blade("team", 0, 0.03),
          blade("team", -0.015, 0.06, { minLod: 2 }),
        ]),
        // Kiel: Bernstein-Tropfen oben, Pechglas-Bauch unten (weich)
        ellipsoid({
          radii: KEEL,
          half: true,
          drop: 0.55,
          segments: 8,
          rings: 3,
          at: [0, KEEL_Y + KEEL[1] / 2, -0.02],
          mat: "amber",
          keep: true,
          smooth: true,
          tag: "keel",
        }),
        ellipsoid({
          radii: [KEEL[0], 0.08, KEEL[2]],
          half: true,
          drop: 0.55,
          segments: 8,
          rings: 1,
          at: [0, KEEL_Y - 0.04, -0.02],
          rot: [0, 0, 180],
          mat: "dark",
          keep: true,
          smooth: true,
          maxLod: 1,
          tag: "keel",
        }),
        // Glyphenband längs des Kielrückens (Notenlinie, ≤ 3 %)
        glyphStrip({
          path: [
            [0, KEEL_Y + 0.13, 0.36],
            [0, KEEL_Y + 0.165, 0.02],
            [0, KEEL_Y + 0.14, -0.34],
          ],
          width: 0.05,
          pattern: [0.16, -0.06, 0.06, -0.06, 0.22],
          lift: 0.012,
          mat: "glyph",
          maxLod: 0,
          tag: "glyphs",
        }),
        // 1 Tonpunkt (Perlglas) hinten auf dem Kielrücken
        lens({
          radius: 0.06,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, KEEL_Y + 0.13, -0.46],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
      ],
    },
  ],
  notes:
    "v_fighter: Pfeilblatt aus zwei Kämmen (spitzes V), Bernstein-Kiel; keine animierten Parts.",
});
