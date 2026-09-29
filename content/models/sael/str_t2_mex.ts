/**
 * Brunnen II (f3:str_t2_mex) – Sael-Massebohrung T2 (In-Place-Upgrade des Brunnens I).
 *
 * Roster: „Brunnen auf 2×2 (Höhe ×1,2) mit Seitenschale, 2 Tech-Streifen.“ Grundform aus str_t1_mex.ts; die Höhe
 * ×1,2 kommt aus dem Roster-Maßstab, dazu flache Seitenschalen links/rechts.
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f3:str_t2_mex',
  parts: mexParts(2),
  notes: 'v_mex T2: Seitenschalen, 2 Streifen.',
});
