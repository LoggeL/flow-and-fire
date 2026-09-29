/**
 * Stechapfel (f2:lnd_t3_arty) – Skarn-Artillerie T3 (schwer).
 *
 * Roster: „Nessel × 1,7 auf 6 Beinen mit zweitem Schwanz, 3 Tech-Streifen.“ faction.md §3.4 T3: Maßstab 1,7 (2×2),
 * 6 Beine, Doppelaufbau (zweiter Schwanz), 3 Streifen; §5.2 Artillerie: Schwanz über dem Rücken, Kapsel 45–55° nach
 * vorn, keine Linse. Aufbau der Nessel (lnd_t1_arty.ts, `artyModel`) mit zwei parallelen Schwänzen, die beide eine
 * Kapsel tragen (symmetrisch; Symmetrie ist die Norm, faction.md §3.2). Beinradius vor dem Maßstab 0,085.
 */
import { defineModel } from '@faf/modelkit';
import { artyModel } from './lnd_t1_arty.ts';

export default defineModel(artyModel({ id: 'f2:lnd_t3_arty', stripes: 3, legs: 6, twin: true, legR: [0.085, 0.08] }));
