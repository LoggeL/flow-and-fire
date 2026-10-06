// Basic effects (view only: never part of sim.bin/simHash).
import { defineEffect } from '../../../../packages/blueprints/src/define.ts';

export default [
  defineEffect({ id: 'core:fx_muzzle_small', view: { kind: 'flash', color: [1, 0.85, 0.5], size: 0.3, durationSec: 0.08 } }),
  defineEffect({ id: 'core:fx_muzzle_large', view: { kind: 'flash', color: [1, 0.8, 0.45], size: 0.6, durationSec: 0.12 } }),
  defineEffect({ id: 'core:fx_explosion_small', view: { kind: 'burst', color: [1, 0.55, 0.2], size: 1.2, durationSec: 0.6, count: 12 } }),
  defineEffect({ id: 'core:fx_explosion_large', view: { kind: 'burst', color: [1, 0.5, 0.15], size: 3, durationSec: 1.1, count: 32 } }),
  defineEffect({ id: 'core:fx_shell_trail', view: { kind: 'trail', color: [0.8, 0.8, 0.8], size: 0.15, durationSec: 0.5, count: 6 } }),
  defineEffect({ id: 'core:fx_scorch', view: { kind: 'decal', color: [0.1, 0.09, 0.08], size: 2, durationSec: 20 } }),
];
