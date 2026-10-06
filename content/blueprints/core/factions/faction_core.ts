// The core faction (own design, no FA names). Start unit: the T1 land factory until the commander
// (ACU) arrives with MS5.
import { defineFaction } from '../../../../packages/blueprints/src/define.ts';

export default defineFaction({
  id: 'core:faction_core',
  units: [
    'core:fac_land_t1',
    'core:lnd_t1_scout',
    'core:lnd_t1_tank',
    'core:lnd_t1_arty',
    'core:lnd_t2_tank',
    'core:lnd_t3_heavy',
  ],
  startUnit: 'core:fac_land_t1',
  color: [0.25, 0.5, 0.9],
});
