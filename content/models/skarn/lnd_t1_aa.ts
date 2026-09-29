/**
 * Klette (f2:lnd_t1_aa) – Skarn-Flugabwehr T1.
 *
 * Roster: „Keilpanzer auf 4 Beinen, Dornenkamm aus 3 senkrechten Dornen (≥ 75°) quer zur Laufrichtung.“
 * faction.md §5.2 Flugabwehr: Dornenkamm aus 3–5 senkrechten Dornen quer zur Laufrichtung, Dorn-Ø ≥ 0,17 WU und
 * ≤ halbe Kapselbreite; verboten: Linse, Schwanz, Kapsel. Pflicht-Paare Zecke↔Klette (waagerechte Linse gegen
 * senkrechten Kamm), Nessel↔Klette (Schrägschwanz gegen Kamm). Winkel-Code: senkrecht = gegen Luft.
 *
 * Ginster (T2, 4 Dornen) und Hagedorn (T3, 4 dickere Dornen, 6 Beine) nutzen `aaModel`. Der Rumpf ist so bemessen,
 * dass die Einheit auch nach 1,3 bzw. 1,4 im 1×1-Footprint bleibt.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), Tech-Streifen
 *   legs_l – linke Knickbeine                                           (PartStream 1, legs)
 *   legs_r – rechte Knickbeine                                          (PartStream 2, legs)
 *   neck   – Kammsockel (Sehne, quer) mit den Dornen (Chitin), dreht (Yaw)   (PartStream 3)
 */
import { defineModel, spike, strut, type ModelDef, type Shape, type Vec3 } from '@faf/modelkit';
import { carapace, keel, ridgeAt, skarnLegs, techStripes } from './lnd_t1_tank.ts';

export interface AaOpts {
  readonly id: string;
  readonly stripes: number;
  readonly spikes: 3 | 4;
  /** Umkreisradius der Dornbasis vor dem Maßstab (4-Kant: Kante = r × √2). */
  readonly spikeR: number;
  readonly spikeH: number;
  readonly legs: 4 | 6;
  readonly legR?: readonly [number, number];
}

export function aaModel(o: AaOpts): ModelDef {
  const K = keel({ len: 1.02, width: 0.8, height: 0.26, y: 0.48, z: -0.04 });
  const hipsZ = o.legs === 6 ? [0.24, -0.06, -0.34] : [0.2, -0.3];
  const legs = skarnLegs({
    hips: hipsZ.map((z): Vec3 => [0.26, K.y - 0.02, z]),
    footOut: 0.42, // Spanne 1,36 WU = 1,7 × Rumpfbreite
    splay: o.legs === 6 ? 0.5 : 0.8,
    kneeY: K.top + 0.12,
    ...(o.legR === undefined ? {} : { radius: o.legR }),
    ...(o.legs === 6 ? { lod2: 'straight' as const } : {}),
  });
  const combZ = -0.16; // hinter der Rumpfmitte: die Dornen ragen aus der Spielkamera über den Heckumriss
  const combY = ridgeAt(K, combZ) + 0.02;
  const half = o.spikes === 3 ? 0.27 : 0.3;
  const spikes: Shape[] = [];
  for (let i = 0; i < o.spikes; i++) {
    const x = -half + (2 * half * i) / (o.spikes - 1);
    const lean = x * 0.16; // äußere Dornen ≈ 82° – immer ≥ 75°
    const h = o.spikeH * (Math.abs(x) < 0.2 ? 1 : 0.9);
    spikes.push(spike({ from: [x, combY, combZ], to: [x + lean, combY + h, combZ], radius: o.spikeR, mat: 'chitin', keep: true, tag: 'spike' }));
  }
  return {
    id: o.id,
    parts: [
      { name: 'hull', shapes: [...carapace(K), ...techStripes(K, o.stripes)] },
      { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', shapes: legs.left },
      { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', shapes: legs.right },
      {
        name: 'neck',
        pivot: [0, combY, combZ],
        anim: 'yaw',
        shapes: [
          // Kammsockel: querliegender Sehnenbalken, trägt die Dornen
          strut({ from: [half + 0.1, combY - 0.02, combZ], to: [-half - 0.1, combY - 0.02, combZ], radius: 0.11, mat: 'sinew', keep: true, tag: 'neck' }),
          ...spikes,
        ],
      },
    ],
    notes: `v_aa: Dornenkamm (${o.spikes} Dornen) auf Kammsockel (Yaw), Beine als legs_l/legs_r.`,
  };
}

export default defineModel(aaModel({ id: 'f2:lnd_t1_aa', stripes: 1, spikes: 3, spikeR: 0.13, spikeH: 0.74, legs: 4 }));
