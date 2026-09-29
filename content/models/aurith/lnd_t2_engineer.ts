/**
 * Solist (f4:lnd_t2_engineer) – Aurith-Engineer T2.
 *
 * Roster: „Chorist ×1,3 mit zwei verschieden großen Sicheln (Anzahl = Tech), 2 Tonpunkte Pechglas.“
 * Grundform aus lnd_t1_engineer.ts (`engineerParts`): zweite, kleinere Sichel parallel rechts hinter der Hauptsichel
 * (statisch im Rumpf), 2 Tonpunkte; Maßstab 1,3 wird beim Export eingebacken, gleitet mit GLIDE_HEIGHT.
 *
 * Aufbau: hull (mit zweiter Sichel), sickle (Hauptsichel, yaw), emitter (Kristall, pitch).
 */
import { defineModel, GLIDE_HEIGHT } from '@faf/modelkit';
import { engineerParts } from './lnd_t1_engineer.ts';

export default defineModel({
  id: 'f4:lnd_t2_engineer',
  hover: GLIDE_HEIGHT,
  parts: engineerParts(2),
  notes: 'v_eng T2: zwei Sicheln (groß + mittel), 2 Tonpunkte.',
});
