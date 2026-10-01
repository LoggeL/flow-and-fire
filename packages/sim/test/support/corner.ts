import type { SimBpTable } from '@faf/blueprints/simbin';
import type { World } from '../../src/index.ts';

/** A corner of a 256 WU test map at least 60 WU away from every commander (their cannons reach 22 WU). */
export function quietCorner(w: World, bp: SimBpTable): readonly [number, number] {
  const commander = bp.indexOf('core:cmd_commander'), U = w.units.col;
  for (const [x, z] of [[30, 30], [30, 226], [226, 30], [226, 226]] as const) {
    let clear = true;
    for (let u = 0; u < w.units.highWater; u++) if (w.units.isLive(u) && U.bp[u] === commander && Math.hypot(U.x[u]! / 4096 - x, U.z[u]! / 4096 - z) < 60) clear = false;
    if (clear) return [x, z];
  }
  throw new Error('no quiet corner');
}
