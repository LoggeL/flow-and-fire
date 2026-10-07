/**
 * Riegel I (core:str_t1_pd), Varkan T1 point defense on its original 1 x 1 foundation.
 * Cast base with framed mounting feet, side radiator wells and a team-coloured bell shield.
 * The pedestal is fixed. Bearing shield and optics follow yaw; trunnions, recoil jacket and bore follow pitch.
 * No additional animation parts: original hull / turret / barrel pivots are preserved.
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes, tube } from '@faf/modelkit';

const TOP = 0.26;
const BZ = -0.08;
const BELL_Y = TOP + 0.03;
const BARREL_Y = BELL_Y + 0.19;

// Wide corner feet carry the casting. Visible fasteners attach its angled gussets to the lower frame.
const FEET = [-1, 1].flatMap((end) => [
  mirrorX(beveledBox({ size: [0.17, 0.08, 0.17], at: [0.375, 0.08, end * 0.375], bevel: { top: 0.018 }, mat: 'body', maxLod: 0, tag: 'hull' })),
  mirrorX(cylinder({ radius: 0.027, height: 0.014, at: [0.393, 0.127, end * 0.393], segments: 6, caps: 'top', mat: 'copper', maxLod: 0 })),
  mirrorX(extrude({ profile: [[-0.068, 0], [0.068, 0], [0.033, 0.13], [-0.035, 0.13]], depth: 0.048, axis: 'x', at: [0.394, 0.08, end * 0.318], mat: 'body', maxLod: 0 })),
]);
const RADIATORS = [-0.145, -0.087, -0.029, 0.029, 0.087, 0.145].map((z) =>
  mirrorX(box({ size: [0.025, 0.084, 0.026], at: [0.458, 0.121, z - 0.035], rot: [0, 0, 15], mat: 'body', maxLod: 0 })),
);
const SHIELD_SEAMS = [-55, 0, 55].map((angle) =>
  box({ size: [0.018, 0.055, 0.03], at: [0.306 * Math.sin(angle * Math.PI / 180), 0.334, BZ - 0.306 * Math.cos(angle * Math.PI / 180)], rot: [0, -angle, 0], mat: 'body', maxLod: 0 }),
);

export default defineModel({
  id: 'core:str_t1_pd',
  budget: { tris: [2400, 650, 220] },
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.9, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.09 }, mat: 'body', tag: 'hull' }),
        ...FEET,
        // Perimeter frame and a dark seam under the casting read as a mounted machine, not a solid plinth.
        mirrorX(box({ size: [0.026, 0.021, 0.62], at: [0.463, 0.054, 0], mat: 'body', maxLod: 0 })),
        ...[-0.463, 0.463].map((z) => box({ size: [0.62, 0.021, 0.026], at: [0, 0.054, z], mat: 'body', maxLod: 0 })),
        tube({ outer: 0.36 * Math.SQRT2, inner: 0.25 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [0.72, 0.03, 0.72], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        // Fixed bearing flange with a recessed race beneath the turret's rotating skirt.
        cylinder({ radius: 0.24, height: 0.03, at: [0, TOP + 0.015, BZ], segments: 8, caps: 'top', mat: 'copper', minLod: 1, maxLod: 1 }),
        cylinder({ radius: 0.264, height: 0.024, at: [0, 0.275, BZ], segments: 16, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 }),
        cylinder({ radius: 0.25, height: 0.017, at: [0, 0.293, BZ], segments: 16, caps: false, mat: 'dark', smooth: 80, maxLod: 0 }),
        ...[-0.27, 0.27].flatMap((x) => [-0.27, 0.27].map((z) => cylinder({ radius: 0.023, height: 0.012, at: [x, 0.296, z], segments: 6, caps: 'top', mat: 'body', maxLod: 0 }))),
        // The side wells are below the cooling pipes. Raised slats leave dark gaps and separate upper/lower rails.
        mirrorX(box({ size: [0.014, 0.1, 0.374], at: [0.452, 0.121, -0.035], mat: 'dark', maxLod: 0 })),
        ...RADIATORS,
        ...[0.061, 0.181].map((y) => mirrorX(box({ size: [0.034, 0.022, 0.398], at: [0.453, y, -0.035], mat: 'body', maxLod: 0 }))),
        // Forward removable service panel, hinge ears and protected recessed lock.
        box({ size: [0.302, 0.1, 0.018], at: [0, 0.123, 0.45], mat: 'dark', maxLod: 0 }),
        box({ size: [0.272, 0.08, 0.018], at: [0, 0.123, 0.461], mat: 'body', maxLod: 0 }),
        mirrorX(cylinder({ radius: 0.014, height: 0.04, axis: 'x', at: [0.102, 0.172, 0.467], segments: 6, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 })),
        cylinder({ radius: 0.026, height: 0.013, axis: 'z', at: [0, 0.122, 0.477], segments: 6, caps: 'top', mat: 'dark', maxLod: 0 }),
        // Rear heat seam remains narrow; the protective bars are real geometry above its dark well.
        quad({ size: [0.36, 0.05], at: [0, TOP - 0.045, -0.405], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        ...[-0.13, -0.043, 0.043, 0.13].map((x) => box({ size: [0.019, 0.026, 0.08], at: [x, 0.224, -0.405], rot: [-45, 0, 0], mat: 'body', maxLod: 0 })),
        mirrorX(cylinder({ radius: 0.06, height: 0.62, axis: 'z', at: [0.41, TOP - 0.035, -0.03], segments: 8, caps: 'top', mat: 'copper', smooth: 80, maxLod: 1, tag: 'barrel' })),
        ...[-0.252, 0.176].map((z) => mirrorX(cylinder({ radius: 0.068, height: 0.024, axis: 'z', at: [0.41, 0.225, z], segments: 8, caps: false, mat: 'body', smooth: 80, maxLod: 0 }))),
        mirrorX(cylinder({ radius: 0.036, height: 0.108, at: [0.41, 0.144, -0.32], segments: 8, caps: false, mat: 'copper', smooth: 80, maxLod: 0 })),
        stripes({ count: 1, width: 0.11, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.305] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BZ],
      anim: 'yaw',
      shapes: [
        // Rotating race and stepped skirt keep the original bell silhouette and exposed team armour.
        cylinder({ radius: 0.316, height: 0.02, at: [0, 0.304, BZ], segments: 16, caps: false, mat: 'body', smooth: 80, maxLod: 0 }),
        frustum({ radius: 0.31, radiusTop: 0.29, height: 0.1, at: [0, BELL_Y + 0.05, BZ], segments: 12, caps: 'bottom', mat: 'team', tag: 'bell' }),
        cylinder({ radius: 0.3, height: 0.025, at: [0, BELL_Y + 0.1125, BZ], segments: 12, caps: false, mat: 'body', maxLod: 0 }),
        sphere({ radius: 0.29, hemi: true, segments: 12, rings: 4, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.125 + 0.1015, BZ], mat: 'team', tag: 'bell' }),
        ...SHIELD_SEAMS,
        // Side cheeks overlap the front of the bell while leaving the barrel free to pitch between them.
        mirrorX(beveledBox({ size: [0.095, 0.164, 0.225], at: [0.171, 0.459, 0.078], bevel: { topFront: 0.029, top: 0.015 }, mat: 'team', maxLod: 0 })),
        mirrorX(box({ size: [0.098, 0.024, 0.19], at: [0.171, 0.378, 0.074], mat: 'body', maxLod: 0 })),
        // Rear access cap and an optic hood with a recessed glass face travel with the turret.
        cylinder({ radius: 0.087, height: 0.019, at: [0, 0.609, -0.128], segments: 8, caps: 'top', mat: 'body', maxLod: 0 }),
        cylinder({ radius: 0.067, height: 0.012, at: [0, 0.625, -0.128], segments: 8, caps: 'top', mat: 'team', maxLod: 0 }),
        box({ size: [0.062, 0.014, 0.019], at: [0, 0.638, -0.143], mat: 'copper', maxLod: 0 }),
        beveledBox({ size: [0.104, 0.055, 0.1], at: [-0.131, 0.584, 0.001], bevel: { top: 0.011 }, mat: 'body', maxLod: 0 }),
        box({ size: [0.075, 0.025, 0.008], at: [-0.131, 0.582, 0.054], mat: 'dark', maxLod: 0 }),
        box({ size: [0.055, 0.017, 0.009], at: [-0.131, 0.582, 0.055], mat: 'glass', maxLod: 0 }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, BZ + 0.24],
      anim: 'pitch',
      shapes: [
        beveledBox({ size: [0.26, 0.16, 0.14], at: [0, BARREL_Y, BZ + 0.26], bevel: { topFront: 0.05 }, mat: 'body' }),
        mirrorX(cylinder({ radius: 0.069, height: 0.124, axis: 'x', at: [0.183, BARREL_Y, BZ + 0.24], segments: 10, caps: 'top', mat: 'body', smooth: 80, maxLod: 0 })),
        mirrorX(cylinder({ radius: 0.042, height: 0.016, axis: 'x', at: [0.249, BARREL_Y, BZ + 0.24], segments: 8, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 })),
        // Hollow bore ends deep in the breech. There is no cap or glowing disc across the muzzle.
        tube({ outer: 0.085, inner: 0.055, height: 0.4, axis: 'z', at: [0, BARREL_Y, 0.31], segments: 10, mat: 'dark', smooth: 80, maxLod: 0, keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.085, height: 0.4, axis: 'z', at: [0, BARREL_Y, 0.31], segments: 6, caps: false, mat: 'dark', keep: true, minLod: 1, tag: 'barrel' }),
        cylinder({ radius: 0.102, height: 0.12, axis: 'z', at: [0, BARREL_Y, 0.29], segments: 10, caps: false, mat: 'body', smooth: 80, maxLod: 0 }),
        ...[0.234, 0.355, 0.435].map((z) => cylinder({ radius: 0.109, height: 0.025, axis: 'z', at: [0, BARREL_Y, z], segments: 10, caps: false, mat: 'copper', smooth: 80, maxLod: 0 })),
        // Paired recoil cylinders remain attached to the pitching cradle, outside the main bore.
        mirrorX(cylinder({ radius: 0.029, height: 0.172, axis: 'z', at: [0.099, 0.422, 0.292], segments: 8, caps: false, mat: 'body', smooth: 80, maxLod: 0 })),
        mirrorX(cylinder({ radius: 0.018, height: 0.08, axis: 'z', at: [0.099, 0.422, 0.406], segments: 8, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 })),
        box({ size: [0.241, 0.035, 0.047], at: [0, 0.422, 0.435], mat: 'body', maxLod: 0 }),
        tube({ outer: 0.105, inner: 0.055, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.5], segments: 10, mat: 'copper', smooth: 80, maxLod: 0, tag: 'barrel' }),
        tube({ outer: 0.105, inner: 0.055, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.5], segments: 6, mat: 'copper', minLod: 1, maxLod: 1, tag: 'barrel' }),
        cylinder({ radius: 0.105, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.5], segments: 6, mat: 'copper', minLod: 2, tag: 'barrel' }),
      ],
    },
  ],
  notes: 'Riegel I with grounded mounting feet, framed radiator wells, service panel, bearing race, layered bell shield, protected optics, trunnions and recoil cylinders. Open cannon bore in close LODs; original yaw/pitch rig and footprint retained. Detail budget is local to this model.',
});
