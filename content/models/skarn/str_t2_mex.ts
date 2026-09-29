/**
 * Egel II (f2:str_t2_mex) – Skarn-Massenextraktor T2 (In-Place-Upgrade, wächst nur in der Höhe: Roster y 1,2).
 *
 * Roster: „Egel auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.“
 * Grundform aus str_t1_mex.ts (Superset-Visual v_mex).
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f2:str_t2_mex',
  parts: mexParts(2),
  notes: 'v_mex T2: vier Seitenplatten, 2 Streifen.',
});
