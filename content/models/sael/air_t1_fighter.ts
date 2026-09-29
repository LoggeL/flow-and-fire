/**
 * Sturmvogel (f3:air_t1_fighter) – Sael-Abfangjäger T1.
 *
 * Roster: „Schmale Pfeilsichel: lange Rumpfspindel, Schwingenspitzen nach hinten gebogen (lang > breit),
 * 2 Lichtnähte hinten.“ Parts shell (rumpfspindel), wing:team (pfeilsichel), wing (leitwerk); 1 Tech-Streifen.
 * faction.md §5.2: Monopol Abfangjäger = schmale Pfeilsichel; verboten: breite Schwinge, Gondeln. Luft: Teamfarbe
 * auf der Schwingenoberseite bis auf die Goldkante (≥ 45 % der Draufsicht).
 * Abgrenzung: Raubmöwe = dieselbe Sichel breiter + Gondeln an den Spitzen, Tölpel = Ovalschwinge + Bauch-Gondel,
 * Seeschwalbe = flache, lange Schwinge + Gabelheck. Der Sturmvogel ist der einzige Flieger, dessen Sichelspitzen
 * weit hinter das Rumpfende zurückgebogen sind (Bumerang) und dessen Spindel vorn deutlich über die Sichel ragt.
 *
 * Kit-Muster Sael-Luft: Spindel und Sichel sind je zwei offene `sweep`-Hälften (oben hell / Emaille, unten
 * Schalenrinde) mit gemeinsamer `smoothGroup` – eine glatte Schale, Teamfarbe bündig, dunkle Unterseite.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite), Länge 1,34 WU, Spannweite 0,94 WU:
 *   hull – Rumpfspindel (Perlmutt/Rinde), Pfeilsichel (Emaille/Rinde) mit Goldkante, V-Leitwerk (Perlmutt),
 *          2 Jade-Lichtnähte am Heck, 1 Tiefjade-Tech-Streifen. Keine animierten Parts (Roster).
 */
import { arcPoints, defineModel, ellipsoid, glyphStrip, mirrorX, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

type Sec = readonly [number, number];

/** Halbe Ovalprofile (aufsteigender Winkel): oben/unten einer Spindel bzw. Schwinge. */
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
const TAIL_Z = -0.66;
const NOSE_Z = 0.68;
const BODY_RX = 0.1;
const BODY_RY = 0.085;

/** Spindel-Querschnitt bei Parameter t (0 = Heck, 1 = Bug): dickste Stelle bei ≈ 55 %, spitze Enden. */
function bodySec(t: number): Sec {
  const s = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.25)), 0.75);
  return [BODY_RX * s, BODY_RY * s];
}
const BODY_N = 8;
const BODY_PATH: Vec3[] = Array.from({ length: BODY_N + 1 }, (_, i): Vec3 => [0, BODY_Y, TAIL_Z + ((NOSE_Z - TAIL_Z) * i) / BODY_N]);
const BODY_SEC: Sec[] = BODY_PATH.map((_, i) => bodySec(i / BODY_N));
/** Oberfläche des Sechskant-Querschnitts oben (Rücken flach zwischen u = ±0,5, Flanken schräg) bei z und u (−1…1). */
function bodyTop(z: number, u: number): { p: Vec3; n: Vec3 } {
  const [rx, ry] = bodySec((z - TAIL_Z) / (NOSE_Z - TAIL_Z));
  const au = Math.abs(u);
  const v = au <= 0.5 ? 0.866 : (0.866 * (1 - au)) / 0.5;
  const n: Vec3 = au <= 0.5 ? [0, 1, 0] : [Math.sign(u) * 0.866 * ry, 0.5 * rx, 0];
  return { p: [rx * u, BODY_Y + ry * v, z], n };
}

// Pfeilsichel: Kreisbogen um einen Mittelpunkt vor… hinter dem Rumpf, Wurzel vorn (θ = 90°), Spitzen weit zurück.
const WING_Y = 0.19;
const WING_R = 0.47;
const WING_A = 100; // halber Bogen in Grad → Spitzen bei x = ±0,46, z ≈ −0,45
const WING_ROOT_Z = 0.12;
const WING_C: Vec3 = [0, WING_Y, WING_ROOT_Z - WING_R];
const WING_N = 10;
const CHORD = 0.3; // Sehne an der Wurzel
const THICK = 0.07;
const TAPER = 0.18;
function wingF(i: number): number {
  const t = Math.abs((2 * i) / WING_N - 1);
  return 1 - (1 - TAPER) * Math.pow(t, 1.4);
}
const WING_PATH: Vec3[] = arcPoints(WING_R, 90 - WING_A, 90 + WING_A, WING_N, 'y', WING_C);
const WING_SEC: Sec[] = WING_PATH.map((_, i) => [(CHORD / 2) * wingF(i), (THICK / 2) * wingF(i)]);
/** Goldkante: schmales Band auf der Oberseite entlang der Vorderkante (außen am Bogen). */
const EDGE_PATH: Vec3[] = WING_PATH.map((_, i): Vec3 => {
  const th = ((90 - WING_A + (2 * WING_A * i) / WING_N) * Math.PI) / 180;
  const f = wingF(i);
  const r = WING_R + (CHORD / 2) * f * 0.78;
  return [WING_C[0] + r * Math.cos(th), WING_Y + (THICK / 2) * f * 0.35, WING_C[2] + r * Math.sin(th)];
});

// Tech-Streifen (Tiefjade) quer über den Spindelrücken im hinteren Drittel, 2 Lichtnähte dahinter.
const STRIPE_Z = -0.3;
const stripePts = [-0.92, -0.5, 0, 0.5, 0.92].map((u) => bodyTop(STRIPE_Z, u));
const seam = (x: number): { path: Vec3[]; normal: Vec3[] } => {
  const pts = [-0.4, -0.47, -0.54].map((z) => bodyTop(z, x));
  return { path: pts.map((q) => q.p), normal: pts.map((q) => q.n) };
};

export default defineModel({
  id: 'f3:air_t1_fighter',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Rumpfspindel: Flanken Perlmutt, Rücken-Einlage Emaille, unten Schalenrinde – eine glatte Schale
        ...[FLANK_L, CREST, FLANK_R].map((profile) =>
          sweep({ path: BODY_PATH, radius: BODY_SEC, profile, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: profile === CREST ? 'enamel' : 'nacre', keep: true, tag: 'shell' }),
        ),
        sweep({ path: BODY_PATH, radius: BODY_SEC, profile: BOTTOM, samples: BODY_N + 1, open: true, smoothGroup: 'body', mat: 'rind', keep: true, tag: 'shell' }),
        // Pfeilsichel: Oberseite Emaille (Teamfarbe), Unterseite Rinde
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WTOP, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'enamel', keep: true, tag: 'wing' }),
        sweep({ path: WING_PATH, radius: WING_SEC, profile: WBOT, samples: WING_N + 1, open: true, smoothGroup: 'wing', mat: 'rind', keep: true, tag: 'wing' }),
        // Goldkante an der Sichel-Vorderkante (nur Kante, ≤ 8 %)
        glyphStrip({ path: EDGE_PATH, width: 0.035, pattern: [0.08, -0.002], widths: [1], mat: 'gold', maxLod: 0, tag: 'wing' }),
        // V-Leitwerk: zwei kleine Perlmutt-Linsen am Heck, 28° nach außen gekippt
        mirrorX(ellipsoid({ radii: [0.12, 0.014, 0.09], segments: 6, rings: 2, at: [0.09, BODY_Y + 0.05, -0.54], rot: [0, -20, 28], mat: 'nacre', maxLod: 1, tag: 'wing' })),
        // 2 Jade-Lichtnähte hinten (Schichtfugen links/rechts auf dem Spindelrücken)
        glyphStrip({ ...seam(0.45), width: 0.035, pattern: [0.05, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        glyphStrip({ ...seam(-0.45), width: 0.035, pattern: [0.05, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // 1 Tech-Streifen Tiefjade, 0,10 WU breit
        glyphStrip({ path: stripePts.map((q) => q.p), normal: stripePts.map((q) => q.n), width: 0.1, pattern: [0.04, -0.001], widths: [1], lift: 0.008, mat: 'jade', maxLod: 1, tag: 'stripe' }),
      ],
    },
  ],
  notes: 'v_fighter: Pfeilsichel mit zurückgebogenen Spitzen, lange Spindel, V-Leitwerk, 2 Lichtnähte; keine animierten Parts.',
});
