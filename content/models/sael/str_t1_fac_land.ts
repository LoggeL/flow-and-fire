/**
 * Landkapitel I (f3:str_t1_fac_land) – Sael-Landfabrik T1 auf 8×8; Grundform aller Kapitel (`chapterParts`, auch
 * für die Luftkapitel).
 *
 * Roster: „Halbschale (Kuppelhalle), zur Ausgangsseite offen, goldener Torbogen mit Goldkern, Rampe.“ Landkapitel
 * II/III: goldene Turmnadel(n), III zusätzlich Seitenschalen; Luftkapitel: Landescheibe (Ring) statt Rampe.
 * faction.md §5.2 Kapitel: Halbschale (Kuppelhalle), zur Ausgangsseite offen, goldener Tor-Bogen (Goldkern); Land mit
 * Rampe, Luft mit Landescheibe. §3.2: Kissen-Sockel füllt den Footprint, keine Fasen, keine rechten Winkel.
 * §4.2: Teamfarbe am Sockelrand und auf der Dachschale (20–30 % der Draufsicht). In-Place-Upgrade (Weihe): II/III
 * wachsen nur in der Höhe (Roster-Maßstab y 1,2 / 1,4) und bekommen Nadeln, Seitenschalen und Streifen.
 *
 * Aufbau (y = Boden, +Z = Ausgang, +X = linke Seite):
 *   hull – Kissen 8×8 (Emaille-Rand, Perlmutt-Einlage), Hallenboden (Schalenrinde) unter der Kuppel, Kuppelhalle als
 *          hohle Viertelkugel-Schale (Emaille = Dachschale, Perlglanz-Krone, zur Ausgangsseite offen, die Schnittkante zeigt
 *          die Wandstärke), Land: Rampe (dunkle Zunge, Fortsetzung des Hallenbodens) vom Tor zur Vorderkante; Luft: Landescheibe (Tiefjade)
 *          mit goldenem Ring; Tech-Streifen (Tiefjade) vorn links; II/III: goldene Turmnadel auf dem Scheitel;
 *          III: zwei Schulternadeln, Seitenschalen links/rechts
 *   gate – goldener Torbogen (Goldkern) an der Öffnung, kippt beim Ausstoß (Pitch, Roster-Anim „tilt“) (PartStream 1)
 */
import { defineModel, ellipsoid, loftShape, strut, stripes, sweep, torus, torusArc, type PartDef, type Ring, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { circlePts, cushion, flatPoly } from './str_t1_mex.ts';

const CUSHION_H = 0.3;
const TOP = CUSHION_H + 0.006;
const HALL_R = 3.35; // Kuppelradius (x, z)
const HALL_H = 2.5; // Kuppelhöhe über der Einlage
const HALL_T = 0.26; // Wandstärke
const HALL_Z = -0.45; // Öffnungsebene (Kuppel reicht nach hinten bis HALL_Z − HALL_R)

/**
 * Viertelkugel-Schale: waagerechte Sichel-Querschnitte (außen Halbkreis hinten, innen zurück), Öffnung nach +Z.
 * Oberhalb der Innenkuppel schrumpft der Innenbogen auf einen Punkt: die Stirnfläche wird dort massiv (Portal).
 */
function hallRings(arcPts: number, phisDeg: readonly number[]): Ring[] {
  const ri = HALL_R - HALL_T;
  const hi = HALL_H - HALL_T;
  return phisDeg.map((deg) => {
    const phi = (deg * Math.PI) / 180;
    const y = HALL_H * Math.sin(phi);
    const ro = HALL_R * Math.cos(phi);
    const q = y / hi;
    const rIn = Math.max(0.03, Math.min(ro * 0.8, q < 1 ? ri * Math.sqrt(1 - q * q) : 0));
    const pts: Vec2[] = [];
    for (let j = 0; j < arcPts; j++) {
      const th = Math.PI + (Math.PI * j) / (arcPts - 1); // 180° … 360°: hintere Hälfte (z ≤ 0)
      pts.push([ro * Math.cos(th), HALL_Z + ro * Math.sin(th)]);
    }
    for (let j = arcPts - 1; j >= 0; j--) {
      const th = Math.PI + (Math.PI * j) / (arcPts - 1);
      pts.push([rIn * Math.cos(th), HALL_Z + rIn * Math.sin(th)]);
    }
    return { y: TOP + y, pts };
  });
}

/**
 * Kuppelhalle je LOD: bis zur Breite 62° Emaille (Dachschale, Teamfarbe), darüber eine Perlglanz-Krone (§4.1: die
 * obersten Schalenpartien blenden ins Helle).
 */
function hall(): Shape[] {
  const variants: readonly [number, readonly number[], 0 | 1 | 2, 0 | 1 | 2][] = [
    [7, [0, 34, 62, 84], 0, 0],
    [5, [0, 40, 62, 84], 1, 1],
    [4, [0, 62, 84], 2, 2],
  ];
  const out: Shape[] = [];
  for (const [pts, phis, minLod, maxLod] of variants) {
    const k = phis.indexOf(62);
    const common = { smooth: 50, smoothGroup: `hall${minLod}`, keep: true, minLod, maxLod, tag: 'shell' } as const;
    out.push(loftShape({ ...common, rings: hallRings(pts, phis.slice(0, k + 1)), caps: { bottom: false, top: false }, mat: 'enamel' }));
    out.push(loftShape({ ...common, rings: hallRings(pts, phis.slice(k)), caps: { bottom: false }, mat: 'lustre' }));
  }
  return out;
}

/** Hallenboden: dunkle Halbscheibe unter der Kuppel (lässt die Öffnung als Öffnung lesen). */
function hallFloor(): Shape {
  const r = HALL_R - HALL_T - 0.05;
  const pts: Vec2[] = [];
  for (let j = 0; j <= 6; j++) {
    const th = Math.PI + (Math.PI * j) / 6;
    pts.push([r * Math.cos(th), HALL_Z + r * Math.sin(th)]);
  }
  return flatPoly(pts, TOP + 0.004, 'rind', 1);
}

/**
 * Land: Rampe als flache, dunkle Zunge (Schalenrinde, setzt den Hallenboden fort) vom Tor bis zur Vorderkante
 * (halbovaler Querschnitt, flacher werdend).
 */
function ramp(): Shape[] {
  const prof: Vec2[] = [];
  for (let j = 0; j <= 5; j++) {
    const a = (Math.PI * j) / 5;
    prof.push([Math.cos(a), Math.sin(a)]);
  }
  const y = TOP - 0.02;
  return [
    sweep({
      path: [
        [0, y, HALL_Z + 0.1],
        [0, y, 1.6],
        [0, y, 3.72],
      ],
      radius: [
        [1.55, 0.26],
        [1.45, 0.16],
        [1.3, 0.03],
      ],
      profile: prof,
      mat: 'rind',
      keep: true,
      maxLod: 1,
      tag: 'shell',
    }),
    sweep({
      path: [
        [0, y, HALL_Z + 0.1],
        [0, y, 3.72],
      ],
      radius: [
        [1.55, 0.26],
        [1.3, 0.03],
      ],
      profile: [
        [1, 0],
        [0.5, 0.87],
        [-0.5, 0.87],
        [-1, 0],
      ],
      caps: false,
      mat: 'rind',
      keep: true,
      minLod: 2,
      tag: 'shell',
    }),
  ];
}

/** Luft: Landescheibe (Tiefjade) mit goldenem Ring vor dem Tor. */
function landingDisc(): Shape[] {
  const c: Vec3 = [0, TOP, 2.05];
  return [
    flatPoly(circlePts(1.55, 12).map(([x, z]) => [x, z + c[2]] as Vec2), TOP + 0.005, 'jade', 2),
    torus({ radius: 1.6, tube: 0.16, segments: 12, sides: 3, scale: [1, 0.6, 1], at: [0, TOP + 0.06, c[2]], mat: 'gold', keep: true, maxLod: 1, tag: 'ring' }),
  ];
}

/** Punkt auf der Kuppelaußenseite (Breite `phi`, Winkel `th` von +X nach +Z, beide Grad). */
function hallPoint(phiDeg: number, thDeg: number, out = 0): Vec3 {
  const phi = (phiDeg * Math.PI) / 180;
  const th = (thDeg * Math.PI) / 180;
  const ro = (HALL_R + out) * Math.cos(phi);
  return [ro * Math.cos(th), TOP + (HALL_H + out) * Math.sin(phi), HALL_Z + ro * Math.sin(th)];
}

export function chapterParts(tech: 1 | 2 | 3, kind: 'land' | 'air'): PartDef[] {
  const hull: Shape[] = [
    ...cushion({ size: 7.9, height: CUSHION_H, inset: 0.1, simpleFrom: 1 }),
    hallFloor(),
    ...hall(),
    ...(kind === 'land' ? ramp() : landingDisc()),
    // Tech-Streifen (Tiefjade) vorn links auf der Einlage, neben Rampe/Landescheibe
    stripes({ count: tech, width: 1.0, at: [2.75, TOP + 0.004, 3.2], mat: 'jade', maxLod: 1 }),
  ];
  if (tech >= 2) {
    // goldene Turmnadel auf dem Kuppelscheitel
    const base = hallPoint(80, 270, -0.05);
    hull.push(strut({ from: base, to: [base[0], base[1] + 1.25, base[2]], radius: 0.18, radiusEnd: 0.04, sides: 4, mat: 'gold', keep: true, tag: 'mast' }));
  }
  if (tech === 3) {
    // zwei Schulternadeln (hinten links/rechts), leicht nach außen geneigt
    for (const th of [235, 305]) {
      const base = hallPoint(52, th, -0.05);
      const outX = Math.cos((th * Math.PI) / 180) * 0.5;
      const outZ = Math.sin((th * Math.PI) / 180) * 0.5;
      hull.push(strut({ from: base, to: [base[0] + outX, base[1] + 0.95, base[2] + outZ], radius: 0.15, radiusEnd: 0.03, sides: 4, mat: 'gold', keep: true, maxLod: 1, tag: 'mast' }));
    }
    // Seitenschalen links/rechts an der Halle
    for (const x of [3.2, -3.2]) {
      hull.push(ellipsoid({ radii: [0.55, 1.05, 1.7], half: true, segments: 6, rings: 2, at: [x, TOP + 0.52, -1.9], mat: 'nacre', maxLod: 1, tag: 'shell' }));
    }
  }
  const gateR = HALL_R - HALL_T / 2;
  return [
    { name: 'hull', smooth: true, shapes: hull },
    {
      name: 'gate',
      pivot: [0, TOP, HALL_Z + 0.08],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Torbogen: halbe Ellipse vor der Schnittkante der Kuppel, Goldkern
        torusArc({
          radius: gateR,
          tube: 0.2,
          arc: 180,
          startDeg: 180,
          segments: 8,
          sides: 3,
          axis: 'z',
          scale: [1, (HALL_H - HALL_T / 2) / gateR, 1],
          at: [0, TOP, HALL_Z + 0.1],
          mat: 'light',
          keep: true,
          tag: 'arch',
        }),
      ],
    },
  ];
}

export default defineModel({
  id: 'f3:str_t1_fac_land',
  parts: chapterParts(1, 'land'),
  notes: 'Grundform v_fac_land/v_fac_air; Torbogen kippt beim Ausstoß (Roster-Anim „tilt“).',
});
