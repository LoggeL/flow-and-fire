/**
 * Bärenklau (f2:exp_lnd_arty) – Experimentelle Schnellfeuer-Artillerie, Plage und Game-Ender (T4, Post-MVP).
 *
 * Roster/experimentals.md §6: breiter Keilrumpf auf 8 gespreizten Beinen, hinten zwei Ankersporne (klappen beim Wurzeln
 * in den Boden); aus dem Rücken wächst ein doppelt gegliederter Riesenschwanz (teamfarben) bis 10,5 WU Höhe, an der
 * Spitze die Dolde: 12 Kapseln radial auf einem flachen Schirm (Ø 4 WU), schräg nach vorn (50°). Maße 8,5 × 5,5 × 10,5 WU,
 * Beinspanne 9 WU, Footprint 6 × 8.
 * **Monopol:** Dolde. **Verboten:** Linse, alles Waagerechte. **Pflichtpaare:** Bärenklau ↔ Stechapfel (eine Kapsel,
 * 6 Beine), Bärenklau ↔ Bilsenkraut (auf Kruste, statisch): Dolde gegen Einzelkapsel, höchster Umriss des Rosters.
 * **Tech-Marker:** zwei quarzweiße Klammer-Winkel an den vorderen Rumpfecken. Keine Glut (Artillerie, keine Flow-Einheit;
 * das Aufglühen der Dolde vor der Salve ist reine View-Animation).
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`). Die Registry liest die Roster-Vorgaben auch aus
 * `experimentals[]`; Name, Rolle, Klasse, Tech, Footprint und Icon stehen zusätzlich im Modell (identisch zum Roster).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Keilrumpf (Rückenpanzer Team mit Firstkante, Bauch Schwarzchitin), Klammer-Winkel
 *   legs_l – vier linke Beine                                                       (PartStream 1, legs)
 *   legs_r – vier rechte Beine                                                      (PartStream 2, legs)
 *   anchor – zwei Ankersporne hinten, klappen beim Wurzeln nach unten (Pitch, Roster-Anim „deploy“) (PartStream 3)
 *   neck   – Schwanzansatz auf dem Rücken, Yaw                                      (PartStream 4)
 *   tail_0 – untere Gliederkette des Schwanzes, Pitch                               (PartStream 5)
 *   tail_1 – obere Gliederkette mit Dolde (Schirm Team, 12 Kapseln Sehne), Pitch    (PartStream 6)
 */
import { crystal, defineModel, extrude, limb, prism, strut, sweep, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 1.55; // Mittelebene des Rumpfs

// Keilrumpf: Sechskant mit Firstkante, breit, Bugspitze vorn (Höhe ≤ 0,35 × Länge)
const KEEL_PATH: Vec3[] = [
  [0, BODY_Y, -3.0],
  [0, BODY_Y, -1.2],
  [0, BODY_Y, 1.4],
  [0, BODY_Y - 0.05, 3.55],
];
const KEEL_R: [number, number][] = [
  [1.75, 0.55],
  [2.2, 0.72],
  [2.0, 0.66],
  [0.3, 0.2],
];
const UPPER: Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
];
const LOWER: Vec2[] = [
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
  [1, 0],
];

// Beine: vier Paare, gespreizt (Spanne 9 WU), Knie über der Rumpfoberkante
const LEG_Z = [1.95, 0.65, -0.65, -1.95];
const LEG_R = [0.45, 0.36, 0.12] as const;
const LEG_JOINTS = LEG_Z.map((z): [Vec3, Vec3, Vec3] => [
  [1.55, BODY_Y - 0.25, z],
  [2.85, 2.75, z * 1.1],
  [4.38, 0.08, z * 1.45],
]);
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
function legSet(side: 1 | -1): Shape[] {
  const out: Shape[] = [];
  for (const j of LEG_JOINTS) {
    const joints = side === 1 ? j : (j.map(mirror) as [Vec3, Vec3, Vec3]);
    out.push(limb({ joints, radius: [...LEG_R], sides: 4, hipCap: false, mat: 'chitin', keep: true, maxLod: 0, tag: 'legs' }));
    out.push(limb({ joints, radius: [...LEG_R], sides: 3, hipCap: false, jointCaps: false, mat: 'chitin', keep: true, minLod: 1, maxLod: 1, tag: 'legs' }));
    out.push(strut({ from: joints[1], to: joints[2], radius: 0.38, radiusEnd: 0.12, sides: 3, caps: false, mat: 'chitin', keep: true, minLod: 2 }));
  }
  return out;
}

// Ankersporne: flache Keile hinten, im Marsch schräg nach hinten unten, beim Wurzeln in den Boden
const ANCHOR_HINGE: Vec3 = [0, BODY_Y - 0.05, -2.75];
const SPUR_PROFILE: Vec2[] = [
  [1, 0],
  [0, 0.6],
  [-1, 0],
  [0, -0.6],
];
function spur(side: 1 | -1): Shape {
  return sweep({
    path: [
      [side * 1.15, BODY_Y - 0.02, -2.6],
      [side * 1.35, BODY_Y - 0.35, -3.6],
      [side * 1.5, 0.45, -4.25],
    ],
    radius: [
      [0.62, 0.4],
      [0.42, 0.3],
      [0.06, 0.05],
    ],
    profile: SPUR_PROFILE,
    mat: 'chitin',
    keep: true,
    tag: 'carapace',
  });
}

// Schwanzansatz (Hals) und doppelte Gliederkette
const NECK_BASE: Vec3 = [0, BODY_Y + 0.55, -1.55];
const T0: Vec3[] = [
  [0, BODY_Y + 0.9, -1.7],
  [0, 3.3, -2.05],
  [0, 4.25, -2.25],
  [0, 5.2, -2.3],
  [0, 6.05, -2.15],
];
const T1: Vec3[] = [
  [0, 6.05, -2.15],
  [0, 6.85, -1.8],
  [0, 7.45, -1.25],
  [0, 7.85, -0.62],
];
/** Gliederung: breit–schmal im Wechsel (Keilsegmente als ein Mesh), Querschnitt Sechskant mit Firstkante. */
const T0_R: [number, number][] = [
  [0.8, 0.72],
  [0.58, 0.54],
  [0.74, 0.68],
  [0.52, 0.5],
  [0.62, 0.58],
];
const T1_R: [number, number][] = [
  [0.7, 0.66],
  [0.52, 0.5],
  [0.64, 0.6],
  [0.44, 0.42],
];
const TAIL_PROFILE: Vec2[] = [
  [1, 0],
  [0.5, 0.85],
  [-0.5, 0.85],
  [-1, 0],
  [-0.5, -0.85],
  [0.5, -0.85],
];

// Dolde: flacher Schirm (Ø 4 WU) an der Schwanzspitze, 50° nach vorn geneigt, 12 Kapseln radial
const UMBEL_TILT = 50;
const UMBEL_C: Vec3 = [0, 8.3, 0.1];
const UMBEL_R = 2.0;
/** Punkt im Schirm-Rahmen (u = quer, v = in der Schirmebene nach vorn/unten, w = Schirmnormale) → Modellraum. */
function umbelPoint(u: number, v: number, w: number): Vec3 {
  const t = (UMBEL_TILT * Math.PI) / 180;
  // Schirmnormale (0, cos t, sin t), Ebenenrichtung (0, −sin t, cos t)
  return [UMBEL_C[0] + u, UMBEL_C[1] + w * Math.cos(t) - v * Math.sin(t), UMBEL_C[2] + w * Math.sin(t) + v * Math.cos(t)];
}
function umbel(): Shape[] {
  const out: Shape[] = [
    // Schirm: flaches Sechseck (Team), zentriert auf der Schirmebene
    prism({ sides: 6, radius: 1.35, height: 0.22, at: umbelPoint(0, 0, 0), rot: [UMBEL_TILT, 0, 0], mat: 'team', keep: true, tag: 'pod' }),
    // Nabe unter dem Schirm, verbindet mit der Schwanzspitze
    strut({ from: T1[T1.length - 1]!, to: umbelPoint(0, 0, -0.05), radius: 0.36, radiusEnd: 0.4, sides: 4, mat: 'sinew', keep: true, tag: 'tail' }),
  ];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 2 * Math.PI + Math.PI / 12;
    const r = k % 2 === 0 ? UMBEL_R - 0.35 : UMBEL_R - 0.55;
    const u = Math.sin(a) * r;
    const v = Math.cos(a) * r;
    const h = k % 2 === 0 ? 0.95 : 0.8;
    // Strahl vom Schirm zur Kapsel (Sehne), Kapsel = vierkantiger Kristall entlang der Schirmnormale, leicht nach außen
    out.push(strut({ from: umbelPoint(u * 0.45, v * 0.45, 0.06), to: umbelPoint(u, v, 0.18), radius: 0.16, sides: 3, caps: false, mat: 'sinew', maxLod: 0, tag: 'pod' }));
    const base = umbelPoint(u, v, 0.18);
    const tipDir = umbelPoint(u * 1.18, v * 1.18, 0.18 + h);
    const mid: Vec3 = [(base[0] + tipDir[0]) / 2, (base[1] + tipDir[1]) / 2, (base[2] + tipDir[2]) / 2];
    const lean = (Math.atan2(r * 0.18, h) * 180) / Math.PI;
    out.push(
      crystal({
        radius: 0.3,
        height: h * 0.72,
        tip: h * 0.34,
        sides: 4,
        at: mid,
        // Kapselachse: Schirmnormale, radial nach außen gekippt
        rot: [UMBEL_TILT + Math.cos(a) * lean, 0, -Math.sin(a) * lean],
        mat: 'sinew',
        keep: true,
        maxLod: 1,
        tag: 'pod',
      }),
    );
    // LOD2: jede zweite Kapsel als einfacher Dorn
    if (k % 2 === 0) out.push(strut({ from: base, to: tipDir, radius: 0.34, radiusEnd: 0, sides: 3, caps: false, mat: 'sinew', keep: true, minLod: 2 }));
  }
  return out;
}

/** Klammer-Winkel (Quarz) an einer vorderen Rumpfecke: flaches L auf der Panzerschräge. */
function bracket(side: 1 | -1): Shape {
  const w = 0.24;
  const profile: Vec2[] = [
    [0, 0],
    [0, 0.8],
    [-side * 0.65, 0.8],
    [-side * 0.65, 0.8 - w],
    [-side * w, 0.8 - w],
    [-side * w, 0],
  ];
  return extrude({
    profile: side === 1 ? profile : profile.slice().reverse(),
    depth: 0.05,
    axis: 'y',
    at: [side * 1.38, BODY_Y + 0.36, 1.75],
    rot: [0, 0, side * -34],
    mat: 'quartz',
    keep: true,
    maxLod: 1,
    tag: 'techmarker',
  });
}

export default defineModel({
  id: 'f2:exp_lnd_arty',
  name: 'Bärenklau',
  role: 'Experimentelle Schnellfeuer-Artillerie',
  class: 'land',
  tech: 4,
  footprint: [6, 8],
  icon: 'land_arty_t4',
  parts: [
    {
      name: 'hull',
      shapes: [
        sweep({ path: KEEL_PATH, radius: KEEL_R, profile: UPPER, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: KEEL_PATH, radius: KEEL_R, profile: LOWER, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        bracket(1),
        bracket(-1),
      ],
    },
    { name: 'legs_l', pivot: [1.55, BODY_Y - 0.25, 0], anim: 'legs', shapes: legSet(1) },
    { name: 'legs_r', pivot: [-1.55, BODY_Y - 0.25, 0], anim: 'legs', shapes: legSet(-1) },
    { name: 'anchor', pivot: ANCHOR_HINGE, anim: 'pitch', shapes: [spur(1), spur(-1)] },
    {
      name: 'neck',
      pivot: NECK_BASE,
      anim: 'yaw',
      shapes: [
        // Schwanzansatz: kurzes Sechskantprisma auf dem Rücken
        prism({ sides: 6, radius: 0.95, height: 0.7, at: [NECK_BASE[0], NECK_BASE[1] + 0.1, NECK_BASE[2] - 0.1], mat: 'chitin', keep: true, tag: 'neck' }),
      ],
    },
    {
      name: 'tail_0',
      parent: 'neck',
      pivot: T0[0]!,
      anim: 'pitch',
      shapes: [sweep({ path: T0, radius: T0_R, profile: TAIL_PROFILE, mat: 'team', keep: true, tag: 'tail' })],
    },
    {
      name: 'tail_1',
      parent: 'tail_0',
      pivot: T1[0]!,
      anim: 'pitch',
      shapes: [
        // Gelenkring zwischen den beiden Gliederketten (Sehne)
        prism({ sides: 6, radius: 0.82, height: 0.4, at: T1[0]!, rot: [12, 0, 0], mat: 'sinew', keep: true, tag: 'tail' }),
        sweep({ path: T1, radius: T1_R, profile: TAIL_PROFILE, mat: 'team', keep: true, tag: 'tail' }),
        ...umbel(),
      ],
    },
  ],
  notes:
    'Plage (T4), Game-Ender: 8 Beine als zwei Parts (Render-Pfad), Ankersporne (Pitch statt „deploy“, das Kit kennt keinen ' +
    'Deploy-Anim), Schwanzansatz-Yaw, zwei Schwanzketten-Pitch. Nicht in roster.units[] (experimentals[]).',
});
