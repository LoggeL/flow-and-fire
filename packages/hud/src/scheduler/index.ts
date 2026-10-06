// HudScheduler barrel (hud-p5-root): frame snapshots → HUD signals at fixed rates (ui.md §9.1).
export { HUD_FLUSH_MEASURE, HudScheduler } from './HudScheduler.ts';
export type { HudFlushInfo, HudSchedulerOptions, HudSchedulerStats } from './HudScheduler.ts';
export { HUD_RATES, HUD_RATE_CLASSES, RATE_TOLERANCE, RateGate } from './rates.ts';
export type { HudRateClass, HudRates } from './rates.ts';
export { sameData, sameRef } from './equal.ts';
