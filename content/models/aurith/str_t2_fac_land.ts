/**
 * Grundhalle II (f4:str_t2_fac_land) – Aurith-Landfabrik T2 (Einstimmen = In-Place-Upgrade von Grundhalle I).
 *
 * Roster: „Grundhalle Höhe ×1,2 mit zweitem Scheitelkristall, 2 Tonpunkte.“ Grundform aus
 * str_t1_fac_land.ts; das Upgrade wächst nur in der Höhe (Roster-Maßstab y 1,2).
 */
import { defineModel } from '@faf/modelkit';
import { hallParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f4:str_t2_fac_land',
  parts: hallParts(2, 'land'),
  notes: 'v_fac T2 (Land): 2 Scheitelkristalle, 2 Tonpunkte.',
});
