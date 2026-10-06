import { describe, expect, test } from 'vitest';
import { UI_SCALE_MAX, UI_SCALE_MIN, computeUiScale, resolveUiScale } from '../../src/hud/root/scale.ts';

describe('computeUiScale (ui.md §4.1)', () => {
  test.each([
    [1920, 1080, 1],
    [2560, 1440, 1.25],
    [3840, 2160, 1.5],
    [5120, 2880, 1.5],
    [2560, 1600, 1.35],
    [1920, 1200, 1.1],
  ])('%d × %d → %d (round₀.₀₅((h/1080)^0.78), 0.8–1.5)', (w, h, s) => {
    expect(computeUiScale(w, h)).toBe(s);
  });

  test('below 1280 × 720 → 0.8', () => {
    expect(computeUiScale(1280, 720)).toBe(0.8);
    expect(computeUiScale(1279, 1080)).toBe(0.8);
    expect(computeUiScale(1920, 719)).toBe(0.8);
    expect(computeUiScale(800, 600)).toBe(0.8);
  });

  test('scale · 1080 > window height → 0.8 (every height below 1080 with the 0.78 exponent)', () => {
    expect(computeUiScale(1920, 1000)).toBe(0.8);
    expect(computeUiScale(1366, 768)).toBe(0.8);
    expect(computeUiScale(1920, 1079)).toBe(0.8);
    expect(computeUiScale(1920, 1080)).toBe(1);
  });

  test('always within 0.8–1.5 and on the 0.05 grid', () => {
    for (let h = 400; h <= 4000; h += 37) {
      const s = computeUiScale(3000, h);
      expect(s).toBeGreaterThanOrEqual(UI_SCALE_MIN);
      expect(s).toBeLessThanOrEqual(UI_SCALE_MAX);
      expect(Math.abs(s * 20 - Math.round(s * 20))).toBeLessThan(1e-9);
    }
  });

  test('manual scale wins over auto ("kompakt" = 1.0 on 1440p)', () => {
    expect(resolveUiScale('auto', 2560, 1440)).toBe(1.25);
    expect(resolveUiScale(1, 2560, 1440)).toBe(1);
    expect(resolveUiScale(0.9, 1280, 720)).toBe(0.9);
  });
});
