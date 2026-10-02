/**
 * Fallhammer (core:lnd_t3_bot), Varkan-Belagerungsläufer T3.
 * Überlange Gusswanne, zwei unabhängig drehende Glocken und schwere Gelenkbeine.
 * Die hintere Glocke steht 0,2 WU höher; beide Rohre bleiben starr an ihrer Glocke.
 * Drei Keramikstreifen, Kupferkühlung und schmale Glutnähte, ohne Heckschlot.
 */
import {
  beveledBox, box, cylinder, defineModel, extrude, frustum, quad, sphere,
  stripes, strut, tube, type Shape,
} from '@faf/modelkit';

const HIP_Y = 0.5;
const LEG_X = 0.37;
const HULL_BOTTOM = 0.46;
const DECK_TOP = 0.76;
const PLATE_TOP = 0.79;
const FRONT_Z = 0.44;
const REAR_Z = -0.04;
const REAR_Y = PLATE_TOP + 0.2;
const BELL_R = 0.26;

/** Hüftlager, vorgestelltes Knie und getrennte Zehen tragen die Gusswanne. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  const outside = x + side * 0.097;
  return [
    // Die Lager gehören zum bewegten Bein, ihre Achsen liegen auf dessen Hüftpivot.
    cylinder({ radius: 0.098, height: 0.22, axis: 'x', at: [x, HIP_Y, 0], segments: 10, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'hip' }),
    cylinder({ radius: 0.073, height: 0.028, axis: 'x', at: [outside, HIP_Y, 0], segments: 8, caps: side > 0 ? 'top' : 'bottom', mat: 'copper', smooth: 65, maxLod: 0, tag: 'hip' }),
    beveledBox({ size: [0.17, 0.245, 0.19], bevel: { top: 0.025, bottom: 0.025 }, at: [x, 0.405, 0.05], rot: [-22, 0, 0], mat: 'body', maxLod: 0, tag: 'thigh' }),
    // Knieachse und darüberliegende Panzerblende bleiben getrennt lesbar.
    cylinder({ radius: 0.078, height: 0.215, axis: 'x', at: [x, 0.295, 0.108], segments: 10, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'knee' }),
    cylinder({ radius: 0.052, height: 0.018, axis: 'x', at: [outside + side * 0.009, 0.295, 0.108], segments: 8, caps: side > 0 ? 'top' : 'bottom', mat: 'copper', smooth: 65, maxLod: 0, tag: 'knee' }),
    beveledBox({ size: [0.195, 0.14, 0.055], bevel: { top: 0.023, side: 0.018 }, at: [x, 0.3, 0.19], mat: 'team', maxLod: 0, tag: 'knee-armor' }),
    extrude({ profile: [[-0.065, 0.1], [-0.045, 0.22], [0.015, 0.286], [0.11, 0.25], [0.115, 0.16], [0.05, 0.095]], depth: 0.155, at: [x, 0, 0], mat: 'body', maxLod: 0, tag: 'shin' }),
    box({ size: [0.135, 0.115, 0.035], at: [x, 0.168, 0.115], rot: [14, 0, 0], mat: 'team', maxLod: 0 }),
    // Zwei teleskopische Streben verbinden jeweils Gelenk und Gussglied.
    strut({ from: [outside, 0.473, -0.045], to: [outside, 0.376, 0.015], radius: 0.026, sides: 6, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'hydraulic' }),
    strut({ from: [outside, 0.38, 0.012], to: [outside, 0.293, 0.072], radius: 0.014, sides: 6, caps: false, mat: 'copper', smooth: 65, maxLod: 0, tag: 'hydraulic' }),
    strut({ from: [outside, 0.275, 0.06], to: [outside, 0.19, -0.012], radius: 0.025, sides: 6, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'hydraulic' }),
    strut({ from: [outside, 0.193, -0.01], to: [outside, 0.105, -0.055], radius: 0.014, sides: 6, caps: false, mat: 'copper', smooth: 65, maxLod: 0, tag: 'hydraulic' }),
    cylinder({ radius: 0.051, height: 0.172, axis: 'x', at: [x, 0.094, 0.015], segments: 8, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'ankle' }),
    box({ size: [0.23, 0.065, 0.16], at: [x, 0.0325, -0.064], mat: 'dark', maxLod: 0, tag: 'heel' }),
    ...[-1, 1].map((toe) => beveledBox({ size: [0.1, 0.075, 0.265], bevel: { topFront: 0.027, top: 0.012 }, at: [x + toe * 0.064, 0.0375, 0.143], mat: 'body', maxLod: 0, tag: 'toe' })),
    // LOD1 erhält Knick und Fuß, LOD2 eine kompakte tragende Silhouette.
    box({ size: [0.18, 0.29, 0.2], at: [x, 0.375, 0.05], rot: [-22, 0, 0], mat: 'body', minLod: 1, maxLod: 1, keep: true }),
    box({ size: [0.17, 0.2, 0.18], at: [x, 0.17, 0.035], rot: [14, 0, 0], mat: 'dark', minLod: 1, maxLod: 1, keep: true }),
    box({ size: [0.26, 0.08, 0.42], at: [x, 0.04, 0.07], mat: 'dark', minLod: 1, keep: true }),
    box({ size: [0.19, 0.44, 0.2], at: [x, 0.28, 0.05], mat: 'dark', minLod: 2, keep: true }),
  ];
}

/** Jedes Waffenpaket dreht samt Lager, Mantel, Optik und Rücklauf mit seiner Glocke. */
function bell(y: number, z: number, barrelFrom: number, barrelTo: number): Shape[] {
  const by = y + 0.15;
  const len = barrelTo - barrelFrom;
  return [
    cylinder({ radius: 0.238, height: 0.05, at: [0, y + 0.025, z], segments: 12, caps: false, mat: 'dark', smooth: 65, maxLod: 1, keep: true, tag: 'race' }),
    frustum({ radius: BELL_R + 0.01, radiusTop: BELL_R - 0.01, height: 0.075, at: [0, y + 0.0675, z], segments: 12, caps: false, mat: 'team', maxLod: 1, keep: true, tag: 'bell' }),
    sphere({ radius: BELL_R - 0.01, hemi: true, segments: 12, rings: 3, scale: [1, 0.52, 1], at: [0, y + 0.105 + 0.065, z], mat: 'team', maxLod: 1, keep: true, tag: 'bell' }),
    // Gussblende umfasst den Rohransatz, der Brückenträger darunter nimmt den Rückstoß auf.
    beveledBox({ size: [0.24, 0.155, 0.13], bevel: { top: 0.023 }, at: [0, by, z + 0.223], mat: 'body', maxLod: 0, tag: 'mantlet' }),
    beveledBox({ size: [0.19, 0.055, 0.28], bevel: { top: 0.014 }, at: [0, by - 0.085, z + 0.255], mat: 'dark', maxLod: 0, tag: 'cradle' }),
    cylinder({ radius: 0.09, caps: false, height: 0.1, axis: 'z', at: [0, by, barrelFrom + 0.035], segments: 10, mat: 'copper', smooth: 65, maxLod: 0, tag: 'collar' }),
    cylinder({ radius: 0.069, height: len - 0.08, axis: 'z', at: [0, by, barrelFrom + (len - 0.08) / 2], segments: 10, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'barrel' }),
    // Hohle Mündung statt leuchtender Vollscheibe, die Bohrung ist von vorne sichtbar.
    tube({ outer: 0.084, inner: 0.05, height: 0.115, axis: 'z', at: [0, by, barrelTo - 0.0575], segments: 8, mat: 'body', smooth: 65, maxLod: 0, tag: 'muzzle' }),
    cylinder({ radius: 0.048, height: 0.006, axis: 'z', at: [0, by, barrelTo - 0.108], segments: 6, caps: 'top', mat: 'dark', maxLod: 0, tag: 'bore' }),
    ...[-1, 1].flatMap((side): Shape[] => [
      cylinder({ radius: 0.027, height: 0.19, axis: 'z', at: [side * 0.105, by, z + 0.272], segments: 8, caps: false, mat: 'dark', smooth: 65, maxLod: 0, tag: 'recoil' }),
      cylinder({ radius: 0.014, height: 0.105, axis: 'z', at: [side * 0.105, by, z + 0.398], segments: 6, caps: false, mat: 'copper', smooth: 65, maxLod: 0, tag: 'recoil' }),
      box({ size: [0.04, 0.06, 0.045], at: [side * 0.094, by - 0.006, z + 0.44], mat: 'body', maxLod: 0, tag: 'recoil-mount' }),
    ]),
    beveledBox({ size: [0.065, 0.068, 0.135], bevel: { top: 0.013 }, at: [0.17, y + 0.175, z + 0.115], mat: 'dark', maxLod: 0, tag: 'optic' }),
    cylinder({ radius: 0.02, height: 0.009, axis: 'z', at: [0.17, y + 0.175, z + 0.187], segments: 8, mat: 'glass', maxLod: 0, tag: 'optic' }),
    box({ size: [0.11, 0.012, 0.08], at: [0, y + 0.239, z - 0.025], mat: 'body', maxLod: 0, tag: 'hatch' }),
    box({ size: [0.11, 0.032, 0.12], at: [0, y + 0.092, z - 0.246], mat: 'copper', maxLod: 0, tag: 'breech' }),
    cylinder({ radius: 0.073, height: len, axis: 'z', at: [0, by, barrelFrom + len / 2], segments: 6, caps: 'top', mat: 'dark', minLod: 1, keep: true, tag: 'barrel' }),
    box({ size: [0.22, 0.14, 0.12], at: [0, by, z + BELL_R - 0.02], mat: 'body', minLod: 1, maxLod: 1, keep: true }),
    frustum({ radius: 0.27, radiusTop: 0.17, height: 0.215, at: [0, y + 0.1075, z], segments: 8, mat: 'team', minLod: 2, keep: true, tag: 'bell' }),
  ];
}

function hullDetails(): Shape[] {
  return [
    // Schmale Kielwanne unter der umlaufenden Panzerkante lässt Hüften und Beine frei.
    extrude({ profile: [[-0.68, HULL_BOTTOM], [0.54, HULL_BOTTOM], [0.69, 0.565], [0.55, 0.62], [-0.67, 0.62], [-0.76, 0.545]], depth: 0.6, mat: 'dark', maxLod: 0, tag: 'keel' }),
    ...[-1, 1].flatMap((side): Shape[] => [
      // Schulterplatten haben eine eigene Frontfase und hängen über der seitlichen Kühlrinne.
      extrude({ profile: [[-0.67, 0.71], [-0.56, 0.805], [0.49, 0.805], [0.67, 0.7], [0.51, 0.642], [-0.62, 0.642]], depth: 0.13, at: [side * 0.337, 0, 0], mat: 'team', maxLod: 0, tag: 'shoulder-armor' }),
      extrude({ profile: [[-0.55, 0.563], [-0.49, 0.625], [0.42, 0.625], [0.54, 0.57], [0.42, 0.52], [-0.5, 0.52]], depth: 0.035, at: [side * 0.397, 0, 0], mat: 'body', maxLod: 0, tag: 'side-armor' }),
      cylinder({ radius: 0.111, height: 0.095, axis: 'x', at: [side * 0.313, HIP_Y, 0], segments: 10, caps: false, mat: 'body', smooth: 65, maxLod: 0, tag: 'hip-housing' }),
      strut({ from: [side * 0.23, 0.57, -0.32], to: [side * 0.313, HIP_Y, -0.025], radius: 0.032, sides: 4, mat: 'copper', maxLod: 0, tag: 'hip-brace' }),
      // Langsseitige Kupferkühlrinne, geschützt zwischen Deck und unterer Gussplatte.
      box({ size: [0.032, 0.039, 0.74], at: [side * 0.403, 0.636, -0.045], mat: 'copper', maxLod: 0, tag: 'coolant-rail' }),
      ...[-0.34, -0.08, 0.18].map((z) => box({ size: [0.022, 0.065, 0.05], at: [side * 0.42, 0.633, z], mat: 'dark', maxLod: 0, tag: 'rail-guard' })),
    ]),
    beveledBox({ size: [0.53, 0.1, 0.2], bevel: { topFront: 0.035 }, at: [0, 0.67, 0.643], mat: 'body', maxLod: 0, tag: 'bow' }),
    beveledBox({ size: [0.59, 0.12, 0.175], bevel: { topBack: 0.025 }, at: [0, 0.708, -0.691], mat: 'dark', maxLod: 0, tag: 'cooling-bank' }),
    // Sichtbare Lamellenbank unter den Tech-Streifen, ohne Schlot oder Glutkern.
    ...[-0.235, -0.141, -0.047, 0.047, 0.141, 0.235].map((x) => box({ size: [0.035, 0.065, 0.135], at: [x, 0.774, -0.696], mat: 'copper', maxLod: 0, tag: 'cooling-fin' })),
    box({ size: [0.64, 0.07, 0.045], at: [0, 0.671, -0.805], mat: 'copper', maxLod: 0, tag: 'manifold' }),
    quad({ size: [0.36, 0.015], at: [0, 0.673, -0.8315], rot: [-90, 0, 0], mat: 'glow', maxLod: 0, tag: 'glow-seam' }),
    // Zwei Laststreben stützen den erhöhten Sockel unterhalb des drehenden Waffenpakets.
    ...[-1, 1].map((side) => strut({ from: [side * 0.165, PLATE_TOP, -0.21], to: [side * 0.16, REAR_Y - 0.024, REAR_Z], radius: 0.032, sides: 4, mat: 'copper', maxLod: 0, tag: 'pedestal-brace' })),
  ];
}

export default defineModel({
  id: 'core:lnd_t3_bot',
  budget: { tris: [2600, 700, 240] },
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.8, DECK_TOP - 0.56, 1.5], at: [0, (DECK_TOP + 0.56) / 2, -0.05], bevel: { top: 0.05, topFront: 0.12, topBack: 0.04 }, mat: 'body', keep: true, tag: 'hull' }),
        box({ size: [0.66, PLATE_TOP - DECK_TOP, 1.34], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.1], mat: 'team', keep: true }),
        cylinder({ radius: 0.22, height: 0.2, at: [0, PLATE_TOP + 0.1, REAR_Z], segments: 10, caps: false, mat: 'dark', smooth: 65, keep: true, tag: 'bell' }),
        stripes({ count: 3, width: 0.56, gap: 0.06, at: [0, PLATE_TOP + 0.028, -0.5] }),
        ...hullDetails(),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0], anim: 'legs', shapes: leg(-1) },
    { name: 'turret', pivot: [0, PLATE_TOP, FRONT_Z], anim: 'yaw', shapes: bell(PLATE_TOP, FRONT_Z, FRONT_Z + 0.2, 1.14) },
    { name: 'turret2', pivot: [0, REAR_Y, REAR_Z], anim: 'yaw', shapes: bell(REAR_Y, REAR_Z, REAR_Z + 0.2, 0.84) },
  ],
  notes: 'Erhöhtes lokales Detailbudget für Gelenklager, Gussplatten, getrennte Zehen, Kühlbank und mechanische Rohrlager mit Bohrung, Optik und Rücklauf. LOD1/2 erhalten kompakte Ersatzformen. Hintere Glocke 0,2 WU überhöht, Rohre bleiben fest an den Glocken.',
});
