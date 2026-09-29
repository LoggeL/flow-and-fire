/**
 * Schwebfliege (f4:air_t2_gunship) – Aurith-Kampfschweber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Keine Flügel: Kiel mit zwei senkrechten Reifen seitlich, Gabel unten.“ Parts keel [team] (Oberschale),
 * ring (Antrieb links/rechts, dreht), fork (Gabel unten, yaw); 2 Tonpunkte.
 * Rollen-Monopol Gunship (faction.md §5.2): keine Flügel, zwei senkrechte Reifen seitlich + Gabel unten; verboten:
 * Flügel, Fächer. Winkel-Code (§5.1 Nr. 5): senkrechte Reifen gibt es nur hier (Luft-Antrieb); die Gabel mit
 * waagerechten Zinken = Direktfeuer und ragt vorn unter dem Kiel hervor, zeigt also auch von oben die Richtung.
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug): Kiel 1,0 WU lang, Reifen Ø 0,68 WU, Breite über die Reifen
 * 1,00 WU (→ 1,30 WU im Spiel), Länge mit Gabel und Kamm 1,26 WU (→ 1,64 WU).
 *   hull  – Bernstein-Kiel (Tropfen, Pechglas-Bauch), teamfarbene Oberschale, kurzer Hinterkamm (Teamfarbe),
 *           Glyphenbänder an den Flanken, 2 Tonpunkte
 *   rings – zwei senkrechte Reifen (Bernstein-Kante) an Pechglas-Achsstummeln, anim `spin` um die Querachse
 *           (PartStream 1)
 *   fork  – Gabel unter dem Bauch: Pechglas-Hals, Steg, zwei gerade waagerechte Sechskant-Zinken (Bernstein-Kante),
 *           anim `yaw` (PartStream 2)
 */
import {
  box,
  cylinder,
  defineModel,
  ellipsoid,
  extrude,
  glyphStrip,
  lens,
  mirrorX,
  torus,
  type Vec2,
  type Vec3,
} from "@faf/modelkit";

const BODY_Y = 0.46; // Mitte des Kiels (Nahtlinie Bernstein/Oberschale)
const KEEL: Vec3 = [0.22, 0.16, 0.5];
const RING_R = 0.3;
const RING_TUBE = 0.05;
const RING_X = 0.42;
const RING_Y = 0.42;
const FORK_Y = 0.13;

/** Hinterkamm, Seitenprofil [z, y]: steigt hinten aus der Oberschale und läuft nach hinten aus. */
const FIN: Vec2[] = [
  [-0.14, BODY_Y + 0.14],
  [-0.3, BODY_Y + 0.3],
  [-0.52, BODY_Y + 0.3],
  [-0.66, BODY_Y + 0.18],
  [-0.46, BODY_Y + 0.06],
];

export default defineModel({
  id: "f4:air_t2_gunship",
  parts: [
    {
      name: "hull",
      shapes: [
        // Kiel: Bernstein-Unterschale (weich), Pechglas-Bauch darunter
        ellipsoid({
          radii: [KEEL[0], 0.14, KEEL[2]],
          half: true,
          drop: 0.4,
          segments: 8,
          rings: 2,
          at: [0, BODY_Y - 0.07, 0],
          rot: [0, 0, 180],
          mat: "pitch",
          keep: true,
          smooth: true,
          tag: "keel",
        }),
        // Oberschale (Teamfarbe): breiter als der Kiel, größte Teamfläche von oben
        ellipsoid({
          radii: [KEEL[0] + 0.04, KEEL[1], KEEL[2] + 0.02],
          half: true,
          drop: 0.4,
          segments: 8,
          rings: 3,
          at: [0, BODY_Y + KEEL[1] / 2, -0.01],
          mat: "team",
          keep: true,
          smooth: true,
          tag: "keel",
        }),
        // Hinterkamm (Teamfarbe)
        extrude({
          profile: FIN,
          depth: 0.12,
          mat: "team",
          keep: true,
          tag: "fin",
        }),
        // Glyphenbänder an den Flanken der Bernsteinschale
        mirrorX(
          glyphStrip({
            path: [
              [KEEL[0] - 0.035, BODY_Y - 0.06, 0.26],
              [KEEL[0] + 0.0, BODY_Y - 0.05, 0.0],
              [KEEL[0] - 0.04, BODY_Y - 0.06, -0.26],
            ],
            normal: [1, -0.3, 0],
            width: 0.05,
            pattern: [0.12, -0.05, 0.05, -0.04, 0.16],
            lift: 0.014,
            mat: "glyph",
            maxLod: 0,
            tag: "glyphs",
          }),
        ),
        // 2 Tonpunkte (Perlglas) hinten auf der Oberschale, vor dem Kamm
        lens({
          radius: 0.05,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, BODY_Y + 0.135, -0.02],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
        lens({
          radius: 0.05,
          thickness: 0.03,
          segments: 6,
          rings: 2,
          at: [0, BODY_Y + 0.12, -0.15],
          mat: "pearl",
          maxLod: 0,
          tag: "techDot",
        }),
      ],
    },
    {
      name: "rings",
      pivot: [0, RING_Y, 0],
      anim: "spin",
      shapes: [
        mirrorX([
          // senkrechter Reif (Ebene y-z), Bernsteinglas
          torus({
            radius: RING_R,
            tube: RING_TUBE,
            segments: 8,
            sides: 4,
            axis: "x",
            at: [RING_X, RING_Y, 0],
            mat: "amber",
            keep: true,
            smooth: 100,
            tag: "ring",
          }),
          // Achsstummel (Pechglas) vom Kiel zur Reifmitte
          cylinder({
            radius: 0.05,
            height: RING_X - 0.12,
            segments: 6,
            axis: "x",
            caps: false,
            at: [(RING_X + 0.12) / 2, RING_Y, 0],
            mat: "pitch",
            keep: true,
            tag: "ring",
          }),
        ]),
      ],
    },
    {
      name: "fork",
      pivot: [0, FORK_Y, 0.06],
      anim: "yaw",
      shapes: [
        // Hals (Pechglas) vom Bauch zur Gabel
        cylinder({
          radius: 0.07,
          height: 0.24,
          segments: 6,
          caps: false,
          at: [0, FORK_Y + 0.12, 0.04],
          mat: "pitch",
          keep: true,
          maxLod: 1,
          tag: "fork",
        }),
        // Steg + zwei gerade waagerechte Zinken, ragen vorn weit unter dem Kiel hervor
        box({
          size: [0.3, 0.1, 0.14],
          at: [0, FORK_Y, 0.06],
          mat: "pitch",
          keep: true,
          maxLod: 1,
          tag: "fork",
        }),
        mirrorX(
          cylinder({
            radius: 0.055,
            height: 0.62,
            segments: 6,
            axis: "z",
            caps: "top",
            at: [0.1, FORK_Y, 0.4],
            mat: "amberedge",
            keep: true,
            tag: "fork",
          }),
        ),
      ],
    },
  ],
  notes:
    "v_gunship: Kiel + zwei senkrechte Reifen (spin) + Gabel unten (yaw); keine Flügel.",
});
