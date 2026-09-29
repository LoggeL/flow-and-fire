/**
 * Albatros (f3:air_t2_gunship) – Sael-Kampfschweber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Keine Schwingen: hochgewölbte Kuppel, darunter hängende Perle mit Lanze, deren Spitze von oben sichtbar
 * vor die Kuppel ragt.“ Parts shell:team (kuppel), orb (haengende_perle, yaw), lance (pitch); 2 Tech-Streifen.
 * faction.md §5.2: Monopol Gunship = keine Schwingen, Kuppel mit hängender Perle und Lanze darunter; Pflicht:
 * Lanzenspitze ragt von oben sichtbar vor die Kuppel; verboten: Schwingen. Perle + waagerechte Lanze = Direktfeuer
 * (Winkel-Code); Luft: Teamfarbe ≥ 45 % der Draufsicht (Kuppel-Emaille bis auf den Perlmutt-Rand).
 * Von oben: ein runder Teamfarben-Kreis mit Perlmutt-Saum und einer Goldspitze nach vorn – kein Flügelumriss.
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug, +X = linke Seite), Kuppel Ø 1,0 × 1,08 WU, Länge 1,52 WU:
 *   hull  – Kuppel (Emaille, hochgewölbte Halbschale, Tropfenform), Perlmutt-Saum darunter, dunkle Bauchschale
 *           (Rinde), Jade-Lichtnaht am hinteren Saum, 2 Tiefjade-Tech-Streifen auf dem hinteren Kuppeldrittel
 *   orb   – hängende Perle (Perlglanz) an goldenem Hals unter der Bauchschale, dreht um +Y   (PartStream 1, yaw)
 *   lance – goldene Lanze waagerecht aus der Perle nach vorn, kippt (Pitch)                   (PartStream 2)
 */
import { cone, defineModel, ellipsoid, frustum, glyphStrip, sphere, type Vec3 } from '@faf/modelkit';

const BASE_Y = 0.46; // Unterkante der Kuppel
const DOME_RX = 0.46;
const DOME_RY = 0.42;
const DOME_RZ = 0.5;
const RIM_RX = 0.52;
const RIM_RZ = 0.56;
const RIM_RY = 0.08;
const BELLY_RY = 0.13;
const ORB_R = 0.16;
const ORB_Y = 0.2;
const LANCE_LEN = 0.84;

/** Punkt + Normale auf der Kuppel (analytisches Ellipsoid über BASE_Y, hintere Hälfte ohne Tropfenform). */
function domeAt(x: number, z: number): { p: Vec3; n: Vec3 } {
  const q = 1 - (x / DOME_RX) ** 2 - (z / DOME_RZ) ** 2;
  const h = Math.sqrt(Math.max(0, q));
  const y = BASE_Y + DOME_RY * h;
  const n: Vec3 = [x / DOME_RX ** 2, Math.max(h, 0.05) / DOME_RY, z / DOME_RZ ** 2];
  return { p: [x, y, z], n };
}
/** Tech-Streifen quer über das hintere Kuppeldrittel bei z. */
function band(z: number): { path: Vec3[]; normal: Vec3[] } {
  const w = DOME_RX * Math.sqrt(1 - (z / DOME_RZ) ** 2) * 0.92;
  const pts = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1].map((u) => domeAt(u * w, z));
  return { path: pts.map((q) => q.p), normal: pts.map((q) => q.n) };
}
/** Lichtnaht auf dem hinteren Perlmutt-Saum (Bogen 220°…320°). */
const SEAM: Vec3[] = [220, 240, 260, 280, 300, 320].map((deg): Vec3 => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * (RIM_RX - 0.03), BASE_Y + RIM_RY * 0.35, Math.sin(a) * (RIM_RZ - 0.03)];
});

export default defineModel({
  id: 'f3:air_t2_gunship',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Kuppel: hochgewölbte Emaille-Halbschale (Teamfarbe), vorn leicht schmaler (Tropfen = Fahrtrichtung)
        ellipsoid({ radii: [DOME_RX, DOME_RY, DOME_RZ], half: true, drop: 0.18, segments: 12, rings: 4, at: [0, BASE_Y + DOME_RY / 2, 0], mat: 'enamel', keep: true, tag: 'shell' }),
        // Perlmutt-Saum: flache Halbschale unter der Kuppel, steht rundum 0,06 WU über
        ellipsoid({ radii: [RIM_RX, RIM_RY, RIM_RZ], half: true, drop: 0.18, segments: 12, rings: 2, at: [0, BASE_Y - 0.02 + RIM_RY / 2, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        // Bauchschale (Rinde, nach unten gewölbt): hell oben, dunkel unten
        ellipsoid({ radii: [RIM_RX - 0.04, BELLY_RY, RIM_RZ - 0.04], half: true, drop: 0.18, segments: 10, rings: 2, rot: [180, 0, 0], at: [0, BASE_Y - 0.02 - BELLY_RY / 2, 0], mat: 'rind', keep: true, tag: 'shell' }),
        // Jade-Lichtnaht am hinteren Saum
        glyphStrip({ path: SEAM, width: 0.04, pattern: [0.12, -0.05], widths: [1], lift: 0.01, mat: 'seam', maxLod: 0, tag: 'seam' }),
        // 2 Tech-Streifen (Tiefjade, 0,10 WU, Abstand 0,10 WU) im hinteren Kuppeldrittel
        glyphStrip({ ...band(-0.24), width: 0.1, pattern: [0.08, -0.001], widths: [1], lift: 0.01, mat: 'jade', maxLod: 1, tag: 'stripe' }),
        glyphStrip({ ...band(-0.44 + 0.02), width: 0.1, pattern: [0.08, -0.001], widths: [1], lift: 0.01, mat: 'jade', maxLod: 1, tag: 'stripe' }),
      ],
    },
    {
      name: 'orb',
      pivot: [0, BASE_Y - 0.02 - BELLY_RY, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // goldener Hals, an dem die Perle hängt
        frustum({ radius: 0.06, radiusTop: 0.09, height: 0.12, segments: 6, caps: false, at: [0, BASE_Y - 0.02 - BELLY_RY - 0.02, 0], mat: 'gold', maxLod: 1, tag: 'orb' }),
        // hängende Perle (Perlglanz, nicht teamfarben)
        sphere({ radius: ORB_R, segments: 10, rings: 5, at: [0, ORB_Y, 0], mat: 'lustre', keep: true, tag: 'orb' }),
      ],
    },
    {
      name: 'lance',
      parent: 'orb',
      pivot: [0, ORB_Y, ORB_R * 0.6],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Lanze: spitzer Goldkegel, waagerecht; Spitze ragt 0,34 WU vor den Kuppelsaum (von oben sichtbar)
        cone({ radius: 0.078, height: LANCE_LEN, segments: 6, axis: 'z', at: [0, ORB_Y, ORB_R * 0.5 + LANCE_LEN / 2], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_gunship: Emaille-Kuppel ohne Schwingen, hängende Perle (yaw) mit Goldlanze (pitch); 2 animierte Parts.',
});
