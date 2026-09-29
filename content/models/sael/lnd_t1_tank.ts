/**
 * Kauri (f3:lnd_t1_tank) – Sael-Direktfeuer-Schweber T1. **Grundform der Sael-Landeinheiten**: exportiert die
 * Schalen-Bausteine (`shell`, `pad`, `techStripes`, `seam`, `surf`), die alle übrigen `lnd_*`-Modelle importieren.
 *
 * Roster: „Tropfenförmige Schale 1,0 × 0,35 × 1,4 WU auf Schwebeteller (Schattensaum 10 %), teamfarbene Perle
 * Ø 0,45 WU, waagerechte Lanze 0,95 WU (≈ 68 % der Rumpflänge) über die Tropfenspitze, goldener Schaft.“
 * faction.md §5.2: Hero-Feature Perle + waagerechte Lanze (≥ 60 % der Rumpflänge, ragt über die Tropfenspitze);
 * verboten: Horn, Lanze steiler als 15°. Teamfarbe ≥ 30 % der Draufsicht: Emaille-Einlage auf dem Schalenscheitel
 * (füllt die Schale bis auf einen 15-%-Perlmuttrand) plus Perle.
 *
 * Schale: waagerecht geschichtete Loft-Ringe eines Halb-Ellipsoids (Tropfenform wie `ellipsoid({ half, drop })`),
 * Perlmuttrand unten, Emaille-Kappe oben, gemeinsame `smoothGroup` = bündige Einlage ohne Stufe; flache Unterseite in
 * Schalenrinde. Tech-Streifen (Tiefjade) und Lichtnaht (Jade) liegen als Decals auf der Schalenfläche.
 *
 * Aufbau (y = Boden vor dem Anheben um 0,25 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller (Schalenrinde), Schale (Perlmutt + Emaille), 1 Tech-Streifen, Lichtnaht am Heck
 *   turret – Perle (Teamfarbe), dreht um +Y                                     (PartStream 1)
 *   barrel – Lanze (Perlglanz) mit goldenem Schaft, kippt (Pitch)                (PartStream 2)
 */
import { cone, cylinder, defineModel, disc, glyphStrip, loftShape, sphere, type LodLevel, type Ring, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

// --- Sael-Schale: gemeinsame Bausteine der Sael-Landeinheiten (von den übrigen lnd_*-Modellen importiert) ---------
export const PAD_H = 0.1;
export interface ShellSpec {
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  /** Unterkante der Schale. */
  readonly y0: number;
  /** Tropfenform: Bug (+Z) schmaler, wie `ellipsoid({ drop })`. */
  readonly drop?: number;
  readonly cz?: number;
}
/** Höhenzone der Schale bis zum Breitengrad `to` (Grad, 90 = Scheitel), Bänder je LOD. */
export interface Zone {
  readonly to: number;
  readonly bands: readonly [number, number, number];
  readonly mat: string;
}
export const rad = (d: number): number => (d * Math.PI) / 180;

export function shellRing(sp: ShellSpec, phiDeg: number, n: number): Ring {
  const s = Math.cos(rad(phiDeg));
  const pts: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    const th = ((j + 0.5) / n) * Math.PI * 2;
    const z = sp.rz * s * Math.sin(th);
    const x = sp.rx * s * Math.cos(th) * (1 - (sp.drop ?? 0) * Math.max(0, z / sp.rz));
    pts.push([x, z + (sp.cz ?? 0)]);
  }
  return { y: sp.y0 + sp.ry * Math.sin(rad(phiDeg)), pts };
}

/** Schale in Höhenzonen (je LOD eigene Segmentzahl), flache Unterseite in Schalenrinde. */
export function shell(sp: ShellSpec, zones: readonly Zone[], group: string, segs: readonly [number, number, number] = [10, 8, 6]): Shape[] {
  const out: Shape[] = [];
  for (const l of [0, 1, 2] as const) {
    const lod = { minLod: l as LodLevel, maxLod: l as LodLevel };
    const n = segs[l];
    out.push(loftShape({ ...lod, rings: [shellRing(sp, 0, n)], caps: { bottom: true, top: false }, mat: 'rind', keep: true, tag: 'shell' }));
    let a = 0;
    for (const z of zones) {
      const b = z.bands[l];
      const rings = Array.from({ length: b + 1 }, (_, i) => shellRing(sp, a + ((z.to - a) * i) / b, n));
      out.push(loftShape({ ...lod, rings, caps: { bottom: false, top: false }, mat: z.mat, smoothGroup: group, keep: true, tag: 'shell' }));
      a = z.to;
    }
  }
  return out;
}

/** Punkt und Normale auf der (Heck-)Schalenfläche. */
export function surf(sp: ShellSpec, x: number, z: number): { p: Vec3; n: Vec3 } {
  const zz = z - (sp.cz ?? 0);
  const h = sp.ry * Math.sqrt(Math.max(0, 1 - (x / sp.rx) ** 2 - (zz / sp.rz) ** 2));
  const n: Vec3 = [x / sp.rx ** 2, h / sp.ry ** 2, zz / sp.rz ** 2];
  const l = Math.hypot(...n);
  return { p: [x, sp.y0 + h, z], n: [n[0] / l, n[1] / l, n[2] / l] };
}

/**
 * Tech-Streifen (Tiefjade, 0,10 WU, Abstand 0,10 WU) quer über das hintere Schalendrittel ab `z0` nach hinten.
 * `step`/`width` nur für sehr kurze Schalen enger (Konus).
 */
export function techStripes(sp: ShellSpec, count: number, z0: number, frac = 0.82, step = 0.2, width = 0.1): Shape[] {
  return Array.from({ length: count }, (_, i) => {
    const z = z0 - i * step;
    const w = frac * sp.rx * Math.sqrt(Math.max(0, 1 - ((z - (sp.cz ?? 0)) / sp.rz) ** 2));
    const pts = Array.from({ length: 7 }, (_, k) => surf(sp, -w + (2 * w * k) / 6, z));
    // lückenlose Striche je Pfadabschnitt: der Streifen folgt der Wölbung statt sie als Sehne zu unterqueren
    return glyphStrip({ path: pts.map((q) => q.p), normal: pts.map((q) => q.n), width, pattern: [w / 3 + 1e-4], widths: [1], lift: 0.012, mat: 'jade', maxLod: 1, tag: 'stripe' });
  });
}

/** Jade-Lichtnaht auf einem Schalen-Breitengrad (Ringecken j0…j1 der LOD0-Schale, n Segmente). */
export function seam(sp: ShellSpec, phiDeg: number, n: number, j0: number, j1: number): Shape {
  const ring = shellRing(sp, phiDeg, n);
  const path: Vec3[] = [];
  const normal: Vec3[] = [];
  for (let j = j0; j <= j1; j++) {
    const [x, z] = ring.pts[j % n]!;
    path.push([x, ring.y, z]);
    const q = surf(sp, x * 0.999, z * 0.999);
    normal.push(q.n);
  }
  return glyphStrip({ path, normal, width: 0.05, pattern: [0.16, -0.06, 0.07, -0.06], widths: [1, 0.7], mat: 'seam', maxLod: 0, tag: 'seam' });
}

/** Schwebeteller: dunkler Diskus, überragt die Schale um ~10 % (Schattensaum). */
export function pad(rx: number, rz: number, cz = 0): Shape {
  return disc({ radius: 1, height: PAD_H, bevel: PAD_H / 2, segments: 10, scale: [rx, 1, rz], at: [0, PAD_H / 2, cz], mat: 'rind', keep: true, tag: 'hoverpad' });
}
// -------------------------------------------------------------------------------------------------------------------

const SHELL: ShellSpec = { rx: 0.5, ry: 0.35, rz: 0.7, y0: 0.06, drop: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const ORB_R = 0.225;
const ORB_Y = TOP + 0.1;
const ORB_Z = 0.12; // Perle vor der Mitte: die Lanzenspitze ragt auch in der Spielkamera über den Teller
const LANCE_Y = ORB_Y - 0.01;
const LANCE_Z0 = 0.22; // Lanzenwurzel in der Perle
const LANCE_L = 0.95;

export default defineModel({
  id: 'f3:lnd_t1_tank',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.55, 0.76, -0.02),
        // Perlmuttrand bis 15 % Radius (cos 31,8° = 0,85), darüber die Emaille-Einlage bis zum Scheitel
        ...shell(SHELL, [
          { to: 31.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        ...techStripes(SHELL, 1, -0.48),
        seam(SHELL, 31.8, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 10, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, LANCE_Y, ORB_Z + 0.12],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Lanze: spitzer Kegel, waagerecht über die Tropfenspitze (Spitze bei z = 1,17, Schale endet bei 0,70)
        cone({ radius: 0.09, height: LANCE_L, segments: 6, axis: 'z', at: [0, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        // goldener Schaft an der Lanzenwurzel vor der Perle
        cylinder({ radius: 0.11, height: 0.16, segments: 6, axis: 'z', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.04], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_tank: Perle Yaw, Lanze Pitch (2 animierte Parts). Schwebehöhe 0,25 aus dem Roster.',
});
