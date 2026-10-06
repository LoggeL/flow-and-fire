// Abstract base of all mobile land units of the core faction (MS3 placeholder tanks): shared motion
// defaults, wreck, veterancy and view defaults. Never emitted.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:base_land_unit',
  abstract: true,
  sim: {
    motion: { layer: 'land', footprint: [1, 1], maxSlope: 0.6, turnInPlace: true },
    wreck: { massFraction: 0.9, hpFraction: 0.5 },
    veterancy: 'default',
    behaviors: [],
    toggles: [],
  },
  view: {
    lod: [60, 180],
    iconThreshold: 14,
  },
});
