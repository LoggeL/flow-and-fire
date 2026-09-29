/**
 * Himmelshalle I (f4:str_t1_fac_air) – Aurith-Luftfabrik T1 auf 8×8.
 *
 * Roster: „Apsis mit Landereif statt Kamm-Rampe (teilt das Visual mit der Grundhalle, Tech-Bitmaske + Rollenbit).“
 * Grundform aus str_t1_fac_land.ts (`hallParts(…, 'air')`): gleiche Apsis und Scheitelkristalle, vorn statt der
 * Kamm-Rampe ein flacher Landereif (Reif ohne Mast = Flow-Anschluss, faction.md §5.1) mit Pechglas-Landefläche.
 */
import { defineModel } from '@faf/modelkit';
import { hallParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f4:str_t1_fac_air',
  parts: hallParts(1, 'air'),
  notes: 'v_fac T1 (Luft): Landereif statt Kamm-Rampe.',
});
