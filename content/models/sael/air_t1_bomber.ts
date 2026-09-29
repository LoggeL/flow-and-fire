/**
 * Tölpel (f3:air_t1_bomber) – Sael-Bomber T1.
 *
 * Roster: „Breite Ovalschwinge (breit ≥ lang, Pfeilung ≤ 30°) mit Bauch-Gondel ≥ 1,4 × Schwingentiefe, ragt vorn
 * und hinten sichtbar über.“ Parts wing:team (ovalschwinge), shell (bauchgondel), wing (leitwerk); 1 Tech-Streifen.
 * faction.md §5.2: Monopol Bomber = breite Ovalschwinge + Bauch-Gondel; verboten: Pfeilung > 30°.
 * Abgrenzung (Pflichtpaare Tölpel↔Sturmvogel, Seeschwalbe↔Tölpel): elliptischer Grundriss ohne Sichel, die dicke,
 * stumpfe Gondel steht vorn und hinten deutlich über; Sturmvogel und Seeschwalbe sind schlank und spitz.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite), Spannweite 1,48 WU, Länge 1,04 WU, Schwingentiefe 0,58 WU,
 * Gondel 1,04 WU (1,8 × Schwingentiefe), Pfeilung der Vorderkante ≈ 12°:
 *   hull – Ovalschwinge (Emaille oben, Rinde unten) mit Goldkante vorn, Bauch-Gondel (Perlmutt/Rinde) mit goldenem
 *          Bombenschacht-Saum, stehendes Leitwerk (Perlmutt), Jade-Lichtnaht am Gondelheck, 1 Tiefjade-Tech-Streifen.
 *          Keine animierten Parts (Roster).
 */
import { defineModel, ellipsoid, glyphStrip, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

type Sec = readonly [number, number];

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

// Ovalschwinge: Pfad quer (x), elliptische Sehne, Spitzen leicht zurück (Pfeilung ≤ 30°).
const WING_Y = 0.25;
const HALF_SPAN = 0.74;
const CHORD = 0.56;
const THICK = 0.1;
const SWEEP_BACK = 0.1; // Spitzen liegen 0,10 WU weiter hinten als die Wurzel
const DIHEDRAL = 0.07; // Spitzen 0,07 WU höher (Gleitflug)
const WING_Z = 0.03;
/** Ovalschwinge mit n Abschnitten: Sinus-Teilung (dichter an den Spitzen), damit die Ovalenden rund bleiben. */
function wingAt(q: number): { p: Vec3; s: Sec } {
  const f = Math.sqrt(Math.max(0, 1 - q * q));
  return { p: [HALF_SPAN * q, WING_Y + DIHEDRAL * q * q, WING_Z - SWEEP_BACK * q * q], s: [(CHORD / 2) * f, (THICK / 2) * Math.sqrt(f)] };
}
function wing(n: number): { path: Vec3[]; radius: Sec[] } {
  const w = Array.from({ length: n + 1 }, (_, i) => wingAt(Math.sin((Math.PI / 2) * (1 - (2 * i) / n))));
  return { path: w.map((x) => x.p), radius: w.map((x) => x.s) };
}
/** LOD-Stufen der Schwinge (ohne `samples`, weil die Sinus-Teilung erhalten bleiben muss). */
const WING_LODS = [
  { n: 12, lod: { maxLod: 0 as const } },
  { n: 8, lod: { minLod: 1 as const, maxLod: 1 as const } },
  { n: 6, lod: { minLod: 2 as const } },
];
const WING = Array.from({ length: 13 }, (_, i) => wingAt(Math.sin((Math.PI / 2) * (1 - i / 6))));
/** Goldkante vorn: Band auf der Oberseite nahe der Vorderkante. */
const EDGE_PATH: Vec3[] = WING.slice(1, -1).map((w): Vec3 => [w.p[0], w.p[1] + w.s[1] * 0.2, w.p[2] + w.s[0] * 0.86]);

// Bauch-Gondel: stumpfe Spindel unter der Schwinge.
const POD_Y = 0.19;
const POD_TAIL = -0.6;
const POD_NOSE = 0.64;
const POD_RX = 0.19;
const POD_RY = 0.17;
const POD_N = 8;
function podSec(t: number): Sec {
  const s = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.1)), 0.5);
  return [POD_RX * s, POD_RY * s];
}
const POD_PATH: Vec3[] = Array.from({ length: POD_N + 1 }, (_, i): Vec3 => [0, POD_Y, POD_TAIL + ((POD_NOSE - POD_TAIL) * i) / POD_N]);
const POD_SEC: Sec[] = POD_PATH.map((_, i) => podSec(i / POD_N));
function podTop(z: number, u: number): { p: Vec3; n: Vec3 } {
  const [rx, ry] = podSec((z - POD_TAIL) / (POD_NOSE - POD_TAIL));
  const au = Math.abs(u);
  const v = au <= 0.5 ? 0.866 : (0.866 * (1 - au)) / 0.5;
  const n: Vec3 = au <= 0.5 ? [0, 1, 0] : [Math.sign(u) * 0.866 * ry, 0.5 * rx, 0];
  return { p: [rx * u, POD_Y + ry * v, z], n };
}
function podBottom(z: number, u: number): { p: Vec3; n: Vec3 } {
  const q = podTop(z, u);
  return { p: [q.p[0], 2 * POD_Y - q.p[1], z], n: [q.n[0], -q.n[1], 0] };
}

const STRIPE_Z = -0.4;
const stripePts = [-0.92, -0.5, 0, 0.5, 0.92].map((u) => podTop(STRIPE_Z, u));
const seamPts = [-0.5, -0.54].map((z) => podTop(z, 0));
/** Bombenschacht-Saum (Gold) längs unter der Gondel. */
const bayPts = [-0.2, 0, 0.2].map((z) => podBottom(z, 0));

export default defineModel({
  id: 'f3:air_t1_bomber',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Ovalschwinge: Oberseite Emaille (Teamfarbe), Unterseite Rinde
        ...WING_LODS.flatMap(({ n, lod }) => [
          sweep({ ...wing(n), ...lod, profile: WTOP, open: true, smoothGroup: 'wing', mat: 'enamel', keep: true, tag: 'wing' }),
          sweep({ ...wing(n), ...lod, profile: WBOT, open: true, smoothGroup: 'wing', mat: 'rind', keep: true, tag: 'wing' }),
        ]),
        glyphStrip({ path: EDGE_PATH, width: 0.035, pattern: [0.08, -0.002], widths: [1], mat: 'gold', maxLod: 0, tag: 'wing' }),
        // Bauch-Gondel: stumpfe Spindel, oben Perlmutt, unten Rinde (Monopol-Merkmal, ragt vorn/hinten über)
        sweep({ path: POD_PATH, radius: POD_SEC, profile: TOP, samples: POD_N + 1, open: true, smoothGroup: 'pod', mat: 'nacre', keep: true, tag: 'shell' }),
        sweep({ path: POD_PATH, radius: POD_SEC, profile: BOTTOM, samples: POD_N + 1, open: true, smoothGroup: 'pod', mat: 'rind', keep: true, tag: 'shell' }),
        // Stehendes Leitwerk: schmale Perlmutt-Linse auf dem Gondelheck, nach hinten geneigt
        ellipsoid({ radii: [0.022, 0.11, 0.13], segments: 6, rings: 2, half: true, at: [0, POD_Y + POD_RY * 0.7 + 0.05, -0.48], rot: [-18, 0, 0], mat: 'nacre', maxLod: 1, tag: 'wing' }),
        // Jade-Lichtnaht am Gondelheck, goldener Bombenschacht-Saum unten
        glyphStrip({ path: seamPts.map((q) => q.p), normal: seamPts.map((q) => q.n), width: 0.05, pattern: [0.04, -0.001], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
        glyphStrip({ path: bayPts.map((q) => q.p), normal: bayPts.map((q) => q.n), width: 0.06, pattern: [0.1, -0.001], widths: [1], mat: 'gold', maxLod: 0, tag: 'shell' }),
        // 1 Tech-Streifen Tiefjade auf dem Gondelheck hinter der Schwinge
        glyphStrip({ path: stripePts.map((q) => q.p), normal: stripePts.map((q) => q.n), width: 0.1, pattern: [0.05, -0.001], widths: [1], lift: 0.008, mat: 'jade', maxLod: 1, tag: 'stripe' }),
      ],
    },
  ],
  notes: 'v_bomber: breite Ovalschwinge (Pfeilung ≈ 12°) + stumpfe Bauch-Gondel (1,8 × Schwingentiefe); keine animierten Parts.',
});
