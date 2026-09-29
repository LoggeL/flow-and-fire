/**
 * Dünung (f3:lnd_t1_arty) – Sael-Artillerie-Schweber T1; Grundform der Horn-Familie (Woge T3, Brecher T2 importieren
 * `horn` und `counterShell`).
 *
 * Roster: „Schale auf Schwebeteller, Horn (weite Mündung, 50°) mittig auf kurzem Drehkranz, Heck-Gegenschale; keine
 * Perle, keine waagerechte Lanze.“
 * faction.md §5.2 Artillerie: Horn (Kegelstumpf mit weiter Mündung, schräg 50°) mittig auf der Schale; Pflicht:
 * Mündung ≥ 2 × Stachel-Ø (hier Ø 0,50 gegen 0,18), Heck-Gegenschale; verboten: Perle, waagerechte Lanze, dünne
 * Stacheln. Pflichtpaare Dünung↔Seeigel (ein dickes Schräghorn gegen dünne senkrechte Stacheln), Kreuz Dünung↔Kelle
 * (schräg = indirekt).
 *
 * Aufbau (y = Boden vor dem Anheben um 0,25 WU, +Z = vorn, +X = linke Seite):
 *   hull   – Schwebeteller, Schale 0,96 × 0,32 × 1,24 WU (Perlmuttrand + Emaille), Heck-Gegenschale (Emaille),
 *            1 Tech-Streifen, Lichtnaht
 *   turret – kurzer Drehkranz (Emaille, Teil des Körpers), dreht um +Y          (PartStream 1)
 *   barrel – Horn 50° (0,72 WU): Perlglanz-Trichter, dunkle Mündung, Goldrand; kippt (Pitch) (PartStream 2)
 */
import { cylinder, defineModel, ellipsoid, frustum, type Shape, type Vec3 } from '@faf/modelkit';
import { pad, seam, shell, surf, techStripes, type ShellSpec } from './lnd_t1_tank.ts';

export const HORN_DEG = 50;

export interface HornOpts {
  /** Wurzel des Horns (Drehpunkt des Pitch-Parts). */
  readonly root: Vec3;
  readonly length: number;
  /** Radius an der Wurzel und an der Mündung. */
  readonly r0: number;
  readonly r1: number;
}

/** Horn unter 50°: geschlossener Trichter (Perlglanz), dunkle Mündungsscheibe, Goldrand an der Mündung. */
export function horn(o: HornOpts): Shape[] {
  const el = (HORN_DEG * Math.PI) / 180;
  const d: Vec3 = [0, Math.sin(el), Math.cos(el)];
  const at = (s: number): Vec3 => [o.root[0], o.root[1] + d[1] * s, o.root[2] + d[2] * s];
  const tilt = 90 - HORN_DEG; // +Y um X gekippt nach vorn
  return [
    frustum({ radius: o.r0, radiusTop: o.r1, height: o.length, segments: 8, rot: [tilt, 0, 0], at: at(o.length / 2), mat: 'lustre', keep: true, tag: 'horn' }),
    // Mündung: dunkle Scheibe knapp über dem Deckel liest sich als offener Schlund
    cylinder({ radius: o.r1 * 0.84, height: 0.02, segments: 8, caps: 'top', rot: [tilt, 0, 0], at: at(o.length), mat: 'rind', maxLod: 1, tag: 'horn' }),
    // Goldrand: kurzer, leicht ausgestellter Ring um die Mündung
    frustum({ radius: o.r1 * 1.02, radiusTop: o.r1 * 1.1, height: 0.06, segments: 8, caps: false, rot: [tilt, 0, 0], at: at(o.length - 0.02), mat: 'gold', maxLod: 1, tag: 'horn' }),
  ];
}

/** Heck-Gegenschale: aufgestellte Emaille-Halbschale am Heck, Wölbung nach hinten oben (hält den Team-Anteil ≥ 30 %). */
export function counterShell(sp: ShellSpec, scale = 1): Shape {
  const z = (sp.cz ?? 0) - sp.rz * 0.68;
  return ellipsoid({
    radii: [0.3 * scale, 0.14 * scale, 0.2 * scale],
    half: true,
    segments: 8,
    rings: 2,
    rot: [-55, 0, 0],
    at: [0, surf(sp, 0, z).p[1] + 0.07 * scale, z],
    mat: 'enamel',
    keep: true,
    tag: 'shell',
  });
}

const SHELL: ShellSpec = { rx: 0.48, ry: 0.32, rz: 0.62, y0: 0.06, drop: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const KRANZ_H = 0.07;
const ROOT: Vec3 = [0, TOP + KRANZ_H, 0.02];

export default defineModel({
  id: 'f3:lnd_t1_arty',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        pad(0.53, 0.68),
        ...shell(SHELL, [
          { to: 25.8, bands: [1, 1, 1], mat: 'nacre' },
          { to: 90, bands: [3, 2, 1], mat: 'enamel' },
        ], 'shell'),
        counterShell(SHELL),
        ...techStripes(SHELL, 1, -0.3),
        seam(SHELL, 25.8, 10, 6, 8),
      ],
    },
    {
      name: 'turret',
      pivot: [0, TOP, 0.02],
      anim: 'yaw',
      smooth: true,
      shapes: [cylinder({ radius: 0.19, height: KRANZ_H + 0.05, segments: 8, caps: 'top', at: [0, TOP + (KRANZ_H - 0.05) / 2, 0.02], mat: 'enamel', keep: true, tag: 'mast' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: ROOT,
      anim: 'pitch',
      smooth: true,
      shapes: horn({ root: [0, ROOT[1] - 0.04, ROOT[2]], length: 0.72, r0: 0.11, r1: 0.25 }),
    },
  ],
  notes: 'v_arty: Drehkranz Yaw, Horn Pitch (2 animierte Parts). Schwebehöhe 0,25 aus dem Roster.',
});
