/**
 * Ginster (f2:lnd_t2_aa) – Skarn-Flak T2.
 *
 * Roster: „Klette × 1,3 mit 4 senkrechten Dornen, 2 Tech-Streifen.“ faction.md §5.2 Flugabwehr: Dornenkamm quer zur
 * Laufrichtung, Dornen ≥ 75°; verboten: Linse, Schwanz, Kapsel. Pflicht-Paar Wolfsmilch↔Ginster (Schrägköcher
 * gegen senkrechte Dornen). Aufbau der Klette (lnd_t1_aa.ts, `aaModel`); Dorn-Radius vor dem Maßstab 0,11
 * (nach 1,3 Kante ≈ 0,2 WU), Beinradius 0,1.
 */
import { defineModel } from '@faf/modelkit';
import { aaModel } from './lnd_t1_aa.ts';

export default defineModel(aaModel({ id: 'f2:lnd_t2_aa', stripes: 2, spikes: 4, spikeR: 0.11, spikeH: 0.7, legs: 4, legR: [0.1, 0.095] }));
