/**
 * Luftnest I (f2:str_t1_fac_air) – Skarn-Luftfabrik T1 auf 8×8: dasselbe Nestmaul wie das Landnest, vorn statt der
 * Rampe ein flaches Landenetz (Sehnen-Sechseckring mit drei Speichen) auf voller Achteck-Kruste.
 *
 * Roster: „Nestmaul mit flachem Landenetz (Netzring) statt Rampe.“
 * Grundform aus str_t1_fac_land.ts (`nestParts`); In-Place-Upgrades wachsen nur in der Höhe (Roster-Maßstab y).
 */
import { defineModel } from '@faf/modelkit';
import { nestParts } from './str_t1_fac_land.ts';

export default defineModel({
  id: 'f2:str_t1_fac_air',
  parts: nestParts(1, 'air'),
  notes: 'v_fac_air T1: Landenetz statt Rampe.',
});
