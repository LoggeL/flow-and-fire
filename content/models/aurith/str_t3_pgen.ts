/**
 * Resonator III (f4:str_t3_pgen) – Aurith-Kraftwerk T3 (Neubau 8×8).
 *
 * Roster: „Resonator auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Kristallen, 3 Tonpunkte.“ Grundform aus str_t1_pgen.ts im
 * Basismaß 2×2; drei Kristall-Säulen dreizählig auf den Sockel-Lappen, nach außen geneigt.
 */
import { defineModel } from '@faf/modelkit';
import { pgenParts } from './str_t1_pgen.ts';

export default defineModel({
  id: 'f4:str_t3_pgen',
  parts: pgenParts(3),
  notes: 'v_pgen T3: 3 Kristall-Säulen, 3 Tonpunkte.',
});
