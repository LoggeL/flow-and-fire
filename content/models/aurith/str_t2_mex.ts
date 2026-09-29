/**
 * Stimmstock II (f4:str_t2_mex) – Aurith-Massenextraktor T2 (In-Place-Upgrade von Stimmstock I).
 *
 * Roster: „Stimmstock mit Höhe ×1,2, 2 Tonpunkte auf dem Sockelrand.“ Grundform aus str_t1_mex.ts; das Upgrade wächst
 * nur in der Höhe (Roster-Maßstab y 1,2), dazu der zweite Tonpunkt.
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f4:str_t2_mex',
  parts: mexParts(2),
  notes: 'v_mex T2: Höhe ×1,2, 2 Tonpunkte.',
});
