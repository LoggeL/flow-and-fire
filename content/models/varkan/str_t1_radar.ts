/**
 * Horcher I (core:str_t1_radar) – Radar T1, 2×2.
 *
 * Roster: „Hoher dünner Mast mit rechteckiger Radarplatte (wing-Prisma 1,6 × 0,8 × 0,1 WU, 35° gekippt), rotierend;
 * kein Ring (Ring = Flow/Schild).“ Intel-Monopol (faction.md §5.1/5.2): Mast = Intel, Radar immer mit Platte.
 * Paartest Horcher↔Schirm: schräge Rechteckplatte auf dünnem Mast gegen waagerechten Ring.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Fuß, flacher Gusssockel mit Teamfarben-Randband, Mastsockel, Gerätehaus, Kupferleitung, Mast, 1 Kerbe
 *   wing – Lager (Kupfer), Joch, Radarplatte (Team, 35° aus der Senkrechten nach hinten gekippt) mit dunkler
 *          Rückenrippe; dreht um +Y (PartStream 1)
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  extrude,
  frustum,
  group,
  mirrorX,
  stripes,
  strut,
  sweep,
  tube,
  type Shape,
} from '@faf/modelkit';

const TOP = 0.2; // Sockeldach
const MAST_TOP = 2.05;
/** Roster-Höhenfaktor; die Plattenneigung wird so vorverzerrt, dass sie nach dem Maßstab 35° beträgt. */
const SY = 1.0;
const TILT = Math.atan(SY * Math.tan((35 * Math.PI) / 180));
const PLATE_L = 0.8 * Math.hypot(Math.sin((35 * Math.PI) / 180), Math.cos((35 * Math.PI) / 180) / SY);
const TILT_DEG = (TILT * 180) / Math.PI;
const PY = MAST_TOP + 0.16 + (PLATE_L / 2) * Math.cos(TILT);
const PZ = -(PLATE_L / 2) * Math.sin(TILT);

/** Sensor modules live in the tilted panel's frame; this whole frame rotates with wing. */
const panel: Shape[] = [
  extrude({ profile: [
    [-0.70, -PLATE_L / 2], [0.70, -PLATE_L / 2],
    [0.8, -PLATE_L / 2 + 0.1], [0.8, PLATE_L / 2 - 0.1],
    [0.70, PLATE_L / 2], [-0.70, PLATE_L / 2],
    [-0.8, PLATE_L / 2 - 0.1], [-0.8, -PLATE_L / 2 + 0.1],
  ], depth: 0.08, axis: 'z', mat: 'team', keep: true, tag: 'wing' }),
  // Dark recessed carrier exposes the individual field-replaceable sensor cassettes.
  box({
    size: [1.44, 0.64, 0.025],
    at: [0, 0, 0.046],
    mat: 'dark',
    maxLod: 0,
  }),
  box({
    size: [1.26, 0.065, 0.075],
    at: [0, -0.245, -0.082],
    mat: 'body',
    maxLod: 1,
  }),
  box({
    size: [1.26, 0.065, 0.075],
    at: [0, 0.245, -0.082],
    mat: 'body',
    maxLod: 1,
  }),
  mirrorX(extrude({
    profile: [[-0.1, -0.3], [-0.17, -0.21], [-0.17, 0.21], [-0.1, 0.3]],
    depth: 0.08,
    axis: 'x',
    at: [0.52, 0, 0],
    mat: 'copper',
    maxLod: 0,
  })),
  // A back-to-back pair of ribs feeds the yoke into the carrier rather than a solid slab.
  mirrorX(strut({
    from: [0.12, -0.31, -0.16],
    to: [0.6, 0.2, -0.105],
    radius: 0.032,
    sides: 4,
    mat: 'body',
    maxLod: 0,
  })),
];
for (const x of [-0.475, 0, 0.475]) {
  for (const y of [-0.166, 0.166]) {
    panel.push(
      extrude({
        profile: [[-0.19, -0.14], [0.19, -0.14], [0.22, -0.11], [0.22, 0.11], [0.19, 0.14], [-0.19, 0.14], [-0.22, 0.11], [-0.22, -0.11]],
        depth: 0.034,
        axis: 'z',
        at: [x, y, 0.069],
        mat: 'team',
        maxLod: 0,
        tag: 'wing',
      }),
      box({
        size: [0.28, 0.127, 0.009],
        at: [x + 0.029, y, 0.091],
        mat: 'dark',
        maxLod: 0,
      }),
      cylinder({
        radius: 0.046,
        height: 0.017,
        axis: 'z',
        segments: 8,
        caps: 'top',
        at: [x - 0.153, y, 0.097],
        mat: 'copper',
        smooth: 50,
        maxLod: 0,
      }),
      cylinder({
        radius: 0.032,
        height: 0.022,
        axis: 'z',
        segments: 8,
        caps: 'top',
        at: [x - 0.153, y, 0.1],
        mat: 'glass',
        smooth: 50,
        maxLod: 0,
      }),
      // External waveguide bridges the paired aperture recesses.
      strut({
        from: [x - 0.08, y - 0.075, 0.1],
        to: [x + 0.15, y - 0.075, 0.1],
        radius: 0.013,
        sides: 4,
        caps: false,
        mat: 'copper',
        maxLod: 0,
      }),
    );
  }
  panel.push(box({ size: [0.42, 0.59, 0.025], at: [x, 0, 0.055], mat: 'team', minLod: 1, maxLod: 1 }));
}

const hull: Shape[] = [
  beveledBox({
    size: [1.96, 0.08, 1.96],
    at: [0, 0.04, 0],
    bevel: { top: 0.03 },
    mat: 'dark',
    maxLod: 0,
    tag: 'hull',
  }),
  // Clipped foundation corners leave a cast plinth rather than a featureless square block.
  extrude({
    profile: [[-0.76, -0.94], [0.76, -0.94], [0.94, -0.76], [0.94, 0.76], [0.76, 0.94], [-0.76, 0.94], [-0.94, 0.76], [-0.94, -0.76]],
    depth: 0.14,
    axis: 'y',
    at: [0, 0.13, 0],
    mat: 'body',
    keep: true,
    tag: 'hull',
  }),
  tube({
    outer: 0.86 * Math.SQRT2,
    inner: 0.7 * Math.SQRT2,
    height: 0.03,
    segments: 4,
    at: [0, TOP + 0.015, 0],
    mat: 'team',
    maxLod: 0,
    tag: 'hull',
  }),
  box({
    size: [1.72, 0.03, 1.72],
    at: [0, TOP + 0.015, 0],
    mat: 'team',
    minLod: 1,
    tag: 'hull',
  }),
  extrude({
    profile: [[-0.22, -0.33], [0.22, -0.33], [0.34, -0.21], [0.34, 0.21], [0.22, 0.33], [-0.22, 0.33], [-0.34, 0.21], [-0.34, -0.21]],
    depth: 0.22,
    axis: 'y',
    at: [0, TOP + 0.11, 0.05],
    mat: 'body',
    tag: 'hull',
  }),
  // Receiver cabinet, pitched lid, inset access door and separated cooling bank.
  beveledBox({
    size: [0.55, 0.33, 0.36],
    at: [-0.43, 0.39, -0.51],
    bevel: { top: 0.055, topBack: 0.07 },
    mat: 'body',
    maxLod: 1,
  }),
  beveledBox({
    size: [0.46, 0.055, 0.28],
    at: [-0.43, 0.568, -0.51],
    bevel: { top: 0.02 },
    mat: 'team',
    maxLod: 0,
  }),
  box({
    size: [0.33, 0.225, 0.013],
    at: [-0.43, 0.395, -0.698],
    mat: 'dark',
    maxLod: 0,
  }),
  box({
    size: [0.29, 0.192, 0.013],
    at: [-0.43, 0.395, -0.707],
    mat: 'ceramic',
    maxLod: 0,
  }),
  box({
    size: [0.026, 0.08, 0.018],
    at: [-0.34, 0.394, -0.721],
    mat: 'copper',
    maxLod: 0,
  }),
  beveledBox({
    size: [0.38, 0.24, 0.34],
    at: [0.42, 0.335, -0.52],
    bevel: { top: 0.045 },
    mat: 'body',
    maxLod: 1,
  }),
  box({
    size: [0.284, 0.009, 0.238],
    at: [0.42, 0.459, -0.52],
    mat: 'dark',
    maxLod: 0,
  }),
  // Cast pedestal, shaft flange and brace shoes.
  frustum({
    radius: 0.23,
    radiusTop: 0.12,
    height: 0.24,
    at: [0, TOP + 0.34, 0.05],
    segments: 8,
    caps: false,
    mat: 'dark',
    smooth: 45,
    tag: 'mast',
  }),
  cylinder({
    radius: 0.24,
    height: 0.05,
    at: [0, 0.448, 0.05],
    segments: 12,
    caps: 'top',
    mat: 'copper',
    smooth: 45,
    maxLod: 0,
  }),
  cylinder({
    radius: 0.1,
    height: MAST_TOP - TOP - 0.46,
    at: [0, (MAST_TOP + TOP + 0.46) / 2, 0.05],
    segments: 12,
    caps: 'top',
    mat: 'copper',
    smooth: 45,
    keep: true,
    tag: 'mast',
  }),
  mirrorX(strut({
    from: [0.31, 0.42, 0.05],
    to: [0.08, 1.2, 0.05],
    radius: 0.038,
    sides: 4,
    caps: false,
    mat: 'body',
    maxLod: 1,
  })),
  mirrorX(extrude({
    profile: [[-0.045, -0.055], [0.045, -0.055], [0.025, 0.055], [-0.015, 0.055]],
    depth: 0.075,
    axis: 'z',
    at: [0.31, 0.426, 0.05],
    mat: 'copper',
    maxLod: 0,
  })),
  strut({
    from: [0, 0.435, -0.235],
    to: [0, 1.01, -0.04],
    radius: 0.031,
    sides: 4,
    caps: false,
    mat: 'body',
    maxLod: 0,
  }),
  strut({
    from: [0, 0.435, 0.335],
    to: [0, 1.01, 0.14],
    radius: 0.031,
    sides: 4,
    caps: false,
    mat: 'body',
    maxLod: 0,
  }),
  cylinder({
    radius: 0.125,
    height: 0.048,
    at: [0, 1.185, 0.05],
    segments: 12,
    caps: false,
    mat: 'body',
    smooth: 45,
    maxLod: 0,
  }),
  cylinder({
    radius: 0.12,
    height: 0.052,
    at: [0, 1.65, 0.05],
    segments: 12,
    caps: false,
    mat: 'body',
    smooth: 45,
    maxLod: 0,
  }),
  // Conduits rise beside the shaft and terminate below the rotating bearing.
  sweep({
    path: [[-0.34, 0.41, -0.32], [-0.15, 0.41, -0.21], [0.15, 0.49, -0.09], [0.15, 0.78, 0.04], [0.15, 1.94, 0.04], [0.08, 2.008, 0.05]],
    radius: 0.018,
    sides: 6,
    mat: 'dark',
    smooth: 45,
    maxLod: 0,
  }),
  sweep({
    path: [[0.42, 0.315, -0.34], [0.42, 0.3, -0.15], [0.24, 0.3, -0.06], [0.12, 0.445, 0.04]],
    radius: 0.022,
    sides: 6,
    mat: 'copper',
    smooth: 45,
    maxLod: 0,
  }),
  // Drive housing attaches to the stationary mast; its output ends at the rotary flange.
  beveledBox({
    size: [0.18, 0.19, 0.15],
    at: [0.17, 1.942, 0.05],
    bevel: { top: 0.035 },
    mat: 'body',
    maxLod: 0,
  }),
  cylinder({
    radius: 0.064,
    height: 0.054,
    axis: 'x',
    at: [0.283, 1.94, 0.05],
    segments: 10,
    caps: 'top',
    mat: 'copper',
    smooth: 45,
    maxLod: 0,
  }),
  stripes({
    count: 1,
    width: 0.12,
    rot: [0, 90, 0],
    at: [0, TOP + 0.034, -0.78],
  }),
];
for (let i = 0; i < 5; i++) {
  hull.push(box({ size: [0.277, 0.014, 0.018], at: [0.42, 0.469, -0.616 + i * 0.048], mat: 'copper', maxLod: 0 }));
}

export default defineModel({
  id: 'core:str_t1_radar',
  budget: { tris: [2400, 650, 200] },
  notes: 'Detaillierte Sensor-Kassetten, rückseitiges Fachwerk, Joch und Drehlager; Service-Sockel mit Receiver, Kühlbank und Mastleitungen. Lokales Detailbudget, vereinfachte Fern-LODs.',
  parts: [
    { name: 'hull', shapes: hull },
    {
      name: 'wing',
      pivot: [0, MAST_TOP, 0.05],
      anim: 'yaw',
      shapes: [
        cylinder({
          radius: 0.155,
          height: 0.11,
          at: [0, MAST_TOP + 0.055, 0.05],
          segments: 12,
          caps: false,
          mat: 'copper',
          smooth: 45,
          tag: 'mast',
        }),
        tube({
          outer: 0.185,
          inner: 0.128,
          height: 0.044,
          at: [0, MAST_TOP + 0.019, 0.05],
          segments: 12,
          mat: 'body',
          smooth: 45,
          maxLod: 0,
        }),
        beveledBox({
          size: [0.23, 0.12, 0.34],
          at: [0, MAST_TOP + 0.14, 0.0],
          bevel: { top: 0.03 },
          mat: 'body',
          maxLod: 1,
          tag: 'boom',
        }),
        mirrorX(strut({
          from: [0.095, 2.18, -0.01],
          to: [0.49, PY - 0.12, PZ - 0.155],
          radius: 0.038,
          sides: 4,
          mat: 'body',
          maxLod: 1,
        })),
        // All braces, receiver fittings and cables below are carried by the same yaw part.
        cylinder({
          radius: 0.087,
          height: 0.34,
          axis: 'x',
          at: [0, 2.23, -0.067],
          segments: 10,
          caps: false,
          mat: 'copper',
          smooth: 45,
          maxLod: 0,
        }),
        mirrorX(cylinder({
          radius: 0.112,
          height: 0.041,
          axis: 'x',
          at: [0.187, 2.23, -0.067],
          segments: 10,
          caps: 'top',
          mat: 'body',
          smooth: 45,
          maxLod: 0,
        })),
        sweep({
          path: [[0.06, 2.135, -0.072], [0.16, 2.17, -0.18], [0.22, 2.3, -0.36], [0.31, 2.46, -0.4]],
          radius: 0.018,
          sides: 6,
          mat: 'dark',
          smooth: 45,
          maxLod: 0,
        }),
        group(panel, { at: [0, PY, PZ], rot: [-TILT_DEG, 0, 0] }),
      ],
    },
  ],
});
