/**
 * Binding rates of the HUD (ui.md §9.1). Rates run in wall-clock time but are only evaluated when a new sim
 * tick arrived: at ×3 speed the economy still updates at 10 Hz (every third tick), while paused nothing but
 * events is written.
 */

/** Rate classes of the scheduler; `event` sections are written at once whenever their version changes. */
export type HudRateClass = 'eco' | 'hot' | 'map' | 'fog' | 'slow' | 'event';

export const HUD_RATE_CLASSES: readonly HudRateClass[] = ['eco', 'hot', 'map', 'fog', 'slow', 'event'];

/** Rates in Hz of the periodic classes. */
export type HudRates = Readonly<Record<Exclude<HudRateClass, 'event'>, number>>;

/**
 * eco: resource values, build and queue progress (10 Hz) · hot: HP, vet, order chain, toggles, tooltip data,
 * flow details (4 Hz) · map: minimap units/blips/pings (4 Hz, staggered: never in the same flush as `hot`, so
 * the DOM work of the selection and the canvas redraw do not add up in one frame) · fog: minimap fog (2 Hz,
 * together with a `map` pass) · slow: timer, unit cap, idle counters, group counts (alert age follows the
 * timer) (1 Hz).
 */
export const HUD_RATES: HudRates = { eco: 10, hot: 4, map: 4, fog: 2, slow: 1 };

/** Share of the period a tick may arrive early and still count (jitter of the sim clock). */
export const RATE_TOLERANCE = 0.2;

/**
 * Wall-clock gate of one rate class. Due times advance by whole periods (so 4 Hz over 10 Hz ticks averages
 * 4 per second instead of snapping to 3.3), a tick up to 20 % of a period early still counts, and after a
 * stall (pause, background tab) the gate re-synchronises instead of bursting to catch up.
 */
export class RateGate {
  readonly periodMs: number;
  private readonly toleranceMs: number;
  private nextDue = Number.NEGATIVE_INFINITY;

  constructor(hz: number) {
    if (!(hz > 0)) throw new Error(`RateGate: rate must be > 0 (got ${hz})`);
    this.periodMs = 1000 / hz;
    this.toleranceMs = this.periodMs * RATE_TOLERANCE;
  }

  /** True when a write is due at `nowMs`. */
  due(nowMs: number): boolean {
    return nowMs >= this.nextDue - this.toleranceMs;
  }

  /** Marks a write at `nowMs`. */
  fire(nowMs: number): void {
    const next = this.nextDue === Number.NEGATIVE_INFINITY ? nowMs + this.periodMs : this.nextDue + this.periodMs;
    this.nextDue = next < nowMs - this.toleranceMs ? nowMs + this.periodMs : next;
  }

  /** Makes the gate due again (e.g. a new structure arrived). */
  reset(): void {
    this.nextDue = Number.NEGATIVE_INFINITY;
  }
}
