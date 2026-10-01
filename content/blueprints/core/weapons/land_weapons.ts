// Weapons of the core land units (simulated from MS5 on; compiled and referenced from MS3).
import { defineWeapon } from '../../../../packages/blueprints/src/define.ts';

export default [
  defineWeapon({id:'core:wpn_reeve_cannon',sim:{range:22,minRange:1,damage:100,reloadSec:1,muzzleVelocity:35,projectile:'core:prj_shell_heavy',salvo:1},view:{fx:{muzzle:'core:fx_muzzle_large',impact:'core:fx_explosion_small'}}}),
  defineWeapon({id:'core:wpn_reeve_tapshot',sim:{range:22,damage:15000,damageRadius:2.5,reloadSec:3.3,muzzleVelocity:25,projectile:'core:prj_shell_heavy',salvo:1,overcharge:true},view:{fx:{muzzle:'core:fx_muzzle_large',impact:'core:fx_explosion_large'}}}),
  defineWeapon({id:'core:wpn_plumb_break',sim:{range:1,damage:2000,damageRadius:40,damageInnerRadius:30,damageFalloff:'quarter',reloadSec:1,muzzleVelocity:1,projectile:'core:prj_blast',salvo:1},view:{fx:{impact:'core:fx_explosion_large'}}}),
  defineWeapon({
    id: 'core:wpn_mg_t1',
    sim: { range: 14, damage: 8, reloadSec: 0.4, muzzleVelocity: 40, projectile: 'core:prj_bullet', salvo: 1 },
    view: { fx: { muzzle: 'core:fx_muzzle_small', impact: 'core:fx_muzzle_small' } },
  }),
  defineWeapon({
    id: 'core:wpn_cannon_t1',
    sim: { range: 18, damage: 30, reloadSec: 1.4, muzzleVelocity: 30, projectile: 'core:prj_shell_light', salvo: 1 },
    view: { fx: { muzzle: 'core:fx_muzzle_small', impact: 'core:fx_explosion_small' } },
  }),
  // Riegel I turret: outranges T1 tanks (18), is outranged by T1 artillery (30).
  defineWeapon({
    id: 'core:wpn_bolt_cannon_t1',
    sim: { range: 24, damage: 45, reloadSec: 1.2, muzzleVelocity: 34, projectile: 'core:prj_shell_light', salvo: 1 },
    view: { fx: { muzzle: 'core:fx_muzzle_small', impact: 'core:fx_explosion_small' } },
  }),
  defineWeapon({
    id: 'core:wpn_arty_t1',
    sim: {
      range: 30,
      minRange: 5,
      damage: 90,
      damageRadius: 1.5,
      reloadSec: 5,
      muzzleVelocity: 16,
      projectile: 'core:prj_arty_shell',
      salvo: 1,
    },
    view: { fx: { muzzle: 'core:fx_muzzle_large', impact: 'core:fx_explosion_small' } },
  }),
  defineWeapon({
    id: 'core:wpn_cannon_t2',
    sim: { range: 22, damage: 75, reloadSec: 1.6, muzzleVelocity: 32, projectile: 'core:prj_shell_heavy', salvo: 1 },
    view: { fx: { muzzle: 'core:fx_muzzle_large', impact: 'core:fx_explosion_small' } },
  }),
  defineWeapon({
    id: 'core:wpn_cannon_t3',
    sim: {
      range: 28,
      damage: 160,
      reloadSec: 2,
      muzzleVelocity: 35,
      projectile: 'core:prj_shell_heavy',
      salvo: 2,
      salvoIntervalSec: 0.3,
    },
    view: { fx: { muzzle: 'core:fx_muzzle_large', impact: 'core:fx_explosion_large' } },
  }),
  defineWeapon({
    id: 'core:wpn_death_heavy',
    sim: { range: 1, damage: 300, damageRadius: 3, reloadSec: 1, muzzleVelocity: 1, projectile: 'core:prj_blast', salvo: 1 },
    view: { fx: { impact: 'core:fx_explosion_large' } },
  }),
];
