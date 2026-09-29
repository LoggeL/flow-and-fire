/**
 * Meißel (core:lnd_t2_tank) – Varkan-Schwerer Panzer T2.
 *
 * Roster: „Punze ×1,3, breitere Glocke mit zwei parallelen Rohren, seitliche Schürzenplatten, 2 Tech-Streifen.“
 * Tech-Skalierung (faction.md §3.4): gleiche Grundform wie die Punze (Wanne mit Bugfase, mittige Glocke,
 * waagerechte Rohre über den Bug), T2-Merkmale = zweites Rohr, breitere Glocke, Schürzenplatten, 2 Streifen.
 * Maßstab 1,3 wird beim Export eingebacken; die Basiswanne ist mit 1,10 WU etwas kürzer als die der Punze, damit die
 * Einheit samt Rohren im Footprint-Check bleibt (≤ 200 % der 1×1-Kante: 1,53 × 1,3 = 1,99 WU); Rohre 0,66 WU = 60 % bzw. ab Glockenmitte 0,88 WU.
 * Paartest Meißel↔Rinne: Kuppel + waagerechte Rohre gegen schrägen Kasten.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull   – Ketten, Deck mit Bugfase, Deckplatte (team), Schürzenplatten links/rechts, Heckkrümmer mit Glutschlitzen,
 *            Kupferleitungen (nur LOD0), 2 Tech-Streifen
 *   turret – breite Glocke (team), dreht um +Y                                 (PartStream 1)
 *   barrel – Blende + zwei parallele Rohre mit Kupfermündungen, Pitch          (PartStream 2, an der Glocke)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, stripes } from '@faf/modelkit';

const TRACK_PROFILE: readonly (readonly [number, number])[] = [
  [-0.45, 0],
  [0.43, 0],
  [0.55, 0.12],
  [0.49, 0.24],
  [-0.49, 0.24],
  [-0.55, 0.12],
];

const DECK_TOP = 0.42;
const PLATE_TOP = 0.45;
const BELL_Y = PLATE_TOP;
const BELL_Z = 0.06;
const BARREL_Y = 0.63;
const BARREL_X = 0.1;

export default defineModel({
  id: 'core:lnd_t2_tank',
  parts: [
    {
      name: 'hull',
      shapes: [
        mirrorX(extrude({ profile: TRACK_PROFILE, depth: 0.22, axis: 'x', at: [0.39, 0, 0], mat: 'dark', tag: 'tracks' })),
        box({ size: [0.56, 0.18, 0.96], at: [0, 0.15, 0], mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({
          size: [1.0, DECK_TOP - 0.24, 1.1],
          at: [0, (DECK_TOP + 0.24) / 2, 0],
          bevel: { top: 0.05, topFront: 0.13, topBack: 0.04 },
          mat: 'body',
          tag: 'hull',
        }),
        box({ size: [0.8, PLATE_TOP - DECK_TOP, 0.94], at: [0, (PLATE_TOP + DECK_TOP) / 2, -0.04], mat: 'team' }),
        // Seitliche Schürzenplatten (T2-Merkmal) über den Ketten
        mirrorX(extrude({ profile: [[-0.42, 0.2], [0.40, 0.2], [0.48, 0.3], [0.44, 0.4], [-0.46, 0.4], [-0.48, 0.34]], depth: 0.06, axis: 'x', at: [0.53, 0, 0], mat: 'body', maxLod: 1, tag: 'hull' })),
        // Heckkrümmer an der Heckfase + Glutschlitze
        box({ size: [0.9, 0.08, 0.08], at: [0, 0.36, -0.54], mat: 'copper', maxLod: 1, tag: 'manifold' }),
        mirrorX(quad({ size: [0.22, 0.04], at: [0.18, 0.404, -0.54], mat: 'glow', maxLod: 1 })),
        mirrorX(cylinder({ radius: 0.075, height: 0.64, axis: 'z', at: [0.45, DECK_TOP + 0.01, -0.13], segments: 6, caps: 'top', mat: 'copper', maxLod: 0, tag: 'barrel' })),
        stripes({ count: 2, width: 0.66, gap: 0.06, at: [0, PLATE_TOP + 0.004, -0.39] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BELL_Z],
      anim: 'yaw',
      shapes: [
        frustum({ radius: 0.345, radiusTop: 0.325, height: 0.1, at: [0, BELL_Y + 0.05, BELL_Z], segments: 8, caps: false, mat: 'team', tag: 'bell' }),
        sphere({ radius: 0.325, hemi: true, segments: 8, rings: 3, scale: [1, 0.62, 1], at: [0, BELL_Y + 0.1 + 0.1, BELL_Z], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, 0.28],
      anim: 'pitch',
      shapes: [
        box({ size: [0.38, 0.16, 0.14], at: [0, BARREL_Y, 0.32], mat: 'body' }),
        mirrorX([
          cylinder({ radius: 0.07, height: 0.66, axis: 'z', at: [BARREL_X, BARREL_Y, 0.61], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
          cylinder({ radius: 0.088, height: 0.1, axis: 'z', at: [BARREL_X, BARREL_Y, 0.89], segments: 6, mat: 'copper', maxLod: 1, tag: 'barrel' }),
          quad({ size: [0.1, 0.1], at: [BARREL_X, BARREL_Y, 0.944], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
        ]),
      ],
    },
  ],
  notes: 'Wanne 1,10 WU statt 1,36 (Punze), damit ×1,3 samt Rohren im 200-%-Footprint-Check bleibt.',
});
