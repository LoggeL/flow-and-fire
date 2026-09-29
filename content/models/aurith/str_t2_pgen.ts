/**
 * Resonator II (f4:str_t2_pgen) – Aurith-Kraftwerk T2 (Neubau 6×6).
 *
 * Roster: „Resonator auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Kristallen, 2 Tonpunkte.“ Grundform aus str_t1_pgen.ts im
 * Basismaß 2×2; zwei nach außen geneigte Kristall-Säulen (Zahl = Tech).
 */
import { defineModel } from '@faf/modelkit';
import { pgenParts } from './str_t1_pgen.ts';

export default defineModel({
  id: 'f4:str_t2_pgen',
  parts: pgenParts(2),
  notes: 'v_pgen T2: 2 Kristall-Säulen, 2 Tonpunkte.',
});
