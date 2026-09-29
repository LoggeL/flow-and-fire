/**
 * Akolyth (f3:lnd_t2_engineer) – Sael-Engineer T2.
 *
 * Roster: „Wie Novize, Maßstab 1,3, zwei Sicheln verschiedener Größe, 2 Tech-Streifen Tiefjade.“ Grundform aus
 * lnd_t1_engineer.ts; Maßstab 1,3 und Schwebehöhe 0,30 kommen aus dem Roster. Die Hauptsichel trägt den Emitter
 * statisch, die kleine Sichel (rechts hinten → vorn links) ist der zweite animierte Part.
 */
import { defineModel } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f3:lnd_t2_engineer',
  parts: engineerParts(2),
  notes: 'v_eng T2: zwei Sicheln (beide Yaw), 2 Streifen.',
});
