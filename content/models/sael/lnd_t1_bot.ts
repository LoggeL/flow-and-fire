/**
 * Knallkrebs (f3:lnd_t1_bot) – Sael-Läufer T1; Grundform der Läufer-Familie (Languste T2, Einsiedler T3 importieren
 * `crabLegs` und `CRAB_ZONES`).
 *
 * Roster: „Breiter Krebs-Rückenschild (breiter als lang) auf spitzen Beinen, Perle mit kurzer waagerechter Lanze;
 * kein Schwebeteller.“
 * faction.md §3.2 Läufer: Schale breiter als lang (Schweber: länger als breit), spitz zulaufende Beine, 3 Beinpaare;
 * §5.1 Nr. 3/7: Beine = geht heran, Schwebeteller verboten; §4.2: Teamfarbe auf dem gesamten Rückenschild bis auf
 * den Goldrand (≥ 30 %). Pflichtpaar Knallkrebs↔Kauri: Beine und Querschild gegen Teller und Tropfen.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull            – Rückenschild 1,00 × 0,24 × 0,76 WU (Goldrand + Emaille), 1 Tech-Streifen, Lichtnaht am Heck
 *   legs_l / legs_r – je drei spitze Krebsbeine, Knie über dem Schildrand, Pivot in der mittleren Hüfte
 *   turret          – Perle (Teamfarbe) vorn auf dem Schild, dreht um +Y        (PartStream 1)
 *   barrel          – kurze Lanze (Perlglanz) mit goldenem Schaft, kippt (Pitch) (PartStream 2)
 */
import { cone, cylinder, defineModel, flipX, legPairs, sphere, strut, type Shape, type Vec3 } from '@faf/modelkit';
import { seam, shell, techStripes, type ShellSpec, type Zone } from './lnd_t1_tank.ts';

/** Läufer-Schild: schmaler Goldrand unten, darüber Emaille bis zum Scheitel. */
export const CRAB_ZONES: readonly Zone[] = [
  { to: 10, bands: [1, 1, 1], mat: 'gold' },
  { to: 90, bands: [3, 2, 1], mat: 'enamel' },
];

export interface CrabLegOpts {
  /** Hüften der linken Seite (+X), vorn → hinten. */
  readonly hips: readonly Vec3[];
  readonly footOut: number;
  readonly splay?: number;
  readonly kneeUp: number;
  readonly kneeAt?: number;
  /** Radius an der Hüfte (Fuß spitz). */
  readonly radius: number;
  /** Kanten der LOD0-Beine, Standard 4 (3 bei vier Beinpaaren, Budget). */
  readonly sides?: number;
}

/** Spitze Krebsbeine in drei LOD-Stufen (4-Kant mit Deckeln, 3-Kant ohne Kniedeckel, LOD2 gerade Hüfte-Fuß-Dornen). */
export function crabLegs(o: CrabLegOpts): { left: Shape[]; right: Shape[]; pivotL: Vec3; pivotR: Vec3 } {
  // Hüften liegen unter dem Schild: keine Hüftdeckel
  const base = { hips: o.hips, footOut: o.footOut, splay: o.splay ?? 0.4, kneeUp: o.kneeUp, kneeAt: o.kneeAt ?? 0.5, hipCap: false, mat: 'rind', keep: true, tag: 'legs' };
  const r: [number, number, number] = [o.radius, o.radius * 0.8, 0];
  const l0 = legPairs({ ...base, radius: r, sides: o.sides ?? 4, maxLod: 0 });
  const l1 = legPairs({ ...base, radius: r, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 });
  const l2 = l0.joints.map(([hip, , foot]) => strut({ from: hip, to: foot, radius: o.radius, radiusEnd: 0, sides: 3, caps: false, minLod: 2, mat: 'rind', keep: true, tag: 'legs' }));
  return { left: [l0.left, l1.left, ...l2], right: [l0.right, l1.right, flipX(l2)], pivotL: l0.pivotL, pivotR: l0.pivotR };
}

const SHELL: ShellSpec = { rx: 0.5, ry: 0.24, rz: 0.38, y0: 0.3 };
const TOP = SHELL.y0 + SHELL.ry;
const HIP_Y = 0.33;
const LEGS = crabLegs({
  hips: [
    [0.27, HIP_Y, 0.2],
    [0.3, HIP_Y, 0],
    [0.27, HIP_Y, -0.2],
  ],
  footOut: 0.46,
  kneeUp: 0.28,
  radius: 0.065,
});
const ORB_R = 0.19;
const ORB_Y = TOP + 0.05;
const ORB_Z = 0.1;
const LANCE_Y = ORB_Y - 0.01;
const LANCE_Z0 = 0.2;
const LANCE_L = 0.52;

export default defineModel({
  id: 'f3:lnd_t1_bot',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [...shell(SHELL, CRAB_ZONES, 'shell'), ...techStripes(SHELL, 1, -0.24, 0.84), seam(SHELL, 10, 10, 6, 8)],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', smooth: true, shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', smooth: true, shapes: LEGS.right },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 10, rings: 4, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, LANCE_Y, ORB_Z + 0.1],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // kurze Lanze: 0,52 WU (68 % der Schildlänge), Spitze bei z = 0,72, Schild endet bei 0,38
        cone({ radius: 0.075, height: LANCE_L, segments: 6, axis: 'z', at: [0, LANCE_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        cylinder({ radius: 0.09, height: 0.12, segments: 6, axis: 'z', at: [0, LANCE_Y, ORB_Z + ORB_R + 0.03], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_bot: Perle Yaw, Lanze Pitch; Beine als legs_l/legs_r wie bei Varkan (Anim-Regel „max. 2“ offen).',
});
