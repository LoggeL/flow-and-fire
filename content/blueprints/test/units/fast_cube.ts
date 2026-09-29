// Test-only blueprint (namespace test:, never part of a game bundle): a faster, tougher cube.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'test:fast_cube',
  extends: 'core:cube',
  categories: ['LAND', 'MOBILE', 'TECH1', 'CUBE', 'TESTONLY'],
  sim: {
    health: { max: 250 },
    motion: { speed: 8.0, accel: 10.0, turnRateDeg: 360 },
  },
  view: {
    placeholder: { hull: 'cyl', size: [0.5, 0.6, 0.5], color: [0.9, 0.4, 0.2] },
  },
});
