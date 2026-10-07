/**
 * Punze (core:lnd_t1_tank) – Varkan-Kampfpanzer T1, Referenzmodell für alle Modell-Autoren.
 *
 * Roster: „Gedrungene Wanne 1,0×0,4×1,4 WU auf Ketten, mittige Glocke, Rohr ≈ 65 % der Rumpflänge über den Bug.“
 * Rollen-Monopol Direktfeuer (faction.md §5.2): Glocke mit waagerechtem Rohr, Rohr ≥ 60 % der Rumpflänge, ragt
 * über den Bug. Teamfarbe auf Deckplatte + Glocke (≥ 30 % der Draufsicht), Glutnaht nur als schmale Schlitze
 * (Kampfeinheit, kein Glutkern), 1 Keramik-Tech-Streifen im hinteren Deckdrittel, Kupfer am Heck und an der Mündung.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Kettenschuhe, Laufrollen und Umlenkräder, gestufte Bugpanzerung, Teamdeck, Motorlamellen,
 *            Kupferleitungen + Heckkrümmer mit Glutschlitzen, Tech-Streifen
 *   turret – Glocke: Schürze (team) + Band + Kuppel (team), Lager, Luke und Optik; dreht um +Y (PartStream 1)
 *   barrel – Blende, Lagerzapfen, Rohrmantel und offene Kupfermündung; kippt (Pitch)             (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes, tube } from '@faf/modelkit';

/** Seitenprofil einer Kette [z, y]: flacher Boden, angeschrägte Enden. */
const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.58, 0],
  [0.56, 0],
  [0.68, 0.12],
  [0.62, 0.24],
  [-0.62, 0.24],
  [-0.68, 0.12],
];

const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const BELL_Y = PLATE_TOP;
const BARREL_Y = 0.64;

// Individual shoes leave the road wheels visible between the upper and lower runs.
const TRACK_SHOES = [-0.455, -0.273, -0.091, 0.091, 0.273, 0.455].flatMap((z) =>
  [0.011, 0.229].map((y) => mirrorX(box({
    size: [0.22, 0.022, 0.165], at: [0.39, y, z], mat: 'dark', maxLod: 0, tag: 'tracks',
  }))),
);
const TRACK_ENDS = [-1, 1].flatMap((end) => [
  mirrorX(box({ size: [0.22, 0.025, 0.13], at: [0.39, 0.059, end * 0.61], rot: [end * 42, 0, 0], mat: 'dark', maxLod: 0, tag: 'tracks' })),
  mirrorX(box({ size: [0.22, 0.025, 0.13], at: [0.39, 0.18, end * 0.635], rot: [end * -30, 0, 0], mat: 'dark', maxLod: 0, tag: 'tracks' })),
]);
const ROAD_WHEELS = [-0.34, 0, 0.34].flatMap((z) => [
  mirrorX(cylinder({ radius: 0.102, height: 0.13, axis: 'x', at: [0.425, 0.12, z], segments: 6, caps: 'top', mat: 'body', smooth: 80, maxLod: 0, tag: 'tracks' })),
  mirrorX(cylinder({ radius: 0.043, height: 0.014, axis: 'x', at: [0.493, 0.12, z], segments: 4, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 })),
]);
const IDLERS = [-0.575, 0.575].flatMap((z) => [
  mirrorX(cylinder({ radius: 0.073, height: 0.13, axis: 'x', at: [0.425, 0.12, z], segments: 6, caps: 'top', mat: 'body', maxLod: 0, tag: 'tracks' })),
  mirrorX(cylinder({ radius: 0.031, height: 0.014, axis: 'x', at: [0.493, 0.12, z], segments: 4, caps: 'top', mat: 'copper', maxLod: 0 })),
]);

export default defineModel({
  id: 'core:lnd_t1_tank',
  budget: { tris: [1800, 500, 180] },
  parts: [
    {
      name: 'hull',
      shapes: [
        // Ketten links/rechts (x 0.28–0.50)
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', minLod: 1, tag: 'tracks' })),
        ...TRACK_SHOES,
        ...TRACK_ENDS,
        ...ROAD_WHEELS,
        ...IDLERS,
        mirrorX(box({ size: [0.06, 0.14, 1.08], at: [0.325, 0.12, 0], mat: 'dark', maxLod: 0, tag: 'tracks' })),
        // Wanne unten zwischen den Ketten (schließt die Lücke unter dem Deck)
        box({ size: [0.56, 0.18, 1.2], at: [0, 0.15, 0], mat: 'dark', tag: 'hull' }),
        // Deck: volle Breite, 45°-Fasen oben, steile Bugfase zeigt die Fahrtrichtung
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.36],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.14, topBack: 0.07 },
          mat: 'body',
          tag: 'hull',
        }),
        // Bannerplatte (Teamfarbe) hinter der Bugfase
        beveledBox({ size: [0.8, PLATE_TOP - DECK_TOP, 0.92], at: [0, (PLATE_TOP + DECK_TOP) / 2, 0.025], bevel: { top: 0.012 }, mat: 'team' }),
        // Abgesetzte Bugpanzerung und zwei breite Wartungsschlitze, im nahen LOD.
        beveledBox({ size: [0.6, 0.04, 0.18], at: [0, DECK_TOP + 0.018, 0.51], bevel: { topFront: 0.025 }, mat: 'team', maxLod: 0, tag: 'hull' }),
        // Stepped cheek plates, split fenders and a dark seam below the glacis.
        mirrorX(beveledBox({ size: [0.11, 0.09, 0.5], at: [0.432, 0.33, 0.235], bevel: { topFront: 0.07, top: 0.015 }, mat: 'body', maxLod: 0, tag: 'hull' })),
        mirrorX(box({ size: [0.11, 0.025, 0.36], at: [0.432, 0.435, -0.23], mat: 'team', maxLod: 0 })),
        box({ size: [0.5, 0.018, 0.055], at: [0, 0.302, 0.65], mat: 'dark', maxLod: 0 }),
        mirrorX(box({ size: [0.12, 0.055, 0.045], at: [0.24, 0.315, 0.664], mat: 'copper', maxLod: 0 })),
        mirrorX(quad({ size: [0.15, 0.15], at: [0.275, PLATE_TOP + 0.004, -0.23], mat: 'dark', maxLod: 0 })),
        // Recessed engine wells with raised louvers; enough spacing to read from above.
        ...[-0.27, -0.185].map((z) => mirrorX(box({ size: [0.145, 0.02, 0.025], at: [0.275, 0.462, z], rot: [18, 0, 0], mat: 'body', maxLod: 0 }))),
        mirrorX(box({ size: [0.03, 0.025, 0.195], at: [0.36, 0.463, -0.225], mat: 'copper', maxLod: 0 })),
        // Heckkrümmer aus Kupfer mit zwei Glutschlitzen (Glutnaht ≤ 2 % der Oberfläche)
        beveledBox({ size: [0.98, 0.08, 0.14], at: [0, DECK_TOP + 0.04, -0.54], bevel: { top: 0.02 }, mat: 'copper', tag: 'manifold' }),
        // Kupferleitungen längs der Deckkanten (Ø 0,17 WU = Mindestmaß), laufen in den Krümmer: der „Flow“
        mirrorX(cylinder({ radius: 0.085, height: 0.87, axis: 'z', at: [0.45, DECK_TOP + 0.01, -0.035], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' })),
        ...[-0.34].map((z) => mirrorX(box({ size: [0.13, 0.03, 0.055], at: [0.435, 0.505, z], mat: 'body', maxLod: 0 }))),
        mirrorX(cylinder({ radius: 0.065, height: 0.1, axis: 'z', at: [0.35, 0.43, -0.635], segments: 6, caps: false, mat: 'copper', smooth: 80, maxLod: 0 })),
        mirrorX(cylinder({ radius: 0.049, height: 0.005, axis: 'z', at: [0.35, 0.43, -0.687], segments: 6, caps: 'bottom', mat: 'dark', maxLod: 0 })),
        mirrorX(quad({ size: [0.2, 0.04], at: [0.16, DECK_TOP + 0.084, -0.54], mat: 'glow' })),
        // 1 Tech-Streifen (Keramik) im hinteren Deckdrittel
        stripes({ count: 1, width: 0.7, at: [0, PLATE_TOP + 0.004, -0.36] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, 0],
      anim: 'yaw',
      shapes: [
        // Glocke = Zylinderschürze + flache Halbkugel (Hero-Feature Direktfeuer)
        cylinder({ radius: 0.325, height: 0.035, at: [0, BELL_Y + 0.0125, 0], segments: 12, caps: false, mat: 'dark', maxLod: 0 }),
        frustum({ radius: 0.31, radiusTop: 0.29, height: 0.1, at: [0, BELL_Y + 0.05, 0], segments: 12, caps: false, mat: 'team', tag: 'bell' }),
        cylinder({ radius: 0.3, height: 0.025, at: [0, BELL_Y + 0.1125, 0], segments: 8, caps: false, mat: 'body', maxLod: 0 }),
        sphere({ radius: 0.29, hemi: true, segments: 10, rings: 3, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.125 + 0.1015, 0], mat: 'team', tag: 'bell' }),
        // Hatch and protected periscope belong to the yawing bell.
        cylinder({ radius: 0.108, height: 0.025, at: [0, 0.774, -0.05], segments: 6, caps: 'top', mat: 'body', maxLod: 0 }),
        cylinder({ radius: 0.09, height: 0.012, at: [0, 0.792, -0.05], segments: 6, caps: 'top', mat: 'team', maxLod: 0 }),
        box({ size: [0.07, 0.028, 0.018], at: [0, 0.81, -0.065], mat: 'copper', maxLod: 0 }),
        beveledBox({ size: [0.105, 0.055, 0.1], at: [-0.14, 0.755, 0.05], bevel: { top: 0.012 }, mat: 'body', maxLod: 0 }),
        box({ size: [0.075, 0.021, 0.006], at: [-0.14, 0.755, 0.103], mat: 'glass', maxLod: 0 }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, 0.24],
      anim: 'pitch',
      shapes: [
        beveledBox({ size: [0.26, 0.16, 0.14], at: [0, BARREL_Y, 0.26], bevel: { topFront: 0.05 }, mat: 'body' }),
        cylinder({ radius: 0.13, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.4], segments: 4, caps: false, mat: 'body', maxLod: 0, tag: 'barrel' }),
        mirrorX(cylinder({ radius: 0.058, height: 0.035, axis: 'x', at: [0.132, BARREL_Y, 0.265], segments: 6, caps: 'top', mat: 'copper', smooth: 80, maxLod: 0 })),
        // Rohr Ø 0,17 WU (Mindestmaß 12 % der Länge), waagerecht, 0,86 WU lang
        cylinder({ radius: 0.085, height: 0.86, axis: 'z', at: [0, BARREL_Y, 0.76], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.098, height: 0.33, axis: 'z', at: [0, BARREL_Y, 0.6], segments: 8, caps: false, mat: 'body', smooth: 80, maxLod: 0, tag: 'barrel' }),
        ...[0.49, 0.755, 1.035].map((z) => cylinder({ radius: 0.102, height: 0.035, axis: 'z', at: [0, BARREL_Y, z], segments: 8, caps: false, mat: 'copper', smooth: 80, maxLod: 0 })),
        cylinder({ radius: 0.105, height: 0.12, axis: 'z', at: [0, BARREL_Y, 1.15], segments: 6, mat: 'copper', minLod: 1, tag: 'barrel' }),
        tube({ outer: 0.105, inner: 0.063, height: 0.12, axis: 'z', at: [0, BARREL_Y, 1.15], segments: 6, mat: 'copper', smooth: 80, maxLod: 0, tag: 'barrel' }),
        cylinder({ radius: 0.062, height: 0.006, axis: 'z', at: [0, BARREL_Y, 1.184], segments: 8, caps: 'top', mat: 'dark', maxLod: 0 }),
      ],
    },
  ],
  notes: 'Referenzmodell der Kitbash-DSL (content/models/README.md). Nahdetails mit einzelnen Kettenschuhen, Laufrollen, Motorlamellen, Turmlager und offener Mündung; lokales Detailbudget auf Nutzerwunsch erhöht, Fahrwerksersatz in LOD1/2.',
});
