/** Shared asset keys; URLs in harness/worker-entry.ts must cover this list. */
import { SCENARIO_NAMES } from '../scenarios.ts';
export const REPLAY_PATHS = SCENARIO_NAMES.map((name) => `test/golden-replays/${name}.rtsreplay`);
