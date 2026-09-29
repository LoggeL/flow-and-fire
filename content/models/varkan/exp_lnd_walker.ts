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
 * Das Bein ist ein Pochstempel: schräger Oberschenkel, Kupfer-Knieachse mit teamfarbener Kniekappe, Stempelgehäuse
 * als Schienbein, darunter die blanke Kupfer-Stempelstange und der runde Guss-Stempel (Fußtritt XM2). Ein
 * Hydraulikzylinder am Beinrücken zeigt die Hubkraft. Hüftschürzen und ein Bauchstück verbinden Torso und Becken,
 * damit der Koloss nicht wie eine Platte auf Stelzen wirkt.
 *
 * Aufbau (y = Boden, +Z = Bug):
 *   hull              – Becken (Hüftblock) mit Kupfer-Gelenkachse und zwei Hüftschürzen
 *   legs_l / legs_r   – Oberschenkel, Knie (Gelenkwalze + Kniekappe team), Stempelgehäuse, Stempelstange, Stampffuß,
 *                       Hydraulikzylinder (anim `legs`)                                               (PartStream 1–2)
 *   turret            – Bauchstück, Torso-Wanne mit Bugfase, Deckplatte (team), Führerstand mit Sichtschlitz,
 *                       Rückenkessel mit Kupferbändern und Leitungen zu den Glocken, Keramik-Klammer, zwei
 *                       Schulterglocken (team) auf Schulterpanzern, dreht um +Y                         (PartStream 3)
 *   barrel_l/barrel_r – Blende, Rohr Ø 0,54 × 3,7 WU mit Rücklaufmantel und Kupfer-Mündungsbremse, kippt (Pitch)
 *                                                                                                      (PartStream 4–5)
 */
import { beveledBox, box, cylinder, defineModel, extrude, frustum, quad, sphere, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const HIP_Y = 3.75;
const LEG_X = 1.6;
const KNEE_Y = 2.05;
const KNEE_Z = 0.75;
const FOOT_Z = 0.3;
const TORSO_Y0 = 4.05; // Unterkante Torso
const DECK_TOP = 5.55;
const PLATE_TOP = 5.61;
const BELL_X = 2.6;
const BELL_R = 1.05;
const BELL_Y = DECK_TOP - 0.25; // Glockenfuß sitzt seitlich am Deck
const BARREL_Y = BELL_Y + 0.64;
const BARREL_Z0 = 0.95;
const BARREL_Z1 = 4.55;
const BOILER_Z = -2.45;
/** Torso-Seitenprofil [z, y]: Kinn vorn unten, Stirn schräg, Deck flach, Heck gefast. */
const TORSO_PROFILE: readonly (readonly [number, number])[] = [
  [-2.35, TORSO_Y0 + 0.15],
  [1.5, TORSO_Y0],
  [2.5, TORSO_Y0 + 0.5],
  [2.4, 5.15],
  [1.55, DECK_TOP],
  [-2.1, DECK_TOP],
  [-2.4, DECK_TOP - 0.3],
];

/** Pochstempel-Bein; LOD0/1 gegliedert, LOD2 eine Säule. */
function leg(side: 1 | -1): Shape[] {
  const x = side * LEG_X;
  return [
    // Oberschenkel: schräg nach vorn zum Knie
    beveledBox({ size: [1.3, 1.95, 1.3], at: [x, (HIP_Y + KNEE_Y) / 2 + 0.05, (0.2 + KNEE_Z) / 2], rot: [-18, 0, 0], bevel: { side: 0.2 }, mat: 'body', maxLod: 1, tag: 'legs' }),
    // Knie: Gelenkwalze quer + teamfarbene Kniekappe vorn
    cylinder({ radius: 0.52, height: 1.5, axis: 'x', at: [x, KNEE_Y, KNEE_Z], segments: 8, mat: 'dark', maxLod: 1, tag: 'legs' }),
    beveledBox({ size: [1.15, 0.95, 0.4], at: [x, KNEE_Y + 0.05, KNEE_Z + 0.55], rot: [-12, 0, 0], bevel: { topFront: 0.15, bottomFront: 0.15 }, mat: 'team', maxLod: 0, tag: 'legs' }),
    // Stempelgehäuse (Schienbein) – leicht zurückgeneigt, unten offen für die Stange
    beveledBox({ size: [1.25, 1.55, 1.25], at: [x, 1.25, (KNEE_Z + FOOT_Z) / 2], rot: [10, 0, 0], bevel: { side: 0.2, bottom: 0.12 }, mat: 'dark', maxLod: 1, tag: 'legs' }),
    // Stempelstange (blankes Kupfer) zwischen Gehäuse und Fuß
    cylinder({ radius: 0.3, height: 0.5, at: [x, 0.62, FOOT_Z], segments: 8, caps: false, mat: 'copper', maxLod: 0, tag: 'legs' }),
    // Hydraulikzylinder am Beinrücken (Hüfte → Gehäuse)
    cylinder({ radius: 0.16, height: 2.4, at: [x, 2.25, -0.55], rot: [-14, 0, 0], segments: 6, caps: false, mat: 'copper', maxLod: 0, tag: 'legs' }),
    cylinder({ radius: 0.23, height: 1.0, at: [x, 2.95, -0.72], rot: [-14, 0, 0], segments: 6, caps: 'top', mat: 'dark', maxLod: 0, tag: 'legs' }),
    // LOD2: eine Säule statt Gliederung
    beveledBox({ size: [1.25, HIP_Y - 0.4, 1.25], at: [x, (HIP_Y + 0.4) / 2, 0.35], bevel: { side: 0.18 }, mat: 'dark', minLod: 2, tag: 'legs' }),
    // Stampffuß: runder Guss-Stempel Ø 1,7 WU mit Kupferkragen
    cylinder({ radius: 0.86, height: 0.42, at: [x, 0.21, FOOT_Z], segments: 12, mat: 'dark', keep: true, tag: 'legs' }),
    frustum({ radius: 0.72, radiusTop: 0.52, height: 0.2, at: [x, 0.52, FOOT_Z], segments: 10, caps: 'top', mat: 'copper', maxLod: 1, tag: 'legs' }),
  ];
}

/** Schulterglocke (team) auf einem Schulterpanzer an der Torsoseite. */
function bell(side: 1 | -1): Shape[] {
  const x = side * BELL_X;
  return [
    // Schulterpanzer: trägt die Glocke, hängt über die Torsoseite
    beveledBox({ size: [1.5, 0.75, 2.3], at: [side * (BELL_X - 0.2), BELL_Y - 0.2, 0.2], bevel: { bottom: 0.3, topFront: 0.15, topBack: 0.15 }, mat: 'body', keep: true, tag: 'bell' }),
    frustum({ radius: BELL_R + 0.03, radiusTop: BELL_R - 0.03, height: 0.3, at: [x, BELL_Y + 0.32, 0.2], segments: 12, caps: false, mat: 'team', tag: 'bell' }),
    cylinder({ radius: BELL_R - 0.02, height: 0.08, at: [x, BELL_Y + 0.51, 0.2], segments: 12, caps: false, mat: 'copper', maxLod: 0 }),
    sphere({ radius: BELL_R - 0.03, hemi: true, segments: 12, rings: 3, scale: [1, 0.72, 1], at: [x, BELL_Y + 0.55 + 0.3, 0.2], mat: 'team', tag: 'bell' }),
  ];
}

function barrel(side: 1 | -1): Shape[] {
  const x = side * BELL_X;
  const len = BARREL_Z1 - BARREL_Z0;
  return [
    beveledBox({ size: [0.7, 0.55, 0.55], at: [x, BARREL_Y, BARREL_Z0 + 0.2], bevel: { topFront: 0.15 }, mat: 'body', maxLod: 1 }),
    // Rücklaufmantel
    cylinder({ radius: 0.38, height: 1.1, axis: 'z', at: [x, BARREL_Y, BARREL_Z0 + 1.0], segments: 8, caps: 'top', mat: 'body', maxLod: 0, tag: 'barrel' }),
    cylinder({ radius: 0.27, height: len, axis: 'z', at: [x, BARREL_Y, BARREL_Z0 + len / 2 + 0.3], segments: 8, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
    // Mündungsbremse (Kupfer)
    cylinder({ radius: 0.36, height: 0.55, axis: 'z', at: [x, BARREL_Y, BARREL_Z1 + 0.1], segments: 8, caps: false, mat: 'copper', keep: true, tag: 'barrel' }),
    quad({ size: [0.34, 0.34], rot: [90, 0, 0], at: [x, BARREL_Y, BARREL_Z1 + 0.38], mat: 'glow', maxLod: 0 }),
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
        beveledBox({ size: [2.3, 1.0, 1.8], at: [0, HIP_Y + 0.1, 0.1], bevel: { top: 0.2, bottomFront: 0.25, bottomBack: 0.25 }, mat: 'body', keep: true, tag: 'hull' }),
        cylinder({ radius: 0.45, height: 3.4, axis: 'x', at: [0, HIP_Y, 0.2], segments: 8, mat: 'copper', keep: true, tag: 'hull' }),
        // Hüftschürzen: Gussplatten außen über den Oberschenkeln
        beveledBox({ size: [0.35, 1.25, 1.9], at: [LEG_X + 0.95, HIP_Y - 0.05, 0.2], bevel: { bottomFront: 0.35, bottomBack: 0.35 }, mat: 'body', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.35, 1.25, 1.9], at: [-LEG_X - 0.95, HIP_Y - 0.05, 0.2], bevel: { bottomFront: 0.35, bottomBack: 0.35 }, mat: 'body', maxLod: 0, tag: 'hull' }),
      ],
    },
    { name: 'legs_l', pivot: [LEG_X, HIP_Y, 0.2], anim: 'legs', shapes: leg(1) },
    { name: 'legs_r', pivot: [-LEG_X, HIP_Y, 0.2], anim: 'legs', shapes: leg(-1) },
    {
      name: 'turret',
      pivot: [0, TORSO_Y0, 0],
      anim: 'yaw',
      shapes: [
        // Bauchstück: verjüngt sich zum Becken
        beveledBox({ size: [2.8, 0.6, 3.2], at: [0, TORSO_Y0 - 0.2, -0.1], bevel: { bottom: 0.25 }, mat: 'dark', maxLod: 1, tag: 'hull' }),
        // Torso-Wanne 4,1 × 1,55 × 4,8 WU als Seitenprofil: vorspringendes Kinn und schräge Stirn (Stempelkopf),
        // flaches Deck, Heck gefast
        extrude({ profile: TORSO_PROFILE, depth: 4.1, axis: 'x', mat: 'body', keep: true, tag: 'hull' }),
        // Deckplatte (Teamfarbe) hinter der Stirn
        box({ size: [3.6, 0.06, 3.5], at: [0, DECK_TOP + 0.03, -0.3], mat: 'team' }),
        // Sehschlitz über die ganze Stirn (Glas) und Kupfer-Kinnband
        quad({ size: [3.0, 0.22], rot: [25.2, 0, 0], at: [0, 5.357, 1.984], mat: 'glass', maxLod: 1 }),
        box({ size: [3.7, 0.2, 0.2], at: [0, 4.6, 2.42], mat: 'copper', maxLod: 1 }),
        // Luke (Führerstand) flach auf dem Deck
        beveledBox({ size: [1.3, 0.3, 0.9], at: [0, DECK_TOP + 0.15, 0.75], bevel: { top: 0.1 }, mat: 'body', maxLod: 0 }),
        // Rückenkessel (liegend, quer) als Gegengewicht, Kupferbänder, Glutnaht am Heck
        cylinder({ radius: 0.85, height: 3.3, axis: 'x', at: [0, DECK_TOP - 0.05, BOILER_Z], segments: 10, mat: 'body', keep: true, tag: 'boiler' }),
        cylinder({ radius: 0.9, height: 0.24, axis: 'x', at: [1.1, DECK_TOP - 0.05, BOILER_Z], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 0.9, height: 0.24, axis: 'x', at: [-1.1, DECK_TOP - 0.05, BOILER_Z], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        quad({ size: [1.5, 0.12], rot: [-90, 0, 0], at: [0, DECK_TOP - 0.45, BOILER_Z - 0.855], mat: 'glow', maxLod: 1 }),
        // Kupferleitungen Kessel → Glocken
        box({ size: [0.22, 0.22, 2.4], at: [1.95, DECK_TOP + 0.05, -1.2], mat: 'copper', maxLod: 0 }),
        box({ size: [0.22, 0.22, 2.4], at: [-1.95, DECK_TOP + 0.05, -1.2], mat: 'copper', maxLod: 0 }),
        // Keramik-Klammer (T4-Kennung) auf dem Deck
        ceramicBracket({ x: 1.5, y: PLATE_TOP + 0.02, z: -0.5, len: 2.3, w: 0.3 }),
        ...bell(1),
        ...bell(-1),
      ],
    },
    { name: 'barrel_l', parent: 'turret', pivot: [BELL_X, BARREL_Y, BARREL_Z0], anim: 'pitch', shapes: barrel(1) },
    { name: 'barrel_r', parent: 'turret', pivot: [-BELL_X, BARREL_Y, BARREL_Z0], anim: 'pitch', shapes: barrel(-1) },
  ],
  notes: 'T4 in Spielgröße. Beine anim `legs` (Stampfschritt, Fußtritt-Schaden XM2 beim Aufsetzen), Torso yaw, Rohre pitch.',
});
