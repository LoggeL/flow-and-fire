/**
 * Triller (f4:lnd_t1_tank) – Aurith-Kampfgleiter T1. **Referenz für alle Aurith-Gleiter** (exportiert die Bausteine
 * Kiel, Kamm, Glyphenbänder, Tonpunkte und Gabel, die die übrigen Gleiter importieren).
 *
 * Roster: „Schlanker Kiel 0,9 × 0,5 × 1,4 WU, 0,25 WU über dem Boden; waagerechte Gabel (Zinken Ø 0,17, Länge 0,9 WU
 * ≈ 65 % der Kiellänge) über die Kielspitze; Kamm 0,8 WU hoch, 1 Tonpunkt.“
 * faction.md §5.2 Direktfeuer-Gleiter: Gabel mit waagerechten Zinken auf dem Kiel, Zinken ≥ 60 % der Kiellänge, ragen
 * über die Kielspitze; kein Kristall. §3.2: Kiel statt Wanne (Gleiter schweben GLIDE_HEIGHT über dem Boden), Kurve =
 * Körper, Gerade = Waffe, Höhe ≥ 0,6 × Rumpflänge, der Kamm trägt die Höhe und läuft nach hinten aus.
 * §4.2: Teamfarbe auf Rückenkamm und Oberschale (≥ 30 % der Draufsicht); Glyphenbänder ≤ 3 %; 1 Tonpunkt Perlglas.
 *
 * Kiel 1,30 × 0,80 WU (etwas kürzer als im Roster, damit der Heuler bei gleicher Form ×1,3 größer bleibt und trotzdem
 * im 1×1-Footprint-Check liegt), Zinken 0,92 WU = 71 % der Kiellänge, 0,35 WU über die Kielspitze.
 *
 * Aufbau (y = Boden, +Z = Bug; der Build hebt alles um GLIDE_HEIGHT an):
 *   hull – Kiel-Unterseite (Pechglas, dunkel), Bernstein-Schale (weich), Oberschale (Team), Rückenkamm (Team),
 *          Glyphenbänder, Tonpunkt
 *   fork – Drehfuß (Pechglas) mit Gabel aus zwei geraden Zinken und Steg, dreht um +Y (PartStream 1)
 */
import { box, cylinder, defineModel, ellipsoid, extrude, glyphStrip, GLIDE_HEIGHT, lens, type Lod, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

// ---------------------------------------------------------------------------------------------------------------
// Gemeinsame Gleiter-Bausteine (von allen Aurith-Gleitern importiert)

/** Höhe der Schalen-Unterkante über dem Boden (darunter die dunkle Kiel-Linse). */
export const BELLY = 0.1;

export interface KeelOpts {
  /** Kiellänge (z). */
  readonly len: number;
  /** Kielbreite (x). */
  readonly width: number;
  /** Schalenhöhe über BELLY. */
  readonly height: number;
  /** Tropfenform: der Bug wird schmaler (0 = Ellipse). */
  readonly drop?: number;
  /** Mittelpunkt des Kiels in z. */
  readonly z?: number;
  /** Material der Schale (Gleiter Bernstein, Engineers Perlglas-Rücken). */
  readonly shellMat?: string;
  /** Oberschale (Teamfarbe) als Anteil der Schalenradien [x, z] und ihre z-Verschiebung; `false` = keine. */
  readonly cap?: false | { readonly rx: number; readonly rz: number; readonly dz?: number; readonly mat?: string };
  readonly segments?: number;
}

/** Radien und Mittelpunkt der Bernstein-Schale (für Glyphenbänder, Aufsätze). */
export interface KeelShape {
  readonly radii: Vec3;
  /** Mittelpunkt der Grundfläche (y = BELLY). */
  readonly base: Vec3;
  readonly drop: number;
  /** Oberkante der Schale in der Mitte. */
  readonly top: number;
  /** Oberkante der Oberschale. */
  readonly capTop: number;
}

/** Kiel eines Gleiters: dunkle Linse als Schwebespalt-Unterseite, weiche Bernstein-Schale, teamfarbene Oberschale. */
export function keel(o: KeelOpts): { shapes: Shape[]; shape: KeelShape } {
  const z = o.z ?? 0;
  const drop = o.drop ?? 0.35;
  const rx = o.width / 2;
  const rz = o.len / 2;
  const h = o.height;
  const segs = o.segments ?? 10;
  const shapes: Shape[] = [
    // Kiel-Unterseite: flache Pechglas-Linse, trägt den dunklen Schwebespalt
    lens({ radius: rx * 0.86, thickness: 0.2, length: o.len * 0.9, segments: 8, rings: 2, at: [0, 0.1, z], mat: 'dark', keep: true, tag: 'lens' }),
    // Schale (Bernsteinglas, weich)
    ellipsoid({ radii: [rx, h, rz], half: true, drop, segments: segs, rings: 3, at: [0, BELLY + h / 2, z], mat: o.shellMat ?? 'amber', smooth: true, keep: true, tag: 'keel' }),
  ];
  let capTop = BELLY + h;
  if (o.cap !== false) {
    const c = o.cap ?? { rx: 0.62, rz: 0.62 };
    const ch = h * 0.42;
    const y0 = BELLY + h * 0.72;
    capTop = y0 + ch;
    shapes.push(
      ellipsoid({
        radii: [rx * c.rx, ch, rz * c.rz],
        half: true,
        drop: drop * 0.6,
        segments: 8,
        rings: 2,
        at: [0, y0 + ch / 2, z + (c.dz ?? -0.08) * o.len],
        mat: c.mat ?? 'team',
        smooth: true,
        keep: true,
        tag: 'lens',
      }),
    );
  }
  return { shapes, shape: { radii: [rx, h, rz], base: [0, BELLY, z], drop, top: BELLY + h, capTop } };
}

/** Punkt und Normale auf der Schale: `phi` = Winkel vom Scheitel (Grad), `th` = Umlaufwinkel (0 = +X, 90 = Bug). */
export function onShell(k: KeelShape, phiDeg: number, thDeg: number): { p: Vec3; n: Vec3 } {
  const [rx, ry, rz] = k.radii;
  const phi = (phiDeg * Math.PI) / 180;
  const th = (thDeg * Math.PI) / 180;
  const s = Math.sin(phi);
  const zl = rz * s * Math.sin(th);
  const xl = rx * s * Math.cos(th) * (1 - k.drop * Math.max(0, zl / rz));
  const yl = ry * Math.cos(phi);
  const n: Vec3 = [xl / (rx * rx), yl / (ry * ry), zl / (rz * rz)];
  const l = Math.hypot(n[0], n[1], n[2]);
  return { p: [k.base[0] + xl, k.base[1] + yl, k.base[2] + zl], n: [n[0] / l, n[1] / l, n[2] / l] };
}

/** Glyphenband (phasenblau, `glyph`) auf beiden Schalenflanken entlang der Breite `phi` von `th0` (Heck) bis `th1`. */
export function shellGlyphs(k: KeelShape, o: { phi?: number; th0?: number; th1?: number; width?: number; pattern?: number[] } = {}): Shape[] {
  const out: Shape[] = [];
  const th0 = o.th0 ?? -62;
  const th1 = o.th1 ?? 48;
  for (const side of [1, -1] as const) {
    const pts: Vec3[] = [];
    const ns: Vec3[] = [];
    for (let i = 0; i <= 6; i++) {
      const th = th0 + ((th1 - th0) * i) / 6;
      const q = onShell(k, o.phi ?? 58, side === 1 ? th : 180 - th);
      pts.push(q.p);
      ns.push(q.n);
    }
    out.push(
      glyphStrip({
        path: pts,
        normal: ns,
        width: o.width ?? 0.06,
        pattern: o.pattern ?? [0.2, -0.07, 0.07, -0.06, 0.3, -0.1, 0.1, -0.06],
        lift: 0.012,
        mat: 'glyph',
        maxLod: 0,
        tag: 'glyphs',
      }),
    );
  }
  return out;
}

/**
 * Rückenkamm (Teamfarbe): Seitenprofil [z, y], `depth` dick (≥ 0,17 WU), bei `x` (Doppelkamm: zweimal mit ±x).
 * LOD2 mit vereinfachtem Profil (jede zweite Ecke).
 */
export function crest(profile: readonly Vec2[], o: { depth?: number; x?: number; mat?: string } = {}): Shape[] {
  const depth = o.depth ?? 0.18;
  const at: Vec3 = [o.x ?? 0, 0, 0];
  const far = profile.filter((_, i) => i % 2 === 0);
  return [
    extrude({ profile, depth, at, mat: o.mat ?? 'team', keep: true, maxLod: 1, tag: 'fin' }),
    extrude({ profile: far, depth, at, mat: o.mat ?? 'team', keep: true, minLod: 2, tag: 'fin' }),
  ];
}

/**
 * Tonpunkte (Tech 1–3, faction.md §3.4): Ø 0,12 WU, Abstand 0,08 WU, in einer Reihe auf beiden Kammflanken
 * (Kammdicke `depth`; `flanks` wählt beim Doppelkamm nur die Außenseite), Reihe beginnt bei `from` und läuft in
 * Richtung `dir` [dz, dy]. Perlglas, bei Engineers Pechglas. Ab LOD2 entfallen sie (zu klein).
 */
export function toneDots(
  count: number,
  o: { from: Vec2; dir?: Vec2; depth?: number; x?: number; mat?: string; size?: number; flanks?: readonly (1 | -1)[] },
): Shape[] {
  const size = o.size ?? 0.12;
  const gap = 0.08 * (size / 0.12);
  const [dz, dy] = o.dir ?? [-1, 0];
  const l = Math.hypot(dz, dy);
  const len = count * size + (count - 1) * gap;
  const out: Shape[] = [];
  for (const side of o.flanks ?? ([1, -1] as const)) {
    const cx = (o.x ?? 0) + side * ((o.depth ?? 0.18) / 2);
    out.push(
      glyphStrip({
        path: [
          [cx, o.from[1], o.from[0]],
          [cx, o.from[1] + (dy / l) * len, o.from[0] + (dz / l) * len],
        ],
        normal: [side, 0, 0],
        width: size,
        pattern: [size, -gap],
        widths: [1],
        lift: 0.006,
        mat: o.mat ?? 'pearl',
        maxLod: 1,
        tag: 'tonepoints',
      }),
    );
  }
  return out;
}

/**
 * Gabel (Direktfeuer, faction.md §5.2): zwei gerade, parallele Sechskant-Zinken (Radius `r`, Ø ≥ 0,17 WU) mit Steg,
 * von `z0` nach vorn `len` lang, Zinkenmitten bei ±gap/2. Zinken Bernstein-Kante, Steg Pechglas.
 */
export function forkTines(o: { y: number; z0: number; len: number; gap: number; r?: number; bridge?: number; mat?: string; bridgeMaxLod?: Lod }): Shape[] {
  const r = o.r ?? 0.085;
  const bridge = o.bridge ?? 0.12;
  return [
    cylinder({ radius: r, height: o.len, segments: 6, axis: 'z', caps: 'top', at: [o.gap / 2, o.y, o.z0 + o.len / 2], mat: o.mat ?? 'amberedge', keep: true, tag: 'fork' }),
    cylinder({ radius: r, height: o.len, segments: 6, axis: 'z', caps: 'top', at: [-o.gap / 2, o.y, o.z0 + o.len / 2], mat: o.mat ?? 'amberedge', keep: true, tag: 'fork' }),
    box({ size: [o.gap + 2 * r, r * 1.3, bridge], at: [0, o.y, o.z0 + bridge / 2], mat: 'pitch', keep: true, ...(o.bridgeMaxLod === undefined ? {} : { maxLod: o.bridgeMaxLod }), tag: 'fork' }),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Triller

const K = keel({ len: 1.3, width: 0.84, height: 0.32, drop: 0.45, cap: { rx: 0.64, rz: 0.66, dz: -0.1 } });
const TURRET_Z = 0.16;
const TURRET_Y = K.shape.capTop;
const FORK_Y = TURRET_Y + 0.06;

/** Rückenkamm (Seitenprofil z/y): steigt hinter dem Drehfuß auf, Spitze hinten, Schweif hängt über das Heck. */
const CREST: Vec2[] = [
  [-0.04, 0.38],
  [-0.2, 0.56],
  [-0.4, 0.76],
  [-0.6, 0.87],
  [-0.8, 0.84],
  [-0.95, 0.68],
  [-0.83, 0.62],
  [-0.68, 0.5],
  [-0.52, 0.27],
  [-0.2, 0.33],
];

export default defineModel({
  id: 'f4:lnd_t1_tank',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        ...crest(CREST),
        ...shellGlyphs(K.shape),
        ...toneDots(1, { from: [-0.72, 0.72] }),
      ],
    },
    {
      name: 'fork',
      pivot: [0, TURRET_Y, TURRET_Z],
      anim: 'yaw',
      shapes: [
        // Drehfuß: flache Pechglas-Linse auf der Oberschale
        lens({ radius: 0.22, thickness: 0.14, segments: 8, rings: 2, at: [0, TURRET_Y, TURRET_Z], mat: 'pitch', smooth: true, tag: 'lens' }),
        // Gabel: Zinken 0,92 WU, ragen 0,35 WU über die Kielspitze (z = 0,65)
        ...forkTines({ y: FORK_Y, z0: 0.08, len: 0.92, gap: 0.27 }),
      ],
    },
  ],
  notes: 'v_tank: Gleiter-Referenz (Bausteine exportiert). Gabel-Yaw als einziger animierter Part.',
});
