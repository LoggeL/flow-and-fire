/**
 * Kolkrabe (core:exp_air_gunship) – Varkan-Experimental: Kampfschweber (T4, Post-MVP PM2 / U21). In Spielgröße
 * modelliert (Maßstab 1,0), Footprint 7×7 (Baustelle/Landeplatz), Flughöhe ≈ 12 WU (Sim).
 *
 * Roster: „Fliegende Gussplatte ≈ 9,5 × 9,5 WU ohne Flügel (Gunship-Monopol): vier Ringdüsen im Kreuz um eine gefaste
 * Deckscheibe (team), darunter zwei hängende Glocken mit waagerechten Rohren, Raketenkessel im Bauch, vier senkrechte
 * Flakrohre als Kamm am Heck. Keramik-Klammer an der Deckscheibe.“
 * Von oben: Kreuz aus vier Team-Ringen um eine Team-Scheibe (≥ 45 % Draufsicht), die Rohre ragen vorn über den Rand
 * und zeigen die Richtung. Die Krähe ist dieselbe Grammatik mit einer Düse – der Kolkrabe ist ihr großer Verwandter.
 *
 * Aufbau (y = Unterkante der Glocken, +Z = Bug):
 *   hull               – Deckscheibe (Achteck, Fasen), Deckplatte (team), Rabenrücken (Gussbuckel, Oberseite team,
 *                        Kupferleisten) mit Kopf, Sehschlitzen und spitzem Schnabel, flacher gekerbter Schwanzfächer
 *                        (team, kein Flügel), vier Kupfer-Ausleger, vier Ringdüsen (Kragen team + Gussschürze),
 *                        Bauch-Raketenkessel, Flak-Rost mit vier senkrechten Rohren auf dem Rücken, Keramik-Klammer,
 *                        Heck-Glutschlitz. Von oben: Rabenkörper (Schnabel vorn, Fächer hinten) im Kreuz aus vier Ringen.
 *   rotor_1…4          – Rotoren in den Düsen, spin                                               (PartStream 1–4)
 *   turret_l/turret_r  – hängende Glocken (team) mit festem Rohr, yaw                              (PartStream 5–6)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, prism, quad, radial, sphere, tube, type PartDef, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const DECK_Y = 1.9; // Mitte der Deckscheibe
const DECK_H = 0.7;
const DECK_TOP = DECK_Y + DECK_H / 2;
const FAN_R = 1.75;
const FAN_D = 4.1; // Abstand Düsenmitte – Mitte (diagonal)
const FAN_Y = DECK_Y + 0.1;
const FANS: readonly (readonly [number, number])[] = [
  [FAN_D / Math.SQRT2, FAN_D / Math.SQRT2],
  [-FAN_D / Math.SQRT2, FAN_D / Math.SQRT2],
  [FAN_D / Math.SQRT2, -FAN_D / Math.SQRT2],
  [-FAN_D / Math.SQRT2, -FAN_D / Math.SQRT2],
];
const BELL_Y = DECK_Y - DECK_H / 2; // Oberkante der hängenden Glocken
const BELL_X = 1.35;
/** Schnabel in der Draufsicht [x, z]. */
const BEAK: readonly (readonly [number, number])[] = [
  [-1.2, 2.4],
  [1.2, 2.4],
  [0.55, 3.9],
  [0, 4.45],
  [-0.55, 3.9],
];
/** Schwanzfächer in der Draufsicht [x, z], hinten gekerbt. */
const TAIL: readonly (readonly [number, number])[] = [
  [-0.8, -2.6],
  [0.8, -2.6],
  [1.35, -4.3],
  [0, -3.85],
  [-1.35, -4.3],
];

function fanShell([x, z]: readonly [number, number]): Shape[] {
  return [
    tube({ outer: FAN_R, inner: FAN_R - 0.38, height: 0.42, segments: 12, at: [x, FAN_Y + 0.12, z], mat: 'team', keep: true, tag: 'ductfan' }),
    frustum({ radius: FAN_R - 0.05, radiusTop: FAN_R, height: 0.34, segments: 12, caps: false, at: [x, FAN_Y - 0.26, z], mat: 'body', maxLod: 1, tag: 'ductfan' }),
  ];
}

function rotor(i: number): PartDef {
  const [x, z] = FANS[i]!;
  return {
    name: `rotor_${i + 1}`,
    pivot: [x, FAN_Y, z],
    anim: 'spin',
    shapes: [
      cylinder({ radius: 0.32, height: 0.3, segments: 8, at: [x, FAN_Y + 0.05, z], caps: 'top', mat: 'copper', maxLod: 1, tag: 'ductfan' }),
      radial(box({ size: [1.1, 0.06, 0.42], at: [0.75, 0, 0], rot: [12, 0, 0], mat: 'team' }), { count: 3, startDeg: 30 * i, at: [x, FAN_Y + 0.08, z], maxLod: 0 }),
    ],
  };
}

function bell(side: 1 | -1): Shape[] {
  const x = side * BELL_X;
  const z = 0.7;
  return [
    frustum({ radius: 0.82, radiusTop: 0.8, height: 0.26, segments: 10, caps: false, at: [x, BELL_Y - 0.13, z], rot: [180, 0, 0], mat: 'team', maxLod: 1, tag: 'bell' }),
    sphere({ radius: 0.8, hemi: true, segments: 10, rings: 3, scale: [1, 0.6, 1], rot: [180, 0, 0], at: [x, BELL_Y - 0.26 - 0.24, z], mat: 'team', maxLod: 1, tag: 'bell' }),
    box({ size: [0.5, 0.4, 0.4], at: [x, BELL_Y - 0.62, z + 0.85], mat: 'body', maxLod: 1 }),
    cylinder({ radius: 0.2, height: 3.3, segments: 8, axis: 'z', at: [x, BELL_Y - 0.62, z + 2.6], caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.26, height: 0.3, segments: 8, axis: 'z', at: [x, BELL_Y - 0.62, z + 4.1], caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' }),
  ];
}

export default defineModel({
  id: 'core:exp_air_gunship',
  lodDistances: [120, 360],
  parts: [
    {
      name: 'hull',
      shapes: [
        // Deckscheibe: Achteck Ø ≈ 6 WU, darüber Deckplatte (team)
        prism({ sides: 8, radius: 3.0, height: DECK_H, at: [0, DECK_Y, 0], rot: [0, 22.5, 0], mat: 'body', keep: true, tag: 'hull' }),
        prism({ sides: 8, radius: 2.6, height: 0.06, at: [0, DECK_TOP + 0.03, 0], rot: [0, 22.5, 0], mat: 'team', keep: true }),
        // Rabenrücken: gefaster Gussbuckel längs, Oberseite team; vorn der Kopf mit Sehschlitzen, davor der Schnabel
        beveledBox({ size: [2.1, 0.6, 4.4], at: [0, DECK_TOP + 0.3, -0.35], bevel: { top: 0.22, topFront: 0.3, topBack: 0.4 }, mat: 'body', keep: true, tag: 'hull' }),
        box({ size: [1.5, 0.05, 3.3], at: [0, DECK_TOP + 0.625, -0.45], mat: 'team', maxLod: 1 }),
        mirrorX(box({ size: [0.1, 0.2, 3.6], at: [1.08, DECK_TOP + 0.2, -0.35], mat: 'copper', maxLod: 0 })),
        beveledBox({ size: [1.7, 0.7, 1.4], at: [0, DECK_TOP + 0.25, 2.35], bevel: { top: 0.18, topFront: 0.4, side: 0.2 }, mat: 'body', maxLod: 1, tag: 'hull' }),
        ...[1, -1].map((sx) => quad({ size: [0.5, 0.14], rot: [45, sx * 18, 0], at: [sx * 0.42, DECK_TOP + 0.46, 2.93], mat: 'glass', maxLod: 0 })),
        // Schnabel: spitzer Gusskeil (Draufsicht) mit Kupfergrat, zeigt die Flugrichtung
        extrude({ profile: BEAK, depth: 0.55, axis: 'y', at: [0, DECK_Y + 0.1, 0], mat: 'body', keep: true, tag: 'hull' }),
        box({ size: [0.16, 0.1, 1.9], at: [0, DECK_Y + 0.42, 3.55], mat: 'copper', maxLod: 1 }),
        // Schwanzfächer (flach, kein Flügel): gekerbte Gussplatte am Heck, Oberseite team
        extrude({ profile: TAIL, depth: 0.2, axis: 'y', at: [0, DECK_Y + 0.12, 0], mat: 'team', keep: true, tag: 'hull' }),
        // vier Ausleger (Kupfer = Leitungen zu den Düsen)
        radial(box({ size: [2.6, 0.3, 0.45], at: [2.4, 0, 0], mat: 'copper', tag: 'boom' }), { count: 4, startDeg: 45, at: [0, DECK_Y + 0.05, 0], keep: true }),
        ...FANS.flatMap((f) => fanShell(f)),
        // Bauch-Raketenkessel längs (Gondel)
        cylinder({ radius: 0.62, height: 3.6, axis: 'z', at: [0, BELL_Y - 0.35, -0.6], segments: 8, mat: 'body', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 0.66, height: 0.2, axis: 'z', at: [0, BELL_Y - 0.35, 1.0], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        // Flak-Kamm auf dem Rabenrücken: Rost (team) + vier senkrechte Rohre
        box({ size: [1.9, 0.14, 0.8], at: [0, DECK_TOP + 0.67, -1.85], mat: 'team', keep: true, tag: 'grate' }),
        ...[-0.66, -0.22, 0.22, 0.66].map((x) =>
          cylinder({ radius: 0.13, height: 1.1, at: [x, DECK_TOP + 1.25, -1.85], segments: 6, caps: 'top', mat: 'dark', keep: true, maxLod: 1, tag: 'barrel' }),
        ),
        box({ size: [1.6, 1.0, 0.26], at: [0, DECK_TOP + 1.2, -1.85], mat: 'dark', minLod: 2, tag: 'barrel' }),
        // Keramik-Klammer auf der Deckplatte, Heck-Glutschlitze
        ceramicBracket({ x: 1.8, y: DECK_TOP + 0.06, z: 0.1, len: 2.2, w: 0.3, arm: 0.6 }),
        quad({ size: [1.4, 0.12], rot: [-90, 0, 0], at: [0, DECK_Y - 0.18, -2.905], mat: 'glow', maxLod: 1 }),
      ],
    },
    rotor(0),
    rotor(1),
    rotor(2),
    rotor(3),
    { name: 'turret_l', pivot: [BELL_X, BELL_Y, 0.7], anim: 'yaw', shapes: bell(1) },
    { name: 'turret_r', pivot: [-BELL_X, BELL_Y, 0.7], anim: 'yaw', shapes: bell(-1) },
  ],
  notes: 'T4 in Spielgröße, 6 animierte Parts (4 Rotoren spin, 2 Glocken yaw). Keine Flügel (Gunship-Monopol).',
});
