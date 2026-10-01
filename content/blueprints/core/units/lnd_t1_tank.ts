// T1 light tank (values as in the PLAN §3.9 example): sizeClass 1, turret with a 360° cannon.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

export default defineUnit({
  id: 'core:lnd_t1_tank',
  extends: 'core:base_land_unit',
  categories: ['LAND', 'MOBILE', 'DIRECTFIRE', 'TECH1'],
  sim: {
    health: { max: 300 },
    economy: { mass: 56, energy: 280, buildTime: 280, buildableBy: 'FACTORY & LAND' },
    motion: { speed: 3.0, accel: 2.5, turnRateDeg: 90, sizeClass: 1, radius: 0.45 },
    hitbox: [0.6, 0.4, 0.8],
    intel: { vision: 20 },
    weapons: [
      {
        id: 'cannon',
        ref: 'core:wpn_cannon_t1',
        part: 'turret',
        arcDeg: 360,
        yawRateDeg: 120,
        layers: ['land'],
        priorities: ['MOBILE & LAND', 'STRUCTURE', 'LAND | STRUCTURE'],
      },
    ],
    deathWeapon: null,
    upgradesTo: null,
  },
  view: {
    mesh: 'units/varkan/lnd_t1_tank',
    placeholder: {
      hull: 'box',
      size: [0.95, 0.34, 0.66],
      color: [0.56, 0.62, 0.5],
      turret: { hull: 'cyl', size: [0.36, 0.18, 0.36], offset: [-0.08, 0.34, 0] },
    },
    icon: 'land_direct',
    hotkeySlot: 'Q',
    fx: { death: 'core:fx_explosion_small' },
  },
});
