/**
 * Assel (f2:exp_lnd_siege) – Experimenteller Brutläufer, Plage (T4, Post-MVP).
 *
 * Roster/experimentals.md §4: ovaler, flach gewölbter Rücken aus sieben überlappenden Querplatten (teamfarben, Kanten
 * dunkel glänzend) auf 14 kurzen Hochbeinen; vorn unter dem Kopfschild das Brutmaul (V-Portal, Herzkern) mit liegender
 * Spule dahinter; links und rechts vorn je ein Linsenträger mit zwei waagerechten Granatlinsen; auf der dritten Platte
 * vier kurze Flakdornen. Maße 9,5 × 7 × 4,4 WU, Beinspanne 10,5 WU, Footprint 8 × 8.
 * **Monopol:** Plattenkuppel (Breite ≥ 0,7 × Länge, vorn das glühende Maul). **Verboten:** Fühler, Schwanz, lange Beine.
 * **Pflichtpaare:** Assel ↔ Skolopender (Kuppel gegen Kette), Assel ↔ Landnest III (Maul am mobilen Körper gegen Maul
 * auf Kruste). **Tech-Marker:** zwei quarzweiße Klammer-Winkel an den vorderen Ecken des Kopfschilds.
 * Glut (Herzkern) ist erlaubt, weil die Assel eine FACTORY ist (Brutbeutel, B3-Erweiterung): Maul + Spulenachse.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`). Die Registry liest die Roster-Vorgaben auch aus
 * `experimentals[]`; Name, Rolle, Klasse, Tech, Footprint und Icon stehen zusätzlich im Modell (identisch zum Roster).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull    – Bauchschale/Kern (Schwarzchitin, Unterseite dunkel), sieben Querplatten (Team, Kopfschild vorn),
 *             Brutmaul (V-Portal, Glut), Brutspule (Team-Randscheiben, Sehnenwickel, Glutachse), Flakdornen, Klammer-Winkel
 *   legs_l  – sieben linke Beine                                                    (PartStream 1, legs)
 *   legs_r  – sieben rechte Beine                                                   (PartStream 2, legs)
 *   neck_l  – linker Linsenträger auf der vorderen Kuppelschulter, Yaw              (PartStream 3)
 *   lens_l  – zwei Zwillingslinsen links, Pitch                                     (PartStream 4)
 *   neck_r  – rechter Linsenträger auf der vorderen Kuppelschulter, Yaw             (PartStream 5)
 *   lens_r  – zwei Zwillingslinsen rechts, Pitch                                    (PartStream 6)
 */
import { bipyramid, cylinder, defineModel, extrude, limb, plate, spike, strut, sweep, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const HALF_L = 5.0; // Halbachse der Kuppel entlang z (Platten reichen bis ±4,7)
const HALF_W = 3.5; // Breite 7 WU
const RIM = 1.25; // Unterkante der Plattenränder
const CROWN = 3.65; // Scheitel der Kuppel (Flakdornen bis 4,4)
const T = 0.28; // Plattendicke

/** Halbe Breite der Kuppel bei z. */
const halfW = (z: number): number => HALF_W * Math.sqrt(Math.max(0, 1 - (z / HALF_L) ** 2));
/** Scheitelhöhe der Kuppel bei z. */
const crown = (z: number): number => RIM + (CROWN - RIM) * Math.sqrt(Math.max(0, 1 - (z / (HALF_L + 0.25)) ** 2));
/** Neigung der Kuppel bei z in Grad (positiv = Nase runter, vordere Hälfte). */
const slope = (z: number): number => {
  const e = 0.02;
  return (Math.atan2(crown(z - e) - crown(z + e), 2 * e) * 180) / Math.PI;
};

interface PlateGeo {
  readonly z: number;
  readonly hw: number;
  readonly arch: number;
  readonly cy: number;
  readonly rot: number;
}
/** Sieben Querplatten von vorn (Kopfschild) nach hinten. */
const PLATE_Z = [3.8, 2.55, 1.28, 0, -1.28, -2.55, -3.8];
const PLATES: PlateGeo[] = PLATE_Z.map((z) => {
  const top = crown(z);
  const arch = top - RIM - T;
  return { z, hw: halfW(z) + 0.1, arch, cy: (RIM + top) / 2, rot: slope(z) * 1.15 };
});

/** Punkt auf der Oberseite von Platte i (seitlich x, entlang der Platte dz), inkl. Plattenneigung. */
function onPlate(i: number, x: number, dz: number, lift = 0): Vec3 {
  const p = PLATES[i]!;
  const ys = RIM + T + p.arch * (1 - (x / p.hw) ** 2) - p.cy + lift;
  const th = (p.rot * Math.PI) / 180;
  return [x, p.cy + ys * Math.cos(th) - dz * Math.sin(th), p.z + ys * Math.sin(th) + dz * Math.cos(th)];
}

function domePlate(p: PlateGeo, i: number): Shape {
  return plate({
    size: [2 * p.hw, i === 0 ? 1.85 : 1.72],
    thickness: T,
    arch: p.arch,
    segments: [6, 1],
    point: i === 0 ? 0.3 : 0,
    at: [0, p.cy, p.z],
    rot: [p.rot, 0, 0],
    mat: 'team',
    keep: true,
    tag: 'carapace',
  });
}

// Kern/Bauchschale: gestreckter Sechskant unter der Kuppel (von oben verdeckt, von der Seite dunkel)
const CORE_Z = [-4.5, -2.6, 0, 2.6, 4.4];
const CORE_PROFILE: Vec2[] = [
  [1, 0],
  [0.55, 0.75],
  [0, 1],
  [-0.55, 0.75],
  [-1, 0],
  [-0.6, -0.45],
  [0.6, -0.45],
];
const CORE_Y = 1.3;
const coreSections = (zs: readonly number[]): [number, number][] => zs.map((z): [number, number] => [halfW(z) * 0.9 + 0.1, Math.max(0.5, crown(z) - CORE_Y - 0.45)]);
const corePath = (zs: readonly number[]): Vec3[] => zs.map((z): Vec3 => [0, CORE_Y, z]);

// Beine: kurz, Knie knapp über dem Kuppelrand, Füße auf Spanne 10,5 WU
const LEG_Z = [3.35, 2.25, 1.1, 0, -1.1, -2.25, -3.35];
const LEG_R = [0.43, 0.34, 0.12] as const;
const LEG_JOINTS = LEG_Z.map((z): [Vec3, Vec3, Vec3] => {
  const w = halfW(z);
  return [
    [w * 0.78, 1.05, z],
    [w + 0.55, 2.05, z * 1.05],
    [5.13, 0.08, z * 1.18],
  ];
});
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
function legSet(side: 1 | -1): Shape[] {
  const out: Shape[] = [];
  for (const j of LEG_JOINTS) {
    const joints = side === 1 ? j : (j.map(mirror) as [Vec3, Vec3, Vec3]);
    out.push(limb({ joints, radius: [...LEG_R], sides: 4, hipCap: false, mat: 'chitin', keep: true, maxLod: 0, tag: 'legs' }));
    out.push(limb({ joints, radius: [...LEG_R], sides: 3, hipCap: false, jointCaps: false, mat: 'chitin', keep: true, minLod: 1, maxLod: 1, tag: 'legs' }));
    out.push(strut({ from: joints[1], to: joints[2], radius: 0.36, radiusEnd: 0.12, sides: 3, caps: false, mat: 'chitin', keep: true, minLod: 2 }));
  }
  return out;
}
const legPivot = (side: 1 | -1): Vec3 => [side * 2.9, 1.05, 0];

// Brutmaul am Bug: V-Portal aus zwei schrägen Keilplatten, dazwischen der glühende Herzkern
const MAW_Z = 4.55;
const MAW: Shape[] = [
  // Glühender Kern: V-förmiger Keil (Spitze unten), bündig hinter den Portalplatten
  extrude({
    profile: [
      [-1.35, 2.3],
      [0, 0.7],
      [1.35, 2.3],
    ],
    depth: 0.3,
    axis: 'z',
    at: [0, 0, MAW_Z - 0.05],
    mat: 'glow',
    keep: true,
    tag: 'gate',
  }),
  // Portalplatten (Schwarzchitin, schräg zur V-Spitze geneigt)
  ...[1, -1].map((s) =>
    strut({ from: [s * 1.62, 2.5, MAW_Z], to: [s * 0.14, 0.55, MAW_Z + 0.02], radius: 0.38, radiusEnd: 0.26, sides: 4, mat: 'chitin', keep: true, tag: 'gate' }),
  ),
];

// Brutspule: liegend quer über dem Maul, unter der Kopfschild-Vorderkante
const SPOOL: Vec3 = [0, 2.62, 4.2];
const SPOOL_SHAPES: Shape[] = [
  cylinder({ radius: 0.34, height: 1.8, axis: 'x', segments: 6, caps: false, at: SPOOL, mat: 'sinew', keep: true, maxLod: 1, tag: 'spool' }),
  cylinder({ radius: 0.56, height: 0.18, axis: 'x', segments: 6, at: [0.95, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 1, tag: 'spool' }),
  cylinder({ radius: 0.56, height: 0.18, axis: 'x', segments: 6, at: [-0.95, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 1, tag: 'spool' }),
  cylinder({ radius: 0.5, height: 2.0, axis: 'x', segments: 4, at: SPOOL, mat: 'team', minLod: 2 }),
  cylinder({ radius: 0.14, height: 2.2, axis: 'x', segments: 3, at: SPOOL, mat: 'glow', keep: true, maxLod: 1, tag: 'spool' }),
];

// Flakdornen: vier kurze senkrechte Dornen auf der dritten Platte
const FLAK: Shape[] = [-1.35, -0.45, 0.45, 1.35].map((x) => {
  const base = onPlate(2, x, -0.05, -0.05);
  return spike({ from: base, to: [x * 1.06, base[1] + (Math.abs(x) < 1 ? 0.78 : 0.62), base[2]], radius: 0.3, mat: 'chitin', keep: true, maxLod: 1, tag: 'spike' });
});

/** Klammer-Winkel (Quarz) an einer vorderen Ecke des Kopfschilds: flaches L, Schenkel nach vorn und nach innen. */
function bracket(side: 1 | -1): Shape {
  const w = 0.22;
  const profile: Vec2[] = [
    [0, 0],
    [0, 0.75],
    [-side * 0.6, 0.75],
    [-side * 0.6, 0.75 - w],
    [-side * w, 0.75 - w],
    [-side * w, 0],
  ];
  const x = side * 1.2;
  const p = onPlate(0, x, 0.1, 0.02);
  const tilt = (Math.atan2(2 * PLATES[0]!.arch * (1.2 / PLATES[0]!.hw), PLATES[0]!.hw) * 180) / Math.PI;
  return extrude({
    profile: side === 1 ? profile : profile.slice().reverse(),
    depth: 0.05,
    axis: 'y',
    at: p,
    rot: [PLATES[0]!.rot, 0, side * -tilt],
    mat: 'quartz',
    keep: true,
    maxLod: 1,
    tag: 'techmarker',
  });
}

// Linsenträger links/rechts vorn auf den Kuppelschultern (Hals + zwei waagerechte Granatlinsen nebeneinander)
const CARRIER_X = 2.05;
const CARRIER_Z = 2.7;
const carrierBase = (side: 1 | -1): Vec3 => onPlate(1, side * CARRIER_X, CARRIER_Z - PLATES[1]!.z);
const LENS_UP = 0.5;
function neck(side: 1 | -1): Shape[] {
  const b = carrierBase(side);
  return [
    strut({ from: [b[0], b[1] - 0.25, b[2] - 0.1], to: [b[0], b[1] + LENS_UP, b[2] + 0.1], radius: 0.46, radiusEnd: 0.38, sides: 4, mat: 'chitin', keep: true, tag: 'neck' }),
  ];
}
function lenses(side: 1 | -1): Shape[] {
  const b = carrierBase(side);
  return [0.3, -0.3].map((dx) =>
    bipyramid({ radius: 0.3, length: 2.0, front: 0.62, at: [b[0] + dx, b[1] + LENS_UP, b[2] + 0.95], mat: 'garnet', keep: true, ...(dx * side < 0 ? { maxLod: 1 as const } : {}), tag: 'lens' }),
  );
}

export default defineModel({
  id: 'f2:exp_lnd_siege',
  name: 'Assel',
  role: 'Experimenteller Brutläufer',
  class: 'land',
  tech: 4,
  footprint: [8, 8],
  icon: 'land_direct_t4',
  parts: [
    {
      name: 'hull',
      shapes: [
        sweep({ path: corePath(CORE_Z), radius: coreSections(CORE_Z), profile: CORE_PROFILE, mat: 'underside', keep: true, maxLod: 1, tag: 'carapace' }),
        sweep({ path: corePath([-4.5, 0, 4.4]), radius: coreSections([-4.5, 0, 4.4]), profile: CORE_PROFILE, mat: 'underside', keep: true, minLod: 2 }),
        ...PLATES.map(domePlate),
        ...MAW,
        ...SPOOL_SHAPES,
        ...FLAK,
        bracket(1),
        bracket(-1),
      ],
    },
    { name: 'legs_l', pivot: legPivot(1), anim: 'legs', shapes: legSet(1) },
    { name: 'legs_r', pivot: legPivot(-1), anim: 'legs', shapes: legSet(-1) },
    { name: 'neck_l', pivot: carrierBase(1), anim: 'yaw', shapes: neck(1) },
    { name: 'lens_l', parent: 'neck_l', pivot: [carrierBase(1)[0], carrierBase(1)[1] + LENS_UP, carrierBase(1)[2] + 0.1], anim: 'pitch', shapes: lenses(1) },
    { name: 'neck_r', pivot: carrierBase(-1), anim: 'yaw', shapes: neck(-1) },
    { name: 'lens_r', parent: 'neck_r', pivot: [carrierBase(-1)[0], carrierBase(-1)[1] + LENS_UP, carrierBase(-1)[2] + 0.1], anim: 'pitch', shapes: lenses(-1) },
  ],
  notes:
    'Plage (T4): 14 Beine als zwei Parts (legs_l/legs_r, Render-Pfad ersetzt sie später), zwei Linsenträger (Yaw) mit je ' +
    'zwei Linsen (Pitch). Glut nur Brutmaul + Spulenachse (FACTORY). Nicht in roster.units[] (experimentals[]).',
});
