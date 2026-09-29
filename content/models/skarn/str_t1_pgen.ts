/**
 * Druse I (f2:str_t1_pgen) – Skarn-Kraftwerk T1; Grundform der Drusen-Familie (II/III importieren `pgenParts`).
 *
 * Roster: „Kristallcluster auf Kruste, 1 Druse (Zahl = Tech, Höhe ≥ 1,5 × Krustenhöhe); kein Ring.“
 * faction.md §5.2 Pgen: Kristallcluster auf Kruste, 1–3 Drusen (Zahl = Tech), Drusenhöhe ≥ 1,5 × Krustenhöhe;
 * verboten: Ring. Pflicht-Paartests: Egel↔Druse (flach mit Ring gegen hoch ohne Ring), Druse↔Glimmzelle (hohe
 * Glut-Kristalle gegen flache Zellen mit Nervennaht), Bilsenkraut↔Druse III.
 * II (6×6) und III (8×8) sind Neubauten: dasselbe Modell im Basismaß 2×2, Roster-Maßstab 3,0 / 4,0
 * (Höhe × 1,2 / × 1,4).
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Kruste (Achteck, Wände Krustengrau, Oberseite Chitin) mit gezackter Teamkante, teamfarbene Sechseck-Platte je
 *   Druse mit dunklen Granat-Splittern, Druse(n) mit Glutkern und Granat-Außenkristallen, Tech-Streifen (Quarz)
 *   hinten; II/III: Seitenplatten an den Diagonalflanken, III zusätzlich Flankenplatten links/rechts.
 */
import { crystal, cylinder, defineModel, plate, stripes, type PartDef, type Shape, type Vec3 } from '@faf/modelkit';
import { crust, druse } from './str_t1_mex.ts';

const CRUST_H = 0.24;

/** Druse auf teamfarbener Sechseck-Platte, mit dunklen Granat-Splittern (T1: zwei, T2: einer, T3: keiner – Budget). */
function geode(at: Vec3, tech: 1 | 2 | 3, seed: number): Shape[] {
  const [x, , z] = at;
  const height = tech === 1 ? 0.95 : tech === 2 ? 0.78 : 0.66; // ≫ 1,5 × Kruste (0,24); ragt aus dem Umriss der Spielkamera
  const shard = (a: number, h: number): Shape =>
    crystal({
      radius: 0.07,
      height: h,
      tip: 0.1,
      sides: 4,
      at: [x + 0.26 * Math.cos(a), CRUST_H + h / 2 + 0.04, z + 0.26 * Math.sin(a)],
      rot: [0, (-a * 180) / Math.PI, 30],
      mat: 'garnet',
      maxLod: 0,
      tag: 'druse',
    });
  return [
    // Teamplatte (Krusten-Oberseite in Teamfarbe, Roster „crust mat team“)
    cylinder({ radius: tech === 1 ? 0.46 : 0.36, height: 0.08, segments: 6, caps: 'top', at: [x, CRUST_H + 0.02, z], mat: 'team', keep: true, tag: 'crust' }),
    ...(tech === 3 ? [] : [shard(seed * 1.7, 0.16)]),
    ...(tech === 1 ? [shard(seed * 1.7 + 2.6, 0.12)] : []),
    ...druse({ at: [x, CRUST_H + 0.06, z], radius: 0.11, height, lean: 22, spread: 0.19, seed, outer: 'garnet', count: tech === 1 ? 4 : 3, sides: tech === 3 ? 4 : 6 }),
  ];
}

export function pgenParts(tech: 1 | 2 | 3): PartDef[] {
  const spots: Vec3[] = tech === 1 ? [[0, 0, 0]] : tech === 2 ? [[0.42, 0, 0.08], [-0.42, 0, -0.08]] : [[0, 0, 0.42], [0.44, 0, -0.26], [-0.44, 0, -0.26]];
  const hull: Shape[] = [
    ...crust({ radius: 1.07, height: CRUST_H, crest: { lo: 0.05, hi: 0.18, width: 0.12 }, seed: 23, crestMaxLod: tech === 3 ? 1 : 2 }),
    // Tech-Streifen (Quarz) hinten rechts bzw. hinten
    stripes({ count: tech, width: 0.34, at: tech === 3 ? [0, CRUST_H + 0.004, -0.52] : [-0.4, CRUST_H + 0.004, -0.5], mat: 'quartz', maxLod: 1 }),
  ];
  spots.forEach((p, i) => hull.push(...geode(p, tech, 3 + i * 4)));
  if (tech >= 2) {
    // Seitenplatten: Chitinschilde an den Diagonalflanken (füllen die Footprint-Ecken)
    for (const a of [45, 135, 225, 315]) {
      const t = (a * Math.PI) / 180;
      hull.push(
        plate({
          size: [0.66, 0.36],
          thickness: 0.05,
          arch: 0.04,
          point: 0.3,
          segments: [1, 1],
          at: [1.0 * Math.cos(t), 0.14, 1.0 * Math.sin(t)],
          rot: [-50, 270 - a, 0],
          mat: 'chitin',
          maxLod: tech === 3 ? 0 : 1,
          tag: 'carapace',
        }),
      );
    }
  }
  if (tech === 3) {
    // Flankenplatten links/rechts: flache Chitinschilde auf der Krustenkante
    for (const a of [0, 180]) {
      const t = (a * Math.PI) / 180;
      hull.push(
        plate({
          size: [0.7, 0.3],
          thickness: 0.05,
          arch: 0.03,
          point: 0.2,
          segments: [1, 1],
          at: [0.86 * Math.cos(t), CRUST_H + 0.08, 0.86 * Math.sin(t)],
          rot: [-38, 270 - a, 0],
          mat: 'chitin',
          maxLod: 0,
          tag: 'carapace',
        }),
      );
    }
  }
  return [{ name: 'hull', shapes: hull }];
}

export default defineModel({
  id: 'f2:str_t1_pgen',
  parts: pgenParts(1),
  notes: 'Grundform v_pgen (Basismaß 2×2); II/III: 2/3 Drusen, Seitenplatten, Roster-Maßstab 3,0/4,0.',
});
