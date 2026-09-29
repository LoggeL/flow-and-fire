/**
 * Chorist (f4:lnd_t1_engineer) – Aurith-Engineer T1; Grundform der Engineer-Familie (Solist T2, Vorsänger T3
 * importieren `engineerParts`).
 *
 * Roster: „Kurzer breiter Kiel mit Perlglas-Rücken, eine Perlglas-Sichel diagonal vom linken Heck nach vorn rechts,
 * Kristall an der Sichelspitze; teamfarbenes Kiel-Seitenband und kleiner Kamm; 1 Tonpunkt Pechglas.“
 * faction.md §5.2 Engineer: Perlglas-Sichel diagonal über dem Kiel, Kristall an der Sichelspitze, Perlglas-Rücken;
 * asymmetrisch; Zahl der Sicheln = Tech (1/2/3, verschieden groß); keine Waffenform. §3.2: gleitet auf dem Kiel
 * (GLIDE_HEIGHT), Kamm läuft nach hinten aus, Höhe ≥ 0,6 × Rumpflänge. §4.2: Teamfarbe ≥ 25 % (Kiel-Seitenband +
 * Kamm), Tonpunkte bei Engineers Pechglas auf dem Perlglas-Rücken. Paartest Pfiff↔Chorist: gebogene Sichel gegen
 * geraden, senkrechten Mast.
 *
 * Aufbau (y = Boden vor dem Schwebe-Offset, +Z = Bug, +X = linke Seite):
 *   hull    – Schwebelinse (Pechglas, dunkler Spalt), Kiel als Tropfen-Halbschale (team = Seitenband), Perlglas-Rücken,
 *             teamfarbener Kamm nach hinten, Glyphenbänder an den Flanken, Tonpunkte; T2/T3: weitere, kleinere
 *             Sicheln (statisch): T2 rechts hinten nach vorn links, T3 zusätzlich klein an der linken Flanke
 *   sickle  – Hauptsichel: Drehkranz links hinten, Perlglas-Bogen diagonal nach vorn rechts (PartStream 1, yaw)
 *   emitter – Resonanzkristall an der Sichelspitze, kippt (PartStream 2, pitch; T3 statisch in der Sichel)
 */
import {
  bezier,
  crystal,
  cylinder,
  defineModel,
  ellipsoid,
  extrude,
  GLIDE_HEIGHT,
  glyphStrip,
  group,
  lens,
  loftShape,
  sweep,
  type PartDef,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

/** Kiel (team) als Tropfen-Halbschale: Unterkante y = 0,08 über der Schwebelinse. */
const KEEL = { r: [0.44, 0.24, 0.6] as Vec3, y0: 0.08, drop: 0.3 };
/** Perlglas-Rücken. */
const BACK = { r: [0.35, 0.25, 0.5] as Vec3, y0: 0.19, z: -0.04, drop: 0.3 };

/** Höhe des Perlglas-Rückens bei (x, z) (Halb-Ellipsoid mit Tropfenform). */
function backY(x: number, z: number): number {
  const lz = z - BACK.z;
  const fx = 1 - BACK.drop * Math.max(0, lz / BACK.r[2]);
  const q = 1 - (x / (BACK.r[0] * fx)) ** 2 - (lz / BACK.r[2]) ** 2;
  return BACK.y0 + BACK.r[1] * Math.sqrt(Math.max(0, q));
}

interface SickleSpec {
  /** Drehkranz (Fußpunkt) der Sichel. */
  readonly base: Vec3;
  /** Richtung des Bogens in Grad (0 = Bug, + = nach links/+X, − = nach rechts/−X). */
  readonly yaw: number;
  /** Größe relativ zur Hauptsichel. */
  readonly k: number;
}

/** Sichelbogen lokal [vor, hoch, seitlich]: steigt steil auf, wölbt sich vor und fällt zur Spitze, leicht seitlich gekrümmt. */
const ARC: Vec3[] = [
  [0, 0, 0],
  [0.1, 0.6, 0.12],
  [0.6, 0.68, 0.06],
  [0.86, 0.26, -0.02],
];

/**
 * Sicheln (Zahl = Tech, verschieden groß): Hauptsichel links hinten diagonal nach vorn rechts (Roster); Solist +
 * mittlere Sichel rechts hinten nach vorn links (kreuzt unter der Hauptsichel); Vorsänger + kleine Sichel an der
 * linken Flanke nach links außen – von oben ein Fächer aus 1/2/3 Bögen.
 */
const SICKLES: readonly SickleSpec[] = [
  { base: [0.2, 0.38, -0.2], yaw: -30, k: 1 },
  { base: [-0.2, 0.37, -0.24], yaw: 34, k: 0.7 },
  { base: [0.24, 0.33, 0.04], yaw: 84, k: 0.5 },
];

function sickleCtrl(s: SickleSpec): Vec3[] {
  const a = (s.yaw * Math.PI) / 180;
  const f: Vec3 = [Math.sin(a), 0, Math.cos(a)];
  const l: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
  return ARC.map(([u, v, w]): Vec3 => [s.base[0] + (f[0] * u + l[0] * w) * s.k, s.base[1] + v * s.k, s.base[2] + (f[2] * u + l[2] * w) * s.k]);
}

/** Perlglas-Sichel: abgeflachter Bogen, zur Spitze verjüngt; Drehkranz aus Pechglas nur an der drehbaren Hauptsichel. */
function sickleShapes(s: SickleSpec, main: boolean): Shape[] {
  const ctrl = sickleCtrl(s);
  const q = Math.sqrt(s.k);
  const rad = (f: number): [number, number] => [(0.1 - 0.05 * f) * q, (0.055 - 0.02 * f) * q];
  const secs = (n: number): [number, number][] => Array.from({ length: n + 1 }, (_, i) => rad(i / n));
  const n0 = main ? 6 : 4;
  return [
    ...(main ? [cylinder({ radius: 0.11, height: 0.08, segments: 6, caps: 'top', at: [ctrl[0]![0], ctrl[0]![1] - 0.02, ctrl[0]![2]], mat: 'pitch', keep: true, maxLod: 1, tag: 'sickle' })] : []),
    sweep({ path: bezier(ctrl, n0), radius: secs(n0), sides: 4, mat: 'pearl', smooth: 70, keep: true, maxLod: 0, tag: 'sickle' }),
    sweep({ path: bezier(ctrl, 4), radius: secs(4), sides: 4, mat: 'pearl', smooth: 70, keep: true, minLod: 1, maxLod: 1, tag: 'sickle' }),
    sweep({ path: bezier(ctrl, 3), radius: secs(3), sides: 3, mat: 'pearl', keep: true, minLod: 2, tag: 'sickle' }),
  ];
}

/** Resonanzkristall an der Sichelspitze (beidseitig spitz, hängt nach vorn unten). */
function emitterShapes(s: SickleSpec): Shape[] {
  const tip = sickleCtrl(s)[3]!;
  const k = Math.sqrt(s.k);
  const at: Vec3 = [tip[0], tip[1] - 0.08 * k, tip[2] + 0.02];
  return [
    crystal({ radius: 0.085 * k, height: 0.1 * k, tip: 0.1 * k, bottomTip: 0.09 * k, sides: 6, at, rot: [20, 0, 0], mat: 'phase', keep: true, maxLod: 1, tag: 'crystal' }),
    crystal({ radius: 0.1 * k, height: 0.1 * k, tip: 0.1 * k, bottomTip: 0.09 * k, sides: 3, at, mat: 'phase', keep: true, minLod: 2, tag: 'crystal' }),
  ];
}

/** Kamm (Seitenprofil z/y): steigt hinter der Rückenmitte auf und läuft über das Heck hinaus. */
const FIN: Vec2[] = [
  [-0.04, 0.42],
  [-0.26, 0.6],
  [-0.48, 0.7],
  [-0.66, 0.64],
  [-0.73, 0.47],
  [-0.56, 0.38],
  [-0.34, 0.36],
];

/** Glyphenband an der Kiel-Flanke (Seite s: +1 links, −1 rechts). */
function flankGlyphs(s: 1 | -1): Shape {
  const y = KEEL.y0 + 0.07;
  const ky = Math.sqrt(1 - (0.07 / KEEL.r[1]) ** 2);
  const path: Vec3[] = [0.34, 0.17, 0, -0.17, -0.34].map((z): Vec3 => {
    const fx = 1 - KEEL.drop * Math.max(0, z / KEEL.r[2]);
    return [s * KEEL.r[0] * ky * fx * Math.sqrt(1 - (z / KEEL.r[2]) ** 2) * 0.99, y, z];
  });
  return glyphStrip({ path, normal: [s, 0.3, 0], width: 0.05, pattern: [0.16, -0.05, 0.05, -0.05, 0.22, -0.06], mat: 'glyph', maxLod: 0, tag: 'glyphs' });
}

/** Tonpunkte (Pechglas) quer auf dem vorderen Perlglas-Rücken, an die Wölbung angelegt. */
function dots(tech: number): Shape[] {
  const out: Shape[] = [];
  const dia = 0.12;
  const step = 0.2;
  const z = 0.2;
  const hex = Array.from({ length: 6 }, (_, i): Vec2 => [(dia / 2) * Math.cos((i * Math.PI) / 3), (dia / 2) * Math.sin((i * Math.PI) / 3)]);
  const e = 0.01;
  const deg = 180 / Math.PI;
  for (let i = 0; i < tech; i++) {
    const x = (i - (tech - 1) / 2) * step - 0.04;
    const gx = (backY(x + e, z) - backY(x - e, z)) / (2 * e);
    const gz = (backY(x, z + e) - backY(x, z - e)) / (2 * e);
    out.push(loftShape({ rings: [{ y: 0, pts: hex }], caps: { bottom: false, top: true }, at: [x, backY(x, z) + 0.012, z], rot: [Math.atan(gz) * deg, 0, -Math.atan(gx) * deg], mat: 'pitch', keep: true, maxLod: 0, tag: 'dots' }));
  }
  return out;
}

export function engineerParts(tech: 1 | 2 | 3): PartDef[] {
  const hull: Shape[] = [
    // Schwebelinse: dunkler Spalt unter dem Kiel
    lens({ radius: 0.34, thickness: 0.12, length: 0.92, segments: 8, rings: 2, at: [0, 0.06, -0.02], mat: 'pitch', keep: true, tag: 'lens' }),
    // Kiel (Tropfen-Halbschale, teamfarbenes Seitenband)
    ellipsoid({ radii: KEEL.r, half: true, drop: KEEL.drop, segments: 10, rings: 2, at: [0, KEEL.y0 + KEEL.r[1] / 2, 0], mat: 'team', smooth: true, keep: true, tag: 'keel' }),
    // Perlglas-Rücken (Klassenkennung Engineer)
    ellipsoid({ radii: BACK.r, half: true, drop: BACK.drop, segments: 10, rings: 2, at: [0, BACK.y0 + BACK.r[1] / 2, BACK.z], mat: 'pearl', smooth: true, keep: true, tag: 'keel' }),
    // Kamm (team), 0,17 WU dick
    extrude({ profile: FIN, depth: 0.17, mat: 'team', keep: true, tag: 'fin' }),
    flankGlyphs(1),
    flankGlyphs(-1),
    ...dots(tech),
  ];
  for (let i = 1; i < tech; i++) hull.push(...sickleShapes(SICKLES[i]!, false));
  const parts: PartDef[] = [
    { name: 'hull', shapes: hull },
    {
      name: 'sickle',
      pivot: SICKLES[0]!.base,
      anim: 'yaw',
      shapes: tech === 3 ? [...sickleShapes(SICKLES[0]!, true), ...emitterShapes(SICKLES[0]!)] : sickleShapes(SICKLES[0]!, true),
    },
  ];
  if (tech !== 3) {
    parts.push({ name: 'emitter', parent: 'sickle', pivot: sickleCtrl(SICKLES[0]!)[3]!, anim: 'pitch', shapes: [group(emitterShapes(SICKLES[0]!))] });
  }
  return parts;
}

export default defineModel({
  id: 'f4:lnd_t1_engineer',
  hover: GLIDE_HEIGHT,
  parts: engineerParts(1),
  notes: 'Grundform v_eng (Chorist/Solist/Vorsänger); gleitet mit GLIDE_HEIGHT; Sichel-Yaw, Emitter-Pitch.',
});
