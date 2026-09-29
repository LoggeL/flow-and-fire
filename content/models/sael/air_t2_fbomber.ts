/**
 * Raubmöwe (f3:air_t2_fbomber) – Sael-Jagdbomber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Pfeilsichel mit zwei Gondeln an den Schwingenspitzen, Spannweite +30 % gegenüber Sturmvogel; keine
 * Kuppel, keine Bauch-Gondel.“ Parts shell (rumpf), wing:team (pfeilsichel), shell (gondel_l), shell (gondel_r);
 * 2 Tech-Streifen.
 * faction.md §5.2: Monopol Jagdbomber = Pfeilsichel mit zwei Gondeln an den Schwingenspitzen; verboten: Kuppel,
 * Bauch-Gondel. Abgrenzung (Pflichtpaar Sturmvogel↔Raubmöwe): die Sichel ist breiter und weniger stark
 * zurückgebogen, ihre Spitzen tragen je eine Perlmutt-Gondel mit goldener Spitze (Luftkanonen, Brandbomben);
 * Spannweite 1,55 WU gegenüber 1,05 WU beim Sturmvogel (+48 %).
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug, +X = linke Seite), Länge 1,12 WU, Spannweite 1,19 WU:
 *   hull – Rumpf (Perlmutt-Flanken, Emaille-Rücken, Rinde unten), Pfeilsichel (Emaille/Rinde) mit Goldkante,
 *          2 Spitzen-Gondeln (Perlmutt/Rinde) mit Goldspitze, 2 Jade-Lichtnähte, 2 Tiefjade-Tech-Streifen.
 *          Keine animierten Parts (Roster).
 */
import { arcPoints, cone, defineModel, glyphStrip, mirrorX, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

type Sec = readonly [number, number];

const FLANK_L: Vec2[] = [
  [1, 0],
  [0.5, 0.866],
];
const CREST: Vec2[] = [
  [0.5, 0.866],
  [-0.5, 0.866],
];
const FLANK_R: Vec2[] = [
  [-0.5, 0.866],
  [-1, 0],
];
const TOP: Vec2[] = [
  [1, 0],
  [0.5, 0.866],
  [-0.5, 0.866],
  [-1, 0],
];
const BOTTOM: Vec2[] = [
  [-1, 0],
  [-0.5, -0.866],
  [0.5, -0.866],
  [1, 0],
];
const WTOP: Vec2[] = [
  [1, 0],
  [0.5, 0.8],
  [-0.5, 0.8],
  [-1, 0],
];
const WBOT: Vec2[] = [
  [-1, 0],
  [-0.5, -0.8],
  [0.5, -0.8],
  [1, 0],
];

const BODY_Y = 0.2;
const TAIL_Z = -0.54;
const NOSE_Z = 0.58;
const BODY_RX = 0.115;
const BODY_RY = 0.095;
const BODY_N = 8;
function bodySec(t: number): Sec {
  const s = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 0.7);
  return [BODY_RX * s, BODY_RY * s];
}
const BODY_PATH: Vec3[] = Array.from({ length: BODY_N + 1 }, (_, i): Vec3 => [0, BODY_Y, TAIL_Z + ((NOSE_Z - TAIL_Z) * i) / BODY_N]);
const BODY_SEC: Sec[] = BODY_PATH.map((_, i) => bodySec(i / BODY_N));
function bodyTop(z: number, u: number): { p: Vec3; n: Vec3 } {
  const [rx, ry] = bodySec((z - TAIL_Z) / (NOSE_Z - TAIL_Z));
  const au = Math.abs(u);
  const v = au <= 0.5 ? 0.866 : (0.866 * (1 - au)) / 0.5;
  const n: Vec3 = au <= 0.5 ? [0, 1, 0] : [Math.sign(u) * 0.866 * ry, 0.5 * rx, 0];
  return { p: [rx * u, BODY_Y + ry * v, z], n };
}

// Pfeilsichel: breiter und flacher gebogen als beim Sturmvogel, Spitzen bei x = ±0,51, z ≈ −0,29.
const WING_Y = 0.19;
const WING_R = 0.52;
const WING_A = 80;
const WING_ROOT_Z = 0.14;
const WING_C: Vec3 = [0, WING_Y, WING_ROOT_Z - WING_R];
const WING_N = 8;
const CHORD = 0.38;
const THICK = 0.075;
const TAPER = 0.4;
function wingF(i: number): number {
  const t = Math.abs((2 * i) / WING_N - 1);
  return 1 - (1 - TAPER) * Math.pow(t, 1.4);
}
const WING_PATH: Vec3[] = arcPoints(WING_R, 90 - WING_A, 90 + WING_A, WING_N, 'y', WING_C);
const WING_SEC: Sec[] = WING_PATH.map((_, i) => [(CHORD / 2) * wingF(i), (THICK / 2) * wingF(i)]);
const EDGE_PATH: Vec3[] = WING_PATH.slice(1, -1).map((_, k): Vec3 => {
  const i = k + 1;
  const th = ((90 - WING_A + (2 * WING_A * i) / WING_N) * Math.PI) / 180;
  const f = wingF(i);
  const r = WING_R + (CHORD / 2) * f * 0.78;
  return [WING_C[0] + r * Math.cos(th), WING_Y + (THICK / 2) * f * 0.35, WING_C[2] + r * Math.sin(th)];
});
const TIP = WING_PATH[0]!; // linke Spitze (+X)

// Spitzen-Gondel: stumpfe Spindel längs, auf der Schwingenspitze; Goldspitze vorn (Waffe = spitz).
const GOND_RX = 0.1;
const GOND_RY = 0.09;
const GOND_TAIL = TIP[2] - 0.3;
const GOND_NOSE = TIP[2] + 0.3;
const GOND_N = 5;
function gondSec(t: number): Sec {
  const s = Math.pow(Math.sin(Math.PI * t), 0.55);
  return [GOND_RX * s, GOND_RY * s];
}
const GOND_PATH: Vec3[] = Array.from({ length: GOND_N + 1 }, (_, i): Vec3 => [TIP[0], WING_Y, GOND_TAIL + ((GOND_NOSE - GOND_TAIL) * i) / GOND_N]);
const GOND_SEC: Sec[] = GOND_PATH.map((_, i) => gondSec(i / GOND_N));

const stripe = (z: number): { path: Vec3[]; normal: Vec3[] } => {
  const pts = [-0.92, -0.5, 0, 0.5, 0.92].map((u) => bodyTop(z, u));
  return { path: pts.map((q) => q.p), normal: pts.map((q) => q.n) };
};
const seam = (u: number): { path: Vec3[]; normal: Vec3[] } => {
  const pts = [-0.36, -0.42, -0.47].map((z) => bodyTop(z, u));
  return { path: pts.map((q) => q.p), normal: pts.map((q) => q.n) };
};

export default defineModel({
  id: 'f3:air_t2_fbomber',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Rumpf: Perlmutt-Flanken, Emaille-Rücken, Rinde unten
        ...[FLANK_L, CREST, FLANK_R].map((profile) =>
          sweep({ path: BODY_PATH, radius: BODY_SEC, profile, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: profile === CREST ? 'enamel' : 'nacre', keep: true, tag: 'shell' }),
        ),
        sweep({ path: BODY_PATH, radius: BODY_SEC, profile: BOTTOM, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: 'rind', keep: true, tag: 'shell' }),
        // Pfeilsichel: Oberseite Emaille, Unterseite Rinde, Goldkante vorn
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WTOP, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'enamel', keep: true, tag: 'wing' }),
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WBOT, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'rind', keep: true, tag: 'wing' }),
        glyphStrip({ path: EDGE_PATH, width: 0.035, pattern: [0.13, -0.002], widths: [1], mat: 'gold', maxLod: 0, tag: 'wing' }),
        // 2 Gondeln an den Schwingenspitzen (Monopol-Merkmal), oben Perlmutt, unten Rinde, Goldspitze vorn
        mirrorX([
          sweep({ path: GOND_PATH, radius: GOND_SEC, profile: TOP, samples: GOND_N + 1, open: true, smoothGroup: 'gondola', mat: 'nacre', keep: true, tag: 'shell' }),
          sweep({ path: GOND_PATH, radius: GOND_SEC, profile: BOTTOM, samples: GOND_N + 1, open: true, smoothGroup: 'gondola', mat: 'rind', keep: true, tag: 'shell' }),
          cone({ radius: 0.04, height: 0.14, segments: 4, axis: 'z', at: [TIP[0], WING_Y, GOND_NOSE + 0.04], mat: 'gold', maxLod: 1, tag: 'shell' }),
        ]),
        // 2 Jade-Lichtnähte am Heck, 2 Tech-Streifen Tiefjade im hinteren Drittel
        glyphStrip({ ...seam(0.45), width: 0.035, pattern: [0.05, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        glyphStrip({ ...seam(-0.45), width: 0.035, pattern: [0.05, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        glyphStrip({ ...stripe(-0.06), width: 0.1, pattern: [0.05, -0.001], widths: [1], lift: 0.008, mat: 'jade', maxLod: 1, tag: 'stripe' }),
        glyphStrip({ ...stripe(-0.26), width: 0.1, pattern: [0.05, -0.001], widths: [1], lift: 0.008, mat: 'jade', maxLod: 1, tag: 'stripe' }),
      ],
    },
  ],
  notes: 'v_fbomber: Pfeilsichel mit Spitzen-Gondeln (Goldspitzen), Spannweite +48 % zum Sturmvogel; keine animierten Parts.',
});
