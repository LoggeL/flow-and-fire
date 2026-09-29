/**
 * Grundhalle I (f4:str_t1_fac_land) – Aurith-Landfabrik T1 auf 8×8; Grundform aller Hallen (`hallParts`, auch für
 * die Himmelshallen).
 *
 * Roster: „Apsis (halb offene Muschel, offene Seite = Ausgang) mit Kamm-Rampe, Kristall über dem Scheitel.“
 * faction.md §5.2 Halle: Apsis = halb offene Muschel, offene Seite = Ausgang; Grundhalle mit Kamm-Rampe, Himmelshalle
 * mit Landereif; Kristall über dem Scheitel = Resonanzkern. Teamfarbe (§4.2): Sockelrand + Apsis-Außenseite, zusammen
 * 20–30 % der Draufsicht – deshalb ist nur die Scheitelkappe der Apsis teamfarben, die Schale darunter Bernstein.
 * Einstimmen (Upgrade II/III) wächst nur in der Höhe (Roster-Maßstab y 1,2 / 1,4) und bringt je einen Scheitelkristall
 * mehr (Zahl = Tech) und einen Tonpunkt mehr.
 *
 * Aufbau (y = Boden, +Z = Ausgang): nur `hull` (Hallen haben keine beweglichen Teile)
 *   Dreipass-Sockel 8×8 (team/Bernstein), Apsis als halbe Kuppelschale mit Wandstärke (hinten geschlossen, vorn offen;
 *   Bernstein-Schale mit Glyphenband, teamfarbene Scheitelkappe), Scheitelkristall(e) auf dem Scheitel, Tonpunkte
 *   Perlglas auf dem Apsis-Rücken; Land: Kamm-Rampe (Pechglas-Laufbahn mit zwei teamfarbenen Kämmen) nach vorn;
 *   Luft: Landereif (Bernstein-Kante) mit Pechglas-Landefläche auf dem vorderen Lappen.
 */
import {
  crystal,
  defineModel,
  cylinder,
  extrude,
  glyphStrip,
  loftShape,
  torus,
  type PartDef,
  type Ring,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';
import { dreipass, socketY, tonpunkte, type SocketSpec } from './str_t1_mex.ts';

export const HALL_SOCKET: SocketSpec = { half: 4, team: 0.2, amber: 0.3, rim: 0.91 };

/** Apsis: halbe Ellipsoid-Schale (Halbachsen AX/AY/AZ) um (0, AY0, AZC), offen nach +Z. */
const AX = 2.9;
const AY = 3.1;
const AZ = 3.0;
const AY0 = 0.12;
const AZC = 0.55;
const WALL = 0.22;
/** Grenze Bernstein-Schale / teamfarbene Scheitelkappe (Breitengrad). */
const BELT_DEG = 60;

const rad = (d: number): number => (d * Math.PI) / 180;

/** Ring der C-förmigen Schalen-Querschnitte auf Breitengrad `phi` (M Segmente über 180°). */
function apseRing(phiDeg: number, m: number, closed: boolean): Ring {
  const c = Math.cos(rad(phiDeg));
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];
  for (let j = 0; j <= m; j++) {
    const th = rad(180 + (180 * j) / m);
    outer.push([AX * c * Math.cos(th), AZC + AZ * c * Math.sin(th)]);
    const ix = closed ? AX * c : Math.max(0.02, AX * c - WALL);
    const iz = closed ? AZ * c : Math.max(0.02, AZ * c - WALL);
    inner.push([ix * Math.cos(th), AZC + iz * Math.sin(th)]);
  }
  return { y: AY0 + AY * Math.sin(rad(phiDeg)), pts: [...outer, ...inner.reverse()] };
}

/** Apsis-Schale: Bernstein-Schale + teamfarbene Scheitelkappe, je LOD mit eigener Auflösung. */
function apse(): Shape[] {
  const out: Shape[] = [];
  const variants = [
    { m: 6, belt: [0, 32, BELT_DEG], top: [BELT_DEG, 89], lod: { maxLod: 0 as const } },
    { m: 4, belt: [0, BELT_DEG], top: [BELT_DEG, 89], lod: { minLod: 1 as const, maxLod: 1 as const } },
    { m: 3, belt: [0, BELT_DEG], top: [BELT_DEG, 89], lod: { minLod: 2 as const } },
  ];
  for (const v of variants) {
    const ring = (phi: number): Ring => apseRing(phi, v.m, phi >= 89);
    const common = { caps: { bottom: false, top: false }, smooth: true, smoothGroup: 'apse', keep: true, tag: 'shell', ...v.lod };
    out.push(loftShape({ rings: v.belt.map(ring), mat: 'amber', ...common }));
    out.push(loftShape({ rings: v.top.map(ring), mat: 'team', ...common }));
  }
  return out;
}

/** Punkt auf der Apsis-Außenseite (Breitengrad, Winkel ab +X über −Z). */
function apsePoint(phiDeg: number, thDeg: number, lift = 0): { p: Vec3; n: Vec3 } {
  const c = Math.cos(rad(phiDeg));
  const s = Math.sin(rad(phiDeg));
  const th = rad(thDeg);
  const n0: Vec3 = [(c * Math.cos(th)) / AX, s / AY, (c * Math.sin(th)) / AZ];
  const l = Math.hypot(...n0);
  const n: Vec3 = [n0[0] / l, n0[1] / l, n0[2] / l];
  return { p: [AX * c * Math.cos(th) + n[0] * lift, AY0 + AY * s + n[1] * lift, AZC + AZ * c * Math.sin(th) + n[2] * lift], n };
}

/** Scheitelkristalle (Zahl = Tech); LOD2 nur einer. */
function apexCrystals(tech: 1 | 2 | 3): Shape[] {
  const top = AY0 + AY;
  const z = AZC - 0.45;
  const spots: { x: number; lean: number; k: number }[] =
    tech === 1 ? [{ x: 0, lean: 0, k: 1 }] : tech === 2 ? [{ x: 0.42, lean: -12, k: 0.9 }, { x: -0.42, lean: 12, k: 0.9 }] : [{ x: 0, lean: 0, k: 1 }, { x: 0.62, lean: -18, k: 0.8 }, { x: -0.62, lean: 18, k: 0.8 }];
  const out: Shape[] = [];
  for (const [sides, lod] of [
    [6, { maxLod: 0 as const }],
    [4, { minLod: 1 as const, maxLod: 1 as const }],
  ] as const) {
    for (const s of spots) {
      const h = 0.95 * s.k;
      const tip = 0.5 * s.k;
      const up: Vec3 = [-Math.sin(rad(s.lean)), Math.cos(rad(s.lean)), 0];
      const half = (h + tip) / 2 - 0.12;
      out.push(crystal({ radius: 0.3 * s.k, height: h, tip, sides, at: [s.x + up[0] * half, top - 0.06 + up[1] * half, z], rot: [0, 0, s.lean], mat: 'phase', keep: true, tag: 'crystal', ...lod }));
    }
  }
  out.push(crystal({ radius: 0.34, height: 1.0, tip: 0.5, sides: 3, at: [0, top + 0.6, z], mat: 'phase', keep: true, minLod: 2, tag: 'crystal' }));
  return out;
}

/** Kamm-Rampe (Land): Pechglas-Laufbahn aus der Halle nach vorn, seitlich zwei teamfarbene Kämme. */
function ramp(): Shape[] {
  const floor = socketY(HALL_SOCKET, 0, AZC);
  // Seitenprofil [z, y]: Oberkante gewölbt, unten dem Sockel folgend
  const top: Vec2[] = [
    [AZC - 0.9, floor + 0.14],
    [1.3, floor + 0.14],
    [2.4, floor - 0.06],
    [3.3, 0.12],
    [3.95, 0.02],
  ];
  const bottom: Vec2[] = [
    [3.6, 0],
    [2.6, Math.max(0.005, socketY(HALL_SOCKET, 0, 2.6) - 0.1)],
    [AZC - 0.9, floor - 0.12],
  ];
  // Kamm: flacher, gebogener Grat, der hinten hoch aus der Halle kommt und vorn ausläuft
  const crest: Vec2[] = [
    [AZC - 0.6, floor + 0.62],
    [1.9, floor + 0.3],
    [3.85, 0.06],
    [3.3, 0.02],
    [1.9, floor - 0.1],
    [AZC - 0.6, floor],
  ];
  return [
    extrude({ profile: [...top, ...bottom], depth: 1.5, mat: 'pitch', keep: true, tag: 'fin' }),
    ...[0.84, -0.84].map((x) => extrude({ profile: crest, depth: 0.26, at: [x, 0, 0], mat: 'team', keep: true, tag: 'fin' })),
  ];
}

/** Landereif (Luft): flacher Reif mit Landefläche auf dem vorderen Lappen. */
function landingRing(): Shape[] {
  const z = 2.35;
  const y = socketY(HALL_SOCKET, 0, z);
  return [
    // Landefläche (Pechglas) und Landereif (Bernstein-Kante)
    cylinder({ radius: 1.18, height: 0.12, segments: 10, caps: 'top', at: [0, y + 0.03, z], mat: 'pitch', keep: true, tag: 'ring' }),
    torus({ radius: 1.28, tube: 0.17, segments: 10, sides: 3, scale: [1, 0.8, 1], at: [0, y + 0.1, z], mat: 'amberedge', keep: true, tag: 'ring' }),
  ];
}

export function hallParts(tech: 1 | 2 | 3, kind: 'land' | 'air'): PartDef[] {
  // Glyphenband um die Bernstein-Schale der Apsis
  const belt = Array.from({ length: 13 }, (_, i) => apsePoint(BELT_DEG / 2, 185 + (170 * i) / 12, 0.01));
  const shapes: Shape[] = [
    ...dreipass({ ...HALL_SOCKET, m: 6 }),
    ...apse(),
    glyphStrip({ path: belt.map((b) => b.p), normal: belt.map((b) => b.n), width: 0.14, pattern: [0.7, -0.25, 0.22, -0.2, 0.45, -0.3], mat: 'glyph', maxLod: 0, tag: 'glyphs' }),
    ...apexCrystals(tech),
    // Tonpunkte auf dem Apsis-Rücken (Ø 0,3: auf 8×8 sonst unsichtbar)
    ...tonpunkte(tech, AZC - AZ * Math.cos(rad(BELT_DEG)) - 0.02, (x, z) => {
      const q = 1 - (x / AX) ** 2 - ((z - AZC) / AZ) ** 2;
      return AY0 + AY * Math.sqrt(Math.max(0, q));
    }, 0.3, 0.2),
    ...(kind === 'land' ? ramp() : landingRing()),
  ];
  return [{ name: 'hull', shapes }];
}

export default defineModel({
  id: 'f4:str_t1_fac_land',
  parts: hallParts(1, 'land'),
  notes: 'Grundform v_fac (Grundhalle/Himmelshalle); Apsis offen nach +Z, Kamm-Rampe.',
});
