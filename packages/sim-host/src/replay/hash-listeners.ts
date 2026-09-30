/**
 * Several rule-hash listeners on one SimCore (TRACK-REPLAY review): SimCore has a single
 * `onHash` slot, so a recorder, the replay verifier, the cross-engine trail and debug tools would
 * overwrite each other. `addHashListener` installs one fan-out function in that slot (keeping a
 * listener that was already assigned directly as the first entry) and returns a remover.
 *
 * Interim solution without touching core.ts (parallel milestones own it): MS11 turns `onHash`
 * into a listener list inside SimCore and removes this module (docs/status/track-replay.md,
 * "Offene Punkte für MS11"). Until then, code that shares a core must use addHashListener instead
 * of assigning `core.onHash`; a later direct assignment replaces the fan-out (detected and
 * re-installed on the next addHashListener, dropping the overwritten listeners).
 */

import type { HashListener, SimCore } from '../core.ts';

interface FanOut {
  readonly fn: HashListener;
  readonly listeners: HashListener[];
}

const fanOuts = new WeakMap<SimCore, FanOut>();

function fanOutOf(core: SimCore): FanOut {
  const existing = fanOuts.get(core);
  if (existing !== undefined && core.onHash === existing.fn) return existing;
  const listeners: HashListener[] = [];
  const prior = core.onHash;
  if (prior !== null) listeners.push(prior);
  const fn: HashListener = (tick, hash) => {
    // Snapshot: a listener may remove itself (or add others) while being called.
    const ls = listeners.slice();
    for (let i = 0; i < ls.length; i++) ls[i]!(tick, hash);
  };
  const f: FanOut = { fn, listeners };
  fanOuts.set(core, f);
  core.onHash = fn;
  return f;
}

/** Registers `listener` for the core's rule hashes (in registration order); returns its remover. */
export function addHashListener(core: SimCore, listener: HashListener): () => void {
  const f = fanOutOf(core);
  f.listeners.push(listener);
  let active = true;
  return (): void => {
    if (!active) return;
    active = false;
    const i = f.listeners.indexOf(listener);
    if (i >= 0) f.listeners.splice(i, 1);
  };
}

/** Number of listeners currently registered through addHashListener (tests, diagnostics). */
export function hashListenerCount(core: SimCore): number {
  const f = fanOuts.get(core);
  return f !== undefined && core.onHash === f.fn ? f.listeners.length : core.onHash !== null ? 1 : 0;
}
