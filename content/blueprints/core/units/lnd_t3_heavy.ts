// T3 heavy assault tank: sizeClass 3, slow, high collision mass (hard to push), death explosion.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:lnd_t3_heavy',
  extends: 'core:base_land_unit',
  categories: ['LAND', 'MOBILE', 'DIRECTFIRE', 'TECH3'],
  sim: {
    health: { max: 4500 },
    economy: { mass: 840, energy: 7200, buildTime: 3600, buildableBy: 'FACTORY & LAND & TECH3' },
    motion: { speed: 1.9, accel: 1.2, turnRateDeg: 45, sizeClass: 3, radius: 1.2, mass: 24, maxSlope: 0.5 },
    hitbox: [2.3, 0.8, 1.7],
    intel: { vision: 28 },
    weapons: [
      {
        id: 'main',
        ref: 'core:wpn_cannon_t3',
        part: 'turret',
        arcDeg: 360,
        yawRateDeg: 60,
        layers: ['land'],
        priorities: ['MOBILE & LAND & (TECH2 | TECH3)', 'MOBILE & LAND', 'STRUCTURE', 'LAND | STRUCTURE'],
      },
      {
        id: 'coax',
        ref: 'core:wpn_mg_t1',
        part: 'hull',
        arcDeg: 90,
        yawRateDeg: 90,
        layers: ['land'],
        priorities: ['MOBILE & LAND & TECH1', 'MOBILE & LAND', 'LAND | STRUCTURE'],
      },
    ],
    deathWeapon: 'core:wpn_death_heavy',
    upgradesTo: null,
  },
  view: {
    mesh: 'units/varkan/lnd_t3_bot',
    placeholder: {
      hull: 'box',
      size: [2.3, 0.72, 1.7],
      color: [0.46, 0.52, 0.5],
      turret: { hull: 'box', size: [1.05, 0.4, 0.9], offset: [-0.2, 0.72, 0] },
    },
    icon: 'land_direct',
    hotkeySlot: 'R',
    fx: { death: 'core:fx_explosion_large' },
  },
});
