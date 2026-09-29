/**
 * Luftnest II (f2:str_t2_fac_air) – Skarn-Luftfabrik T2 (In-Place-Upgrade von Luftnest I, Höhe × 1,2).
 *
 * Roster: „Luftnest × 1,3 mit Brutspule, 2 Tech-Streifen.“
 * Grundform aus str_t1_fac_land.ts (`nestParts`); In-Place-Upgrades wachsen nur in der Höhe (Roster-Maßstab y).
 */
import { defineModel } from '@faf/modelkit';
import { nestParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f2:str_t2_fac_air',
  parts: nestParts(2, 'air'),
  notes: 'v_fac_air T2: Brutspule, 2 Streifen.',
});
