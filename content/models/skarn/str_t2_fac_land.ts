/**
 * Landnest II (f2:str_t2_fac_land) – Skarn-Landfabrik T2 (In-Place-Upgrade von Landnest I, Höhe × 1,2).
 *
 * Roster: „Landnest × 1,3 mit Brutspule, 2 Tech-Streifen.“
 * Grundform aus str_t1_fac_land.ts (`nestParts`); In-Place-Upgrades wachsen nur in der Höhe (Roster-Maßstab y).
 */
import { defineModel } from '@faf/modelkit';
import { nestParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f2:str_t2_fac_land',
  parts: nestParts(2, 'land'),
  notes: 'v_fac_land T2: Brutspule auf dem Nackenpanzer, 2 Streifen.',
});
