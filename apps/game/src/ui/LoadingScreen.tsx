/**
 * Loading screen (P3): progress bar with percentage, the asset currently loading, bytes loaded /
 * planned and whether they come from the Cache API or the network; later the sim start. Shown on
 * top of the canvas until the session is ready; errors stay visible.
 */
import type { LoadState } from '../loading.ts';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const PHASE_TEXT: Record<LoadState['phase'], string> = {
  manifest: 'Asset-Manifest laden …',
  assets: 'Assets laden …',
  sim: 'Karte in die Simulation laden …',
  ready: 'Bereit',
  error: 'Laden fehlgeschlagen',
};

export function LoadingScreen({ state, mapName }: { state: LoadState; mapName: string }) {
  const pct = Math.max(0, Math.min(100, state.progress));
  const source = state.source === null ? '' : state.source === 'cache' ? 'aus dem Cache' : 'aus dem Netz';
  return (
    <div class="faf-loading" data-testid="loading-screen" data-phase={state.phase}>
      <div class="faf-loading-box">
        <div class="faf-loading-title">Flow &amp; Fire</div>
        <div class="faf-loading-map">Karte: {mapName}</div>
        <div class="faf-loading-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div class="faf-loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <div class="faf-loading-row">
          <span data-testid="loading-phase">{PHASE_TEXT[state.phase]}</span>
          <span data-testid="loading-percent">{pct} %</span>
        </div>
        {state.phase === 'error' ? (
          <div class="faf-loading-error" data-testid="loading-error">{state.message}</div>
        ) : (
          <>
            <div class="faf-loading-row faf-dim">
              <span data-testid="loading-asset">{state.asset ?? '–'}{source === '' ? '' : ` (${source})`}</span>
              <span data-testid="loading-bytes">
                {fmtBytes(state.bytesLoaded)} / {fmtBytes(state.bytesTotal)}
              </span>
            </div>
            <div class="faf-loading-row faf-dim">
              <span>
                Assets {state.assetsDone}/{state.assetsTotal}
              </span>
              <span data-testid="loading-sources">
                Cache {state.fromCache} · Netz {state.fromNetwork}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
