/**
 * Ohrwurm (f2:lnd_t2_tank) – Skarn-Kampfläufer T2 (schwer).
 *
 * Roster: „Zecke × 1,3 mit zwei parallelen Linsen und Zangen-Platten am Bug (aus V2 ‚Klaue‘), 2 Tech-Streifen,
 * weiterhin 4 Beine.“ faction.md §5.2 Direktfeuer Linie: Linsen waagerecht, ≥ 50 % der Rumpflänge, ragen über den Bug;
 * verboten: Schwanz, senkrechte Dornen. Pflicht-Paar Ohrwurm↔Wolfsmilch: waagerechtes Linsenpaar gegen 50°-Köcher.
 *
 * Chassis der Zecke (lnd_t1_tank.ts), Rumpf auf 1,2 × 0,9 WU gekürzt, damit die Einheit nach dem Maßstab 1,3 im
 * 1×1-Footprint bleibt (≤ 200 % der Kante); Beinradius vor dem Maßstab 0,1 (Kante nach 1,3 ≥ 0,17 WU).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), Zangen am Bug (Chitin), 2 Tech-Streifen
 *   legs_l – zwei linke Knickbeine                                      (PartStream 1, legs)
 *   legs_r – zwei rechte Knickbeine                                     (PartStream 2, legs)
 *   neck   – Sehnenhals mit Joch und zwei parallelen Granatlinsen, dreht (Yaw)   (PartStream 3)
 */
import { claw, defineModel, strut } from '@faf/modelkit';
import { carapace, garnetLens, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';

const K = keel({ len: 1.2, width: 0.9, height: 0.28, y: 0.5, z: -0.1 });
const LEGS = skarnLegs({
  hips: [
    [0.3, K.y - 0.02, 0.12],
    [0.3, K.y - 0.02, -0.34],
  ],
  footOut: 0.42, // Spanne 1,44 WU = 1,6 × Rumpfbreite
  splay: 0.6,
  kneeY: K.top + 0.12,
  radius: [0.1, 0.095],
});
const NECK_Z = 0.08;
const LENS_Y = K.top + 0.1;
const LENS_X = 0.13;
const LENS_Z = 0.48; // Linsen 0,64 WU = 53 % der Rumpflänge, Spitzen 0,3 WU vor der Bugspitze (0,5)

/**
 * Zange: gebogene Chitinklinge (4-Kant, spitz zulaufend) seitlich am Bug, biegt nach außen aus und läuft
 * vor dem Bug nach innen zusammen – ein Kieferpaar unter dem Linsenpaar.
 */
function pincer(side: 1 | -1): ReturnType<typeof claw> {
  return claw({
    from: [side * 0.24, K.y, K.bow - 0.2],
    to: [side * 0.07, K.y + 0.04, K.bow + 0.3],
    bend: [side * 0.16, 0.02, 0],
    radius: 0.1,
    mat: 'chitin',
    keep: true,
    maxLod: 1,
    tag: 'carapace',
  });
}

export default defineModel({
  id: 'f2:lnd_t2_tank',
  parts: [
    {
      name: 'hull',
      shapes: [...carapace(K), pincer(1), pincer(-1), ...techStripes(K, 2)],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'neck',
      pivot: [0, K.top, NECK_Z],
      anim: 'yaw',
      shapes: [
        strut({ from: [0, K.top - 0.08, NECK_Z - 0.08], to: [0, LENS_Y - 0.02, NECK_Z + 0.1], radius: 0.12, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        // Joch: querliegender Sehnenbalken, trägt die beiden Linsen
        strut({ from: [LENS_X + 0.04, LENS_Y, NECK_Z + 0.16], to: [-LENS_X - 0.04, LENS_Y, NECK_Z + 0.16], radius: 0.09, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        garnetLens([LENS_X, LENS_Y, LENS_Z], 0.64, 0.15),
        garnetLens([-LENS_X, LENS_Y, LENS_Z], 0.64, 0.15),
      ],
    },
  ],
  notes: 'v_tank (T2): zwei parallele Linsen fest am Hals (1 animierter Part laut Roster), Zangen-Platten am Bug.',
});
