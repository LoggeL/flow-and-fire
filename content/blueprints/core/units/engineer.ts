import { defineUnit } from '../../../../packages/blueprints/src/define.ts';
/** T1 engineer produced by the land factory, using the same build/repair economy as commander. */
export default defineUnit({
 id:'core:eng_t1',extends:'core:base_land_unit',categories:['LAND','MOBILE','ENGINEER','REPAIR','RECLAIM','TECH1'],
 sim:{health:{max:150},motion:{speed:2,accel:2.5,turnRateDeg:120,sizeClass:1,radius:0.4},
 economy:{mass:52,energy:260,buildTime:260,buildableBy:'FACTORY & LAND & TECH1',buildPower:5,buildRange:5},intel:{vision:20},weapons:[]},
 view:{mesh:'units/varkan/lnd_t1_engineer',placeholder:{hull:'box',size:[0.7,0.45,0.7]},icon:'land_engineer',iconThreshold:10,hotkeySlot:'R',lod:[80,240]},
});
