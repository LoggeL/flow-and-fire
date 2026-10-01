// T1 point defense and radar (roster: Riegel I, Horcher I; ms6.3), built by engineers and the commander.
// Radar shows enemy units outside sight as anonymous blips while it is powered.
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';

const buildableBy = '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND';
const structure = { layer: 'land' as const, speed: 0, accel: 0, turnRateDeg: 0, turnInPlace: false, maxSlope: 0.3 };

export default [
  defineUnit({
    id: 'core:str_t1_pd',
    categories: ['STRUCTURE', 'DEFENSE', 'DIRECTFIRE', 'TECH1', 'SIZE4'],
    sim: {
      health: { max: 1350 },
      motion: { ...structure, sizeClass: 1, footprint: [1, 1] },
      intel: { vision: 24 },
      economy: { mass: 240, energy: 2000, buildTime: 250, buildableBy },
      hitbox: [0.9, 0.7, 0.9],
      weapons: [
        { id: 'turret', ref: 'core:wpn_bolt_cannon_t1', part: 'turret', arcDeg: 360, yawRateDeg: 90, layers: ['land'], priorities: ['MOBILE & LAND', 'STRUCTURE', 'LAND | STRUCTURE'] },
      ],
      wreck: { massFraction: 0.9, hpFraction: 0.5 },
      veterancy: 'none',
    },
    view: { mesh: 'units/varkan/str_t1_pd', placeholder: { hull: 'box', size: [0.9, 0.5, 0.9], turret: { hull: 'cyl', size: [0.6, 0.25, 0.6], offset: [0, 0.5, 0] } }, iconThreshold: 10, icon: 'structure_generic', lod: [80, 240], hotkeySlot: 'Z', fx: { death: 'core:fx_explosion_small' } },
  }),
  defineUnit({
    id: 'core:str_t1_radar',
    categories: ['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH1', 'SIZE4'],
    sim: {
      health: { max: 200 },
      motion: { ...structure, sizeClass: 2, footprint: [2, 2] },
      intel: { vision: 20, radar: 116 },
      economy: { mass: 80, energy: 720, buildTime: 80, buildableBy, energyUpkeep: 20 },
      wreck: { massFraction: 0.9, hpFraction: 0.5 },
      veterancy: 'none',
    },
    view: { mesh: 'units/varkan/str_t1_radar', placeholder: { hull: 'box', size: [1.8, 2.4, 1.8] }, iconThreshold: 10, icon: 'structure_generic', lod: [80, 240], hotkeySlot: 'D', fx: { death: 'core:fx_explosion_small' } },
  }),
];
