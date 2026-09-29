/**
 * Landkapitel III (f3:str_t3_fac_land) – Sael-Landfabrik T3 (In-Place-Upgrade „Weihe“ des Landkapitels II).
 *
 * Roster: „Landkapitel ×1,7 mit zwei Turmnadeln und Seitenschale, 3 Tech-Streifen.“ Grundform aus str_t1_fac_land.ts
 * (`chapterParts`); Höhe ×1,4 kommt aus dem Roster-Maßstab; Scheitelnadel plus zwei Schulternadeln, Seitenschalen
 * links/rechts.
 */
import { defineModel } from '@faf/modelkit';
import { chapterParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f3:str_t3_fac_land',
  parts: chapterParts(3, 'land'),
  notes: 'v_fac_land T3: drei Nadeln, Seitenschalen, 3 Streifen.',
});
