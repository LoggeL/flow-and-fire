/**
 * Karkinos (f3:exp_lnd_assault) – Riesen-Sturmläufer, Großschale (T4, Post-MVP).
 *
 * Roster/experimentals.md §3: flach gewölbter, teamfarbener Rückenschild mit Goldrand (6,4 × 5,2 WU, breiter als lang)
 * auf 10 spitzen Beinen (5 Paare, Knie über dem Schildrand, Beinspanne 8,4 WU); vorn zwei geschlossene Scherenschalen
 * (außen Teamfarbe, innen Perlmutt) auf kurzen Armen, aus jeder eine kurze Lanze; auf dem Schildscheitel die
 * teamfarbene Perle (Ø 1,5 WU) mit zwei parallelen Lanzen (3,6 WU, 1,2 WU über den Schildrand). Unterseite
 * Tiefjade-Bauchschale, zwei Tiefjade-Klammerbögen am hinteren Schildrand (Tech-Marker T4). Höhe 5,0 WU.
 * **Monopol:** Scherenschild. **Pflichtpaare:** Karkinos ↔ Einsiedler (Scheren + 10 Beine gegen gewundene Schale +
 * 8 Beine, Maßstab 3×), Karkinos ↔ Ammonit (Beine gegen Schwebeteller).
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`, Maße in WU). Die Registry liest seit dem Review 2026-09-29 auch `experimentals[]`
 * aus dem Roster (Abgleich von Icon und Footprint per Warnung); Name, Rolle, Klasse, Tech, Footprint und Icon stehen
 * trotzdem explizit im Modell.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Rückenschild (Team) mit Goldrand und Perlmutt-Scheitellage, Bauchschale (Tiefjade), Scherenarme,
 *            Scherenschalen (Team/Perlmutt) mit Scherenlanzen (Gold), Klammerbögen (Tiefjade), Lichtnaht
 *   legs_l – fünf linke Beine                                                  (PartStream 1, legs)
 *   legs_r – fünf rechte Beine                                                 (PartStream 2, legs)
 *   orb    – Scheitelperle (Team), dreht um +Y                                (PartStream 3, yaw)
 *   lance  – zwei parallele Tiefenlanzen, kippen (Pitch)                        (PartStream 4)
 */
import { arcPoints, cone, defineModel, ellipsoid, glyphStrip, legPairs, sphere, strut, sweep, type Shape, type Vec3 } from '@faf/modelkit';

const RX = 3.2; // Rückenschild: Breite 6,4 WU
const RZ = 2.6; // Länge 5,2 WU
const RIM_Y = 2.4; // Unterkante Rückenschild
const DOME_H = 1.25;
const TOP_Y = RIM_Y + DOME_H;
const ORB_R = 0.75; // Ø 1,5 WU
const ORB_Y = TOP_Y + 0.5;
const LANCE_LEN = 3.6;
const LANCE_TIP = RZ + 1.2; // ragt 1,2 WU über den Schildrand

/** Punkt und Normale auf der Rückenschild-Oberfläche (Halb-Ellipsoid) über (x, y). */
function onDome(x: number, y: number, back: 1 | -1): { p: Vec3; n: Vec3 } {
  const u = x / RX;
  const v = (y - RIM_Y) / DOME_H;
  const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  const p: Vec3 = [x, y, back * RZ * w];
  const n: Vec3 = [x / (RX * RX), (y - RIM_Y) / (DOME_H * DOME_H), (back * RZ * w) / (RZ * RZ)];
  const l = Math.hypot(n[0], n[1], n[2]);
  return { p, n: [n[0] / l, n[1] / l, n[2] / l] };
}

/** Tech-Marker T4: eckige Klammer („[“ links, „]“ rechts) als Tiefjade-Decal am hinteren Schildrand. */
function bracket(side: 1 | -1): Shape[] {
  const x0 = side * 0.75;
  const x1 = side * 1.2;
  const y0 = RIM_Y + 0.14;
  const y1 = RIM_Y + 0.62;
  const lines: [number, number, number, number][] = [
    [x0, y1, x1, y1],
    [x1, y1, x1, y0],
    [x1, y0, x0, y0],
  ];
  return lines.map(([ax, ay, bx, by]) => {
    const a = onDome(ax, ay, -1);
    const b = onDome(bx, by, -1);
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
    return glyphStrip({ path: [a.p, b.p], normal: [a.n, b.n], width: 0.2, pattern: [len + 0.1], widths: [1], lift: 0.05, mat: 'jade', maxLod: 1, tag: 'techmarker' });
  });
}

/** Goldrand: geschlossene Ellipse um den Schildfuß. */
const RIM_PATH: Vec3[] = arcPoints(1, 0, 360, 24, 'y').map(([x, , z]): Vec3 => [x * RX, RIM_Y + 0.04, z * RZ]);

/** Beine: Hüften unter dem Schildrand, mittlere Paare weiter außen (Krebsstand), Knie über dem Schildrand. */
const HIP_Z = [-1.8, -0.9, 0, 0.9, 1.8];
const HIPS: Vec3[] = HIP_Z.map((z): Vec3 => [0.82 * RX * Math.sqrt(1 - (z / RZ) ** 2), RIM_Y - 0.25, z]);
const LEG_OPTS = { hips: HIPS, footOut: 1.36, splay: 0.3, kneeAt: 0.35, kneeUp: 1.55, radius: [0.3, 0.24, 0] as number[] };
const legs = legPairs({ ...LEG_OPTS, sides: 4, mat: 'rind', maxLod: 0 });
const legsLow = legPairs({ ...LEG_OPTS, sides: 3, jointCaps: false, mat: 'rind', minLod: 1 });

/** Schere: Arm (Rinde), geschlossene Doppelschale (oben Team, unten Perlmutt), kurze Lanze. */
function claw(side: 1 | -1, lod: { readonly maxLod?: 0 | 1 | 2; readonly minLod?: 0 | 1 | 2 }, segs: number): Shape[] {
  const cx = side * 2.0;
  const cy = 1.9;
  const cz = 3.2;
  return [
    strut({ ...lod, from: [side * 1.45, RIM_Y - 0.15, 1.7], to: [cx * 0.97, cy, cz - 0.8], radius: 0.34, radiusEnd: 0.28, sides: 4, caps: false, mat: 'rind', tag: 'arm' }),
    ellipsoid({ ...lod, radii: [0.86, 0.62, 1.3], half: true, drop: 0.45, segments: segs, rings: 3, at: [cx, cy + 0.31, cz], rot: [0, -side * 8, 0], mat: 'enamel', smoothGroup: `claw${side}`, keep: true, tag: 'shell' }),
    ellipsoid({ ...lod, radii: [0.8, 0.42, 1.24], half: true, drop: 0.45, segments: segs, rings: 2, at: [cx, cy - 0.21, cz], rot: [180, side * 8, 0], mat: 'nacre', smoothGroup: `claw${side}`, keep: true, tag: 'shell' }),
    // Scherenlanze in Perlglanz wie beim Kauri (Review 2026-09-29: Gold nur als Kante, Ø 0,6 WU gegen Filigran)
    cone({ ...lod, radius: 0.3, height: 1.0, segments: 6, axis: 'z', at: [cx - side * 0.12, cy, cz + 1.0 + 0.2], mat: 'lustre', keep: true, tag: 'lance' }),
  ];
}

export default defineModel({
  id: 'f3:exp_lnd_assault',
  name: 'Karkinos',
  role: 'Riesen-Sturmläufer',
  class: 'land',
  tech: 4,
  footprint: [4, 4],
  icon: 'land_direct_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Rückenschild (Emaille, Teamfarbe): flach gewölbt, breiter als lang
        ellipsoid({ radii: [RX, DOME_H, RZ], half: true, segments: 18, rings: 4, at: [0, RIM_Y + DOME_H / 2, 0], mat: 'enamel', keep: true, tag: 'shell' }),
        // Perlmutt-Scheitellage: die oberste Schicht unter der Perle
        ellipsoid({ radii: [1.35, 0.42, 1.15], half: true, segments: 12, rings: 2, at: [0, TOP_Y - 0.08 + 0.21, -0.1], mat: 'nacre', maxLod: 1, tag: 'shell' }),
        // Goldrand am Schildfuß
        sweep({ path: RIM_PATH, radius: 0.085, sides: 4, caps: false, mat: 'gold', maxLod: 1, tag: 'rim' }),
        // Bauchschale (Tiefjade), flache Seite oben
        ellipsoid({ radii: [2.85, 0.75, 2.3], half: true, segments: 12, rings: 2, at: [0, RIM_Y - 0.375, 0], rot: [180, 0, 0], mat: 'jade', keep: true, tag: 'belly' }),
        // Scheren: LOD0 fein, LOD1/2 gröber
        ...claw(1, { maxLod: 0 }, 10),
        ...claw(-1, { maxLod: 0 }, 10),
        ...claw(1, { minLod: 1 }, 6),
        ...claw(-1, { minLod: 1 }, 6),
        // Tech-Marker T4: Klammerbögen am hinteren Schildrand
        ...bracket(1),
        ...bracket(-1),
        // Jade-Lichtnaht quer am Heck (≤ 2 %)
        glyphStrip({
          path: [-0.5, -0.25, 0, 0.25, 0.5].map((x) => onDome(x, RIM_Y + 0.95, -1).p),
          normal: [-0.5, -0.25, 0, 0.25, 0.5].map((x) => onDome(x, RIM_Y + 0.95, -1).n),
          width: 0.12,
          pattern: [0.3, -0.12],
          widths: [1],
          lift: 0.05,
          mat: 'seam',
          maxLod: 0,
          tag: 'seam',
        }),
      ],
    },
    { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', shapes: [legs.left, legsLow.left] },
    { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', shapes: [legs.right, legsLow.right] },
    {
      name: 'orb',
      pivot: [0, TOP_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Scheitelperle (Teamfarbe), Ø 1,5 WU
        sphere({ radius: ORB_R, segments: 12, rings: 6, at: [0, ORB_Y, 0], mat: 'enamel', keep: true, tag: 'orb' }),
      ],
    },
    {
      name: 'lance',
      parent: 'orb',
      pivot: [0, ORB_Y, 0.3],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Tiefenlanzen: zwei parallele Perlglanz-Kegel wie Triton/Einsiedler, waagerecht, Ø 0,6 WU an der Wurzel
        ...[0.36, -0.36].map((x) =>
          cone({ radius: 0.3, height: LANCE_LEN, segments: 6, axis: 'z', at: [x, ORB_Y - 0.08, LANCE_TIP - LANCE_LEN / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        ),
      ],
    },
  ],
  notes:
    'v_exp_karkinos: 10 Beine als zwei Parts (legs_l/legs_r, Gangart), Perlen-Yaw, Lanzen-Pitch (2 Waffen-Parts laut experimentals.md §2.4). Beinspanne 8,4 WU laut Roster (> 200 % des 4×4-Footprints).',
});
