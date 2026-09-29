/**
 * Zecke (f2:lnd_t1_tank) – Skarn-Kampfläufer T1. **Referenz-Chassis aller Skarn-Landeinheiten.**
 *
 * Roster: „Flacher Keilpanzer 1,0 × 0,3 × 1,4 WU auf 4 Hochbeinen (Spanne ≈ 1,6 WU), waagerechte Granatlinse
 * (≈ 54 % der Rumpflänge) ragt über die Bugspitze; teamfarbene Rückenplatte ≈ 34 % inkl. Beine.“
 * faction.md §5.2 Direktfeuer Linie: Linse waagerecht auf kurzem Hals, ≥ 50 % der Rumpflänge, ragt über den Bug,
 * 4 Beine; verboten: Schwanz, senkrechte Dornen. §3.2: Keil mit Firstkante (Höhe ≤ 0,35 × Länge), Knie über der
 * Rumpfoberkante, Füße auf 1,4–1,8 × Rumpfbreite gespreizt, Beinglieder ≥ 0,17 WU. §3.4: 1 Tech-Streifen (Quarz)
 * im hinteren Panzerdrittel.
 *
 * Die übrigen Skarn-Landmodelle (lnd_*) bauen ihren Rumpf mit den hier exportierten Chassis-Helfern (`keel`,
 * `carapace`, `band`, `techStripes`, `skarnLegs`), damit Keil, Beine und Streifen über alle Rollen gleich bleiben.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Schwarzchitin), Rückenplatte mit Firstkante (Team), Heckplatte (Chitin), Tech-Streifen
 *   legs_l – zwei linke Knickbeine                                      (PartStream 1, legs)
 *   legs_r – zwei rechte Knickbeine                                     (PartStream 2, legs)
 *   neck   – kurzer Sehnenhals, dreht (Yaw)                             (PartStream 3)
 *   lens   – Granatlinse, waagerecht, kippt (Pitch)                     (PartStream 4)
 */
import { bipyramid, defineModel, flipX, legPairs, plate, spike, strut, sweep, type Section, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

// ---------------------------------------------------------------------------------------------------------------
// Skarn-Landchassis (geteilt von allen lnd_*-Modellen der Fraktion)

/** Obere Hälfte des Sechskant-Querschnitts mit Firstkante (u = seitlich, v = oben), wie beim Rädelsführer. */
export const UPPER: readonly Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
];
/** Untere Hälfte (flacher Bauch). */
export const LOWER: readonly Vec2[] = [
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
  [1, 0],
];
/** Nur die Deckfacetten um die Firstkante (Quarz-Deck der Engineers). */
export const DECK: readonly Vec2[] = [
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
];

export interface Keel {
  readonly path: readonly Vec3[];
  readonly radii: readonly Section[];
  /** Mittelebene (Naht zwischen Rücken und Bauch). */
  readonly y: number;
  readonly len: number;
  readonly width: number;
  /** Höhe der Firstkante über dem Boden. */
  readonly top: number;
  /** Unterkante des Bauchs. */
  readonly bottom: number;
  readonly rear: number;
  readonly bow: number;
}

export interface KeelOpts {
  /** Rumpflänge (z), -breite (x) und -höhe (y) in WU. */
  readonly len: number;
  readonly width: number;
  readonly height: number;
  /** Mittelebene über dem Boden. */
  readonly y: number;
  /** Versatz des Rumpfs nach vorn (z), Standard 0. */
  readonly z?: number;
  /** Anteil der Breite am Heck, Standard 0,72. */
  readonly rearW?: number;
  /** Lage der breitesten Stelle (0 = Heck, 1 = Bug), Standard 0,3. */
  readonly waist?: number;
}

/** Keilpanzer: Sechskant-Querschnitt mit Firstkante, breiteste Stelle hinten, Bugspitze vorn. */
export function keel(o: KeelOpts): Keel {
  const z0 = o.z ?? 0;
  const w = o.width / 2;
  const ry = o.height / 1.7; // UPPER reicht bis v = 1, LOWER bis v = -0,7
  const rear = z0 - o.len / 2;
  const bow = z0 + o.len / 2;
  const waist = rear + o.len * (o.waist ?? 0.3);
  const shoulder = rear + o.len * 0.68;
  const rw = o.rearW ?? 0.72;
  return {
    path: [
      [0, o.y, rear],
      [0, o.y, waist],
      [0, o.y, shoulder],
      [0, o.y, bow],
    ],
    radii: [
      [w * rw, ry * 0.72],
      [w, ry],
      [w * 0.86, ry * 0.9],
      [w * 0.08, ry * 0.22],
    ],
    y: o.y,
    len: o.len,
    width: o.width,
    top: o.y + ry,
    bottom: o.y - 0.7 * ry,
    rear,
    bow,
  };
}

/** Querschnitt des Keils an der Stelle z (linear zwischen den Stützstellen, wie die Facetten). */
export function sectionAt(k: Keel, z: number): Section {
  const p = k.path;
  for (let i = 0; i + 1 < p.length; i++) {
    const za = p[i]![2];
    const zb = p[i + 1]![2];
    if (z <= zb || i + 2 === p.length) {
      const t = Math.min(1, Math.max(0, (z - za) / (zb - za)));
      const a = k.radii[i]!;
      const b = k.radii[i + 1]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return k.radii[0]!;
}

/** Höhe der Firstkante an der Stelle z. */
export function ridgeAt(k: Keel, z: number): number {
  return k.y + sectionAt(k, z)[1];
}

/**
 * Panzer: Bauchschale (Chitin) + Rückenplatte (Standard Teamfarbe) aus demselben Keil; LOD2 ein Keil aus drei
 * Querschnitten ohne Bauch und ohne Bugdeckel (von oben und schräg reicht der Rücken).
 */
export function carapace(k: Keel, topMat = 'team'): Shape[] {
  const p = k.path;
  const r = k.radii;
  return [
    sweep({ path: p, radius: r, profile: LOWER, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
    sweep({ path: p, radius: r, profile: UPPER, mat: topMat, keep: true, maxLod: 1, tag: 'carapace' }),
    sweep({ path: [p[0]!, p[1]!, p[3]!], radius: [r[0]!, r[1]!, r[3]!], profile: UPPER, caps: 'start', mat: topMat, keep: true, minLod: 2, tag: 'carapace' }),
  ];
}

/** Querband über den Rücken (Tech-Streifen, Seitenband): einseitige Fläche knapp über den Facetten. */
export function band(k: Keel, z: number, depth: number, mat: string, profile: readonly Vec2[] = UPPER, lift = 0.008, maxLod: 0 | 1 | 2 = 2): Shape {
  const a = sectionAt(k, z - depth / 2);
  const b = sectionAt(k, z + depth / 2);
  return sweep({
    path: [
      [0, k.y, z - depth / 2],
      [0, k.y, z + depth / 2],
    ],
    radius: [
      [a[0] + lift, a[1] + lift],
      [b[0] + lift, b[1] + lift],
    ],
    profile,
    open: true,
    mat,
    keep: true,
    maxLod,
    tag: 'stripe',
  });
}

/**
 * 1–3 Tech-Streifen (0,10 WU breit, 0,10 WU Abstand) im hinteren Panzerdrittel, quer über die Deckfacetten an der
 * Firstkante (die Flanken bleiben Teamfarbe); bei kurzen Rümpfen rücken sie vom Heck (0,05 WU Rand) nach vorn. Nur
 * LOD0/1 (in LOD2 übernimmt das Icon die Tech-Kerben).
 */
export function techStripes(k: Keel, count: number, mat = 'quartz', profile: readonly Vec2[] = DECK): Shape[] {
  const out: Shape[] = [];
  const last = Math.max(k.rear + 0.1, k.rear + k.len / 3 - 0.05 - 0.2 * (count - 1));
  for (let i = 0; i < count; i++) out.push(band(k, last + i * 0.2, 0.1, mat, profile, 0.008, 1));
  return out;
}

export interface SkarnLegOpts {
  /** Hüften der linken Seite (+X), rechts gespiegelt. */
  readonly hips: readonly Vec3[];
  readonly footOut: number;
  readonly splay?: number;
  /** Lage des Knies zwischen Hüfte und Fuß, Standard 0,5 (Spinnenknie). */
  readonly kneeAt?: number;
  /** Kniehöhe über dem Boden (WU), muss über der Firstkante liegen. */
  readonly kneeY: number;
  /** Radius an Hüfte/Knie (4-Kant ≥ 0,12 ⇒ Kantenbreite ≥ 0,17 WU). */
  readonly radius?: readonly [number, number];
  /** LOD2: `knee` = dreikantiges Knickbein (Standard), `straight` = ein dreikantiger Dorn Knie→Fuß (6-Beiner). */
  readonly lod2?: 'knee' | 'straight';
}

/**
 * Knickbeine: LOD0 vierkantig mit Kniedeckeln, LOD1 dreikantig ohne Kniedeckel, LOD2 ebenso oder (`straight`) nur das
 * untere Glied als dreikantiger Dorn vom Knie zum Fuß.
 */
export function skarnLegs(o: SkarnLegOpts): { left: Shape[]; right: Shape[]; pivotL: Vec3; pivotR: Vec3; joints: readonly (readonly [Vec3, Vec3, Vec3])[] } {
  const [r0, r1] = o.radius ?? [0.12, 0.11];
  const kneeAt = o.kneeAt ?? 0.5;
  const hipY = o.hips[0]![1];
  const base = {
    hips: o.hips,
    footOut: o.footOut,
    splay: o.splay ?? 0.8,
    kneeAt,
    kneeUp: o.kneeY - hipY * (1 - kneeAt),
    radius: [r0, r1, 0],
    hipCap: false,
    mat: 'chitin',
    keep: true,
    tag: 'legs',
  } as const;
  const hi = legPairs({ ...base, sides: 4, maxLod: 0 });
  if (o.lod2 === 'straight') {
    const mid = legPairs({ ...base, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 });
    const far = hi.joints.map(([, knee, foot]) => spike({ from: knee, to: foot, radius: r1 * 1.1, sides: 3, mat: 'chitin', keep: true, minLod: 2, tag: 'legs' }));
    return { left: [hi.left, mid.left, ...far], right: [hi.right, mid.right, flipX(far)], pivotL: hi.pivotL, pivotR: hi.pivotR, joints: hi.joints };
  }
  const lo = legPairs({ ...base, sides: 3, jointCaps: false, minLod: 1 });
  return { left: [hi.left, lo.left], right: [hi.right, lo.right], pivotL: hi.pivotL, pivotR: hi.pivotR, joints: hi.joints };
}

/** Granatlinse (4-seitige Doppelpyramide, dunkles Granatglas), waagerecht; `radius` ≥ 0,17 ⇒ ≥ 0,25 WU dick. */
export function garnetLens(at: Vec3, length: number, radius = 0.17, front = 0.62): Shape {
  return bipyramid({ radius, length, front, sides: 4, at, mat: 'garnet', keep: true, tag: 'lens' });
}

// ---------------------------------------------------------------------------------------------------------------
// Zecke

const K = keel({ len: 1.4, width: 1.0, height: 0.3, y: 0.5 });
const LEGS = skarnLegs({
  hips: [
    [0.34, K.y - 0.02, 0.26],
    [0.34, K.y - 0.02, -0.28],
  ],
  footOut: 0.46, // Spanne 2 × 0,80 = 1,6 WU = 1,6 × Rumpfbreite
  splay: 0.9,
  kneeY: 0.8, // über der Firstkante (0,68)
});
const NECK_Z = 0.22;
const LENS_Y = K.top + 0.1;

export default defineModel({
  id: 'f2:lnd_t1_tank',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...carapace(K),
        // Heckplatte: Chitinschild, der das Heck schuppenartig überlappt
        plate({ size: [0.58, 0.26], thickness: 0.06, arch: 0.05, segments: [2, 1], at: [0, K.y + 0.1, K.rear + 0.06], rot: [-14, 0, 0], mat: 'chitin', maxLod: 1, tag: 'carapace' }),
        ...techStripes(K, 1),
      ],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'neck',
      pivot: [0, K.top, NECK_Z],
      anim: 'yaw',
      shapes: [strut({ from: [0, K.top - 0.08, NECK_Z - 0.08], to: [0, LENS_Y, NECK_Z + 0.12], radius: 0.12, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' })],
    },
    {
      name: 'lens',
      parent: 'neck',
      pivot: [0, LENS_Y, NECK_Z + 0.1],
      anim: 'pitch',
      // Linse 0,76 WU = 54 % der Rumpflänge, Spitze 0,46 WU vor der Bugspitze
      shapes: [garnetLens([0, LENS_Y, 0.78], 0.76)],
    },
  ],
  notes: 'v_tank: Beine als zwei Parts (legs_l/legs_r, Render-Pfad ersetzt sie später), Hals-Yaw, Linsen-Pitch.',
});
