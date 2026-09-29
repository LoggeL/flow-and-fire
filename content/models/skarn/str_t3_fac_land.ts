/**
 * Landnest III (f2:str_t3_fac_land) – Skarn-Landfabrik T3 (In-Place-Upgrade von Landnest II, Höhe × 1,4).
 *
 * Roster: „Landnest × 1,7 mit zweitem Nestkern und Seitenplatten, 3 Tech-Streifen.“
 * Grundform aus str_t1_fac_land.ts (`nestParts`); In-Place-Upgrades wachsen nur in der Höhe (Roster-Maßstab y).
 */
import { defineModel } from '@faf/modelkit';
import { nestParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f2:str_t3_fac_land',
  parts: nestParts(3, 'land'),
  notes: 'v_fac_land T3: Brutspule, zweiter Nestkern, Seitenplatten, 3 Streifen.',
});
