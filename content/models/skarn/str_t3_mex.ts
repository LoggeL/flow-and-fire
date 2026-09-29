/**
 * Egel III (f2:str_t3_mex) – Skarn-Massenextraktor T3 (In-Place-Upgrade, wächst nur in der Höhe: Roster y 1,4).
 *
 * Roster: „Egel auf 2×2 (Höhe × 1,4), doppelter Netzring, 3 Tech-Streifen; nur eine Druse (unterscheidet sich so
 * von der Fumarole).“
 * Grundform aus str_t1_mex.ts (Superset-Visual v_mex).
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f2:str_t3_mex',
  parts: mexParts(3),
  notes: 'v_mex T3: Seitenplatten, zweiter Netzring (Sehne), 3 Streifen, eine Druse.',
});
