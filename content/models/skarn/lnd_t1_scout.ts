/**
 * Schabe (f2:lnd_t1_scout) – Skarn-Land-Späher T1.
 *
 * Roster: „Kleinster Panzer auf 2 Beinen, zwei lange Fühler (≥ 1,0 × Rumpflänge) schräg nach vorn oben; keine Linse,
 * kein Ring.“ faction.md §5.2 Land-Späher; Winkel-Code „hoch und dünn = Intel“. Pflicht-Paare Floh↔Schabe (Linse
 * gegen Fühler), Flicker↔Schabe (Spule/Deck gegen Fühler), Schabe↔Gespinst (Fühler gegen Netzring). Fühler als
 * zweigliedrige Vierkant-Glieder, Basis ≥ 0,17 WU Kante; 1 Tech-Streifen (Quarz). Keine animierten Parts außer den
 * Beinen (Roster: animatedParts 0).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), Tech-Streifen, zwei Fühler (Chitin, Sehnen-Ansatz)
 *   legs_l – ein Knickbein links                                        (PartStream 1, legs)
 *   legs_r – ein Knickbein rechts                                       (PartStream 2, legs)
 */
import { defineModel, limb, strut, type Vec3 } from '@faf/modelkit';
import { carapace, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';

const K = keel({ len: 0.7, width: 0.52, height: 0.2, y: 0.5, z: -0.22 });
const LEGS = skarnLegs({
  hips: [[0.16, K.y - 0.02, -0.24]],
  footOut: 0.3, // Spanne 0,92 WU ≈ 1,77 × Rumpfbreite
  splay: 0,
  kneeY: K.top + 0.16,
});

/** Fühler: Ansatz am Bug, Knick nach außen oben, Spitze schräg nach vorn oben (Länge ≈ 1,1 × Rumpflänge). */
function feeler(side: 1 | -1, lod: { readonly maxLod?: 0 | 1; readonly minLod?: 1 | 2 }, sides: 3 | 4): ReturnType<typeof limb> {
  const j: Vec3[] = [
    [side * 0.1, K.top - 0.02, K.bow - 0.14],
    [side * 0.26, K.top + 0.36, K.bow + 0.08],
    [side * 0.38, K.top + 0.62, K.bow + 0.46],
  ];
  return limb({ ...lod, joints: j, radius: [0.12, 0.085, 0.03], sides, hipCap: false, jointCaps: sides === 4, mat: 'chitin', keep: true, tag: 'antenna' });
}

export default defineModel({
  id: 'f2:lnd_t1_scout',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...carapace(K),
        ...techStripes(K, 1),
        feeler(1, { maxLod: 0 }, 4),
        feeler(-1, { maxLod: 0 }, 4),
        feeler(1, { minLod: 1 }, 3),
        feeler(-1, { minLod: 1 }, 3),
        // Sehnen-Ansatz der Fühler: kurzer Querbalken am Bug
        strut({ from: [0.16, K.top - 0.03, K.bow - 0.12], to: [-0.16, K.top - 0.03, K.bow - 0.12], radius: 0.07, mat: 'sinew', maxLod: 0, tag: 'antenna' }),
      ],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
  ],
  notes: 'v_scout: nur Beine animiert (legs_l/legs_r), Fühler statisch im Rumpf.',
});
