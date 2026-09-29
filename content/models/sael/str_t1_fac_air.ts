/**
 * Luftkapitel I (f3:str_t1_fac_air) – Sael-Luftfabrik T1 auf 8×8.
 *
 * Roster: „Halbschale mit Landescheibe (Ring) statt Rampe.“ Grundform aus str_t1_fac_land.ts (`chapterParts`); vor
 * dem Tor liegt statt der Rampe die Landescheibe (Tiefjade) mit goldenem Ring. Pflichtpaar zum Landkapitel: Rampen-
 * Zunge gegen Ringscheibe.
 */
import { defineModel } from '@faf/modelkit';
import { chapterParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f3:str_t1_fac_air',
  parts: chapterParts(1, 'air'),
  notes: 'v_fac_air T1: Landescheibe statt Rampe.',
});
