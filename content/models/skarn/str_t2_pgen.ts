/**
 * Druse II (f2:str_t2_pgen) – Skarn-Kraftwerk T2 (Neubau).
 *
 * Roster: „Kruste auf 6×6 (Maßstab 3,0, Höhe × 1,2) mit 2 Drusen, 2 Tech-Streifen; füllt ≥ 70 % der
 * Footprint-Kante.“
 * Grundform aus str_t1_pgen.ts im Basismaß 2×2; der Roster-Maßstab wird beim Export eingebacken.
 */
import { defineModel } from '@faf/modelkit';
import { pgenParts } from './str_t1_pgen.ts';

export default defineModel({
  id: 'f2:str_t2_pgen',
  parts: pgenParts(2),
  notes: 'v_pgen T2: 2 Drusen, Seitenplatten, 2 Streifen.',
});
