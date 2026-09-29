/**
 * maps — regenerates every procedural map source (mapgen) and compiles every map source under
 * content/maps/src to content/maps/<name>.rtsmap (mapc). Idempotent: a second run changes nothing.
 *
 *   pnpm maps     (root)  ==  pnpm --filter @faf/formats run maps
 */

import { compileAllMapSources } from './mapc.ts';
import { GENERATORS } from './mapgen.ts';

const log = (m: string): void => console.log(m);
for (const gen of Object.values(GENERATORS)) gen(log);
compileAllMapSources(log);
