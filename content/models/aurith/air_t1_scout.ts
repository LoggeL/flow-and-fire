/**
 * Grille (f4:air_t1_scout) – Aurith-Luftaufklärer T1.
 *
 * Roster: „Kleinster Flieger, kurzer Flügel, ein einzelner senkrechter Kamm; keine Waffen-Parts.“
 * Parts keel [amber] (Rumpf), fin [team] (Flügel), fin [team] (senkrechter Kamm), 1 Tonpunkt (Perlglas).
 * Rollen-Monopol Luft-Späher (faction.md §5.2): kleinster Flieger, EIN senkrechter Kamm; verboten: Waffen-Parts.
 * Abgrenzung (Pflichtpaar MS14 Grille ↔ Maikäfer): Maikäfer = breiter Fächer + Bauch-Linse, flach; Zikade =
 * langes spitzes V ohne senkrechten Kamm. Die Grille ist kurz (0,86 WU), trägt kurze, gerundete Flügel quer zum
 * Rumpf und als höchsten Punkt einen hohen, nach hinten geschwungenen Kamm.
 *
 * Aufbau (y = Boden, +Z = Bug), Länge 0,86 WU, Spannweite 0,74 WU, Höhe 0,62 WU:
 *   hull – Bernstein-Kiel (Tropfen, Pechglas-Bauch), Bernstein-Tiefe-Auge im Bug (Aufklärer-Sensor),
 *          2 Kurzflügel (Pechglas-Unterlage + Teamfarben-Oberseite), senkrechter Kamm (Teamfarbe),
 *          Glyphenband auf dem Kielrücken, 1 Tonpunkt je Kammseite. Keine animierten Parts.
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

const curve = (ctrl: Vec2[], n: number, keepEnd = false): Vec2[] => {
  const pts = bezier(
    ctrl.map(([u, v]): Vec3 => [u, 0, v]),
    n,
  ).map(([u, , v]): Vec2 => [u, v]);
  return keepEnd ? pts : pts.slice(0, -1);
};

/** Linker Kurzflügel (Draufsicht [x, z]): gerade Vorderkante, gerundete Spitze, leicht verjüngt. */
const WING: Vec2[] = [
  [0.06, 0.16],
  ...curve(
    [
      [0.3, 0.14],
      [0.42, 0.12],
      [0.4, -0.12],
      [0.28, -0.12],
    ],
    4,
  ),
  [0.06, -0.14],
];

/** Senkrechter Kamm, Seitenprofil [z, y]: steigt hinter dem Flügel steil auf und läuft nach hinten aus. */
const CREST: Vec2[] = [
  [0.02, 0.3],
  ...curve(
    [
      [-0.08, 0.44],
      [-0.2, 0.62],
      [-0.36, 0.62],
      [-0.46, 0.58],
    ],
    4,
  ),
  ...curve(
    [
      [-0.46, 0.58],
      [-0.4, 0.44],
      [-0.36, 0.34],
      [-0.4, 0.24],
    ],
    2,
    true,
  ),
  [-0.2, 0.22],
];

const KEEL_Y = 0.14; // Unterkante der Bernsteinschale
const KEEL: Vec3 = [0.13, 0.17, 0.43];
const WING_Y = 0.2;
const CREST_T = 0.1;
const wing = (mat: string, dy: number, depth: number, extra: object = {}) =>
  extrude({
    profile: WING,
    depth,
    axis: "y",
    at: [0, WING_Y + dy, 0],
    rot: [0, 0, 6],
    mat,
    keep: true,
    tag: "fin",
    ...extra,
  });

export default defineModel({
  id: "f4:air_t1_scout",
  parts: [
    {
      name: "hull",
      shapes: [
        // Kiel: Bernstein-Tropfen oben, Pechglas-Bauch unten
        ellipsoid({
          radii: KEEL,
          half: true,
          drop: 0.45,
          segments: 8,
          rings: 3,
          at: [0, KEEL_Y + KEEL[1] / 2, 0.02],
          mat: "amber",
          keep: true,
          smooth: true,
          tag: "keel",
        }),
        ellipsoid({
          radii: [KEEL[0], 0.07, KEEL[2]],
          half: true,
          drop: 0.45,
          segments: 8,
          rings: 1,
          at: [0, KEEL_Y - 0.035, 0.02],
          rot: [0, 0, 180],
          mat: "dark",
          keep: true,
          smooth: true,
          maxLod: 1,
          tag: "keel",
        }),
        // Sensor-Auge (Bernstein-Tiefe) im Bug
        lens({
          radius: 0.075,
          thickness: 0.08,
          length: 0.16,
          segments: 8,
          rings: 2,
          at: [0, KEEL_Y + 0.06, 0.33],
          mat: "amberdeep",
          smooth: true,
          maxLod: 1,
          tag: "lens",
        }),
        // Kurzflügel: Pechglas-Unterlage + Teamfarben-Oberseite (LOD2 nur Teamfläche)
        mirrorX([
          wing("dark", -0.03, 0.03, { maxLod: 1 }),
          wing("team", 0, 0.03),
          wing("team", -0.015, 0.06, { minLod: 2 }),
        ]),
        // Der eine senkrechte Kamm (Teamfarbe), höchster Punkt
        extrude({
          profile: CREST,
          depth: CREST_T,
          mat: "team",
          keep: true,
          tag: "fin",
        }),
        // Glyphenband auf dem Kielrücken vor dem Kamm
        glyphStrip({
          path: [
            [0, KEEL_Y + 0.13, 0.28],
            [0, KEEL_Y + 0.165, 0.06],
          ],
          width: 0.045,
          pattern: [0.08, -0.04, 0.04, -0.03, 0.06],
          lift: 0.012,
          mat: "glyph",
          maxLod: 0,
          tag: "glyphs",
        }),
        // 1 Tonpunkt (Perlglas) je Kammseite, hinten oben
        mirrorX(
          lens({
            radius: 0.05,
            thickness: 0.02,
            segments: 6,
            rings: 2,
            axis: "x",
            at: [CREST_T / 2 + 0.006, 0.5, -0.3],
            mat: "pearl",
            maxLod: 0,
            tag: "techDot",
          }),
        ),
      ],
    },
  ],
  notes:
    "v_air_scout: kleinster Flieger, Kurzflügel + ein senkrechter Kamm; unbewaffnet, keine animierten Parts.",
});
