/**
 * Stimmstock III (f4:str_t3_mex) – Aurith-Massenextraktor T3 (In-Place-Upgrade von Stimmstock II).
 *
 * Roster: „Stimmstock mit doppeltem Reif, Höhe ×1,4, 3 Tonpunkte; keine Harfenbögen (unterscheidet sich so von der
 * Äolsharfe).“ Grundform aus str_t1_mex.ts; zweiter, höherer Reif aus Bernstein-Kante auf drei Pechglas-Stützen.
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f4:str_t3_mex',
  parts: mexParts(3),
  notes: 'v_mex T3: doppelter Reif, Höhe ×1,4, 3 Tonpunkte.',
});
