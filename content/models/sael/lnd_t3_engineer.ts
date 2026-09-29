/**
 * Kustos (f3:lnd_t3_engineer) – Sael-Engineer T3.
 *
 * Roster: „Maßstab 1,4 (Deckel für 1×1-Footprint), drei Sicheln (Anzahl = Tech), 3 Tech-Streifen Tiefjade; dritte
 * Sichel statisch (Anim-Limit 2).“ Grundform aus lnd_t1_engineer.ts; die dritte, kleinste Sichel sitzt vorn links
 * im Rumpf (hull), Maßstab 1,4 und Schwebehöhe 0,35 kommen aus dem Roster.
 */
import { defineModel } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f3:lnd_t3_engineer',
  parts: engineerParts(3),
  notes: 'v_eng T3: drei Sicheln (zwei Yaw, eine statisch), 3 Streifen.',
});
