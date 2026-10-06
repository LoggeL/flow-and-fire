/**
 * Scenarios of the FX benchmark (`pnpm bench:fx`) and the draw budget (TRACK-RENDERFX acceptance:
 * FX draws = shields + particles + beams ≤ 6 and total draws ≤ 40 per frame; exceeding them is a
 * benchmark ERROR, ms values never are – DECISIONS 16).
 */

export const FX_SCENARIO_NAMES = [
  'battle',
  'battle-nofx',
  'battle-pass',
  'battle-nofx-pass',
  'battle-low',
  'battle-ldr',
  'shields',
  'shields-nofx',
  'shields-pass',
  'shields-nofx-pass',
  'big',
  'lighting-csm',
  'lighting-nocsm',
] as const;
export type FxScenarioName = (typeof FX_SCENARIO_NAMES)[number];

/** Scenarios of `--quick` (Chromium only, 1 s warm-up + 3 s). */
export const QUICK_SCENARIOS: readonly FxScenarioName[] = ['battle', 'shields', 'big'];

export const FX_DRAW_LIMIT = 6;
export const TOTAL_DRAW_LIMIT = 40;

/** Viewport of the benchmark (CSS px, DPR 1): medium's render scale 0.8 gives a 1536×864 backbuffer. */
export const BENCH_VIEWPORT = { width: 1920, height: 1080, dpr: 1 } as const;

export interface FxScenario {
  readonly name: FxScenarioName;
  /** URL parameters of the fx-lab (bench=1 and seed are added by the runner). */
  readonly params: Readonly<Record<string, string>>;
  /** German one-liner for the docs. */
  readonly purpose: string;
  /**
   * Re-trigger `__fxlab.triggerBigExplosion()` every N seconds of the run (warm-up included), so the
   * measured window always contains a fresh commander explosion; 0 = never.
   */
  readonly triggerEveryS: number;
}

export const FX_SCENARIOS: Readonly<Record<FxScenarioName, FxScenario>> = {
  battle: {
    name: 'battle',
    params: { scene: 'battle', preset: 'medium', flight: '1' },
    purpose: '2×200-Gefecht, Medium (HDR, Bloom, FXAA, CSM), Kameraflug',
    triggerEveryS: 0,
  },
  'battle-nofx': {
    name: 'battle-nofx',
    params: { scene: 'battle', preset: 'medium', flight: '1', fx: '0' },
    purpose: 'wie battle, aber ohne transparente FX (fx=0) → GPU-Differenz = Kosten von Partikeln, Beams und Trails',
    triggerEveryS: 0,
  },
  'battle-pass': {
    name: 'battle-pass',
    params: { scene: 'battle', preset: 'medium', flight: '1', gpuseg: 'pass' },
    purpose: 'wie battle, GPU-Timer nur an Pass-Grenzen (gpuseg=pass) → Szenen-Segment minus battle-nofx-pass = FX-Kosten ohne Messartefakt',
    triggerEveryS: 0,
  },
  'battle-nofx-pass': {
    name: 'battle-nofx-pass',
    params: { scene: 'battle', preset: 'medium', flight: '1', fx: '0', gpuseg: 'pass' },
    purpose: 'Referenz zu battle-pass: ohne transparente FX, Timer nur an Pass-Grenzen',
    triggerEveryS: 0,
  },
  'battle-low': {
    name: 'battle-low',
    params: { scene: 'battle', preset: 'low', flight: '1' },
    purpose: 'Gefecht mit Preset Low (Partikel-Cap 8.192 greift)',
    triggerEveryS: 0,
  },
  'battle-ldr': {
    name: 'battle-ldr',
    params: { scene: 'battle', preset: 'medium', hdr: '0', flight: '1' },
    purpose: 'Gefecht, Medium mit LDR-Fallback (hdr=0)',
    triggerEveryS: 0,
  },
  shields: {
    name: 'shields',
    params: { scene: 'shields', preset: 'medium' },
    purpose: '20 Schilde unter Beschuss (Ziel: Schild-Segment ≤ 1 ms GPU)',
    triggerEveryS: 0,
  },
  'shields-nofx': {
    name: 'shields-nofx',
    params: { scene: 'shields', preset: 'medium', fx: '0' },
    purpose: 'wie shields, aber ohne transparente FX (fx=0) → GPU-Differenz = Kosten der 20 Schilde (+ Partikel/Trails)',
    triggerEveryS: 0,
  },
  'shields-pass': {
    name: 'shields-pass',
    params: { scene: 'shields', preset: 'medium', fx: 'shields', gpuseg: 'pass' },
    purpose: 'nur die 20 Schilde als FX (fx=shields), GPU-Timer nur an Pass-Grenzen (gpuseg=pass) → Szenen-Segment minus shields-nofx-pass = Schild-Kosten',
    triggerEveryS: 0,
  },
  'shields-nofx-pass': {
    name: 'shields-nofx-pass',
    params: { scene: 'shields', preset: 'medium', fx: '0', gpuseg: 'pass' },
    purpose: 'Referenz zu shields-pass: gleiche Szene ohne transparente FX, Timer nur an Pass-Grenzen',
    triggerEveryS: 0,
  },
  big: {
    name: 'big',
    params: { scene: 'big', preset: 'medium' },
    purpose: 'Kommandanten-Explosion mit Schockwelle und Kamera-Shake, alle 4 s neu ausgelöst',
    triggerEveryS: 4,
  },
  'lighting-csm': {
    name: 'lighting-csm',
    params: { scene: 'lighting', preset: 'medium', csm: '1', flight: '1' },
    purpose: 'Licht-Szene mit CSM (2 Kaskaden, statischer Cache), Kameraflug',
    triggerEveryS: 0,
  },
  'lighting-nocsm': {
    name: 'lighting-nocsm',
    params: { scene: 'lighting', preset: 'medium', csm: '0', flight: '1' },
    purpose: 'Licht-Szene ohne CSM (Vergleich → CSM-Kosten)',
    triggerEveryS: 0,
  },
};

/**
 * Cost estimates by difference (same scene, same resolution, timer boundaries only between passes):
 * GPU(scene segment of `with`) − GPU(scene segment of `without`).
 */
export interface FxGpuDiff {
  readonly label: string;
  readonly with: FxScenarioName;
  readonly without: FxScenarioName;
  /** Budget of the difference in ms (acceptance target), null = none. */
  readonly budgetMs: number | null;
}

export const FX_GPU_DIFFS: readonly FxGpuDiff[] = [
  { label: '20 Schilde (fx=shields)', with: 'shields-pass', without: 'shields-nofx-pass', budgetMs: 1 },
  { label: 'Gefecht: Partikel + Beams/Trails + Schilde', with: 'battle-pass', without: 'battle-nofx-pass', budgetMs: null },
];

export function parseFxScenario(s: string): FxScenarioName | undefined {
  return (FX_SCENARIO_NAMES as readonly string[]).includes(s) ? (s as FxScenarioName) : undefined;
}

/** Query string of a scenario run (benchmark mode: HUD off, fixed seed). */
export function scenarioQuery(s: FxScenario, seed = 1): string {
  const q = new URLSearchParams({ ...s.params, bench: '1', seed: String(seed) });
  return q.toString();
}

/** Scene name a scenario loads (for the "scene not registered" check). */
export function scenarioScene(s: FxScenario): string {
  return s.params['scene'] ?? 'battle';
}
