/**
 * Konverter (core:exp_str_arty) – Varkan-Experimental: strategische Artillerie, Game-Ender (T4, Post-MVP PM3 / U21).
 * In Spielgröße modelliert (Maßstab 1,0), Footprint 10×10. Feature-IDs/Mechaniken: U21, K13, K6, XM6, XM8, XM9
 * (docs/design/experimentals.md §4.4).
 *
 * Roster: „Kippender Konverter auf 10×10: Drehbühne mit zwei Wangen, darin die birnenförmige Konverter-Kelle
 * (Ø ≈ 5 WU, team, Artillerie-Monopol) mit Steilrohr ≈ 8 WU aus der Mündung (60°), zwei Gegengewichte; Höhe ≈ 14 WU –
 * höchstes Bauwerk des Rosters. Keramik-Klammer am Sockel, kein Schlot.“
 *
 * Gleiche Grammatik wie Tiegel/Hochofen (Sockel, Drehteller, Wangen, Gegengewicht, Kelle), aber die Kelle ist eine
 * geschlossene Birne (echter Konverter: runder Boden, zylindrischer Bauch, konischer Hals, schräge Mündung), die
 * in einem Kupfer-Tragring hängt und um ihre Zapfen kippt. Aus der Mündung wächst das bereifte Steilrohr mit
 * Mündungsbremse. Wangen als A-Böcke mit Querhaupt über dem Heck, dahinter zwei Gegengewichte und das Magazin.
 * Von oben (Spielkamera): Riesenrund in Teamfarbe mit einem langen Strich nach vorn. Kampfbauwerk: Glut nur an
 * Mündung und Gegengewicht-Naht (≤ 2 %).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull  – Fuß, zweistufiger Gusssockel (Platte + Achteck-Podest), Teamfarben-Randband, Ankerpoller,
 *           Kupfer-Laufschiene, Keramik-Klammer
 *   boom  – Drehbühne, zwei A-Wangen mit Zapfenlagern, Querhaupt, Gegengewichte, Magazin, yaw           (PartStream 1)
 *   ladle – Konverterbirne (team, Loft), Tragring mit Zapfen, Mantelrohr, Steilrohr mit 3 Reifen und
 *           Mündungsbremse, pitch                                                                        (PartStream 2)
 */
import {
  beveledBox,
  box,
  cylinder,
  defineModel,
  extrude,
  group,
  loftShape,
  mirrorX,
  prism,
  quad,
  radial,
  tube,
  type Shape,
} from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const RAD = Math.PI / 180;
const SLAB = 0.25; // Fußplatte
const TOP = 1.0; // Sockeloberkante
const POD = TOP + 0.35; // Achteck-Podest oben
const TT = POD + 0.5; // Drehbühne oben
const PIV_Y = 4.85; // Zapfenachse
const PIV_Z = -0.9;
const ELEV = 60; // Rohr-Elevation in Ruhe
const TILT = 90 - ELEV; // Neigung der Birnenachse aus der Senkrechten nach vorn
const AX: [number, number] = [Math.sin(TILT * RAD), Math.cos(TILT * RAD)]; // Birnen-/Rohrachse [z, y]
/** Punkt auf der Birnen-/Rohrachse, t WU vom Zapfen. */
const along = (t: number): [number, number, number] => [0, PIV_Y + AX[1] * t, PIV_Z + AX[0] * t];
const ROT: [number, number, number] = [TILT, 0, 0];

/** Kreisring für loftShape (Punkte nach Winkel geordnet). */
function circ(y: number, r: number, n: number): { y: number; pts: [number, number][] } {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { y, pts };
}

/** Birnenprofil [y, r] entlang der lokalen Achse (y = 0 in der Zapfenachse). */
const PEAR: readonly (readonly [number, number])[] = [
  [-2.6, 0.85],
  [-2.3, 1.85],
  [-1.8, 2.45],
  [-1.1, 2.65],
  [0.55, 2.65],
  [1.3, 2.4],
  [2.2, 1.7],
  [2.8, 1.3],
];

/** A-Wange (Seitenprofil [z, y]). */
const CHEEK: readonly (readonly [number, number])[] = [
  [PIV_Z - 2.7, TT],
  [PIV_Z + 2.5, TT],
  [PIV_Z + 1.05, PIV_Y + 0.55],
  [PIV_Z + 0.35, PIV_Y + 1.05],
  [PIV_Z - 0.55, PIV_Y + 1.05],
  [PIV_Z - 1.3, PIV_Y + 0.5],
];

function pear(): Shape[] {
  return [
    // Birne: Loft je LOD mit eigener Auflösung (Loft wird nicht automatisch reduziert): 16 / 10 / 8 Punkte
    loftShape({ rings: PEAR.map(([y, r]) => circ(y, r, 16)), caps: { bottom: true }, rot: ROT, at: along(0), mat: 'team', maxLod: 0, keep: true, tag: 'ladle' }),
    loftShape({ rings: PEAR.filter((_, i) => i !== 1).map(([y, r]) => circ(y, r, 10)), caps: { bottom: true }, rot: ROT, at: along(0), mat: 'team', minLod: 1, maxLod: 1, keep: true, tag: 'ladle' }),
    loftShape({ rings: PEAR.filter((_, i) => i % 2 === 0 || i === 7).map(([y, r]) => circ(y, r, 8)), caps: { bottom: true, top: true }, rot: ROT, at: along(0), mat: 'team', minLod: 2, keep: true, tag: 'ladle' }),
    // Mündung: Kupferlippe + dunkler Grund (Artillerie = offenes Gefäß)
    tube({ outer: 1.45, inner: 1.05, height: 0.35, segments: 10, rot: ROT, at: along(2.95), mat: 'body', keep: true, maxLod: 1, tag: 'ladle' }),
    cylinder({ radius: 1.1, height: 0.05, segments: 12, caps: 'top', rot: ROT, at: along(2.7), mat: 'dark', maxLod: 1 }),
    // Tragring (Kupfer) mit Zapfen und Lagerböcken quer
    tube({ outer: 2.92, inner: 2.6, height: 0.8, segments: 16, rot: ROT, at: along(-0.2), mat: 'copper', keep: true, tag: 'ladle' }),
    cylinder({ radius: 0.55, height: 6.9, axis: 'x', at: [0, PIV_Y, PIV_Z], segments: 8, mat: 'copper', keep: true, tag: 'ladle' }),
    // Gussrippen am Bauch (vier Längsrippen, dunkel) – Rhythmus und Maßstab; liegen auf der Birnenwand (kein Überstand unten)
    group([radial(box({ size: [0.28, 1.0, 0.3], at: [0, -1.35, 2.48], mat: 'body' }), { count: 4, startDeg: 45 })], { rot: ROT, at: along(0), maxLod: 0 }),
  ];
}

function barrel(): Shape[] {
  const T_SLEEVE = [2.5, 4.6] as const; // Mantelrohr (Wiege) aus der Mündung
  const T_TUBE = [4.4, 9.5] as const; // Steilrohr
  const T_BRAKE = 9.9; // Mündungsbremse (Mitte)
  const mid = (a: readonly [number, number]): number => (a[0] + a[1]) / 2;
  const hoop = (t: number, r: number, h: number): Shape =>
    cylinder({ radius: r, height: h, rot: ROT, at: along(t), segments: 12, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' });
  return [
    cylinder({ radius: 0.95, height: T_SLEEVE[1] - T_SLEEVE[0], rot: ROT, at: along(mid(T_SLEEVE)), segments: 12, caps: 'top', mat: 'body', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.6, height: T_TUBE[1] - T_TUBE[0], rot: ROT, at: along(mid(T_TUBE)), segments: 12, caps: false, mat: 'dark', keep: true, tag: 'barrel' }),
    hoop(T_SLEEVE[1] - 0.2, 1.03, 0.35),
    group([hoop(6.3, 0.76, 0.4), hoop(8.0, 0.76, 0.4)], { maxLod: 0 }),
    // Mündungsbremse: Block mit zwei Seitenfenstern (dunkel) + Kupfermündung + Mündungsglut
    beveledBox({ size: [1.7, 1.3, 1.2], bevel: { side: 0.25 }, rot: ROT, at: along(T_BRAKE), mat: 'body', keep: true, tag: 'barrel' }),
    mirrorX(box({ size: [0.05, 0.8, 0.6], rot: ROT, at: [0.86, 0, 0], mat: 'dark', maxLod: 0 }), { at: along(T_BRAKE) }),
    cylinder({ radius: 0.55, height: 0.3, rot: ROT, at: along(T_BRAKE + 0.8), segments: 12, caps: 'top', mat: 'copper', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.34, height: 0.02, rot: ROT, at: along(T_BRAKE + 0.96), segments: 10, caps: 'top', mat: 'glow', maxLod: 0 }),
  ];
}

export default defineModel({
  id: 'core:exp_str_arty',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [9.95, SLAB, 9.95], at: [0, SLAB / 2, 0], bevel: { top: 0.1 }, mat: 'dark', maxLod: 1, tag: 'hull' }),
        beveledBox({ size: [9.6, TOP - SLAB, 9.6], at: [0, SLAB + (TOP - SLAB) / 2, 0], bevel: { top: 0.35 }, mat: 'body', keep: true, tag: 'hull' }),
        // Randband des Sockels (team) als Rahmen; LOD2 als Fläche
        tube({ outer: 4.45 * Math.SQRT2, inner: 3.95 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [8.6, 0.04, 8.6], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        // Achteck-Podest + Kupfer-Laufschiene der Drehbühne
        prism({ sides: 8, radius: 4.55, height: POD - TOP, at: [0, (TOP + POD) / 2, 0], rot: [0, 22.5, 0], mat: 'body', keep: true, maxLod: 1, tag: 'hull' }),
        cylinder({ radius: 4.35, height: 0.14, at: [0, POD + 0.07, 0], segments: 16, caps: false, mat: 'copper', maxLod: 1, tag: 'ring' }),
        // Ankerpoller an den Ecken
        radial(beveledBox({ size: [0.8, 0.55, 0.8], at: [4.3, 0, 0], bevel: { top: 0.18 }, mat: 'body', tag: 'hull' }), {
          count: 4,
          startDeg: 45,
          at: [0, TOP + 0.27, 0],
          maxLod: 0,
        }),
        ceramicBracket({ x: 4.2, y: TOP + 0.04, z: 0, len: 6.6, w: 0.38, arm: 1.1 }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, POD, 0],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 4.15, height: TT - POD, at: [0, (TT + POD) / 2, 0], segments: 16, caps: 'top', mat: 'body', keep: true, tag: 'boom' }),
        // A-Wangen mit Zapfenlagern (Kupfer)
        mirrorX(extrude({ profile: CHEEK, depth: 0.75, axis: 'x', at: [3.65, 0, 0], mat: 'body', keep: true, tag: 'boom' })),
        mirrorX(cylinder({ radius: 0.85, height: 0.4, axis: 'x', at: [4.15, PIV_Y, PIV_Z], segments: 10, mat: 'copper', keep: true, maxLod: 1, tag: 'boom' })),
        mirrorX(box({ size: [0.8, 0.2, 5.0], at: [3.65, TT + 0.1, PIV_Z - 0.1], mat: 'copper', maxLod: 1, tag: 'boom' })),
        // Querhaupt über dem Heck (verbindet die Wangen)
        beveledBox({ size: [8.0, 0.7, 0.8], at: [0, PIV_Y + 0.6, PIV_Z - 3.3], bevel: { top: 0.2 }, mat: 'body', keep: true, tag: 'boom' }),
        mirrorX(box({ size: [0.6, PIV_Y + 0.25 - TT, 0.6], at: [3.65, (PIV_Y + 0.25 + TT) / 2, PIV_Z - 3.3], mat: 'body', tag: 'boom' }), { maxLod: 1 }),
        // Gegengewichte am Heck + Kupferband + Glutnaht
        mirrorX(beveledBox({ size: [1.9, 2.1, 1.7], at: [1.55, TT + 1.05, -3.35], bevel: { top: 0.4 }, mat: 'body', keep: true, tag: 'hull' })),
        box({ size: [5.1, 0.34, 1.76], at: [0, TT + 0.75, -3.35], mat: 'copper', maxLod: 1, tag: 'hull' }),
        quad({ size: [1.4, 0.14], rot: [-90, 0, 0], at: [0, TT + 1.3, -4.205], mat: 'glow', maxLod: 1 }),
        // Magazin zwischen den Gegengewichten: liegende Geschosstrommel
        cylinder({ radius: 0.7, height: 1.1, axis: 'x', at: [0, TT + 1.55, -3.3], segments: 10, mat: 'dark', maxLod: 0, tag: 'boom' }),
      ],
    },
    {
      name: 'ladle',
      parent: 'boom',
      pivot: [0, PIV_Y, PIV_Z],
      anim: 'pitch',
      shapes: [...pear(), ...barrel()],
    },
  ],
  notes: 'T4 in Spielgröße. Birne + Rohr kippen gemeinsam um die Zapfen (pitch), Drehbühne yaw. Höchstes Bauwerk (≈ 14 WU).',
});
