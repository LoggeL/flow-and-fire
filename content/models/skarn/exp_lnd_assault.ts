/**
 * Skolopender (f2:exp_lnd_assault) – Experimenteller Sturmläufer, Plage (T4, Post-MVP).
 *
 * Roster/experimentals.md §3: Kopfsegment (Keil, teamfarben, dreht als Turm) mit überlanger waagerechter Granatlinse
 * (4,2 WU, ragt 1,5 WU über den Kopf) und zwei Kieferlinsen an den Giftklauen; dahinter sechs Rumpfglieder mit
 * teamfarbenen Rückenplatten und dunklen Seitenplatten, 14 Beine (7 Paare, Knie über dem Rücken, Spanne 5,6 WU).
 * Auf den letzten zwei Gliedern ein Dornenkamm aus 6 senkrechten Dornen (AA). Maße 11 × 3,2 × 2,2 WU, Footprint 4 × 10.
 * **Monopol:** Segmentkette (sieben flache Keilglieder, Länge ≥ 3,4 × Breite). **Verboten:** Schwanz, runder Körper,
 * Beine länger als 0,6 × Rumpflänge. **Pflichtpaare:** Skolopender ↔ Assel (Kette gegen Kuppel), Skolopender ↔ Langbein
 * (Strahllinse gegen Präzisionslinse, Körperlänge). **Tech-Marker:** zwei quarzweiße Klammer-Winkel an den vorderen
 * Ecken des Kopfpanzers.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`). Die Registry liest die Roster-Vorgaben auch aus
 * `experimentals[]`; Name, Rolle, Klasse, Tech, Footprint und Icon stehen zusätzlich im Modell (identisch zum Roster).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – sechs Rumpfglieder (Rückenplatte Team, Bauch Schwarzchitin), Seitenplatten, Dornenkamm (6 Dornen)
 *   legs_l – sieben linke Beine                                                  (PartStream 1, legs)
 *   legs_r – sieben rechte Beine                                                 (PartStream 2, legs)
 *   head   – Kopfsegment (Team) mit Giftklauen, Kieferlinsen und Klammer-Winkeln; Yaw   (PartStream 3)
 *   beam   – Hals + überlange Granatlinse (Strahllinse) auf dem Kopf; Pitch       (PartStream 4)
 * Das phasenversetzte Schwingen der Glieder ist reine View-Animation (Bein-Renderer), keine eigenen Parts.
 */
import { bipyramid, claw, defineModel, extrude, limb, plate, spike, strut, sweep, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 1.0; // Mittelebene der Glieder
const HIP_X = 0.8;
const HIP_Y = 0.78;
const FOOT_X = 2.68; // Beinspanne 5,6 WU (inkl. Fußkante)
const KNEE_Y = 1.6; // Knie über der Rückenoberkante (≈ 1,42), Oberkante Knie ≈ 2,2
const LEG_R = [0.43, 0.34, 0.12] as const; // Hüfte ≥ 0,6 WU Kantenbreite (Plagen-Klemmung), zum Fuß verjüngt

/** Rumpfglieder (Mitte z, halbe Länge, halbe Breite, halbe Höhe) von vorn nach hinten. */
const SEGMENTS: readonly (readonly [number, number, number, number])[] = [
  [1.7, 0.74, 1.06, 0.42],
  [0.4, 0.74, 1.1, 0.42],
  [-0.9, 0.74, 1.1, 0.42],
  [-2.2, 0.74, 1.05, 0.4],
  [-3.5, 0.74, 0.97, 0.38],
  [-4.8, 0.72, 0.86, 0.34],
];
/** Hüften der sieben Beinpaare: unter dem Kopf + je Rumpfglied. */
const LEG_Z = [2.95, ...SEGMENTS.map((s) => s[0])];
/** Fußversatz entlang z je Paar: vordere Paare greifen nach vorn, hintere ziehen nach hinten. */
const FOOT_DZ = [0.55, 0.35, 0.15, -0.05, -0.25, -0.45, -0.65];

/** Obere Hälfte des Sechskant-Querschnitts mit Firstkante (u = seitlich, v = oben). */
const UPPER: Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
];
/** Untere Hälfte (flacher Bauch). */
const LOWER: Vec2[] = [
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
  [1, 0],
];
/** Gliedkörper: flaches Sechseck mit niedriger Oberseite, die teamfarbene Rückenplatte bildet den First. */
const KEEL: Vec2[] = [
  [1, 0],
  [0.5, 0.45],
  [-0.5, 0.45],
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
];

/**
 * Ein Keilglied: Schwarzchitin-Körper (hinten breit, vorn schmaler) mit aufgesetzter, gewölbter Rückenplatte (Team,
 * vorn zugespitzt, leicht nach vorn gekippt). Der dunkle Rand zwischen den Platten macht die Kette lesbar.
 */
function segment([z, hl, hw, hh]: readonly [number, number, number, number]): Shape[] {
  const path: Vec3[] = [
    [0, BODY_Y, z - hl],
    [0, BODY_Y, z - hl * 0.2],
    [0, BODY_Y, z + hl],
  ];
  const radius: [number, number][] = [
    [hw * 0.92, hh * 0.9],
    [hw, hh],
    [hw * 0.62, hh * 0.7],
  ];
  const plateY = BODY_Y + 0.04 + (0.3 + 0.12) / 2 + hh * 0.2;
  return [
    sweep({ path, radius, profile: KEEL, mat: 'chitin', keep: true, maxLod: 0, tag: 'carapace' }),
    sweep({ path: [path[0]!, path[2]!], radius: [radius[1]!, radius[2]!], profile: KEEL, mat: 'chitin', keep: true, minLod: 1, maxLod: 1 }),
    plate({ size: [hw * 1.8, hl * 1.7], thickness: 0.12, arch: 0.3, segments: [4, 1], point: 0.35, at: [0, plateY, z + 0.04], rot: [5, 0, 0], mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
    // LOD2: ein teamfarbener Zweipunkt-Keil je Glied
    sweep({ path: [path[0]!, path[2]!], radius: [radius[1]!, radius[2]!], profile: UPPER, mat: 'team', minLod: 2 }),
  ];
}

/** Dunkle, glänzende Seitenplatte an der Flanke eines Glieds (über den Hüften, nach außen geneigt). */
function sidePlates([z, hl, hw]: readonly [number, number, number, number]): Shape[] {
  const at = (s: 1 | -1): Vec3 => [s * (hw + 0.12), BODY_Y - 0.12, z - 0.05];
  return [1, -1].map((s) =>
    plate({ size: [0.5, hl * 1.6], thickness: 0.1, segments: [1, 1], point: 0.3, at: at(s as 1 | -1), rot: [0, 0, s * -38], mat: 'chitin', maxLod: 0, tag: 'carapace' }),
  );
}

/** Beingelenke der linken Seite (Hüfte, Knie, Spitzfuß). */
const LEG_JOINTS = LEG_Z.map((z, i): [Vec3, Vec3, Vec3] => {
  const dz = FOOT_DZ[i]!;
  return [
    [HIP_X, HIP_Y, z],
    [HIP_X + 1.0, KNEE_Y, z + dz * 0.3],
    [FOOT_X, 0.08, z + dz],
  ];
});
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];

function legSet(side: 1 | -1): Shape[] {
  const out: Shape[] = [];
  for (const j of LEG_JOINTS) {
    const joints = side === 1 ? j : (j.map(mirror) as [Vec3, Vec3, Vec3]);
    // LOD0: vierkantig mit Kniedeckel; LOD1: dreikantig ohne Deckel; LOD2: nur das Unterbein (Knie–Fuß)
    out.push(limb({ joints, radius: [...LEG_R], sides: 4, hipCap: false, mat: 'chitin', keep: true, maxLod: 0, tag: 'legs' }));
    out.push(limb({ joints, radius: [...LEG_R], sides: 3, hipCap: false, jointCaps: false, mat: 'chitin', keep: true, minLod: 1, maxLod: 1, tag: 'legs' }));
    out.push(strut({ from: joints[1], to: joints[2], radius: 0.36, radiusEnd: 0.12, sides: 3, caps: false, mat: 'chitin', keep: true, minLod: 2 }));
  }
  return out;
}
const pivotOf = (side: 1 | -1): Vec3 => [side * HIP_X, HIP_Y, LEG_Z.reduce((s, z) => s + z, 0) / LEG_Z.length];

// Kopf
const HEAD_PATH: Vec3[] = [
  [0, BODY_Y + 0.02, 2.4],
  [0, BODY_Y + 0.02, 3.15],
  [0, BODY_Y - 0.02, 4.05],
];
const HEAD_R: [number, number][] = [
  [1.04, 0.4],
  [1.12, 0.44],
  [0.28, 0.16],
];
const HEAD_PIVOT: Vec3 = [0, BODY_Y, 3.0];
const BEAM_Y = BODY_Y + 0.7;
const BEAM_PIVOT: Vec3 = [0, BEAM_Y, 2.9];

/** Giftklaue (Zangen-Keil) mit Kieferlinse, Seite x = ±1. */
function jaw(side: 1 | -1): Shape[] {
  return [
    claw({ from: [side * 0.85, BODY_Y - 0.12, 3.5], to: [side * 0.28, BODY_Y - 0.22, 4.95], bend: [side * 0.45, 0, 0], radius: 0.36, segments: 3, mat: 'sinew', keep: true, tag: 'carapace' }),
    bipyramid({ radius: 0.24, length: 1.1, front: 0.6, at: [side * 0.9, BODY_Y + 0.06, 3.95], mat: 'garnet', keep: true, maxLod: 1, tag: 'lens' }),
  ];
}

/** Klammer-Winkel (Quarz) an der vorderen Kopfpanzer-Ecke: flaches L, Schenkel nach vorn und nach innen. */
function bracket(side: 1 | -1): Shape {
  const w = 0.2;
  const profile: Vec2[] = [
    [0, 0],
    [0, 0.7],
    [-side * 0.55, 0.7],
    [-side * 0.55, 0.7 - w],
    [-side * w, 0.7 - w],
    [-side * w, 0],
  ];
  return extrude({
    profile: side === 1 ? profile : profile.slice().reverse(),
    depth: 0.05,
    axis: 'y',
    at: [side * 0.74, BODY_Y + 0.27, 3.3],
    rot: [0, 0, side * -30],
    mat: 'quartz',
    keep: true,
    maxLod: 1,
    tag: 'techmarker',
  });
}

// Dornenkamm: 6 senkrechte Dornen auf den letzten zwei Gliedern (je drei quer)
const COMB: Shape[] = [];
for (const s of SEGMENTS.slice(4)) {
  const top = BODY_Y + s[3] - 0.04;
  for (const x of [-0.5, 0, 0.5]) {
    const h = x === 0 ? 0.95 : 0.78;
    COMB.push(spike({ from: [x, top - (x === 0 ? 0 : 0.08), s[0] - 0.05], to: [x * 1.1, top + h, s[0] - 0.05], radius: 0.3, mat: 'chitin', keep: true, tag: 'spike' }));
  }
}

export default defineModel({
  id: 'f2:exp_lnd_assault',
  name: 'Skolopender',
  role: 'Experimenteller Sturmläufer',
  class: 'land',
  tech: 4,
  footprint: [4, 10],
  icon: 'land_direct_t4',
  parts: [
    {
      name: 'hull',
      shapes: [...SEGMENTS.flatMap(segment), ...SEGMENTS.flatMap(sidePlates), ...COMB],
    },
    { name: 'legs_l', pivot: pivotOf(1), anim: 'legs', shapes: legSet(1) },
    { name: 'legs_r', pivot: pivotOf(-1), anim: 'legs', shapes: legSet(-1) },
    {
      name: 'head',
      pivot: HEAD_PIVOT,
      anim: 'yaw',
      shapes: [
        sweep({ path: HEAD_PATH, radius: HEAD_R, profile: UPPER, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: HEAD_PATH, radius: HEAD_R, profile: LOWER, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        ...jaw(1),
        ...jaw(-1),
        bracket(1),
        bracket(-1),
      ],
    },
    {
      name: 'beam',
      parent: 'head',
      pivot: BEAM_PIVOT,
      anim: 'pitch',
      shapes: [
        // Hals: kurzes Vierkantprisma aus dem Kopffirst
        strut({ from: [0, BODY_Y + 0.3, 2.75], to: [0, BEAM_Y, 3.0], radius: 0.34, caps: false, mat: 'sinew', keep: true, maxLod: 1, tag: 'neck' }),
        // Strahllinse: 4,2 WU, Taille über dem Hals, Spitze 1,5 WU vor dem Kopf (z 1,3 … 5,5)
        bipyramid({ radius: 0.5, length: 4.2, front: 0.6, at: [0, BEAM_Y, 3.4], mat: 'garnet', keep: true, tag: 'lens' }),
      ],
    },
  ],
  notes:
    'Plage (T4): 14 Beine als zwei Parts (legs_l/legs_r, Render-Pfad ersetzt sie später), Kopf-Yaw, Strahllinsen-Pitch. ' +
    'Gliederschwingen nur View. Nicht in roster.units[] (experimentals[]), deshalb Name/Rolle/Klasse/Tech/Footprint/Icon im Modell.',
});
