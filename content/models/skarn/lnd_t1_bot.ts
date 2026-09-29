/**
 * Floh (f2:lnd_t1_bot) – Skarn-Sturmläufer T1 (leicht, schnell).
 *
 * Roster: „Kurzer Keilpanzer hoch auf 2 langen Beinen (Beine länger als der Panzer), Granatlinse auf kurzem Hals.“
 * faction.md §5.2 Direktfeuer-Läufer: Linse auf **2 Beinen**, Panzer kürzer als bei der Linie (Zecke 1,4 WU),
 * Beine länger als der Panzer; verboten: Schwanz. Pflicht-Paar Floh↔Schabe: beide 2 Beine, hier die waagerechte
 * Linse, dort zwei lange Fühler. 1 Tech-Streifen (Quarz).
 *
 * Der Aufbau wird von der Milbe (lnd_t2_bot) mit Seitenplatten wiederverwendet (`botModel`).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), Tech-Streifen, bei T2 Seitenplatten (Chitin)
 *   legs_l – ein langes Knickbein links                                 (PartStream 1, legs)
 *   legs_r – ein langes Knickbein rechts                                (PartStream 2, legs)
 *   neck   – kurzer Sehnenhals, dreht (Yaw)                             (PartStream 3)
 *   lens   – Granatlinse, kippt (Pitch)                                 (PartStream 4)
 */
import { defineModel, plate, strut, type ModelDef, type Shape } from '@faf/modelkit';
import { carapace, garnetLens, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';

/** Floh-Aufbau; `sidePlates` = Seitenplatten der Milbe (T2), `legR` = Beinradius vor dem Roster-Maßstab. */
export function botModel(o: { id: string; stripes: number; sidePlates?: boolean; legR?: readonly [number, number] }): ModelDef {
  const K = keel({ len: 0.84, width: 0.66, height: 0.26, y: 0.8, z: -0.06 });
  const legs = skarnLegs({
    hips: [[0.22, K.y - 0.02, -0.04]],
    footOut: 0.36, // Spanne 2 × 0,58 = 1,16 WU ≈ 1,75 × Rumpfbreite
    splay: 0,
    kneeY: K.top + 0.14,
    ...(o.legR === undefined ? {} : { radius: o.legR }),
  });
  const neckZ = K.bow - 0.26;
  const lensY = K.top + 0.06;
  const hull: Shape[] = [...carapace(K), ...techStripes(K, o.stripes)];
  if (o.sidePlates === true) {
    // Seitenplatten: flache Chitinschilde über den Hüften, schräg nach außen abfallend (T2-Zusatz „Seitenplatten“)
    for (const s of [1, -1] as const) {
      hull.push(
        // Review: 0,2 × 0,56 WU verschwanden neben Panzer und Beinen (Milbe ≈ Floh); jetzt breite Flankenschilde, die
        // den Umriss aus der Spielkamera verbreitern (T2-Lesart ohne neue Rollenform), in allen LODs
        plate({ size: [0.3, 0.66], thickness: 0.05, arch: 0.03, segments: [1, 2], point: 0.35, at: [s * 0.42, K.y + 0.03, K.path[1]![2] + 0.08], rot: [0, 0, s * -26], mat: 'chitin', keep: true, tag: 'carapace' }),
      );
    }
  }
  return {
    id: o.id,
    parts: [
      { name: 'hull', shapes: hull },
      { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', shapes: legs.left },
      { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', shapes: legs.right },
      {
        name: 'neck',
        pivot: [0, K.top, neckZ],
        anim: 'yaw',
        shapes: [strut({ from: [0, K.top - 0.06, neckZ - 0.06], to: [0, lensY, neckZ + 0.08], radius: 0.1, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' })],
      },
      {
        name: 'lens',
        parent: 'neck',
        pivot: [0, lensY, neckZ + 0.06],
        anim: 'pitch',
        // Linse 0,52 WU, Spitze 0,3 WU vor der Bugspitze
        shapes: [garnetLens([0, lensY, K.bow + 0.3 - 0.26], 0.52, 0.16)],
      },
    ],
    notes: 'v_bot: 2 Beine als Parts legs_l/legs_r (Render-Pfad ersetzt sie später), Hals-Yaw, Linsen-Pitch.',
  };
}

export default defineModel(botModel({ id: 'f2:lnd_t1_bot', stripes: 1 }));
