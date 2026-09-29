/**
 * Laterne III (f3:str_t3_pgen) – Sael-Kraftwerk T3 (Neubau auf 8×8).
 *
 * Roster: „Laterne auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Laternen, 3 Tech-Streifen.“ Grundform aus str_t1_pgen.ts
 * im Basismaß 2×2; hohe Mittellaterne, zwei kleinere Seitenlaternen gefächert. Pflichtpaar Sintflut↔Laterne III:
 * drei stehende Linsen ohne Horn.
 */
import { defineModel } from '@faf/modelkit';
import { pgenParts } from './str_t1_pgen.ts';

export default defineModel({
  id: 'f3:str_t3_pgen',
  parts: pgenParts(3),
  notes: 'v_pgen T3: 3 Laternen, 3 Streifen.',
});
