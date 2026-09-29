/**
 * Stopfer (f2:lnd_t2_engineer) – Skarn-Engineer T2.
 *
 * Roster: „Wie Flicker, Maßstab 1,3, zwei Quarz-Nadeln verschiedener Länge, 2 Tech-Streifen schwarz.“
 * Grundform aus lnd_t1_engineer.ts (Superset-Visual v_eng); Maßstab 1,3 aus dem Roster.
 * Parts: hull (inkl. kurzer, statischer Nadel links vorn), legs_l/legs_r, needle (Yaw), emitter (Pitch).
 */
import { defineModel } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f2:lnd_t2_engineer',
  parts: engineerParts(2),
  notes: 'v_eng T2: zweite, kurze Nadel statisch im Rumpf, 2 Streifen.',
});
