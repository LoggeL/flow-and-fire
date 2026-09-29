/**
 * Brunnen III (f3:str_t3_mex) – Sael-Massebohrung T3 (In-Place-Upgrade des Brunnens II).
 *
 * Roster: „Brunnen auf 2×2 (Höhe ×1,4), doppelter Ring, 3 Tech-Streifen; keine Bögen (unterscheidet sich so vom
 * Quellbogen).“ Grundform aus str_t1_mex.ts; zweiter, goldener Kranz über dem ersten, Seitenschalen wie II.
 */
import { defineModel } from '@faf/modelkit';
import { mexParts } from './str_t1_mex.ts';

export default defineModel({
  id: 'f3:str_t3_mex',
  parts: mexParts(3),
  notes: 'v_mex T3: doppelter Kranz, Seitenschalen, 3 Streifen.',
});
