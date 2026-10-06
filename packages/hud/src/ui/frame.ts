/**
 * Frame and clock fallbacks shared by the HudScheduler and the minimap renderer: requestAnimationFrame
 * and performance.now() in the browser, timers/Date in DOM-less test and bench environments.
 * Presentation code only (never used by sim packages).
 */

/** Schedules `cb` for the next animation frame (16-ms timer without rAF). */
export function requestFrameFallback(cb: () => void): unknown {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => cb());
  return setTimeout(cb, 16);
}

/** High-resolution wall clock in ms (performance.now(), else Date.now()). */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
