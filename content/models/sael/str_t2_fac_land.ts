/**
 * Landkapitel II (f3:str_t2_fac_land) – Sael-Landfabrik T2 (In-Place-Upgrade „Weihe“ des Landkapitels I).
 *
 * Roster: „Landkapitel ×1,3 mit goldener Turmnadel, 2 Tech-Streifen.“ Grundform aus str_t1_fac_land.ts
 * (`chapterParts`); Höhe ×1,2 kommt aus dem Roster-Maßstab, dazu die goldene Turmnadel auf dem Kuppelscheitel.
 */
import { defineModel } from '@faf/modelkit';
import { chapterParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f3:str_t2_fac_land',
  parts: chapterParts(2, 'land'),
  notes: 'v_fac_land T2: Turmnadel, 2 Streifen.',
});
