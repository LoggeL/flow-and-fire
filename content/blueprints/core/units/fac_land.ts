// T1 land factory (placeholder structure; economy/building is MS4/MS6). It anchors the tech tree:
// the factory is a root (faction start unit until the commander arrives in MS5) and builds the T1
// land units. The T2/T3 factories (upgrade chain T1 → T2 → T3) arrive with MS6/MS8; until then the
// T2/T3 tanks carry costs but no `buildableBy` (spawned only). The game table stays at ≤ 7 units in
// MS3 on purpose: sim tests use sim id 7 as "unknown blueprint" until ms3-p2 updates them.
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
    sim: { economy: { mass: 240, energy: 2100, buildTime: 300, buildableBy: '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND', buildPower: 20, massStorage: 80 } },
    view: { placeholder: { hull: 'box', size: [4.6, 1.2, 4.6], color: [0.55, 0.57, 0.6] }, hotkeySlot: 'E' },
  }),
];
