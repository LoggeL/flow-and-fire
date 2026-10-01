import { defineUnit } from '../../../../packages/blueprints/src/define.ts';
/** MS4 test consumer, intentionally excluded from normal game content. */
export default defineUnit({ id: 'test:stall_consumer', categories: ['STRUCTURE', 'ECONOMIC'], sim: { health: { max: 100 }, motion: { layer: 'land', speed: 0, accel: 0, turnRateDeg: 0, sizeClass: 1, footprint: [2, 2], maxSlope: 0.3 }, economy: { mass: 0, energy: 0, buildTime: 1, energyUpkeep: 40, stallsOff: true } }, view: { placeholder: { hull: 'box', size: [1, 1, 1] } } });
