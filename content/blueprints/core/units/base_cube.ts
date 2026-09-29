// Abstract base of all MS1 test cubes: shared sim/motion defaults, never emitted.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:base_cube',
  abstract: true,
  categories: ['LAND', 'MOBILE', 'TECH1', 'CUBE'],
  sim: {
    health: { max: 100 },
    motion: {
      layer: 'land',
      speed: 3.0,
      accel: 3.0,
      turnRateDeg: 180,
      sizeClass: 1,
      footprint: [1, 1],
      maxSlope: 0.6,
      radius: 0.3,
    },
    intel: { vision: 16 },
  },
  view: {
    placeholder: { hull: 'box', size: [0.5, 0.5, 0.5] },
    iconThreshold: 8,
  },
});
