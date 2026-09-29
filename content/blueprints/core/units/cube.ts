// MS1 placeholder unit: a half-WU box that drives at 3 WU/s and turns at 180 °/s.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:cube',
  extends: 'core:base_cube',
  view: {
    placeholder: { hull: 'box', size: [0.5, 0.5, 0.5], color: [0.62, 0.66, 0.72] },
    icon: 'land_cube',
  },
});
