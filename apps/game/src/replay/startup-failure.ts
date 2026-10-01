import type { ReplayFailure } from './controller.ts';

/** Only the replay host's pre-ready canonical build handoff is a compatibility notice. */
export function isReplayStartupCompatibilityNotice(message: unknown, replayMode: boolean, ready: boolean): boolean {
  if (!replayMode || ready || message === null || typeof message !== 'object') return false;
  const m = message as { t?: unknown; message?: unknown; replayBuild?: unknown; replayRoute?: unknown };
  if (m.t !== 'error' || typeof m.message !== 'string' || m.message.trim() === '' || m.message.startsWith('worker:')
    || typeof m.replayBuild !== 'string' || m.replayBuild.trim() === '' || typeof m.replayRoute !== 'string') return false;
  try { return m.replayRoute === `/b/${encodeURIComponent(m.replayBuild)}/`; }
  catch { return false; } // Malformed Unicode is not a valid encoded build route.
}

/** The controller already renders the same compatibility notice and its build button. */
export function visibleReplayWorkError(error: string | null, failure: ReplayFailure | null, ready: boolean): string | null {
  if (failure !== null && error === failure.message && isReplayStartupCompatibilityNotice({
    t: 'error', message: failure.message, replayBuild: failure.buildHash, replayRoute: failure.route,
  }, true, ready)) return null;
  return error;
}
