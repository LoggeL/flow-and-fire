/**
 * Seeschwalbe (f3:air_t1_scout) – Sael-Luftaufklärer T1.
 *
 * Roster: „Kleinster Flieger, schmale Schwinge, gegabeltes Heck.“ Parts shell (rumpf), wing:team (schwinge),
 * wing (gabelheck); 1 Tech-Streifen; unbewaffnet.
 * faction.md §5.2: Monopol Luft-Späher = kleinster Flieger mit gegabeltem Heck; verboten: Waffen-Parts.
 * Abgrenzung (Pflichtpaar Seeschwalbe↔Tölpel): lange, schmale, kaum gepfeilte Schwinge und zwei weit gespreizte
 * Schwanzspieße statt Ovalschwinge mit Bauch-Gondel; gegenüber dem Sturmvogel kurz (breiter als lang), die
 * Schwingenspitzen bleiben vor dem Heck.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite), Spannweite 0,98 WU, Länge 0,86 WU:
 *   hull – kurze Rumpfspindel (Perlmutt-Flanken, Emaille-Rücken, Rinde unten), schmale Schwinge (Emaille/Rinde) mit
 *          Goldkante, Laternenglas-Auge am Bug, Gabelheck aus zwei Perlmutt-Spießen, Jade-Lichtnaht an der Gabel,
 *          1 Tiefjade-Tech-Streifen. Keine animierten Parts (Roster).
 */
import { arcPoints, defineModel, ellipsoid, glyphStrip, mirrorX, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

type Sec = readonly [number, number];

/** Sechskant-Querschnitt in offenen Hälften (aufsteigender Winkel): Flanken, Rücken, Unterseite. */
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
const BOTTOM: Vec2[] = [
  [-1, 0],
  [-0.5, -0.866],
  [0.5, -0.866],
  [1, 0],
];
/** Schwingenprofil (flache Linse), oben/unten. */
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
/** Rautenprofil der Schwanzspieße. */
const DIAMOND: Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const BODY_Y = 0.2;
const TAIL_Z = -0.3;
const NOSE_Z = 0.34;
const BODY_RX = 0.085;
const BODY_RY = 0.075;
const BODY_N = 6;
function bodySec(t: number): Sec {
  const s = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.15)), 0.7);
  return [BODY_RX * s, BODY_RY * s];
}
const BODY_PATH: Vec3[] = Array.from({ length: BODY_N + 1 }, (_, i): Vec3 => [0, BODY_Y, TAIL_Z + ((NOSE_Z - TAIL_Z) * i) / BODY_N]);
const BODY_SEC: Sec[] = BODY_PATH.map((_, i) => bodySec(i / BODY_N));
/** Oberfläche des Sechskant-Querschnitts oben bei z und u (−1…1). */
function bodyTop(z: number, u: number): { p: Vec3; n: Vec3 } {
  const [rx, ry] = bodySec((z - TAIL_Z) / (NOSE_Z - TAIL_Z));
  const au = Math.abs(u);
  const v = au <= 0.5 ? 0.866 : (0.866 * (1 - au)) / 0.5;
  const n: Vec3 = au <= 0.5 ? [0, 1, 0] : [Math.sign(u) * 0.866 * ry, 0.5 * rx, 0];
  return { p: [rx * u, BODY_Y + ry * v, z], n };
}

// Schwinge: flacher Bogen (großer Radius), Spitzen nur leicht zurück – lang und schmal wie eine Seeschwalbe.
const WING_Y = 0.2;
const WING_R = 0.72;
const WING_A = 42; // halber Bogen → Spitzen bei x = ±0,48, z ≈ −0,12
const WING_ROOT_Z = 0.07;
const WING_C: Vec3 = [0, WING_Y, WING_ROOT_Z - WING_R];
const WING_N = 10;
const CHORD = 0.24;
const THICK = 0.055;
const TAPER = 0.3;
function wingF(i: number): number {
  const t = Math.abs((2 * i) / WING_N - 1);
  return 1 - (1 - TAPER) * Math.pow(t, 1.6);
}
const WING_PATH: Vec3[] = arcPoints(WING_R, 90 - WING_A, 90 + WING_A, WING_N, 'y', WING_C);
const WING_SEC: Sec[] = WING_PATH.map((_, i) => [(CHORD / 2) * wingF(i), (THICK / 2) * wingF(i)]);
/** Goldkante: schmales Band auf der Oberseite entlang der Vorderkante. */
const EDGE_PATH: Vec3[] = WING_PATH.map((_, i): Vec3 => {
  const th = ((90 - WING_A + (2 * WING_A * i) / WING_N) * Math.PI) / 180;
  const f = wingF(i);
  const r = WING_R + (CHORD / 2) * f * 0.78;
  return [WING_C[0] + r * Math.cos(th), WING_Y + (THICK / 2) * f * 0.35, WING_C[2] + r * Math.sin(th)];
});

// Gabelheck: zwei flache Spieße, die aus dem Rumpfende nach außen-hinten auseinanderlaufen.
const FORK_PATH: Vec3[] = [
  [0.035, BODY_Y, -0.2],
  [0.1, BODY_Y + 0.006, -0.38],
  [0.24, BODY_Y + 0.02, -0.58],
];
const FORK_SEC: Sec[] = [
  [0.06, 0.022],
  [0.042, 0.016],
  [0, 0],
];

const STRIPE_Z = -0.13;
const stripePts = [-0.92, -0.5, 0, 0.5, 0.92].map((u) => bodyTop(STRIPE_Z, u));
const seamPts = [-0.19, -0.24, -0.28].map((z) => bodyTop(z, 0));

export default defineModel({
  id: 'f3:air_t1_scout',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Rumpf: Perlmutt-Flanken, Emaille-Rücken, Rinde unten (eine glatte Schale)
        ...[FLANK_L, CREST, FLANK_R].map((profile) =>
          sweep({ path: BODY_PATH, radius: BODY_SEC, profile, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: profile === CREST ? 'enamel' : 'nacre', keep: true, tag: 'shell' }),
        ),
        sweep({ path: BODY_PATH, radius: BODY_SEC, profile: BOTTOM, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: 'rind', keep: true, tag: 'shell' }),
        // Schmale Schwinge: Oberseite Emaille (Teamfarbe), Unterseite Rinde
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WTOP, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'enamel', keep: true, tag: 'wing' }),
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WBOT, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'rind', keep: true, tag: 'wing' }),
        glyphStrip({ path: EDGE_PATH, width: 0.03, pattern: [0.08, -0.002], widths: [1], mat: 'gold', maxLod: 0, tag: 'wing' }),
        // Gabelheck (Monopol-Merkmal): zwei Perlmutt-Spieße, spitz auslaufend
        mirrorX(sweep({ path: FORK_PATH, radius: FORK_SEC, profile: DIAMOND, samples: 4, mat: 'nacre', keep: true, tag: 'wing' })),
        // Späher-Auge: kleine Laternenglas-Linse vorn auf dem Rücken (keine Waffe)
        ellipsoid({ radii: [0.045, 0.03, 0.07], segments: 6, rings: 2, half: true, at: [0, BODY_Y + BODY_RY * 0.866 + 0.008, 0.14], mat: 'glass', maxLod: 1, tag: 'shell' }),
        // Jade-Lichtnaht an der Gabelwurzel
        glyphStrip({ path: seamPts.map((q) => q.p), normal: seamPts.map((q) => q.n), width: 0.035, pattern: [0.04, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // 1 Tech-Streifen Tiefjade
        glyphStrip({ path: stripePts.map((q) => q.p), normal: stripePts.map((q) => q.n), width: 0.1, pattern: [0.04, -0.001], widths: [1], lift: 0.008, mat: 'jade', maxLod: 1, tag: 'stripe' }),
      ],
    },
  ],
  notes: 'v_air_scout: kleinster Flieger, schmale Schwinge, Gabelheck aus zwei Spießen; unbewaffnet, keine animierten Parts.',
});
