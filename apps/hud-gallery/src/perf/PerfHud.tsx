import { Hud, useHud } from '@faf/hud';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { pendingPerfResult, runHudPerf } from './harness.ts';
import type { PerfParams } from './params.ts';

/**
 * The full HUD in measurement mode: mounts <Hud/> and starts the perf harness once the root exists
 * (window.__HUD_PERF__ reports progress and the result).
 */
export function PerfHud({ params }: { readonly params: PerfParams }): JSX.Element {
  const model = useHud();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.__HUD_PERF__ = pendingPerfResult(params);
    const root = host.current?.querySelector<HTMLElement>('[data-hud-root]');
    if (root === null || root === undefined) {
      window.__HUD_PERF__ = { ...pendingPerfResult(params), done: true, errors: ['[data-hud-root] missing'] };
      return;
    }
    void runHudPerf(model, root, params);
  }, []);
  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }} data-testid="perf-host">
      <Hud mac={false} />
    </div>
  );
}
