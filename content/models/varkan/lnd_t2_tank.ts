/**
 * Meißel (core:lnd_t2_tank), Varkan-Schwerer Panzer T2.
 * Breite Glocke, zwei parallele Rohre, schwere Schürzenplatten und zwei Tech-Streifen.
 * Die 1,10-WU-Wanne bleibt samt Rohren nach ×1,3 im bisherigen Footprint.
 * Nahmodell: offenes Laufwerk, gestaffelte Panzerung, Kühlerbank und gekoppelte Rücklaufrohre.
 * LOD1 behält Panzerplatten und Ring; LOD2 verwendet geschlossene Ketten und die Glocken-Grundform.
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes, tube } from '@faf/modelkit';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.45, 0], [0.43, 0], [0.55, 0.12], [0.49, 0.24], [-0.49, 0.24], [-0.55, 0.12],
];
const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const BELL_Y = PLATE_TOP;
const BELL_Z = 0.06;
const BARREL_Y = 0.63;
const BARREL_X = 0.1;

// Sichtbare Radkörper und versenkte Naben zwischen den oberen Schürzen und dem unteren Kettenband.
const roadWheels = [-0.345, -0.115, 0.115, 0.345].flatMap((z) => [
  cylinder({ radius: 0.103, height: 0.105, axis: 'x', at: [0.463, 0.12, z], segments: 6, caps: 'top', mat: 'body', smooth: 70, maxLod: 0, tag: 'tracks' }),
  cylinder({ radius: 0.036, height: 0.012, axis: 'x', at: [0.521, 0.12, z], segments: 4, caps: 'top', mat: 'copper', smooth: 70, maxLod: 0 }),
  box({ size: [0.025, 0.03, 0.11], at: [0.415, 0.17, z + 0.025], rot: [-25, 0, 0], mat: 'dark', maxLod: 0 }),
]);
const treadShoes = Array.from({ length: 6 }, (_, i) => -0.405 + i * 0.162).map((z) =>
  box({ size: [0.225, 0.022, 0.076], at: [0.413, 0.229, z], mat: 'body', maxLod: 0, tag: 'tracks' }),
);
const skirtPanels = [-0.31, -0.04, 0.23].map((z) =>
  extrude({ profile: [[-0.115, 0.215], [0.115, 0.215], [0.115, 0.338], [0.09, 0.363], [-0.09, 0.363], [-0.115, 0.338]], depth: 0.04, axis: 'x', at: [0.544, 0, z], mat: 'body', maxLod: 0 }),
);
const coolingFins = Array.from({ length: 3 }, (_, i) =>
  box({ size: [0.023, 0.038, 0.135], at: [-0.18 + i * 0.18, 0.47, -0.43], mat: 'body', maxLod: 0 }),
);

export default defineModel({
  id: 'core:lnd_t2_tank',
  budget: { tris: [2000, 550, 180] },
  parts: [
    {
      name: 'hull',
      shapes: [
        // Vollkörper nur auf Distanz; im Nahmodell lassen Bänder die Laufrollen erkennen.
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', minLod: 1, tag: 'tracks' })),
        mirrorX([
          box({ size: [0.2, 0.045, 0.9], at: [0.4, 0.0225, -0.01], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          box({ size: [0.2, 0.045, 0.92], at: [0.4, 0.215, -0.01], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          box({ size: [0.225, 0.15, 0.04], at: [0.413, 0.102, 0.492], rot: [37, 0, 0], mat: 'body', maxLod: 0, tag: 'tracks' }),
          box({ size: [0.225, 0.15, 0.04], at: [0.413, 0.102, -0.506], rot: [-37, 0, 0], mat: 'body', maxLod: 0, tag: 'tracks' }),
          ...roadWheels,
          ...treadShoes,
        ]),
        box({ size: [0.56, 0.18, 0.96], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [1.0, DECK_TOP - 0.24, 1.1], at: [0, (DECK_TOP + 0.24) / 2, 0], bevel: { top: 0.05, topFront: 0.13, topBack: 0.05 }, mat: 'body', tag: 'hull' }),
        beveledBox({ size: [0.8, PLATE_TOP - DECK_TOP, 0.94], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.04], bevel: { topFront: 0.018 }, mat: 'team' }),
        // Gestaffelte Bugplatten mit abgeschrägten Rändern und zurückgesetztem Unterbug.
        beveledBox({ size: [0.76, 0.065, 0.2], at: [0, 0.382, 0.435], rot: [-12, 0, 0], bevel: { topFront: 0.025, side: 0.016 }, mat: 'body', maxLod: 1 }),
        beveledBox({ size: [0.62, 0.032, 0.16], at: [0, 0.43, 0.405], rot: [-8, 0, 0], bevel: { topFront: 0.013 }, mat: 'team', maxLod: 0 }),
        box({ size: [0.6, 0.035, 0.065], at: [0, 0.253, 0.48], mat: 'dark', maxLod: 0 }),
        mirrorX(extrude({ profile: [[-0.42, 0.2], [0.40, 0.2], [0.48, 0.3], [0.44, 0.4], [-0.46, 0.4], [-0.48, 0.34]], depth: 0.04, axis: 'x', at: [0.53, 0, 0], mat: 'body', maxLod: 1, tag: 'hull' })),
        mirrorX(skirtPanels),
        // Geschütztes Kühlergehäuse mit offenen dunklen Kanälen zwischen den Rippen.
        box({ size: [0.9, 0.08, 0.08], at: [0, 0.36, -0.54], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        box({ size: [0.51, 0.024, 0.135], at: [0, 0.453, -0.43], mat: 'dark', maxLod: 0, tag: 'manifold' }),
        ...coolingFins,
        mirrorX(quad({ size: [0.22, 0.02], at: [0.18, 0.404, -0.54], mat: 'glow', maxLod: 1 })),
        mirrorX(cylinder({ radius: 0.058, height: 0.64, axis: 'z', at: [0.45, DECK_TOP + 0.01, -0.13], segments: 8, caps: 'top', mat: 'copper', smooth: 70, maxLod: 0, tag: 'manifold' })),
        mirrorX([
          box({ size: [0.08, 0.025, 0.04], at: [0.45, 0.47, -0.31], mat: 'body', maxLod: 0 }),
          box({ size: [0.12, 0.02, 0.1], at: [0.29, 0.462, -0.24], mat: 'body', maxLod: 0 }),
          box({ size: [0.032, 0.018, 0.085], at: [0.29, 0.48, -0.24], mat: 'copper', maxLod: 0 }),
        ]),
        stripes({ count: 2, width: 0.66, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.29] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BELL_Z],
      anim: 'yaw',
      shapes: [
        // Breiter gestufter Drehkranz; die Glocke bleibt der Direktfeuer-Rollenmarker.
        cylinder({ radius: 0.37, height: 0.045, at: [0, BELL_Y + 0.024, BELL_Z], segments: 12, caps: false, mat: 'dark', maxLod: 1 }),
        cylinder({ radius: 0.35, height: 0.025, at: [0, BELL_Y + 0.053, BELL_Z], segments: 12, caps: false, mat: 'copper', maxLod: 0 }),
        frustum({ radius: 0.345, radiusTop: 0.325, height: 0.1, at: [0, BELL_Y + 0.05, BELL_Z], segments: 10, caps: false, mat: 'team', tag: 'bell' }),
        sphere({ radius: 0.325, hemi: true, segments: 10, rings: 3, scale: [1, 0.62, 1], at: [0, BELL_Y + 0.2, BELL_Z], mat: 'team', tag: 'bell' }),
        mirrorX([
          beveledBox({ size: [0.13, 0.125, 0.265], at: [0.275, 0.592, 0.10], rot: [0, -12, 0], bevel: { top: 0.035, topFront: 0.025 }, mat: 'team', maxLod: 1 }),
          box({ size: [0.047, 0.025, 0.15], at: [0.338, 0.574, 0.025], mat: 'body', maxLod: 0 }),
        ]),
        cylinder({ radius: 0.102, height: 0.028, at: [0, 0.752, 0.006], segments: 8, mat: 'body', smooth: 70, maxLod: 0 }),
        box({ size: [0.075, 0.018, 0.021], at: [0, 0.774, 0.006], mat: 'copper', maxLod: 0 }),
        // Periskopoptik und geschützte Frontlinse drehen mit dem Turm.
        box({ size: [0.09, 0.038, 0.055], at: [-0.15, 0.737, 0.08], mat: 'body', maxLod: 0 }),
        box({ size: [0.066, 0.019, 0.007], at: [-0.15, 0.741, 0.111], mat: 'glass', maxLod: 0 }),
        box({ size: [0.07, 0.045, 0.035], at: [0.253, 0.658, 0.218], mat: 'body', maxLod: 0 }),
        box({ size: [0.047, 0.025, 0.006], at: [0.253, 0.658, 0.239], mat: 'glass', maxLod: 0 }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, 0.28],
      anim: 'pitch',
      shapes: [
        beveledBox({ size: [0.38, 0.16, 0.14], at: [0, BARREL_Y, 0.32], bevel: { topFront: 0.045 }, mat: 'body' }),
        box({ size: [0.29, 0.115, 0.12], at: [0, BARREL_Y, 0.243], mat: 'dark', maxLod: 0 }),
        mirrorX([
          cylinder({ radius: 0.07, height: 0.66, axis: 'z', at: [BARREL_X, BARREL_Y, 0.61], segments: 6, caps: false, mat: 'dark', smooth: 70, keep: true, tag: 'barrel' }),
          cylinder({ radius: 0.087, height: 0.16, axis: 'z', at: [BARREL_X, BARREL_Y, 0.436], segments: 6, caps: false, mat: 'body', maxLod: 0, tag: 'barrel' }),
          cylinder({ radius: 0.084, height: 0.036, axis: 'z', at: [BARREL_X, BARREL_Y, 0.548], segments: 6, caps: false, mat: 'copper', smooth: 70, maxLod: 0 }),
          // Offene Kupfermündung und zurückgesetztes dunkles Rohrinnere.
          tube({ outer: 0.088, inner: 0.05, height: 0.1, axis: 'z', at: [BARREL_X, BARREL_Y, 0.89], segments: 6, mat: 'copper', smooth: 70, maxLod: 0, tag: 'barrel' }),
          cylinder({ radius: 0.049, height: 0.012, axis: 'z', at: [BARREL_X, BARREL_Y, 0.91], segments: 6, caps: 'top', mat: 'dark', maxLod: 0 }),
          cylinder({ radius: 0.088, height: 0.1, axis: 'z', at: [BARREL_X, BARREL_Y, 0.89], segments: 6, mat: 'copper', minLod: 1, maxLod: 1, tag: 'barrel' }),
          cylinder({ radius: 0.021, height: 0.22, axis: 'z', at: [BARREL_X, BARREL_Y + 0.092, 0.422], segments: 4, caps: 'top', mat: 'copper', smooth: 70, maxLod: 0 }),
          box({ size: [0.055, 0.027, 0.036], at: [BARREL_X, BARREL_Y + 0.087, 0.54], mat: 'body', maxLod: 0 }),
        ]),
      ],
    },
  ],
  notes: 'Wanne 1,10 WU; Maßstab ×1,3. Nahmodell mit Laufwerk, Zusatzpanzerung, Kühlrippen und offenen Doppelmündungen; vereinfachte Distanzmodelle.',
});
