// T1 scout: fast, small, lightly armed; sizeClass 1, light collision mass.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:lnd_t1_scout',
  extends: 'core:base_land_unit',
  categories: ['LAND', 'MOBILE', 'SCOUT', 'DIRECTFIRE', 'TECH1'],
  sim: {
    health: { max: 60 },
    economy: { mass: 12, energy: 80, buildTime: 60, buildableBy: 'FACTORY & LAND & TECH1' },
    motion: { speed: 5.0, accel: 5.0, turnRateDeg: 180, sizeClass: 1, radius: 0.35, mass: 1 },
    hitbox: [0.8, 0.35, 0.55],
    intel: { vision: 30 },
    weapons: [
      {
        id: 'mg',
        ref: 'core:wpn_mg_t1',
        part: 'turret',
        arcDeg: 360,
        yawRateDeg: 180,
        layers: ['land'],
        priorities: ['MOBILE & LAND', 'STRUCTURE', 'LAND | STRUCTURE'],
      },
    ],
    wreck: { massFraction: 0.9, hpFraction: 0.5 },
    deathWeapon: null,
    upgradesTo: null,
  },
  view: {
    mesh: 'units/varkan/lnd_t1_scout',
    placeholder: {
      hull: 'box',
      size: [0.8, 0.28, 0.55],
      color: [0.66, 0.7, 0.58],
      turret: { hull: 'cyl', size: [0.22, 0.14, 0.22], offset: [-0.05, 0.28, 0] },
    },
    icon: 'land_scout',
    hotkeySlot: 'W',
    fx: { death: 'core:fx_explosion_small' },
  },
});
