// T1 mobile artillery: slow, indirect fire (ballistic shells), sizeClass 1.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:lnd_t1_arty',
  extends: 'core:base_land_unit',
  categories: ['LAND', 'MOBILE', 'ARTILLERY', 'INDIRECTFIRE', 'TECH1'],
  sim: {
    health: { max: 200 },
    economy: { mass: 72, energy: 360, buildTime: 360, buildableBy: 'FACTORY & LAND & TECH1' },
    motion: { speed: 2.2, accel: 1.8, turnRateDeg: 70, sizeClass: 1, radius: 0.45 },
    hitbox: [0.9, 0.45, 0.65],
    intel: { vision: 18 },
    weapons: [
      {
        id: 'mortar',
        ref: 'core:wpn_arty_t1',
        part: 'turret',
        arcDeg: 360,
        yawRateDeg: 60,
        layers: ['land'],
        priorities: ['STRUCTURE', 'MOBILE & LAND', 'LAND | STRUCTURE'],
      },
    ],
    deathWeapon: null,
    upgradesTo: null,
  },
  view: {
    mesh: 'units/varkan/lnd_t1_arty',
    placeholder: {
      hull: 'box',
      size: [0.95, 0.3, 0.66],
      color: [0.64, 0.58, 0.46],
      turret: { hull: 'box', size: [0.5, 0.22, 0.34], offset: [-0.12, 0.3, 0] },
    },
    icon: 'land_indirect',
    hotkeySlot: 'E',
    fx: { death: 'core:fx_explosion_small' },
  },
});
