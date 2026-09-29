/**
 * Druse III (f2:str_t3_pgen) – Skarn-Kraftwerk T3 (Neubau).
 *
 * Roster: „Kruste auf 8×8 (Maßstab 4,0, Höhe × 1,4) mit 3 Drusen, 3 Tech-Streifen.“
 * Grundform aus str_t1_pgen.ts im Basismaß 2×2; der Roster-Maßstab wird beim Export eingebacken.
 */
import { defineModel } from '@faf/modelkit';
import { pgenParts } from './str_t1_pgen.ts';

export default defineModel({
  id: 'f2:str_t3_pgen',
  parts: pgenParts(3),
  notes: 'v_pgen T3: 3 Drusen, Seitenplatten + Flankenplatten, 3 Streifen.',
});
