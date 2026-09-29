/**
 * Fumarole (f2:str_t1_hydro) – Skarn-Hydrokarbon-Kraftwerk T1 auf 6×6.
 *
 * Roster: „Offener Netzring mit drei Drusen darin und Dampfsäule (Partikel, nur View).“
 * faction.md §5.2 Hydro: offener Netzring mit drei Drusen darin und Dampfsäule. Pflicht-Paartest Egel III ↔ Fumarole:
 * hier drei hohe Drusen in einem großen, vorn offenen Ring, beim Egel eine Druse in zwei geschlossenen Ringen.
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull), gebaut im vollen Maß 6×6 (Roster-Maßstab 1,0):
 *   Kruste (Achteck, Wände Krustengrau, Oberseite Chitin) mit gezackter Teamkante, vorn offener Netzring (Team,
 *   Sechseck-Bogen über fünf Kanten), drei Drusen im Dreieck (Glutkern + Granat-Außenkristalle), Dampfschlot in der
 *   Mitte (Chitin-Kragen, dunkler Schlund – die Dampfsäule ist ein View-Partikel), Tech-Streifen (Quarz) hinten rechts.
 */
import { cylinder, defineModel, stripes, sweep, tube, type Vec3 } from '@faf/modelkit';
import { crust, druse } from './str_t1_mex.ts';

const CRUST_H = 0.36;
const RING_R = 2.05;
const RING_Y = CRUST_H + 0.14;

/** Sechseck-Bogen über fünf Kanten, Lücke vorn (+Z) = „offener“ Ring. */
function openRingPath(): Vec3[] {
  const v = (deg: number): Vec3 => {
    const t = (deg * Math.PI) / 180;
    return [RING_R * Math.cos(t), RING_Y, RING_R * Math.sin(t)];
  };
  const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1], a[2] + (b[2] - a[2]) * k];
  return [lerp(v(90), v(150), 0.45), v(150), v(210), v(270), v(330), v(30), lerp(v(30), v(90), 0.55)];
}
const RHOMBUS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const RIDGE: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
];

const path = openRingPath();
const DRUSES: Vec3[] = [60, 180, 300].map((a): Vec3 => {
  const t = (a * Math.PI) / 180;
  return [1.1 * Math.cos(t), CRUST_H + 0.02, 1.1 * Math.sin(t)];
});

export default defineModel({
  id: 'f2:str_t1_hydro',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...crust({ radius: 3.2, height: CRUST_H, crest: { lo: 0.12, hi: 0.42, width: 0.3 }, seed: 31, crestMaxLod: 1 }),
        // offener Netzring (Team): LOD0 Rhombus-Querschnitt, ab LOD1 aufliegender Grat
        sweep({ path, radius: path.map((): [number, number] => [0.22, 0.16]), profile: RHOMBUS, mat: 'team', keep: true, maxLod: 0, tag: 'webring' }),
        sweep({
          path: path.map((p): Vec3 => [p[0], CRUST_H, p[2]]),
          radius: path.map((): [number, number] => [0.22, 0.26]),
          profile: RIDGE,
          open: true,
          mat: 'team',
          keep: true,
          minLod: 1,
          tag: 'webring',
        }),
        // Dampfschlot: Chitin-Kragen mit dunklem Schlund; LOD1/2 ein Sechseck-Block
        tube({ outer: 0.55, inner: 0.32, height: 0.34, segments: 6, at: [0, CRUST_H + 0.17, 0], mat: 'chitin', maxLod: 0, tag: 'crust' }),
        cylinder({ radius: 0.33, height: 0.06, segments: 6, caps: 'top', at: [0, CRUST_H + 0.2, 0], mat: 'underside', maxLod: 0, tag: 'crust' }),
        cylinder({ radius: 0.55, height: 0.34, segments: 6, caps: 'top', at: [0, CRUST_H + 0.17, 0], mat: 'chitin', minLod: 1, tag: 'crust' }),
        stripes({ count: 1, width: 0.5, stripe: 0.1, at: [-1.55, CRUST_H + 0.004, -1.7], mat: 'quartz', maxLod: 1 }),
        ...DRUSES.flatMap((at, i) => druse({ at, radius: 0.23, height: 1.8, spread: 0.42, lean: 24, count: 3, seed: 13 + i * 5, outer: 'garnet', sides: 5, outerSides: 4 })),
      ],
    },
  ],
  notes: 'v_hydro: offener Netzring, drei Drusen, Dampfschlot (Dampfsäule = View-Partikel).',
});
