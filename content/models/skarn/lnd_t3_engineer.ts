/**
 * Weber (f2:lnd_t3_engineer) – Skarn-Engineer T3.
 *
 * Roster: „Maßstab 1,4 (Deckel für 1×1), 6 Beine, drei Quarz-Nadeln (Anzahl = Tech, dritte statisch), 3 Tech-Streifen
 * schwarz.“ Grundform aus lnd_t1_engineer.ts (Superset-Visual v_eng); Maßstab 1,4 aus dem Roster.
 * Parts: hull (inkl. zweiter und dritter, statischer Nadel), legs_l/legs_r (je 3 Beine), needle (Yaw), emitter (Pitch).
 */
import { defineModel } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f2:lnd_t3_engineer',
  parts: engineerParts(3),
  notes: 'v_eng T3: 6 Beine, drei Nadeln (zweite und dritte statisch), 3 Streifen.',
});
