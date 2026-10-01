import { DEFAULT_MAP_LIGHT, type MapLight } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { sunDirection } from '../../src/view/light.ts';

const light = (azimuthDeg: number, elevationDeg: number): MapLight => ({ ...DEFAULT_MAP_LIGHT, azimuthDeg, elevationDeg });

function expectVec(v: readonly number[], e: readonly number[]): void {
  for (let i = 0; i < 3; i++) expect(v[i]!).toBeCloseTo(e[i]!, 12);
}

describe('sunDirection (DECISIONS 19)', () => {
  it('azimuth 0 = sun from +z, 90 = from +x', () => {
    expectVec(sunDirection(light(0, 0)), [0, 0, 1]);
    expectVec(sunDirection(light(90, 0)), [1, 0, 0]);
    expectVec(sunDirection(light(180, 0)), [0, 0, -1]);
    expectVec(sunDirection(light(270, 0)), [-1, 0, 0]);
  });

  it('elevation 90 = straight up', () => {
    expectVec(sunDirection(light(123, 90)), [0, 1, 0]);
  });

  it('is (sin az · cos el, sin el, cos az · cos el) and unit length', () => {
    for (const [az, el] of [
      [135, 50],
      [215, 48],
      [300, 40],
      [17, 3],
    ] as const) {
      const d = sunDirection(light(az, el));
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      expectVec(d, [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
      expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    }
  });
});
