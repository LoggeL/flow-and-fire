/**
 * Konverter (core:exp_str_arty) – Varkan-Experimental: strategische Artillerie, Game-Ender (T4, Post-MVP PM3 / U21).
 * In Spielgröße modelliert (Maßstab 1,0), Footprint 10×10.
 *
 * Roster: „Kippender Konverter auf 10×10: Drehbühne mit zwei Wangen, darin die birnenförmige Konverter-Kelle
 * (Ø ≈ 5 WU, team, Artillerie-Monopol) mit Steilrohr ≈ 8 WU aus der Mündung (60°), zwei Gegengewichte; Höhe ≈ 14 WU –
 * höchstes Bauwerk des Rosters. Keramik-Klammer am Sockel, kein Schlot.“
 * Gleiche Grammatik wie Tiegel/Hochofen (Sockel, Drehteller, Wangen, Gegengewicht, Kelle), aber die Kelle ist eine
 * geschlossene Birne, die um ihre Zapfen kippt – das Gießgerät „Konverter“. Von oben: Riesenrund in Teamfarbe mit
 * einem langen Strich nach vorn. Kampfbauwerk: Glut nur an der Mündung (≤ 2 %).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull  – Fuß, Gusssockel, Teamfarben-Randband, Kupferkranz, Keramik-Klammer
 *   boom  – Drehbühne, zwei Wangen mit Zapfenlagern, zwei Gegengewichte am Heck, yaw           (PartStream 1)
 *   ladle – Konverterbirne (team, Boden rund, Hals konisch), Zapfenachse, Steilrohr aus der Mündung, pitch (PartStream 2)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, mirrorX, quad, sphere, tube, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TOP = 0.8; // Sockeloberkante
const TT = TOP + 0.45; // Drehbühne oben
const PIV_Y = 4.6; // Zapfenachse
const PIV_Z = -0.6;
const ELEV = 60; // Rohr-Elevation in Ruhe
const RAD = Math.PI / 180;
const DIR: [number, number] = [Math.cos(ELEV * RAD), Math.sin(ELEV * RAD)]; // [z, y]
const along = (t: number): [number, number, number] => [0, PIV_Y + DIR[1] * t, PIV_Z + DIR[0] * t];
const TILT = 90 - ELEV; // Neigung der Birnenachse aus der Senkrechten nach vorn

const CHEEK: readonly (readonly [number, number])[] = [
  [PIV_Z - 1.6, TT],
  [PIV_Z + 1.6, TT],
  [PIV_Z + 0.9, PIV_Y + 0.5],
  [PIV_Z - 0.2, PIV_Y + 0.9],
  [PIV_Z - 1.1, PIV_Y + 0.4],
];

/** Konverterbirne entlang ihrer Achse (lokal +Y), dann um die Zapfen gekippt. */
function pear(): Shape[] {
  const tilt: [number, number, number] = [TILT, 0, 0];
  const at = (t: number): [number, number, number] => [0, PIV_Y + Math.cos(TILT * RAD) * t, PIV_Z + Math.sin(TILT * RAD) * t];
  return [
    sphere({ radius: 2.3, hemi: true, segments: 14, rings: 4, scale: [1, 0.75, 1], rot: [180 + TILT, 0, 0], at: at(-0.6), mat: 'team', keep: true, tag: 'ladle' }),
    cylinder({ radius: 2.3, height: 1.5, segments: 14, caps: false, rot: tilt, at: at(0.15), mat: 'team', keep: true, tag: 'ladle' }),
    cylinder({ radius: 2.36, height: 0.3, segments: 14, caps: false, rot: tilt, at: at(0.1), mat: 'copper', maxLod: 1, tag: 'ladle' }),
    frustum({ radius: 2.3, radiusTop: 1.3, height: 1.3, segments: 14, caps: false, rot: tilt, at: at(1.55), mat: 'team', keep: true, tag: 'ladle' }),
    // Mündung: offener Kragen (Artillerie = offene Kelle), dunkler Grund
    tube({ outer: 1.35, inner: 1.0, height: 0.4, segments: 12, rot: tilt, at: at(2.35), mat: 'body', keep: true, tag: 'ladle' }),
    cylinder({ radius: 1.0, height: 0.05, segments: 12, caps: 'top', rot: tilt, at: at(2.2), mat: 'dark', maxLod: 1 }),
  ];
}

export default defineModel({
  id: 'core:exp_str_arty',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [9.9, 0.2, 9.9], at: [0, 0.1, 0], bevel: { top: 0.08 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [9.6, TOP, 9.6], at: [0, TOP / 2, 0], bevel: { top: 0.35 }, mat: 'body', keep: true, tag: 'hull' }),
        // Randband des Sockels (team) als Rahmen + Kupferkranz um die Drehbühne
        tube({ outer: 4.45 * Math.SQRT2, inner: 3.9 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [8.6, 0.04, 8.6], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        cylinder({ radius: 3.75, height: 0.12, at: [0, TOP + 0.06, 0], segments: 14, caps: false, mat: 'copper', maxLod: 1, tag: 'ring' }),
        ceramicBracket({ x: 4.2, y: TOP + 0.04, z: 0, len: 7.4, w: 0.36, arm: 1.2 }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 3.6, height: TT - TOP, at: [0, (TT + TOP) / 2, 0], segments: 14, caps: 'top', mat: 'body', keep: true, tag: 'boom' }),
        mirrorX(extrude({ profile: CHEEK, depth: 0.55, axis: 'x', at: [2.75, 0, 0], mat: 'body', keep: true, tag: 'boom' })),
        mirrorX(cylinder({ radius: 0.6, height: 0.3, axis: 'x', at: [3.15, PIV_Y, PIV_Z], segments: 8, mat: 'copper', maxLod: 1, tag: 'boom' })),
        // Gegengewichte am Heck + Glutnaht
        mirrorX(beveledBox({ size: [1.4, 1.5, 1.5], at: [1.3, TT + 0.75, -2.7], bevel: { top: 0.3 }, mat: 'body', keep: true, tag: 'hull' })),
        box({ size: [3.9, 0.3, 1.6], at: [0, TT + 0.55, -2.7], mat: 'copper', maxLod: 1, tag: 'hull' }),
        quad({ size: [1.6, 0.12], rot: [-90, 0, 0], at: [0, TT + 0.9, -3.455], mat: 'glow', maxLod: 1 }),
      ],
    },
    {
      name: 'ladle',
      parent: 'boom',
      pivot: [0, PIV_Y, PIV_Z],
      anim: 'pitch',
      shapes: [
        ...pear(),
        cylinder({ radius: 0.42, height: 5.9, axis: 'x', at: [0, PIV_Y, PIV_Z], segments: 8, mat: 'copper', keep: true, tag: 'ladle' }),
        // Steilrohr aus der Mündung (60°): Mantel, Rohr, Kupfermündung, Mündungsglut
        cylinder({ radius: 0.75, height: 2.0, rot: [TILT, 0, 0], at: along(3.2), segments: 10, caps: false, mat: 'body', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.5, height: 6.6, rot: [TILT, 0, 0], at: along(6.9), segments: 10, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.62, height: 0.6, rot: [TILT, 0, 0], at: along(10.0), segments: 10, caps: 'top', mat: 'copper', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.3, height: 0.02, rot: [TILT, 0, 0], at: along(10.31), segments: 8, caps: 'top', mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Birne + Rohr kippen gemeinsam um die Zapfen (pitch), Drehbühne yaw.',
});
