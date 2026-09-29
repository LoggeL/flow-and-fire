/**
 * Milbe (f2:lnd_t2_bot) – Skarn-Raketenläufer T2.
 *
 * Roster: „Floh × 1,3 mit Seitenplatten und 2 Tech-Streifen, weiterhin 2 Beine.“ faction.md §3.4: T2 = Maßstab 1,3,
 * Seitenplatten am Panzer (`carapace`, flach), 2 Streifen; §5.2 Direktfeuer-Läufer: Linse auf 2 Beinen, kein Schwanz.
 * Aufbau wie Floh (lnd_t1_bot.ts, `botModel`), Beinradius vor dem Maßstab 0,1 (nach 1,3 ≈ 0,13 ⇒ Kante ≥ 0,17 WU).
 */
import { defineModel } from '@faf/modelkit';
import { botModel } from './lnd_t1_bot.ts';

export default defineModel(botModel({ id: 'f2:lnd_t2_bot', stripes: 2, sidePlates: true, legR: [0.1, 0.095] }));
