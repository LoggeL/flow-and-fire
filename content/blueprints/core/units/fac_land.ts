// Land factories T1 → T2 → T3 (roster values; ms6.3). Higher tiers exist only as paid upgrades of
// a standing factory on the same 5×5 site: no production while upgrading, then the factory builds
// its own tier and every lower land tier. The T2/T3 tanks are produced by Landwerk II/III.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

const base = defineUnit({
  id: 'core:base_land_factory',
  abstract: true,
  sim: {
    health: { max: 4200 },
    motion: { layer: 'land', speed: 0, accel: 0, turnRateDeg: 0, sizeClass: 3, footprint: [5, 5], maxSlope: 0.3, turnInPlace: false },
    intel: { vision: 20 },
    wreck: { massFraction: 0.9, hpFraction: 0.5 },
    veterancy: 'none',
  },
  view: {
    mesh: 'units/varkan/str_t1_fac_land',
    lod: [80, 240],
    iconThreshold: 10,
    icon: 'structure_generic',
    fx: { death: 'core:fx_explosion_large' },
  },
});

export default [
  base,
  defineUnit({
    id: 'core:fac_land_t1',
    extends: 'core:base_land_factory',
    categories: ['STRUCTURE', 'FACTORY', 'LAND', 'TECH1'],
    sim: { upgradesTo: 'core:fac_land_t2', economy: { mass: 240, energy: 2100, buildTime: 300, buildableBy: '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND', buildPower: 20, massStorage: 80 } },
    view: { placeholder: { hull: 'box', size: [4.6, 1.2, 4.6], color: [0.55, 0.57, 0.6] }, hotkeySlot: 'E' },
  }),
  defineUnit({
    id: 'core:fac_land_t2',
    extends: 'core:base_land_factory',
    categories: ['STRUCTURE', 'FACTORY', 'LAND', 'TECH2'],
    sim: { health: { max: 8200 }, upgradesTo: 'core:fac_land_t3', economy: { mass: 1400, energy: 11000, buildTime: 2300, buildPower: 40, massStorage: 160 } },
    view: { mesh: 'units/varkan/str_t2_fac_land', placeholder: { hull: 'box', size: [4.6, 1.5, 4.6], color: [0.55, 0.57, 0.6] } },
  }),
  defineUnit({
    id: 'core:fac_land_t3',
    extends: 'core:base_land_factory',
    categories: ['STRUCTURE', 'FACTORY', 'LAND', 'TECH3'],
    sim: { health: { max: 16000 }, upgradesTo: null, economy: { mass: 5200, energy: 47000, buildTime: 12000, buildPower: 90, massStorage: 320 } },
    view: { mesh: 'units/varkan/str_t3_fac_land', placeholder: { hull: 'box', size: [4.6, 1.8, 4.6], color: [0.55, 0.57, 0.6] } },
  }),
];
