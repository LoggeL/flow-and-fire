/**
 * Grundhalle III (f4:str_t3_fac_land) – Aurith-Landfabrik T3 (Einstimmen = In-Place-Upgrade von Grundhalle II).
 *
 * Roster: „Grundhalle Höhe ×1,4 mit drei Scheitelkristallen, 3 Tonpunkte (8 Parts).“ Grundform aus
 * str_t1_fac_land.ts; das Upgrade wächst nur in der Höhe (Roster-Maßstab y 1,4).
 */
import { defineModel } from '@faf/modelkit';
import { hallParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f4:str_t3_fac_land',
  parts: hallParts(3, 'land'),
  notes: 'v_fac T3 (Land): 3 Scheitelkristalle, 3 Tonpunkte.',
});
