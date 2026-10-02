/**
 * Punze (core:lnd_t1_tank) – Varkan-Kampfpanzer T1, Referenzmodell für alle Modell-Autoren.
 *
 * Roster: „Gedrungene Wanne 1,0×0,4×1,4 WU auf Ketten, mittige Glocke, Rohr ≈ 65 % der Rumpflänge über den Bug.“
 * Rollen-Monopol Direktfeuer (faction.md §5.2): Glocke mit waagerechtem Rohr, Rohr ≥ 60 % der Rumpflänge, ragt
 * über den Bug. Teamfarbe auf Deckplatte + Glocke (≥ 30 % der Draufsicht), Glutnaht nur als schmale Schlitze
 * (Kampfeinheit, kein Glutkern), 1 Keramik-Tech-Streifen im hinteren Deckdrittel, Kupfer am Heck und an der Mündung.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten (dunkel), Wanne unten (dunkel), Deck mit 45°-Bugfase, Deckplatte (team), Kupferleitungen +
 *            Heckkrümmer mit Glutschlitzen, Tech-Streifen
 *   turret – Glocke: Schürze (team) + Band + Kuppel (team), dreht um +Y        (PartStream-Eintrag 1)
 *   barrel – Blende + Rohr + Mündung (Kupfer) + Mündungsglut, kippt (Pitch)     (PartStream-Eintrag 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes } from '@faf/modelkit';

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

export default defineModel({
  id: 'core:lnd_t1_tank',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Ketten links/rechts (x 0.28–0.50)
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
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
        mirrorX(quad({ size: [0.15, 0.15], at: [0.275, PLATE_TOP + 0.004, -0.23], mat: 'dark', maxLod: 0 })),
        // Heckkrümmer aus Kupfer mit zwei Glutschlitzen (Glutnaht ≤ 2 % der Oberfläche)
        beveledBox({ size: [0.98, 0.08, 0.14], at: [0, DECK_TOP + 0.04, -0.54], bevel: { top: 0.02 }, mat: 'copper', tag: 'manifold' }),
        // Kupferleitungen längs der Deckkanten (Ø 0,17 WU = Mindestmaß), laufen in den Krümmer: der „Flow“
        mirrorX(cylinder({ radius: 0.085, height: 0.87, axis: 'z', at: [0.45, DECK_TOP + 0.01, -0.035], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' })),
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
        frustum({ radius: 0.31, radiusTop: 0.29, height: 0.1, at: [0, BELL_Y + 0.05, 0], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
        cylinder({ radius: 0.3, height: 0.025, at: [0, BELL_Y + 0.1125, 0], segments: 8, caps: false, mat: 'body', maxLod: 0 }),
        sphere({ radius: 0.29, hemi: true, segments: 8, rings: 3, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.125 + 0.1015, 0], mat: 'team', tag: 'bell' }),
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
        // Rohr Ø 0,17 WU (Mindestmaß 12 % der Länge), waagerecht, 0,86 WU lang
        cylinder({ radius: 0.085, height: 0.86, axis: 'z', at: [0, BARREL_Y, 0.76], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.105, height: 0.12, axis: 'z', at: [0, BARREL_Y, 1.15], segments: 6, mat: 'copper', tag: 'barrel' }),
        cylinder({ radius: 0.06, height: 0.01, axis: 'z', at: [0, BARREL_Y, 1.215], segments: 6, caps: 'top', mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
  notes: 'Referenzmodell der Kitbash-DSL (content/models/README.md).',
});
