// Projectiles of the core land weapons.
import { defineProjectile } from '../../../../packages/blueprints/src/define.ts';

export default [
  defineProjectile({
    id: 'core:prj_bullet',
    sim: { kind: 'linear', speed: 40, lifetimeSec: 0.6 },
    view: { shape: 'tracer', size: 0.08, color: [1, 0.9, 0.5] },
  }),
  defineProjectile({
    id: 'core:prj_shell_light',
    sim: { kind: 'linear', speed: 30, lifetimeSec: 1 },
    view: { shape: 'sphere', size: 0.12, color: [1, 0.75, 0.35] },
  }),
  defineProjectile({
    id: 'core:prj_shell_heavy',
    sim: { kind: 'linear', speed: 34, lifetimeSec: 1.2 },
    view: { shape: 'sphere', size: 0.18, color: [1, 0.7, 0.3], trailFx: 'core:fx_shell_trail' },
  }),
  defineProjectile({
    id: 'core:prj_arty_shell',
    sim: { kind: 'ballistic', speed: 16, gravity: 4.9, lifetimeSec: 6 },
    view: { shape: 'sphere', size: 0.22, color: [1, 0.6, 0.25], trailFx: 'core:fx_shell_trail' },
  }),
  defineProjectile({
    id: 'core:prj_blast',
    sim: { kind: 'linear', speed: 1, lifetimeSec: 0.1 },
  }),
];
