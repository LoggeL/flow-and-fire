/** MS4 values from docs/design/roster.md §§4,9. Own faction IDs and placeholder assets. */
import { COMMANDER_VARIANTS } from '../../../../packages/rules/src/commander-enhancements.ts';
import { defineUnit } from '../../../../packages/blueprints/src/define.ts';
const structures = { health: { max: 400 }, motion: { layer: 'land' as const, speed: 0, accel: 0, turnRateDeg: 0, sizeClass: 2, footprint: [2, 2] as const, maxSlope: 0.3, turnInPlace: false }, intel: { vision: 16 }, wreck: { massFraction: 0.9, hpFraction: 0.5 }, veterancy: 'none' as const };
const view = { iconThreshold: 10, icon: 'structure_generic' as const, placeholder: { hull: 'box' as const, size: [1.8, 1, 1.8] as const }, lod: [80, 240] as const };
const buildableBy = '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND';
export default [
    defineUnit({id:'core:str_t1_estorage',categories:['STRUCTURE','ECONOMIC','ENERGYSTORAGE','TECH1'],sim:{...structures,economy:{mass:120,energy:1200,buildTime:120,buildableBy,energyStorage:5000}},view:{...view,mesh:'units/varkan/str_t1_estore',hotkeySlot:'R'}}),
    defineUnit({ id: 'core:cmd_commander', categories: ['LAND', 'MOBILE', 'DIRECTFIRE', 'COMMAND', 'ENGINEER', 'RECLAIM', 'REPAIR', 'UNIQUE'], sim: { upgradesTo: 'core:cmd_commander_engineering', health: { max: 12000 }, motion: { layer: 'land', speed: 1.7, accel: 3, turnRateDeg: 90, sizeClass: 2, footprint: [2, 2], maxSlope: 0.6, radius: 0.7 }, intel: { vision: 26 }, deathWeapon:'core:wpn_plumb_break', weapons: [{id:'cannon',ref:'core:wpn_reeve_cannon',part:'hull',arcDeg:360,yawRateDeg:120,layers:['land'],priorities:['COMMAND','MOBILE & LAND','STRUCTURE']}], economy: { mass: 2000, energy: 5000000, buildTime: 6000000, buildPower: 10, buildRange: 5, massIncome: 1, energyIncome: 20, massStorage: 650, energyStorage: 3900 } }, view: { mesh: 'units/varkan/cmd_commander', placeholder: { hull: 'box', size: [2, 2.4, 2] }, icon: 'commander', iconThreshold: 12, lod: [80, 240] } }),
    // Each combination preserves installed modules; the Sim bills only the newly added module.
    ...COMMANDER_VARIANTS.slice(1).map((id, index) => {
      const mask = index + 1, engineering = (mask & 1) !== 0, cannon = (mask & 2) !== 0, armor = (mask & 4) !== 0;
      const successor = !engineering ? mask | 1 : !armor ? mask | 4 : !cannon ? mask | 2 : -1;
      const cost = mask === 1 ? { mass: 300, energy: 3000, buildTime: 600 } :
        mask === 2 ? { mass: 250, energy: 2500, buildTime: 500 } : { mass: 400, energy: 5000, buildTime: 800 };
      return defineUnit({ id, extends: 'core:cmd_commander', sim: {
        upgradesTo: successor < 0 ? null : COMMANDER_VARIANTS[successor]!,
        health: { max: 12000 + (engineering ? 4000 : 0) + (armor ? 8000 : 0) },
        economy: { ...cost, buildPower: engineering ? 20 : 10 },
        ...(cannon ? { weapons: [{ id: 'cannon', ref: 'core:wpn_reeve_cannon_enhanced', part: 'hull' as const, arcDeg: 360, yawRateDeg: 120, layers: ['land' as const], priorities: ['COMMAND', 'MOBILE & LAND', 'STRUCTURE'] }] } : {}),
      } });
    }),
    defineUnit({ id: 'core:str_t1_mex', categories: ['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH1', 'SIZE4'], sim: { ...structures, upgradesTo: 'core:str_t2_mex', economy: { mass: 36, energy: 360, buildTime: 60, buildableBy, buildPower: 10, massIncome: 2, energyUpkeep: 2, spotKind: 'mass' } }, view: { ...view, mesh: 'units/varkan/str_t1_mex', hotkeySlot: 'Q' } }),
    defineUnit({ id: 'core:str_t2_mex', categories: ['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH2', 'SIZE4'], sim: { ...structures, upgradesTo: 'core:str_t3_mex', health: { max: 2100 }, intel: { vision: 20 }, economy: { mass: 900, energy: 5400, buildTime: 900, buildPower: 15, massIncome: 6, energyUpkeep: 9, spotKind: 'mass' } }, view: { ...view, mesh: 'units/varkan/str_t2_mex' } }),
    defineUnit({ id: 'core:str_t3_mex', categories: ['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH3', 'SIZE4'], sim: { ...structures, upgradesTo: null, health: { max: 7000 }, intel: { vision: 20 }, economy: { mass: 4500, energy: 31000, buildTime: 2900, buildPower: 0, massIncome: 18, energyUpkeep: 54, spotKind: 'mass' } }, view: { ...view, mesh: 'units/varkan/str_t3_mex' } }),
    defineUnit({ id: 'core:str_t1_pgen', categories: ['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH1', 'SIZE4'], sim: { ...structures, health: { max: 620 }, economy: { mass: 75, energy: 750, buildTime: 125, buildableBy, energyIncome: 20 } }, view: { ...view, mesh: 'units/varkan/str_t1_pgen', hotkeySlot: 'W' } }),
];
