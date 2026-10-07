import { describe, expect, it } from 'vitest';
import { FxRng } from '@faf/render-fx';
import { GROUND_BASE_WU, GROUND_WAVES, LAB_GROUND_GLSL, glslFloat, labGroundGradient, labGroundHeight } from '../../src/app/ground.ts';
import { LAB_WORLD_WU } from '../../src/app/context.ts';

/**
 * Translates one of the generated GLSL functions (a straight-line body of `float`/`vec2` statements over
 * `p.x`/`p.y`, `sin`, `cos`) into JS. Every scalar operation can be rounded to float32 (`f32 = true`) to
 * see how far the GPU (highp float) drifts from the double-precision JS mirror.
 */
function compileGlslFunction(name: string, f32: boolean): (x: number, z: number) => number[] {
  const m = new RegExp(`\\n(float|vec2) ${name}\\(vec2 p\\) \\{\\n([\\s\\S]*?)\\n\\}`).exec(LAB_GROUND_GLSL);
  if (m === null) throw new Error(`${name} not found in LAB_GROUND_GLSL`);
  const r = f32 ? 'Math.fround' : '';
  let body = m[2]!;
  // vec2 arithmetic of the gradient: `g += c * vec2(a, b);` → component-wise.
  body = body.replace(/g \+= c \* vec2\(([^,]+), ([^)]+)\);/g, `g0 = ${r}(g0 + ${r}(c * $1)); g1 = ${r}(g1 + ${r}(c * $2));`);
  body = body.replace('vec2 g = vec2(0.0);', 'let g0 = 0, g1 = 0;').replace('float c;', 'let c = 0;').replace('return g;', 'return [g0, g1];');
  body = body.replace(/float h = ([^;]+);/, 'let h = $1;').replace('return h;', 'return [h];');
  // Products/sums inside the trig arguments, rounded per operation like the GPU would.
  body = body.replace(/(sin|cos)\(([\d.-]+) \* p\.x \+ ([\d.-]+) \* p\.y \+ ([\d.-]+)\)/g, `${r}(Math.$1(${r}(${r}(${r}($2 * px) + ${r}($3 * py)) + $4)))`);
  body = body.replace(/h \+= ([\d.]+) \* ([^;]+);/g, `h = ${r}(h + ${r}($1 * $2));`);
  body = body.replace(/c = ([\d.]+) \* ([^;]+);/g, `c = ${r}($1 * $2);`);
  if (/\bp\.|vec|float /.test(body)) throw new Error(`untranslated GLSL left in ${name}:\n${body}`);
  return new Function('px', 'py', body) as (x: number, z: number) => number[];
}

describe('lab ground height', () => {
  it('GLSL mirror carries exactly the JS wave table', () => {
    const lits = [...LAB_GROUND_GLSL.matchAll(/h \+= ([\d.-]+) \* sin\(([\d.-]+) \* p\.x \+ ([\d.-]+) \* p\.y \+ ([\d.-]+)\)/g)].map((m) =>
      m.slice(1, 5).map(Number),
    );
    expect(lits).toEqual(GROUND_WAVES.map((w) => [...w]));
    expect(LAB_GROUND_GLSL).toContain(`float h = ${glslFloat(GROUND_BASE_WU)};`);
    // Every literal is written so that it parses back to the identical double.
    for (const w of GROUND_WAVES) for (const v of w) expect(Number(glslFloat(v))).toBe(v);
    expect(glslFloat(8)).toBe('8.0');
    expect(() => glslFloat(1e-9)).toThrow(/exponent/);
    expect(() => glslFloat(Number.NaN)).toThrow();
  });

  it('GLSL height == JS height (double exact, float32 within 2e-4 WU)', () => {
    const glsl64 = compileGlslFunction('labGroundHeight', false);
    const glsl32 = compileGlslFunction('labGroundHeight', true);
    const rng = new FxRng(42);
    let maxErr32 = 0;
    for (let i = 0; i < 5000; i++) {
      const x = rng.range(0, LAB_WORLD_WU);
      const z = rng.range(0, LAB_WORLD_WU);
      const h = labGroundHeight(x, z);
      expect(glsl64(x, z)[0]).toBe(h);
      maxErr32 = Math.max(maxErr32, Math.abs(glsl32(Math.fround(x), Math.fround(z))[0]! - h));
    }
    expect(maxErr32).toBeLessThan(2e-4);
  });

  it('GLSL gradient == JS gradient == finite difference', () => {
    const glsl64 = compileGlslFunction('labGroundGrad', false);
    const rng = new FxRng(7);
    const g: [number, number] = [0, 0];
    for (let i = 0; i < 500; i++) {
      const x = rng.range(0, LAB_WORLD_WU);
      const z = rng.range(0, LAB_WORLD_WU);
      labGroundGradient(x, z, g);
      const [gx, gz] = glsl64(x, z);
      expect(gx).toBeCloseTo(g[0], 12);
      expect(gz).toBeCloseTo(g[1], 12);
      const e = 1e-4;
      expect((labGroundHeight(x + e, z) - labGroundHeight(x - e, z)) / (2 * e)).toBeCloseTo(g[0], 7);
      expect((labGroundHeight(x, z + e) - labGroundHeight(x, z - e)) / (2 * e)).toBeCloseTo(g[1], 7);
    }
  });

  it('stays above 0 and gentle (max slope ≤ 12°) over the whole lab world', () => {
    let minH = Infinity;
    let maxSlope = 0;
    const g: [number, number] = [0, 0];
    for (let x = 0; x <= LAB_WORLD_WU; x += 2) {
      for (let z = 0; z <= LAB_WORLD_WU; z += 2) {
        minH = Math.min(minH, labGroundHeight(x, z));
        labGroundGradient(x, z, g);
        maxSlope = Math.max(maxSlope, Math.hypot(g[0], g[1]));
      }
    }
    expect(minH).toBeGreaterThan(0);
    expect((Math.atan(maxSlope) * 180) / Math.PI).toBeLessThan(12);
  });
});
