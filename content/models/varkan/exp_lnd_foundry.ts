/**
 * Kokille (core:exp_lnd_foundry) – Varkan-Experimental: mobile Gießhalle (T4, Post-MVP PM2 / U21). In Spielgröße
 * modelliert (Maßstab 1,0), Footprint 7×9, sizeClass 7.
 *
 * Roster: „Rollende Gießhalle auf vier Kettenblöcken (7 × 9 WU): U-Portal (Fabrik-Monopol) mit glühendem
 * Werkhallentor und Heckrampe, zwei Schlote (FACTORY = Flow-Einheit), vorn zwei Deckskellen (Artillerie), seitlich
 * zwei Glocken (Direktfeuer), am Heck ein Rostkamm (Flak), mittig Schildmast mit waagerechtem Ring als höchstem
 * Punkt. Keramik-Klammer an den Deckkanten.“
 * Jede Waffe trägt die Signaturform ihrer Rolle (faction.md §5.2); die Masse liest sich von oben als flacher
 * Guss-Block mit offenem U am Heck und dem Schildring darüber.
 *
 * Aufbau (y = Boden, +Z = Bug, Heck = Ausgang):
 *   hull              – vier Kettenblöcke mit Kupfer-Laufradnaben, Unterwanne, Bugramme (Crush, XM2), Deck mit
 *                       Bugfase, Deckplatte (team) und Kupfer-Scheuerleisten, U-Portal (Wände mit teamfarbenen Kappen,
 *                       Hallendecke mit drei Sägezahn-Sheds, deren Fenster nach vorn glühen), glühendes Tor, Glutschein
 *                       an den Portal-Innenwänden, Gießrinne, Heckrampe mit Kupferkufen, zwei Schlote mit Glutkrone,
 *                       Schildmast, Keramik-Klammer. Glut ≈ 3 % (Glutkern-Band der Flow-Einheiten).
 *   turret_l/_r       – Flankenglocken (team) mit festem Rohr, yaw                                (PartStream 1–2)
 *   ladle_l/_r        – Deckskellen (team) mit Schwenkarm, yawpitch                              (PartStream 3–4)
 *   aa                – Rostkamm (team) mit vier senkrechten Flakrohren, yaw                     (PartStream 5)
 *   ring              – Schildring (team) waagerecht, spin                                       (PartStream 6)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, radial, sphere, tube, wedge, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-1.75, 0],
  [1.75, 0],
  [2.05, 0.45],
  [1.85, 1.1],
  [-1.85, 1.1],
  [-2.05, 0.45],
];
const DECK_Y0 = 1.0;
const DECK_TOP = 2.2;
const PLATE_TOP = 2.26;
const WALL_H = 2.2;
const RING_Y = 7.2;
/** Mitten der drei Sheds (z) über der Hallendecke. */
const SHEDS = [-0.23, -1.1, -1.97] as const;

function bell(side: 1 | -1): Shape[] {
  const x = side * 2.55;
  const z = 2.5;
  const y = DECK_TOP;
  return [
    frustum({ radius: 0.78, radiusTop: 0.74, height: 0.28, at: [x, y + 0.14, z], segments: 10, caps: false, mat: 'team', tag: 'bell' }),
    sphere({ radius: 0.74, hemi: true, segments: 10, rings: 3, scale: [1, 0.7, 1], at: [x, y + 0.28 + 0.26, z], mat: 'team', tag: 'bell' }),
    box({ size: [0.5, 0.36, 0.36], at: [x, y + 0.55, z + 0.78], mat: 'body', maxLod: 1 }),
    cylinder({ radius: 0.2, height: 2.3, axis: 'z', at: [x, y + 0.55, z + 1.95], segments: 8, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.26, height: 0.3, axis: 'z', at: [x, y + 0.55, z + 3.05], segments: 8, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' }),
  ];
}

function ladle(side: 1 | -1): Shape[] {
  const x = side * 1.45;
  const z = 2.2;
  const y = DECK_TOP;
  return [
    cylinder({ radius: 0.55, height: 0.3, at: [x, y + 0.15, z], segments: 8, caps: 'top', mat: 'copper', tag: 'boom' }),
    box({ size: [0.36, 0.9, 0.36], at: [x, y + 0.6, z - 0.1], rot: [-20, 0, 0], mat: 'copper', tag: 'boom' }),
    // offene Kelle Ø 1,5 WU (team), leicht nach vorn gekippt
    tube({ outer: 0.75, inner: 0.56, height: 0.6, floor: 0.14, segments: 10, at: [x, y + 1.2, z + 0.15], rot: [14, 0, 0], mat: 'team', keep: true, tag: 'ladle' }),
  ];
}

export default defineModel({
  id: 'core:exp_lnd_foundry',
  lodDistances: [120, 360],
  parts: [
    {
      name: 'hull',
      shapes: [
        // vier Kettenblöcke (je Seite vorn + hinten)
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 1.05, axis: 'x', at: [2.95, 0, 2.25], mat: 'dark', keep: true, tag: 'tracks' })),
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 1.05, axis: 'x', at: [2.95, 0, -2.25], mat: 'dark', keep: true, tag: 'tracks' })),
        box({ size: [4.6, 0.9, 8.2], at: [0, 0.75, 0], mat: 'dark', tag: 'hull' }),
        // Laufrad-Naben (Kupfer) außen an den Kettenblöcken
        ...[3.0, 1.5, -1.5, -3.0].map((z) => mirrorX(cylinder({ radius: 0.34, height: 0.14, axis: 'x', at: [3.52, 0.55, z], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'tracks' }))),
        // Bugramme (Crush, XM2): schräges Räumschild mit Kupferkante unter der Bugfase
        beveledBox({ size: [6.4, 1.0, 0.7], at: [0, 0.75, 4.55], rot: [-20, 0, 0], bevel: { topFront: 0.2, side: 0.3 }, mat: 'dark', keep: true, tag: 'hull' }),
        box({ size: [6.0, 0.18, 0.24], at: [0, 0.32, 4.82], mat: 'copper', maxLod: 1, tag: 'hull' }),
        // Deck: 6,8 × 1,2 × 8,8 WU, Bugfase
        beveledBox({
          size: [6.8, DECK_TOP - DECK_Y0, 8.8],
          at: [0, (DECK_TOP + DECK_Y0) / 2, 0],
          bevel: { top: 0.2, topFront: 0.5, topBack: 0.15 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        // Deckplatte vorn (team) zwischen den Waffen
        box({ size: [5.9, PLATE_TOP - DECK_TOP + 0.02, 3.6], at: [0, DECK_TOP + 0.02, 2.0], mat: 'team' }),
        // U-Portal hinten: zwei Wände (Kappen team) + Dach, offen nach hinten (Ausgang)
        mirrorX(beveledBox({ size: [1.2, WALL_H, 4.4], at: [2.55, DECK_TOP + WALL_H / 2, -2.2], bevel: { top: 0.3 }, mat: 'body', keep: true, tag: 'hull' })),
        mirrorX(quad({ size: [0.62, 3.8], at: [2.55, DECK_TOP + WALL_H + 0.004, -2.2], mat: 'team', maxLod: 1 })),
        beveledBox({ size: [3.95, 0.3, 2.6], at: [0, DECK_TOP + WALL_H - 0.12, -1.1], bevel: { top: 0.06 }, mat: 'body', keep: true, tag: 'hull' }),
        // Sheddach der Gießhalle: drei Sägezahn-Sheds (Schräge team), die steilen Fensterflächen nach vorn glühen von innen
        ...SHEDS.map((z) => wedge({ size: [3.7, 0.7, 0.86], at: [0, DECK_TOP + WALL_H + 0.38, z], rot: [0, 180, 0], mat: 'team', maxLod: 1, tag: 'hull' })),
        ...SHEDS.map((z) => quad({ size: [3.3, 0.6], rot: [90, 0, 0], at: [0, DECK_TOP + WALL_H + 0.33, z + 0.435], mat: 'glow', maxLod: 1 })),
        // Stirnwand der Halle (Portal ist vorn geschlossen, hinten offen = Ausgang)
        beveledBox({ size: [3.95, WALL_H - 0.2, 0.5], at: [0, DECK_TOP + (WALL_H - 0.2) / 2, 0.25], bevel: { topFront: 0.25 }, mat: 'body', keep: true, tag: 'hull' }),
        // Werkhallentor (Glutkern) an der Stirnwand innen + Gießrinne zur Heckrampe
        quad({ size: [3.4, 1.8], rot: [-90, 0, 0], at: [0, DECK_TOP + 0.95, -0.006], mat: 'glow', keep: true }),
        quad({ size: [1.4, 3.9], at: [0, DECK_TOP + 0.01, -2.3], mat: 'glow', maxLod: 1 }),
        // Glutschein an den Innenseiten der Portalwände (Halle von innen erleuchtet)
        mirrorX(quad({ size: [0.65, 4.0], rot: [0, 0, 90], at: [1.944, DECK_TOP + 1.0, -2.2], mat: 'glow', maxLod: 0 })),
        wedge({ size: [3.4, 1.45, 1.8], at: [0, 0.725, -5.2], rot: [0, 180, 0], mat: 'body', keep: true, tag: 'hull' }),
        // Rampenkufen (Kupfer) seitlich
        mirrorX(wedge({ size: [0.2, 1.5, 1.85], at: [1.8, 0.75, -5.2], rot: [0, 180, 0], mat: 'copper', maxLod: 1, tag: 'hull' })),
        // zwei Schlote auf den Portalwänden (FACTORY = Flow), Glutkrone
        mirrorX(cylinder({ radius: 0.42, height: 1.9, at: [2.55, DECK_TOP + WALL_H + 0.95, -3.4], segments: 8, caps: false, mat: 'body', keep: true, tag: 'stack' })),
        mirrorX(cylinder({ radius: 0.36, height: 0.06, at: [2.55, DECK_TOP + WALL_H + 1.88, -3.4], segments: 8, caps: 'top', mat: 'glow', maxLod: 1, tag: 'stack' })),
        // Schildmast mittig auf dem Dach
        cylinder({ radius: 0.32, height: RING_Y - (DECK_TOP + WALL_H), at: [0, (RING_Y + DECK_TOP + WALL_H) / 2, -1.2], segments: 8, caps: 'top', mat: 'dark', keep: true, tag: 'mast' }),
        cylinder({ radius: 0.42, height: 0.4, at: [0, DECK_TOP + WALL_H + 0.3, -1.2], segments: 8, caps: false, mat: 'copper', maxLod: 1, tag: 'mast' }),
        // Kupferleitungen außen an den Portalwänden (Flow zu den Schloten) + Heckkrümmer
        mirrorX(cylinder({ radius: 0.2, height: 4.2, axis: 'z', at: [3.25, DECK_TOP + 0.35, -2.2], segments: 6, mat: 'copper', maxLod: 1, tag: 'barrel' })),
        mirrorX(cylinder({ radius: 0.2, height: 2.3, at: [3.25, DECK_TOP + 1.45, -4.2], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' })),
        box({ size: [6.4, 0.3, 0.4], at: [0, DECK_TOP - 0.2, -4.45], mat: 'copper', maxLod: 1, tag: 'hull' }),
        // Kupfer-Scheuerleisten längs an den Deckflanken
        mirrorX(box({ size: [0.12, 0.25, 7.6], at: [3.44, DECK_TOP - 0.5, 0], mat: 'copper', maxLod: 0, tag: 'hull' })),
        // Keramik-Klammer an den Deckkanten vorn
        ceramicBracket({ x: 3.05, y: DECK_TOP, z: 1.3, len: 4.8, w: 0.34 }),
      ],
    },
    { name: 'turret_l', pivot: [2.55, DECK_TOP, 2.5], anim: 'yaw', shapes: bell(1) },
    { name: 'turret_r', pivot: [-2.55, DECK_TOP, 2.5], anim: 'yaw', shapes: bell(-1) },
    { name: 'ladle_l', pivot: [1.45, DECK_TOP, 2.2], anim: 'yawpitch', shapes: ladle(1) },
    { name: 'ladle_r', pivot: [-1.45, DECK_TOP, 2.2], anim: 'yawpitch', shapes: ladle(-1) },
    {
      name: 'aa',
      pivot: [0, DECK_TOP + WALL_H, -3.35],
      anim: 'yaw',
      shapes: [
        box({ size: [2.2, 0.16, 1.0], at: [0, DECK_TOP + WALL_H + 0.08, -3.35], mat: 'team', keep: true, tag: 'grate' }),
        ...[-0.75, -0.25, 0.25, 0.75].map((x) =>
          cylinder({ radius: 0.13, height: 1.3, at: [x, DECK_TOP + WALL_H + 0.8, -3.35], segments: 6, caps: 'top', mat: 'dark', keep: true, maxLod: 1, tag: 'barrel' }),
        ),
        box({ size: [1.8, 1.2, 0.26], at: [0, DECK_TOP + WALL_H + 0.75, -3.35], mat: 'dark', minLod: 2, tag: 'barrel' }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, -1.2],
      anim: 'spin',
      shapes: [
        tube({ outer: 3.7, inner: 3.3, height: 0.32, segments: 16, at: [0, RING_Y, -1.2], mat: 'team', keep: true, tag: 'ring' }),
        radial(box({ size: [3.1, 0.1, 0.16], at: [1.75, 0, 0], mat: 'copper' }), { count: 3, startDeg: 90, at: [0, RING_Y, -1.2], maxLod: 1 }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Schildring = höchster Punkt (Mobiler-Schild-Grammatik), U-Portal öffnet zum Heck (Ausgang, XM5).',
});
