// The core faction (own design, no FA names). Start unit: the T1 land factory until the commander
// (ACU) arrives with MS5.
import { defineFaction } from '../../../../packages/blueprints/src/define.ts';

export default defineFaction({
  id: 'core:faction_core',
  units: [
    'core:cmd_commander',
    'core:str_t1_mex',
    'core:str_t2_mex',
    'core:str_t3_mex',
    'core:str_t1_pgen',
    'core:str_t1_estorage',
    'core:fac_land_t1',
    'core:fac_land_t2',
    'core:fac_land_t3',
    'core:str_t1_pd',
    'core:str_t1_radar',
    'core:eng_t1',
    'core:lnd_t1_scout',
    'core:lnd_t1_tank',
    'core:lnd_t1_arty',
    'core:lnd_t2_tank',
    'core:lnd_t3_heavy',
  ],
  startUnit: 'core:cmd_commander',
  color: [0.25, 0.5, 0.9],
});
