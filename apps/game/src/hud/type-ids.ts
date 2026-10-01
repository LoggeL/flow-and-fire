/** Explicit bridge between existing compiled ids and the design roster used by the HUD. */
const PAIRS = [
  ['core:eng_t1', 'core:lnd_t1_engineer'],
  ['core:fac_land_t1', 'core:str_t1_fac_land'],
  ['core:fac_land_t2', 'core:str_t2_fac_land'],
  ['core:fac_land_t3', 'core:str_t3_fac_land'],
  ['core:str_t1_estorage', 'core:str_t1_estore'],
] as const;
export function hudTypeId(id: string): string { return PAIRS.find(pair => pair[0] === id)?.[1] ?? id; }
export function simTypeId(id: string): string { return PAIRS.find(pair => pair[1] === id)?.[0] ?? id; }
