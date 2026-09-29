/**
 * Ammonit (f3:exp_lnd_fortress) – Schwebende Festung mit Kapitel, Großschale (T4, Post-MVP).
 *
 * Roster/experimentals.md §4: dunkler Schwebeteller (Schattensaum 10 %), darauf drei liegende Schalenwindungen
 * (Ø 9 → 5 → 2,5 WU), die sich zur Mündung hin öffnen (teamfarbene Emaille, Goldkanten an den Windungsnähten); in der
 * Mündung die Perle (Ø 1,8 WU) mit der Gezeitenlanze (Überlänge ≥ 1,2 × Rumpflänge, ragt 4 WU über den Bug); über der
 * innersten Windung ein waagerechter Schildring; am Heck ein niedriges, goldenes Kapiteltor mit Goldkern (FACTORY,
 * Flow-Ausnahme). Schwebehöhe 0,6 WU. **Monopol:** liegende Spiralschale. **Pflichtpaare:** Ammonit ↔ Konus (Spirale
 * auf großem Teller gegen schmale Schale, beide mit Überlänge-Lanze), Ammonit ↔ Karkinos (Teller gegen Beine).
 *
 * Die Spirale ist eine logarithmische Spirale mit Wachstum 2 pro Windung; der Bahnquerschnitt ist ein flaches
 * Halb-Oval (Radius = Bahnradius / 3), so berühren sich benachbarte Windungen am Fuß (dort liegt die Goldnaht). Jede
 * Windung besteht aus drei offenen `sweep`-Bahnen (Flanke Perlmutt, Rücken Emaille, Flanke Perlmutt) in einer
 * gemeinsamen `smoothGroup`. Die Lanze liegt über den Windungen und läuft durch die Mündungsperle (Schaft hinter der
 * Perle), damit sie die Überlänge des Konus zeigt, ohne dass die Perle die Mündung verlässt.
 *
 * Gebaut in Spielmaß auf y = 0 (Teller-Unterkante); der Build hebt um `hover` = 0,6 WU an. Die Registry liest
 * seit dem Review 2026-09-29 auch `experimentals[]` aus dem Roster; Name, Rolle, Klasse, Tech, Footprint, Icon und
 * hover stehen trotzdem explizit hier.
 *
 * Aufbau (y = Boden vor dem Anheben, +Z = vorn, +X = linke Seite):
 *   hull  – Schwebeteller (Rinde, Tiefjade-Unterseite), Spiralschale, Goldnähte, Anfangskammer, Mündungslippe,
 *           Kapiteltor mit Goldkern, Klammerbögen, Lichtnaht
 *   orb   – Mündungsperle (Team), dreht um +Y                                  (PartStream 1, yaw)
 *   lance – Gezeitenlanze, kippt (Pitch)                                          (PartStream 2)
 *   ring  – schwebender Schildring über der innersten Windung, dreht             (PartStream 3, yaw)
 */
import { cone, defineModel, disc, ellipsoid, glyphStrip, lens, sphere, strut, sweep, torus, torusArc, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const PAD_H = 0.3;
const PAD_TOP = PAD_H;
const R_END = 3.9; // Bahnradius an der Mündung
const PHI_END = 90; // Mündung vorn (Grad, von +X nach +Z)
const FLAT = 0.85; // Halb-Oval: Höhe / Breite
const XC = -0.64; // Spiralmitte, so dass die Schale auf dem Footprint zentriert ist
const ZC = -0.76;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const bahnR = (phi: number): number => R_END * 2 ** ((phi - PHI_END) / 360);
const spiralPt = (phi: number, y = PAD_TOP): Vec3 => [XC + bahnR(phi) * Math.cos(rad(phi)), y, ZC + bahnR(phi) * Math.sin(rad(phi))];

/** Bogenprofil (Halb-Oval, Einheitskreis) zwischen zwei Winkeln (0 = Außenflanke am Fuß, 180 = Gegenflanke). */
function arc(fromDeg: number, toDeg: number, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rad(fromDeg + ((toDeg - fromDeg) * i) / (n - 1));
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

type Lod = { readonly maxLod?: 0 | 1 | 2; readonly minLod?: 0 | 1 | 2 };

/** Windung `w` (0 = außen, 2 = innen) als drei offene Bahnen; `segs` Pfadsegmente, `crown` Profilpunkte im Rücken. */
function winding(w: number, segs: number, crown: number, lod: Lod, tris: boolean): Shape[] {
  const phi1 = PHI_END - 360 * w;
  const phi0 = phi1 - 360;
  const path: Vec3[] = [];
  const radius: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segs;
    path.push(spiralPt(phi));
    const t = bahnR(phi) / 3;
    radius.push([t, t * FLAT]);
  }
  const lane = (profile: Vec2[], mat: string): Shape =>
    sweep({ ...lod, path, radius, profile, open: true, smoothGroup: 'spiral', mat, keep: true, tag: 'shell' });
  if (!tris) return [lane(arc(0, 180, crown), 'enamel')];
  return [lane(arc(0, 34, 2), 'nacre'), lane(arc(34, 146, crown), 'enamel'), lane(arc(146, 180, 2), 'nacre')];
}

/** Goldnaht am Fuß zwischen zwei Windungen (innere Kante der Windung `w`). */
function seam(w: number, segs: number, lod: Lod): Shape {
  const phi1 = PHI_END - 360 * w;
  const phi0 = phi1 - 360;
  const path: Vec3[] = [];
  for (let i = 0; i <= segs; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segs;
    const r = bahnR(phi) * (1 - 1 / 3);
    path.push([XC + r * Math.cos(rad(phi)), PAD_TOP + 0.05, ZC + r * Math.sin(rad(phi))]);
  }
  return sweep({ ...lod, path, radius: 0.09, sides: 3, caps: false, mat: 'gold', tag: 'seam' });
}

// Mündung: Ende der äußeren Windung (Bahnradius R_END, Querschnitt R_END / 3)
const MOUTH = spiralPt(PHI_END);
const T_END = R_END / 3;
const ORB_R = 0.9; // Ø 1,8 WU
const ORB: Vec3 = [MOUTH[0] - 0.25, PAD_TOP + T_END * FLAT + 0.15, MOUTH[2] - 0.1];
const BOW_Z = ZC + R_END + T_END; // Vorderkante der Schale
const LANCE_TIP = BOW_Z + 4; // ragt 4 WU über den Bug
const LANCE_BASE = ZC - bahnR(-90) - bahnR(-90) / 3 + 0.2; // Schaftende über dem Heckrand

// Schwebeteller: Ellipse um die Schale, 10 % Schattensaum
const SHELL_X: [number, number] = [XC - bahnR(-180) * (4 / 3), XC + bahnR(0) * (4 / 3)];
const SHELL_Z: [number, number] = [ZC - bahnR(-90) * (4 / 3), BOW_Z];
const PAD_C: Vec3 = [(SHELL_X[0] + SHELL_X[1]) / 2, PAD_H / 2, (SHELL_Z[0] + SHELL_Z[1]) / 2];
const PAD_RX = ((SHELL_X[1] - SHELL_X[0]) / 2) * 1.1;
const PAD_RZ = ((SHELL_Z[1] - SHELL_Z[0]) / 2) * 1.1;
const PAD_R = 4.5;

// Heck: Rückenlinie der äußeren Windung bei φ = -90° (läuft dort quer, entlang x)
const REAR = spiralPt(-90);
const T_REAR = bahnR(-90) / 3;
const RING: Vec3 = [XC, 3.2, ZC];

/** Punkt/Normale auf dem Rücken der hinteren Windung: Versatz `dx` entlang der Bahn, `dz` quer (nach hinten −). */
function onRear(dx: number, dz: number): { p: Vec3; n: Vec3 } {
  const u = dz / T_REAR;
  const h = T_REAR * FLAT * Math.sqrt(Math.max(0, 1 - u * u));
  const n: Vec3 = [0, 1 / (T_REAR * FLAT) ** 2 * h, dz / T_REAR ** 2];
  const l = Math.hypot(n[0], n[1], n[2]);
  return { p: [REAR[0] + dx, PAD_TOP + h, REAR[2] + dz], n: [n[0] / l, n[1] / l, n[2] / l] };
}

/** Tech-Marker T4: „[“ links, „]“ rechts auf dem Rücken der hinteren Windung (Tiefjade-Decal). */
function bracket(side: 1 | -1): Shape[] {
  const xa = side * 0.95;
  const xb = side * 1.35;
  const lines: [number, number, number, number][] = [
    [xa, 0.34, xb, 0.34],
    [xb, 0.34, xb, -0.34],
    [xb, -0.34, xa, -0.34],
  ];
  return lines.map(([ax, az, bx, bz]) => {
    const a = onRear(ax, az);
    const b = onRear(bx, bz);
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
    return glyphStrip({ path: [a.p, b.p], normal: [a.n, b.n], width: 0.2, pattern: [len + 0.1], widths: [1], lift: 0.05, mat: 'jade', maxLod: 1, tag: 'techmarker' });
  });
}

export default defineModel({
  id: 'f3:exp_lnd_fortress',
  name: 'Ammonit',
  role: 'Schwebende Festung',
  class: 'land',
  tech: 4,
  footprint: [8, 8],
  icon: 'land_sniper_t4',
  hover: 0.6,
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Schwebeteller: dunkle Rinde oben, Tiefjade-Bauchschale unten; überragt die Schale um 10 %
        disc({ radius: PAD_R, height: PAD_H, bevel: PAD_H / 2, segments: 20, at: PAD_C, scale: [PAD_RX / PAD_R, 1, PAD_RZ / PAD_R], mat: 'rind', keep: true, tag: 'hoverpad' }),
        ellipsoid({ radii: [PAD_RX * 0.86, 0.22, PAD_RZ * 0.86], half: true, segments: 14, rings: 2, at: [PAD_C[0], 0.11, PAD_C[2]], rot: [180, 0, 0], mat: 'jade', maxLod: 1, tag: 'belly' }),
        // Spiralschale: drei Windungen, je LOD eigene Dichte
        ...winding(0, 24, 5, { maxLod: 0 }, true),
        ...winding(1, 16, 5, { maxLod: 0 }, true),
        ...winding(2, 11, 4, { maxLod: 0 }, true),
        ...winding(0, 15, 3, { minLod: 1, maxLod: 1 }, true),
        ...winding(1, 10, 3, { minLod: 1, maxLod: 1 }, true),
        ...winding(2, 6, 3, { minLod: 1, maxLod: 1 }, false),
        ...winding(0, 9, 4, { minLod: 2 }, false),
        ...winding(1, 6, 3, { minLod: 2 }, false),
        // Goldkanten an den Windungsnähten
        seam(0, 15, { maxLod: 0 }),
        seam(1, 11, { maxLod: 0 }),
        seam(0, 12, { minLod: 1, maxLod: 1 }),
        // Anfangskammer im Zentrum (Perlmutt) schließt die innerste Windung
        ellipsoid({ radii: [0.62, 0.42, 0.62], half: true, segments: 8, rings: 2, at: [XC, PAD_TOP + 0.21, ZC], mat: 'nacre', maxLod: 1, tag: 'shell' }),
        // Mündungslippe (Perlglanz) um das offene Ende der äußeren Windung
        torusArc({ radius: T_END * 0.98, tube: 0.16, arc: 180, startDeg: 90, segments: 10, sides: 4, flatten: 1, axis: 'x', at: [MOUTH[0], PAD_TOP, MOUTH[2]], scale: [1, FLAT, 1], rot: [0, 0, 0], mat: 'lustre', keep: true, tag: 'lip' }),
        // Kapiteltor am Heck: niedriger Goldbogen mit Goldkern (FACTORY)
        torusArc({ radius: 0.8, tube: 0.18, arc: 180, startDeg: 180, segments: 8, sides: 4, axis: 'z', at: [0, PAD_TOP, SHELL_Z[0] - 0.22], mat: 'gold', keep: true, tag: 'arch' }),
        lens({ radius: 0.5, thickness: 0.2, axis: 'z', segments: 8, at: [0, PAD_TOP + 0.45, SHELL_Z[0] - 0.14], mat: 'light', keep: true, tag: 'core' }),
        // Tech-Marker T4
        ...bracket(1),
        ...bracket(-1),
        // Jade-Lichtnaht am hinteren Tellerrand (≤ 2 %)
        glyphStrip({
          path: [-1.6, -0.8, 0, 0.8, 1.6].map((x): Vec3 => [PAD_C[0] + x + 2.4, PAD_TOP + 0.001, PAD_C[2] - PAD_RZ * Math.sqrt(1 - ((x + 2.4) / PAD_RX) ** 2) + 0.2]),
          width: 0.12,
          pattern: [0.45, -0.2],
          widths: [1],
          mat: 'seam',
          maxLod: 0,
          tag: 'seam',
        }),
      ],
    },
    {
      name: 'orb',
      pivot: [ORB[0], ORB[1], ORB[2]],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 12, rings: 6, at: ORB, mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'lance',
      parent: 'orb',
      pivot: [ORB[0], ORB[1], ORB[2]],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Gezeitenlanze: Spitze 4 WU vor dem Bug, Ø 0,7 WU an der Perle; goldener Schaft läuft hinter der Perle über die
        // Windungen bis zum Heckrand (Überlänge ≥ 1,2 × Rumpflänge wie beim Konus)
        cone({ radius: 0.35, height: LANCE_TIP - ORB[2], segments: 6, axis: 'z', at: [ORB[0], ORB[1], (LANCE_TIP + ORB[2]) / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        strut({ from: [ORB[0], ORB[1], ORB[2] - 0.5], to: [ORB[0], ORB[1], LANCE_BASE], radius: 0.2, radiusEnd: 0.15, sides: 4, mat: 'gold', keep: true, tag: 'lance' }),
        sphere({ radius: 0.28, segments: 6, rings: 3, at: [ORB[0], ORB[1], LANCE_BASE], mat: 'gold', maxLod: 1, tag: 'lance' }),
      ],
    },
    {
      name: 'ring',
      pivot: RING,
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Schildring (Personal-Schild ab K10): schwebt waagerecht über der innersten Windung
        torus({ radius: 1.7, tube: 0.17, segments: 16, sides: 4, at: RING, mat: 'lustre', keep: true, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_exp_ammonite: Perlen-Yaw, Lanzen-Pitch, Schildring-Yaw (3 animierte Parts, experimentals.md §2.4). Schwebehöhe 0,6 WU (Roster motion.hoverHeightView).',
});
