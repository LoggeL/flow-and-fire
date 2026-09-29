/**
 * Hagedorn (f2:lnd_t3_aa) – Skarn-Flugabwehr T3 (schwer).
 *
 * Roster: „Ginster × 1,4 (1×1-Deckel) mit 4 dickeren Dornen auf 6 Beinen, 3 Tech-Streifen.“ faction.md §3.4 T3:
 * 6 Beine, Maßstab 1,4 bei 1×1-Footprint, 3 Streifen; §5.2 Flugabwehr: senkrechter Dornenkamm. Aufbau der Klette
 * (lnd_t1_aa.ts, `aaModel`); Dornen dicker als beim Ginster (Radius 0,125 vor dem Maßstab, Kante ≈ 0,25 WU) und
 * etwas höher, Beinradius 0,095.
 */
import { defineModel } from '@faf/modelkit';
import { aaModel } from './lnd_t1_aa.ts';

export default defineModel(aaModel({ id: 'f2:lnd_t3_aa', stripes: 3, spikes: 4, spikeR: 0.125, spikeH: 0.76, legs: 6, legR: [0.095, 0.09] }));
