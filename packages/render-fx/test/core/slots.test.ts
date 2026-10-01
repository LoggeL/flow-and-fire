import { SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT, UNIT_HEIGHTMAP, std140Layout } from '@faf/render';
import type { Std140Type } from '@faf/render';
import { describe, expect, it } from 'vitest';
import {
  FX_TIME_WRAP_S,
  FX_VIEW_BLOCK_GLSL,
  FX_VIEW_LAYOUT,
  SLOT_FX_SCORCH,
  SLOT_FX_SHADOW,
  SLOT_FX_VIEW,
  UNIT_FX_CURVE_LUT,
  UNIT_FX_SCORCH_CELLS,
  UNIT_FX_SCORCH_DATA,
  UNIT_FX_SHADOW_DYNAMIC,
  UNIT_FX_SHADOW_STATIC,
  fxSharedBufferBindings,
} from '../../src/index.ts';
import type { BufH } from '@faf/render';

/** render's own units: heightmap 0 plus the pass-local units 0–7 of terrain/units; 8–9 reserved for render/MS3. */
const RENDER_UNITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** render's uniform-block slots 0–3, 4–5 reserved. */
const RENDER_SLOTS = [SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT, 4, 5];

describe('slot table', () => {
  const fxSlots = [SLOT_FX_VIEW, SLOT_FX_SHADOW, SLOT_FX_SCORCH];
  const fxUnits = [UNIT_FX_SHADOW_STATIC, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_CURVE_LUT, UNIT_FX_SCORCH_DATA, UNIT_FX_SCORCH_CELLS];

  it('matches the common contract exactly', () => {
    expect(fxSlots).toEqual([6, 7, 8]);
    expect(fxUnits).toEqual([10, 11, 12, 13, 14]);
    expect(FX_TIME_WRAP_S).toBe(4096);
  });

  it('never collides with render slots/units and stays unique', () => {
    expect([SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT]).toEqual([0, 1, 2, 3]);
    expect(UNIT_HEIGHTMAP).toBe(0);
    for (const s of fxSlots) expect(RENDER_SLOTS).not.toContain(s);
    for (const u of fxUnits) expect(RENDER_UNITS).not.toContain(u);
    expect(new Set(fxSlots).size).toBe(fxSlots.length);
    expect(new Set(fxUnits).size).toBe(fxUnits.length);
  });

  it('fits the WebGL2 minimum limits (24 UBO bindings, 16 texture units per stage)', () => {
    for (const s of fxSlots) expect(s).toBeLessThan(24);
    for (const u of fxUnits) expect(u).toBeLessThan(16);
  });

  it('shared buffer bindings put Frame and FxView at their slots', () => {
    const b = fxSharedBufferBindings({ frame: 11 as BufH, fxView: 12 as BufH });
    expect(b).toEqual([
      { slot: SLOT_FRAME, buffer: 11 },
      { slot: SLOT_FX_VIEW, buffer: 12 },
    ]);
  });
});

describe('FxView block', () => {
  it('JS layout matches the GLSL declaration', () => {
    const body = /uniform FxView \{([\s\S]*?)\};/.exec(FX_VIEW_BLOCK_GLSL)?.[1];
    expect(body).toBeDefined();
    const fields = [...body!.matchAll(/^\s*(\w+)\s+(\w+);/gm)].map((m) => ({ type: m[1] as Std140Type, glslName: m[2]! }));
    expect(fields.map((f) => f.glslName)).toEqual(['u_fxRight', 'u_fxUp', 'u_fxFwd', 'u_fxTime']);
    const fromGlsl = std140Layout(fields.map((f) => ({ name: f.glslName.slice(2), type: f.type })));
    expect(FX_VIEW_LAYOUT.size).toBe(fromGlsl.size);
    expect(FX_VIEW_LAYOUT.size).toBe(64);
    for (const f of fromGlsl.fields) expect(FX_VIEW_LAYOUT.offsetOf(f.name)).toBe(f.offset);
  });
});
