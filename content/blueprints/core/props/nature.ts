// Map props (placed by the .rtsmap PROP chunk from MS8 on): reclaimable rocks and trees.
import { defineProp } from '../../../../packages/blueprints/src/define.ts';

export default [
  defineProp({
    id: 'core:prop_rock_small',
    sim: { reclaim: { mass: 12, energy: 0, timeSec: 2 }, blocksShots: true, footprint: [1, 1] },
    view: { placeholder: { hull: 'box', size: [0.9, 0.6, 0.8], color: [0.45, 0.44, 0.42] } },
  }),
  defineProp({
    id: 'core:prop_rock_large',
    sim: { reclaim: { mass: 45, energy: 0, timeSec: 6 }, blocksShots: true, footprint: [2, 2] },
    view: { placeholder: { hull: 'box', size: [1.9, 1.2, 1.7], color: [0.42, 0.41, 0.4] } },
  }),
  defineProp({
    id: 'core:prop_tree_pine',
    sim: { reclaim: { mass: 0, energy: 25, timeSec: 1 }, blocksShots: false, footprint: [0, 0], health: 50 },
    view: { placeholder: { hull: 'cyl', size: [0.5, 2.2, 0.5], color: [0.2, 0.36, 0.2] } },
  }),
];
