/**
 * Pfeife (f4:lnd_t1_aa) – Aurith-Flugabwehrgleiter T1.
 *
 * Roster: „Kiel mit teamfarbener Kamm-Platte, darauf 2 senkrechte Pfeifen (≥ 75°) mit gestufter Länge quer zur
 * Fahrtrichtung.“
 * faction.md §5.2 Flugabwehr: 2–4 senkrechte Pfeifen mit gestufter Länge (Orgelprospekt) quer zur Fahrtrichtung auf
 * teamfarbener Kamm-Platte; Pfeifen höchstens halb so dick wie die Spindel; verboten Trichter, Gabel als Hauptmerkmal.
 * Winkel-Code: senkrecht = gegen Luft. Paartests: Triller↔Pfeife (waagerechte Zinken gegen senkrechte Pfeifen),
 * Posaune↔Pfeife (dünne senkrechte Pfeifen gegen dicke 50°-Spindel).
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull  – Kiel 1,2 × 0,84 WU (Bernstein, Oberschale Team), Rückenkamm, Glyphenbänder, 1 Tonpunkt
 *   plate – Drehfuß, Pfeifenplatte (Team, quer) mit zwei Pfeifen Ø 0,17 WU (0,86 / 0,62 WU, freistehend über der Platte), dreht um +Y (PartStream 1)
 */
import { cylinder, defineModel, extrude, GLIDE_HEIGHT, lens, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

export interface OrganPipe {
  /** Querposition (x). */
  readonly x: number;
  /** Oberkante. */
  readonly top: number;
  /** Radius (Ø ≥ 0,17 WU × Maßstab-Kehrwert). */
  readonly r: number;
}

/**
 * Orgelprospekt (Flugabwehr-Monopol): senkrechte Sechskant-Pfeifen (Bernstein-Kante) mit Pechglas-Fuß vor einer
 * querstehenden, teamfarbenen Kamm-Platte (`plate` = Umriss [x, y], `plateZ` = Plattenmitte, Dicke `depth`).
 */
export function organ(o: { pipes: readonly OrganPipe[]; base: number; z: number; plate: readonly Vec2[]; plateZ: number; depth?: number }): Shape[] {
  const shapes: Shape[] = [extrude({ profile: o.plate, depth: o.depth ?? 0.17, axis: 'z', at: [0, 0, o.plateZ], mat: 'team', keep: true, tag: 'fin' })];
  for (const p of o.pipes) {
    const h = p.top - o.base;
    shapes.push(
      cylinder({ radius: p.r, height: h, segments: 6, caps: 'top', at: [p.x, o.base + h / 2, o.z], mat: 'amberedge', keep: true, tag: 'pipe' }),
      // Pfeifenmund: dunkles Band im unteren Drittel (Labium)
      cylinder({ radius: p.r * 1.06, height: 0.07, segments: 6, caps: false, at: [p.x, o.base + h * 0.3, o.z], mat: 'pitch', maxLod: 0, tag: 'pipe' }),
    );
  }
  return shapes;
}

const K = keel({ len: 1.2, width: 0.84, height: 0.3, drop: 0.4, cap: { rx: 0.62, rz: 0.62, dz: -0.12 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP, 0.1];
const BASE = TOP - 0.02;

/** Pfeifenplatte (Vorderansicht x/y): reicht nur bis zur halben Pfeifenhöhe, damit die Pfeifen als Kamm frei stehen. */
const PLATE: Vec2[] = [
  [-0.34, BASE],
  [0.34, BASE],
  [0.34, BASE + 0.3],
  [0.2, BASE + 0.42],
  [0.02, BASE + 0.4],
  [-0.2, BASE + 0.32],
  [-0.34, BASE + 0.22],
];

/** Rückenkamm hinter der Platte, läuft über das Heck aus. */
const CREST: Vec2[] = [
  [-0.14, 0.4],
  [-0.34, 0.62],
  [-0.56, 0.74],
  [-0.76, 0.7],
  [-0.88, 0.54],
  [-0.74, 0.5],
  [-0.56, 0.28],
  [-0.3, 0.32],
];

export default defineModel({
  id: 'f4:lnd_t1_aa',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST), ...shellGlyphs(K.shape, { th1: 44 }), ...toneDots(1, { from: [-0.66, 0.6] })],
    },
    {
      name: 'plate',
      pivot: PIVOT,
      anim: 'yaw',
      shapes: [
        lens({ radius: 0.24, thickness: 0.12, segments: 8, rings: 2, at: PIVOT, mat: 'pitch', smooth: true, tag: 'lens' }),
        ...organ({
          base: BASE,
          z: PIVOT[2] + 0.1,
          plateZ: PIVOT[2] - 0.06,
          plate: PLATE,
          pipes: [
            { x: 0.15, top: BASE + 0.86, r: 0.085 },
            { x: -0.15, top: BASE + 0.62, r: 0.085 },
          ],
        }),
      ],
    },
  ],
  notes: 'v_aa: Pfeifenplatte-Yaw als einziger animierter Part; Pfeifen senkrecht (90°).',
});
