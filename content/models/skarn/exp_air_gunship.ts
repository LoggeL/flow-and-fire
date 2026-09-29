/**
 * Tsetse (f2:exp_air_gunship) – Experimenteller Kampfschweber, Plage (T4, Post-MVP).
 *
 * Roster/experimentals.md §5: langer Gliederrumpf aus drei Keilgliedern (teamfarbene Rückenplatten), am Kopf ein dunkler
 * Kopfschild; vier teamfarbene Ausleger im X, an jedem eine Schwirrscheibe (opak, gestreift, dreht); unter dem Rumpf
 * vier Bauchlinsen in zwei Paaren, seitlich zwei Stachelköcher; auf dem mittleren Glied ein Dornenkamm aus vier
 * senkrechten Dornen. Maße 10 × 11 × 2,4 WU, Landefläche 6 × 6.
 * **Monopol:** Vierfach-Schwirrscheibe (keine Flügel). **Verboten:** Flügel, Hinterleib (Bomber-Monopol).
 * **Pflichtpaare:** Tsetse ↔ Hummel (vier Scheiben gegen eine), Tsetse ↔ Brummer (Flügel und Hinterleib).
 * **Tech-Marker:** zwei quarzweiße Klammer-Winkel an den vorderen Ecken des vorderen Rumpfglieds.
 * Teamfarbe ≥ 45 % der Draufsicht (Luft): Rückenplatten, Ausleger und die Streifen der Schwirrscheiben (wie Varkans
 * Rotorblätter); Scheibenkörper, Kopfschild, Linsen und Köcher bleiben dunkel.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`), Unterkante der Bauchlinsen auf y = 0 (Flughöhe setzt der Renderer).
 * Die Registry liest die Roster-Vorgaben auch aus
 * `experimentals[]`; Name, Rolle, Klasse, Tech, Footprint und Icon stehen zusätzlich im Modell (identisch zum Roster).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull    – drei Rumpfglieder (Kiel Schwarzchitin, Rückenplatte Team), Kopfschild (Sehne), X-Ausleger (Team),
 *             Stachelköcher, Dornenkamm, Klammer-Winkel
 *   disc_fl / disc_fr / disc_bl / disc_br – Schwirrscheiben, Spin um +Y         (PartStream 1–4)
 *   lens_f  – vorderes Bauchlinsenpaar, Pitch                                     (PartStream 5)
 *   lens_b  – hinteres Bauchlinsenpaar, Pitch                                     (PartStream 6)
 */
import { bipyramid, cylinder, defineModel, extrude, plate, prism, quad, spike, strut, sweep, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 1.05; // Mittelebene des Rumpfs

/** Rumpfglieder: Mitte z, halbe Länge, halbe Breite, halbe Höhe (vorn, Mitte, hinten). */
const SEGMENTS: readonly (readonly [number, number, number, number])[] = [
  [2.85, 1.2, 1.0, 0.5],
  [0.55, 1.2, 1.2, 0.55],
  [-2.65, 2.05, 0.95, 0.45],
];

const KEEL: Vec2[] = [
  [1, 0],
  [0.5, 0.45],
  [-0.5, 0.45],
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
];
const UPPER: Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
];

/** Keilglied: Kiel (Schwarzchitin) mit gewölbter, vorn zugespitzter Rückenplatte (Team). Hinteres Glied läuft spitz aus. */
function segment([z, hl, hw, hh]: readonly [number, number, number, number], i: number): Shape[] {
  const rear = i === 2;
  const path: Vec3[] = [
    [0, BODY_Y + (rear ? 0.12 : 0), z - hl],
    [0, BODY_Y, z - hl * (rear ? 0.1 : 0.25)],
    [0, BODY_Y, z + hl],
  ];
  const radius: [number, number][] = rear
    ? [
        [0.22, 0.14],
        [hw, hh],
        [hw * 0.8, hh * 0.8],
      ]
    : [
        [hw * 0.85, hh * 0.85],
        [hw, hh],
        [hw * 0.75, hh * 0.75],
      ];
  const plateY = BODY_Y + 0.04 + (0.34 + 0.12) / 2 + hh * 0.2;
  return [
    sweep({ path, radius, profile: KEEL, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
    plate({
      size: [hw * 1.8, hl * 1.75],
      thickness: 0.12,
      arch: 0.34,
      segments: [4, 1],
      point: rear ? 0.7 : 0.3,
      at: [0, plateY + (rear ? 0.02 : 0), z + (rear ? -0.05 : 0.05)],
      // hinteres Glied: Platte gedreht, läuft nach hinten spitz aus (flacher Keil, kein Hinterleib)
      rot: rear ? [3, 180, 0] : [4, 0, 0],
      mat: 'team',
      keep: true,
      maxLod: 1,
      tag: 'carapace',
    }),
    sweep({ path: [path[0]!, path[2]!], radius: [radius[1]!, radius[2]!], profile: UPPER, mat: 'team', minLod: 2 }),
  ];
}

// Kopfschild: dunkler Keil vor dem vorderen Glied, Spitze = Flugrichtung
const HEAD_PATH: Vec3[] = [
  [0, BODY_Y, 3.75],
  [0, BODY_Y - 0.05, 4.4],
  [0, BODY_Y - 0.15, 5.0],
];
const HEAD_R: [number, number][] = [
  [0.95, 0.5],
  [0.8, 0.42],
  [0.16, 0.1],
];
const HEAD_PROFILE: Vec2[] = [...UPPER, [-0.5, -0.7], [0.5, -0.7]];

// X-Ausleger und Schwirrscheiben
const DISC_R = 1.5;
const DISC_Y = 1.5;
const DISCS: readonly { readonly name: string; readonly at: Vec3; readonly root: Vec3 }[] = [
  { name: 'disc_fl', at: [4.02, DISC_Y, 3.2], root: [0.7, BODY_Y + 0.1, 1.35] },
  { name: 'disc_fr', at: [-4.02, DISC_Y, 3.2], root: [-0.7, BODY_Y + 0.1, 1.35] },
  { name: 'disc_bl', at: [4.02, DISC_Y, -2.15], root: [0.7, BODY_Y + 0.1, -0.2] },
  { name: 'disc_br', at: [-4.02, DISC_Y, -2.15], root: [-0.7, BODY_Y + 0.1, -0.2] },
];
const BOOMS: Shape[] = DISCS.flatMap((d) => [
  strut({ from: d.root, to: [d.at[0], d.at[1] - 0.1, d.at[2]], radius: 0.46, radiusEnd: 0.36, sides: 4, mat: 'team', keep: true, tag: 'neck' }),
  // Nabenlager unter der Scheibe
  cylinder({ radius: 0.42, height: 0.36, segments: 6, caps: 'bottom', at: [d.at[0], d.at[1] - 0.2, d.at[2]], mat: 'chitin', keep: true, maxLod: 1, tag: 'buzzdisc' }),
]);

/** Schwirrscheibe: opake, flache Sechseckscheibe (Schwarzchitin) mit drei teamfarbenen Streifen und Sehnen-Nabe. */
function buzzdisc(at: Vec3): Shape[] {
  const top = at[1] + 0.07;
  return [
    prism({ sides: 6, radius: DISC_R, height: 0.14, at, mat: 'chitin', keep: true, tag: 'buzzdisc' }),
    ...[0, 60, 120].map((deg) => quad({ size: [DISC_R * 1.62, 0.34], at: [at[0], top + 0.006, at[2]], rot: [0, deg, 0], mat: 'team', keep: true, maxLod: 1, tag: 'buzzdisc' })),
    quad({ size: [DISC_R * 1.62, 0.5], at: [at[0], top + 0.006, at[2]], rot: [0, 30, 0], mat: 'team', minLod: 2 }),
    prism({ sides: 6, radius: 0.3, height: 0.16, at: [at[0], top + 0.08, at[2]], mat: 'sinew', keep: true, maxLod: 1, tag: 'buzzdisc' }),
  ];
}

// Bauchlinsen: zwei Paare unter dem Rumpf, waagerecht nach vorn
const LENS_Y = 0.3;
const LENS_R = 0.3;
function lensPair(z: number): Shape[] {
  return [0.5, -0.5].map((x) => bipyramid({ radius: LENS_R, length: 1.7, front: 0.62, at: [x, LENS_Y, z], mat: 'garnet', keep: true, tag: 'lens' }));
}
const lensMount = (z: number): Shape =>
  strut({ from: [0, BODY_Y - 0.25, z - 0.35], to: [0, LENS_Y + 0.08, z - 0.35], radius: 0.4, radiusEnd: 0.34, sides: 4, caps: 'end', mat: 'chitin', keep: true, maxLod: 1, tag: 'neck' });

// Stachelköcher seitlich am mittleren Glied
const QUIVERS: Shape[] = [1, -1].flatMap((s) => [
  cylinder({ radius: 0.36, height: 1.7, axis: 'z', segments: 6, at: [s * 1.38, BODY_Y - 0.2, 0.6], mat: 'sinew', keep: true, tag: 'pod' }),
  spike({ from: [s * 1.38, BODY_Y - 0.2, 1.45], to: [s * 1.38, BODY_Y - 0.2, 1.95], radius: 0.36, sides: 6, mat: 'sinew', keep: true, maxLod: 1, tag: 'pod' }),
]);

// Dornenkamm: vier senkrechte Dornen in einer Reihe auf dem mittleren Glied
const COMB: Shape[] = [-0.35, 0.3, 0.95, 1.6].map((z, i) => {
  const base = BODY_Y + 0.5;
  return spike({ from: [0, base, z], to: [0, base + (i === 1 || i === 2 ? 0.88 : 0.72), z - 0.05], radius: 0.3, mat: 'chitin', keep: true, tag: 'spike' });
});

/** Klammer-Winkel (Quarz) an einer vorderen Ecke des vorderen Rumpfglieds. */
function bracket(side: 1 | -1): Shape {
  const w = 0.2;
  const profile: Vec2[] = [
    [0, 0],
    [0, 0.65],
    [-side * 0.5, 0.65],
    [-side * 0.5, 0.65 - w],
    [-side * w, 0.65 - w],
    [-side * w, 0],
  ];
  return extrude({
    profile: side === 1 ? profile : profile.slice().reverse(),
    depth: 0.05,
    axis: 'y',
    at: [side * 0.62, BODY_Y + 0.42, 3.35],
    rot: [4, 0, side * -22],
    mat: 'quartz',
    keep: true,
    maxLod: 1,
    tag: 'techmarker',
  });
}

export default defineModel({
  id: 'f2:exp_air_gunship',
  name: 'Tsetse',
  role: 'Experimenteller Kampfschweber',
  class: 'air',
  tech: 4,
  footprint: [6, 6],
  icon: 'air_direct_t4',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...SEGMENTS.flatMap(segment),
        sweep({ path: HEAD_PATH, radius: HEAD_R, profile: HEAD_PROFILE, mat: 'sinew', keep: true, tag: 'carapace' }),
        ...BOOMS,
        ...QUIVERS,
        ...COMB,
        lensMount(2.35),
        lensMount(-0.05),
        bracket(1),
        bracket(-1),
      ],
    },
    ...DISCS.map((d) => ({ name: d.name, pivot: d.at, anim: 'spin' as const, shapes: buzzdisc(d.at) })),
    { name: 'lens_f', pivot: [0, LENS_Y, 2.0] as Vec3, anim: 'pitch' as const, shapes: lensPair(2.35) },
    { name: 'lens_b', pivot: [0, LENS_Y, -0.4] as Vec3, anim: 'pitch' as const, shapes: lensPair(-0.05) },
  ],
  notes:
    'Plage (T4): vier Schwirrscheiben (Spin, je ein Part), zwei Bauchlinsenpaare (Pitch). Keine Flügel, kein Hinterleib. ' +
    'Nicht in roster.units[] (experimentals[]), deshalb Name/Rolle/Klasse/Tech/Footprint/Icon im Modell.',
});
