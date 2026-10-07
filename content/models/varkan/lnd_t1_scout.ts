/**
 * Funke (core:lnd_t1_scout), Varkan-Späher T1.
 * Schlanke Kettenwanne, festes Bug-MG und hoher Kupfermast ohne Kopfteil.
 * Nahdetail: offene Laufrollen, abgestufte Bugpanzerung, Optikbank, Kühllamellen,
 * Mastverstrebung und Leitungen. Alle Bauteile bleiben im unveränderten hull-Part.
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, stripes, strut, sweep, tube } from '@faf/modelkit';

/** Geschlossene Fahrwerks-Silhouette für die beiden entfernten LODs. */
const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.36, 0], [0.34, 0], [0.45, 0.1], [0.4, 0.2], [-0.41, 0.2], [-0.45, 0.1],
];
const DECK_TOP = 0.33;
const PLATE_TOP = 0.36;
const MAST_Z = -0.12;
const MAST_BASE = PLATE_TOP;
const MAST_TOP = MAST_BASE + 1.0;

export default defineModel({
  id: 'core:lnd_t1_scout',
  budget: { tris: [1400, 400, 150] },
  parts: [
    {
      name: 'hull',
      shapes: [
        // Im Nahmodell liegt der Kettengurt außen um echte Laufrollen.
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.17, axis: 'x', at: [0.245, 0, 0], mat: 'dark', minLod: 1, tag: 'tracks' })),
        mirrorX([
          box({ size: [0.17, 0.025, 0.7], at: [0.245, 0.0125, -0.01], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          box({ size: [0.17, 0.025, 0.81], at: [0.245, 0.1875, -0.005], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          extrude({ profile: [[0.34, 0], [0.45, 0.1], [0.4, 0.2], [0.375, 0.175], [0.422, 0.098], [0.325, 0.025]], depth: 0.17, axis: 'x', at: [0.245, 0, 0], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          extrude({ profile: [[-0.36, 0], [-0.45, 0.1], [-0.41, 0.2], [-0.385, 0.175], [-0.423, 0.1], [-0.35, 0.025]], depth: 0.17, axis: 'x', at: [0.245, 0, 0], mat: 'dark', maxLod: 0, tag: 'tracks' }),
          ...[-0.31, -0.155, 0, 0.155, 0.31].flatMap((z) => [
            cylinder({ radius: 0.071, height: 0.13, axis: 'x', at: [0.245, 0.099, z], segments: 6, caps: 'top', mat: 'body', maxLod: 0, smooth: true, tag: 'tracks' }),
            cylinder({ radius: 0.032, height: 0.015, axis: 'x', at: [0.318, 0.099, z], segments: 4, caps: 'top', mat: 'copper', maxLod: 0 }),
          ]),
          // Zwei Querstege machen den unteren Kettenlauf und dessen Richtung lesbar.
          ...[-0.22, 0.22].map((z) => box({ size: [0.176, 0.017, 0.037], at: [0.245, 0.017, z], mat: 'body', maxLod: 0 })),
        ]),
        box({ size: [0.34, 0.14, 0.74], at: [0, 0.13, 0], mat: 'dark', tag: 'hull' }),
        beveledBox({
          size: [0.68, DECK_TOP - 0.19, 0.88], at: [0, (DECK_TOP + 0.19) / 2, 0],
          bevel: { top: 0.04, topFront: 0.11, topBack: 0.05 }, mat: 'body', tag: 'hull',
        }),
        beveledBox({ size: [0.58, PLATE_TOP - DECK_TOP, 0.66], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.02], bevel: { top: 0.012 }, mat: 'team' }),
        // Zweite, geknickte Buglage: schmaler Kiel unten, zurückgesetzte obere Kante.
        extrude({ profile: [[0.285, 0.205], [0.43, 0.185], [0.477, 0.23], [0.445, 0.284], [0.35, 0.315]], depth: 0.43, axis: 'x', mat: 'body', maxLod: 0, tag: 'hull' }),
        mirrorX(extrude({ profile: [[0.23, 0.339], [0.34, 0.339], [0.404, 0.284], [0.35, 0.28]], depth: 0.16, axis: 'x', at: [0.2, 0, 0], mat: 'team', maxLod: 0 })),
        beveledBox({ size: [0.24, 0.09, 0.1], at: [0, 0.27, 0.43], bevel: { topFront: 0.03 }, mat: 'dark', maxLod: 1 }),
        quad({ size: [0.12, 0.03], at: [0, 0.279, 0.487], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
        // Optikbank sitzt flach auf dem Bug, der hohe Mast bleibt kopflos.
        box({ size: [0.27, 0.055, 0.08], at: [0, 0.347, 0.313], mat: 'dark', maxLod: 0 }),
        ...[-0.085, 0, 0.085].flatMap((x) => [
          tube({ outer: 0.03, inner: 0.022, height: 0.035, axis: 'z', at: [x, 0.348, 0.357], segments: 6, mat: 'body', maxLod: 0 }),
          cylinder({ radius: 0.021, height: 0.008, axis: 'z', at: [x, 0.348, 0.371], segments: 6, caps: 'top', mat: 'glass', maxLod: 0, smooth: true }),
        ]),
        // Seitliche Team-Paneele und versenkte Lüftungen über dem offenen Fahrwerk.
        mirrorX([
          box({ size: [0.015, 0.074, 0.2], at: [0.333, 0.267, 0.075], mat: 'team', maxLod: 0 }),
          box({ size: [0.016, 0.06, 0.19], at: [0.329, 0.256, -0.185], mat: 'dark', maxLod: 0 }),
          ...[-0.24, -0.185, -0.13].map((z) => box({ size: [0.022, 0.048, 0.012], at: [0.336, 0.255, z], rot: [10, 0, 0], mat: 'body', maxLod: 0 })),
          // Kupferleitung vom Heckkrümmer zum vorderen Fahrwerksanschluss.
          sweep({ path: [[0.295, 0.341, -0.355], [0.305, 0.341, -0.3], [0.305, 0.341, 0.09], [0.305, 0.294, 0.155]], radius: 0.018, sides: 4, caps: false, mat: 'copper', maxLod: 0, smooth: 60 }),
          box({ size: [0.058, 0.016, 0.04], at: [0.301, 0.354, -0.065], mat: 'body', maxLod: 0 }),
        ]),
        frustum({ radius: 0.13, radiusTop: 0.085, height: 0.1, at: [0, MAST_BASE + 0.05, MAST_Z], segments: 6, caps: 'top', mat: 'body', tag: 'mast' }),
        cylinder({ radius: 0.065, height: MAST_TOP - MAST_BASE, axis: 'y', at: [0, (MAST_TOP + MAST_BASE) / 2, MAST_Z], segments: 6, caps: false, mat: 'copper', keep: true, tag: 'mast' }),
        cylinder({ radius: 0.07, height: 0.05, at: [0, MAST_TOP + 0.025, MAST_Z], segments: 6, caps: 'top', mat: 'glow', keep: true, tag: 'mast' }),
        // Schmale Spannhülsen und zwei Diagonalstreben am Mastfuß.
        ...[0.57, 0.99].map((y) => cylinder({ radius: 0.074, height: 0.025, at: [0, y, MAST_Z], segments: 6, caps: false, mat: 'body', maxLod: 0 })),
        mirrorX(strut({ from: [0.17, 0.365, -0.27], to: [0.04, 0.58, MAST_Z], radius: 0.014, sides: 4, caps: false, mat: 'body', maxLod: 0 })),
        cylinder({ radius: 0.025, height: 0.04, at: [-0.2, 0.379, -0.25], segments: 6, mat: 'body', maxLod: 0 }),
        strut({ from: [-0.2, 0.39, -0.25], to: [-0.2, 0.67, -0.28], radius: 0.008, radiusEnd: 0.004, sides: 4, caps: false, mat: 'copper', maxLod: 0 }),
        beveledBox({ size: [0.6, 0.06, 0.1], at: [0, DECK_TOP + 0.03, -0.37], bevel: { top: 0.015 }, mat: 'copper', tag: 'manifold' }),
        quad({ size: [0.3, 0.035], at: [0, DECK_TOP + 0.064, -0.37], mat: 'glow' }),
        stripes({ count: 1, width: 0.5, at: [0, PLATE_TOP + 0.004, -0.25] }),
      ],
    },
  ],
  notes: 'Detailbudget lokal angehoben: Laufrollen, Buglagen, Optik, Kühllamellen und Leitungen nur in LOD0. LOD1/2 behalten den geschlossenen Kettenumriss. Kein Turm; Rumpf-MG starr im Bug, Mast ohne Kopfteil und Glutnaht an der Spitze.',
});
