// T2 medium tank: sizeClass 2 (needs 2 WU clearance), heavier cannon.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:lnd_t2_tank',
  extends: 'core:base_land_unit',
  categories: ['LAND', 'MOBILE', 'DIRECTFIRE', 'TECH2'],
  sim: {
    health: { max: 900 },
    economy: { mass: 198, energy: 990, buildTime: 880 },
    motion: { speed: 2.8, accel: 2.2, turnRateDeg: 75, sizeClass: 2, radius: 0.75, maxSlope: 0.55 },
    hitbox: [1.4, 0.5, 1.0],
    intel: { vision: 24 },
    weapons: [
      {
        id: 'cannon',
        ref: 'core:wpn_cannon_t2',
        part: 'turret',
        arcDeg: 360,
        yawRateDeg: 90,
        layers: ['land'],
        priorities: ['MOBILE & LAND', 'STRUCTURE', 'LAND | STRUCTURE'],
      },
    ],
    deathWeapon: null,
    upgradesTo: null,
  },
  view: {
    placeholder: {
      hull: 'box',
      size: [1.45, 0.46, 1.0],
      color: [0.5, 0.58, 0.52],
      turret: { hull: 'box', size: [0.62, 0.26, 0.56], offset: [-0.12, 0.46, 0] },
    },
    icon: 'land_direct',
    hotkeySlot: 'Q',
    fx: { death: 'core:fx_explosion_large' },
  },
});
