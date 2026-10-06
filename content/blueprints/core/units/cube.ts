// MS1 placeholder unit: a half-WU box that drives at 3 WU/s and turns at 180 °/s.
// MS2: the view uses the pipeline model 'units/cube_bot' (3 LODs, merged parts); the placeholder
// stays as fallback (sim values unchanged ⇒ simHash unchanged).
// MS3: icon 'cube' from the ICON_IDS registry (view only).
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:cube',
  extends: 'core:base_cube',
  view: {
    placeholder: { hull: 'box', size: [0.5, 0.5, 0.5], color: [0.62, 0.66, 0.72] },
    mesh: 'units/cube_bot',
    lod: [60, 180],
    icon: 'cube',
  },
});
