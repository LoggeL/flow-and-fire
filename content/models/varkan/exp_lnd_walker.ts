/**
 * Stampfe (core:exp_lnd_walker) – Varkan-Experimental: Sturmläufer (T4, Post-MVP PM1 / U16). In Spielgröße modelliert
 * (Roster-Maßstab 1,0), Footprint 6×6, sizeClass 6.
 *
 * Roster: „Zweibeiniger Stampfkoloss, Höhe ≈ 6,3 WU (2,6× Vogt): breite Torso-Wanne (team) auf zwei Säulenbeinen mit
 * runden Stampffüßen (Ø 1,6 WU), zwei Schulterglocken mit waagerechten Rohren (Direktfeuer-Monopol), liegender
 * Rückenkessel als Gegengewicht. Keramik-Klammer statt Tech-Streifen. Kein Schlot, kein Lot-Kopf.“
 * Silhouette auf Strategic-Zoom-Distanz: zwei Säulen + breiter Querbalken + zwei lange Rohre – ein „Π“ mit Hörnern,
 * mehr als doppelt so hoch wie der Vogt. Kampfeinheit: Glut nur als Nähte (≤ 2 %).
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull              – Becken (Hüftblock) mit Kupfer-Gelenkachse
 *   legs_l / legs_r   – Oberschenkel, Knie, Säulen-Unterschenkel, runder Stampffuß (anim `legs`)   (PartStream 1–2)
 *   turret            – Torso-Wanne mit Bugfase, Deckplatte (team), Rückenkessel, Keramik-Klammer, zwei Schulter-
 *                       glocken (team), dreht um +Y                                                 (PartStream 3)
 *   barrel_l/barrel_r – Blende, Rohr Ø 0,5 × 3,4 WU, Kupfermündung, kippt (Pitch)                   (PartStream 4–5)
 */
import { beveledBox, box, cylinder, defineModel, frustum, quad, sphere, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const HIP_Y = 3.7;
const LEG_X = 1.55;
const TORSO_Y0 = 4.0; // Unterkante Torso
const DECK_TOP = 5.5;
const PLATE_TOP = 5.56;
const BELL_X = 2.5;
const BELL_R = 1.0;
const BELL_Y = DECK_TOP - 0.25; // Glockenfuß sitzt seitlich am Deck
const BARREL_Y = BELL_Y + 0.62;
const BARREL_Z0 = 0.95;
const BARREL_Z1 = 4.1;

/** Säulenbein mit rundem Stampffuß; LOD0 Oberschenkel schräg + Knie, LOD1/2 eine Säule. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    beveledBox({ size: [1.25, 1.9, 1.25], at: [x, HIP_Y - 0.75, 0.2], rot: [-16, 0, 0], bevel: { side: 0.18 }, mat: 'body', maxLod: 0, tag: 'legs' }),
    cylinder({ radius: 0.45, height: 1.4, axis: 'x', at: [x, 2.1, 0.45], segments: 8, mat: 'copper', maxLod: 0, tag: 'legs' }),
    beveledBox({ size: [1.15, 2.0, 1.15], at: [x, 1.35, 0.3], rot: [8, 0, 0], bevel: { side: 0.16 }, mat: 'dark', maxLod: 0, tag: 'legs' }),
    beveledBox({ size: [1.2, HIP_Y - 0.4, 1.2], at: [x, (HIP_Y + 0.4) / 2, 0.25], bevel: { side: 0.18 }, mat: 'dark', minLod: 1, tag: 'legs' }),
    // Stampffuß: runder Guss-Stempel Ø 1,7 WU mit Kupferkragen
    cylinder({ radius: 0.85, height: 0.45, at: [x, 0.225, 0.3], segments: 12, mat: 'dark', keep: true, tag: 'legs' }),
    frustum({ radius: 0.62, radiusTop: 0.5, height: 0.22, at: [x, 0.56, 0.3], segments: 8, caps: 'top', mat: 'copper', maxLod: 1, tag: 'legs' }),
  ];
}

/** Schulterglocke (team) an der Torsoseite. */
function bell(side: 1 | -1): Shape[] {
  const x = side * BELL_X;
  return [
    frustum({ radius: BELL_R + 0.03, radiusTop: BELL_R - 0.03, height: 0.3, at: [x, BELL_Y + 0.15, 0.2], segments: 10, caps: false, mat: 'team', tag: 'bell' }),
    cylinder({ radius: BELL_R - 0.02, height: 0.08, at: [x, BELL_Y + 0.34, 0.2], segments: 10, caps: false, mat: 'body', maxLod: 0 }),
    sphere({ radius: BELL_R - 0.03, hemi: true, segments: 10, rings: 3, scale: [1, 0.72, 1], at: [x, BELL_Y + 0.38 + 0.29, 0.2], mat: 'team', tag: 'bell' }),
    // Glockenträger zum Torso
    box({ size: [0.7, 0.5, 1.2], at: [side * (BELL_X - 0.75), BELL_Y + 0.2, 0.2], mat: 'body', maxLod: 1 }),
  ];
}

function barrel(side: 1 | -1): Shape[] {
  const x = side * BELL_X;
  const len = BARREL_Z1 - BARREL_Z0;
  return [
    beveledBox({ size: [0.6, 0.45, 0.45], at: [x, BARREL_Y, BARREL_Z0 + 0.15], bevel: { topFront: 0.12 }, mat: 'body', maxLod: 1 }),
    cylinder({ radius: 0.25, height: len, axis: 'z', at: [x, BARREL_Y, BARREL_Z0 + len / 2 + 0.3], segments: 8, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
    cylinder({ radius: 0.32, height: 0.45, axis: 'z', at: [x, BARREL_Y, BARREL_Z1 + 0.1], segments: 8, caps: false, mat: 'copper', keep: true, tag: 'barrel' }),
    quad({ size: [0.3, 0.3], rot: [90, 0, 0], at: [x, BARREL_Y, BARREL_Z1 + 0.33], mat: 'glow', maxLod: 0 }),
  ];
}

export default defineModel({
  id: 'core:exp_lnd_walker',
  lodDistances: [120, 360],
  parts: [
    {
      name: 'hull',
      shapes: [
        // Becken: Hüftblock zwischen den Beinen, Kupfer-Gelenkachse quer
        beveledBox({ size: [2.3, 1.0, 1.7], at: [0, HIP_Y + 0.1, 0.1], bevel: { top: 0.2, bottomFront: 0.25, bottomBack: 0.25 }, mat: 'body', keep: true, tag: 'hull' }),
        cylinder({ radius: 0.45, height: 3.6, axis: 'x', at: [0, HIP_Y, 0.2], segments: 8, mat: 'copper', keep: true, tag: 'hull' }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0.2], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0.2], anim: 'legs', shapes: leg(-1) },
    {
      name: 'turret',
      pivot: [0, TORSO_Y0, 0],
      anim: 'yaw',
      shapes: [
        // Torso-Wanne: 4,0 × 1,5 × 4,4 WU, 45°-Fasen, steile Bugfase (Höhe ≤ 0,45 × Länge)
        beveledBox({
          size: [3.9, DECK_TOP - TORSO_Y0, 4.4],
          at: [0, (DECK_TOP + TORSO_Y0) / 2, 0],
          bevel: { top: 0.25, topFront: 0.55, topBack: 0.3, bottomFront: 0.35, bottomBack: 0.2 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        // Deckplatte (Teamfarbe) hinter der Bugfase
        beveledBox({ size: [3.3, PLATE_TOP - DECK_TOP + 0.02, 3.2], at: [0, DECK_TOP + 0.02, -0.1], bevel: { top: 0.02 }, mat: 'team' }),
        // Führerstand: niedriger Gussaufbau vorn auf dem Deck mit Sichtschlitz (gibt dem Torso eine Stirn)
        beveledBox({ size: [1.7, 0.7, 1.1], at: [0, PLATE_TOP + 0.35, 1.35], bevel: { top: 0.15, topFront: 0.3 }, mat: 'body', keep: true, tag: 'hull' }),
        quad({ size: [1.2, 0.14], rot: [45, 0, 0], at: [0, PLATE_TOP + 0.5, 1.83], mat: 'glass', maxLod: 0 }),
        // Rückenkessel (liegend, quer) als Gegengewicht, Kupferbänder, Glutnaht am Heck
        cylinder({ radius: 0.75, height: 3.1, axis: 'x', at: [0, DECK_TOP - 0.1, -2.35], segments: 10, mat: 'body', keep: true, tag: 'boiler' }),
        cylinder({ radius: 0.8, height: 0.22, axis: 'x', at: [1.05, DECK_TOP - 0.1, -2.35], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 0.8, height: 0.22, axis: 'x', at: [-1.05, DECK_TOP - 0.1, -2.35], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        quad({ size: [1.4, 0.12], rot: [-90, 0, 0], at: [0, DECK_TOP - 0.45, -3.105], mat: 'glow', maxLod: 1 }),
        // Keramik-Klammer (T4-Kennung) auf dem Deck
        ceramicBracket({ x: 1.45, y: PLATE_TOP + 0.02, z: -0.45, len: 2.3, w: 0.3 }),
        ...bell(1),
        ...bell(-1),
      ],
    },
    { name: 'barrel_l', parent: 'turret', pivot: [BELL_X, BARREL_Y, BARREL_Z0], anim: 'pitch', shapes: barrel(1) },
    { name: 'barrel_r', parent: 'turret', pivot: [-BELL_X, BARREL_Y, BARREL_Z0], anim: 'pitch', shapes: barrel(-1) },
  ],
  notes: 'T4 in Spielgröße. Beine anim `legs` (Stampfschritt, Fußtritt-Schaden XM2 beim Aufsetzen), Torso yaw, Rohre pitch.',
});
