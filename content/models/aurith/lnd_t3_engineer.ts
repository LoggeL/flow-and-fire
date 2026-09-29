/**
 * Vorsänger (f4:lnd_t3_engineer) – Aurith-Engineer T3.
 *
 * Roster: „Maßstab 1,4 (Deckel 1×1), drei Sicheln (Anzahl = Tech), 3 Tonpunkte Pechglas; zweite und dritte Sichel
 * statisch (Anim-Limit 2).“ Grundform aus lnd_t1_engineer.ts (`engineerParts`): drei parallel versetzte Sicheln
 * (groß, mittel rechts hinten, klein links vorn); der Kristall sitzt fest an der Hauptsichel (Roster: 1 animierter
 * Part).
 *
 * Aufbau: hull (mit zweiter und dritter Sichel), sickle (Hauptsichel mit Kristall, yaw).
 */
import { defineModel, GLIDE_HEIGHT } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f4:lnd_t3_engineer',
  hover: GLIDE_HEIGHT,
  parts: engineerParts(3),
  notes: 'v_eng T3: drei Sicheln, Kristall statisch an der Hauptsichel, 3 Tonpunkte.',
});
