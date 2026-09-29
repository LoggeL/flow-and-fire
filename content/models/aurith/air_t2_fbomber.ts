/**
 * Schwärmer (f4:air_t2_fbomber) – Aurith-Jagdbomber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Pfeilblatt mit zwei Linsen-Gondeln an den Spitzen, Spannweite +30 % gegenüber Zikade; keine Reifen.“
 * Parts keel [amber], fin [team] (Pfeilblatt l/r), lens (Gondel l/r); 2 Tonpunkte.
 * Rollen-Monopol Jagdbomber (faction.md §5.2): Pfeilblatt mit zwei Linsen-Gondeln an den Spitzen; verboten: Reifen.
 * Abgrenzung (Pflichtpaar MS14 Zikade ↔ Schwärmer): dieselbe Pfeilblatt-Familie (Kielspitze, Blätter laufen nach
 * hinten auseinander), aber breitere, weniger gepfeilte Blätter, an deren Spitzen zwei dicke Bernstein-Gondeln
 * sitzen, und Maßstab 1,3. Spannweite Basis 1,22 WU inkl. Gondeln (Zikade 0,89 WU, +37 %), im Spiel 1,59 WU (+79 %).
 *
 * Aufbau (Basismaß, y = Boden, +Z = Bug), Länge 1,22 WU (→ 1,59 WU):
 *   hull – Kiel (Bernstein oben, Pechglas unten), 2 Pfeilblätter (Pechglas-Unterlage + Teamfarben-Oberseite),
 *          2 Linsen-Gondeln (Bernstein, Pechglas-Mündungsring vorn) an den Blattspitzen, Glyphenband auf dem
 *          Kielrücken, 2 Tonpunkte. Keine animierten Parts (Roster: animatedParts 0).
 */
import {
  bezier,
  cylinder,
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
    ctrl.map(([x, z]): Vec3 => [x, 0, z]),
    n,
  ).map(([x, , z]): Vec2 => [x, z]);
  return keepEnd ? pts : pts.slice(0, -1);
};

const TIP: Vec2 = [0.5, -0.3]; // Blattspitze = Gondelmitte
/** Linkes Pfeilblatt (Draufsicht [x, z]): breiter und weniger gepfeilt als bei der Zikade, Spitze stumpf für die Gondel. */
const BLADE: Vec2[] = [
  ...curve(
    [
      [0.02, 0.58],
      [0.22, 0.38],
      [0.42, 0.06],
      [0.5, -0.16],
    ],
    5,
  ),
  [0.5, -0.44],
  ...curve(
    [
      [0.42, -0.5],
      [0.28, -0.48],
      [0.12, -0.3],
      [0.04, 0.2],
    ],
    4,
    true,
  ),
];

const DIHEDRAL = 7;
const BLADE_Y = 0.22;
const KEEL_Y = 0.17;
const KEEL: Vec3 = [0.16, 0.18, 0.62];
const POD_Y = BLADE_Y + TIP[0] * Math.tan((DIHEDRAL * Math.PI) / 180) - 0.02;
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
  id: "f4:air_t2_fbomber",
  parts: [
    {
      name: "hull",
      shapes: [
        // Pfeilblätter: Pechglas-Unterlage + Teamfarben-Oberseite (ab LOD1 eine Teamplatte)
        mirrorX([
          blade("dark", -0.03, 0.03, { maxLod: 0 }),
          blade("team", 0, 0.03, { maxLod: 0 }),
          blade("team", -0.015, 0.06, { minLod: 1 }),
        ]),
        // Kiel: Bernstein-Tropfen oben, Pechglas-Bauch
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
        // Linsen-Gondeln an den Blattspitzen (Bernstein, weich) mit Pechglas-Mündungsring vorn
        mirrorX([
          lens({
            radius: 0.14,
            thickness: 0.22,
            length: 0.62,
            segments: 8,
            rings: 3,
            at: [TIP[0], POD_Y, TIP[1]],
            mat: "amber",
            keep: true,
            smooth: true,
            tag: "lens",
          }),
          cylinder({
            radius: 0.06,
            height: 0.06,
            segments: 6,
            axis: "z",
            caps: "top",
            at: [TIP[0], POD_Y, TIP[1] + 0.31],
            mat: "pitch",
            maxLod: 1,
            tag: "lens",
          }),
        ]),
        // Glyphenband längs des Kielrückens
        glyphStrip({
          path: [
            [0, KEEL_Y + 0.13, 0.36],
            [0, KEEL_Y + 0.165, 0.04],
            [0, KEEL_Y + 0.15, -0.22],
          ],
          width: 0.05,
          pattern: [0.14, -0.06, 0.06, -0.06, 0.18],
          lift: 0.012,
          mat: "glyph",
          maxLod: 0,
          tag: "glyphs",
        }),
        // 2 Tonpunkte (Perlglas) hinten auf dem Kielrücken
        lens({
          radius: 0.055,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, KEEL_Y + 0.14, -0.36],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
        lens({
          radius: 0.055,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, KEEL_Y + 0.105, -0.5],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
      ],
    },
  ],
  notes:
    "v_fbomber: Pfeilblatt wie die Zikade, breiter, mit zwei Bernstein-Linsengondeln an den Spitzen; keine animierten Parts.",
});
