import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT, UNIT_HEIGHTMAP, std140Layout } from '@faf/render';
import type { Std140Type } from '@faf/render';
import { describe, expect, it } from 'vitest';
import {
  FX_PROGRAM_UNITS,
  FX_RECEIVER_UNITS,
  FX_TIME_WRAP_S,
  FX_VIEW_BLOCK_GLSL,
  FX_VIEW_LAYOUT,
  SCORCH_SAMPLERS,
  SHADOW_RECV_SAMPLERS,
  SLOT_FX_SCORCH,
  SLOT_FX_SHADOW,
  SLOT_FX_VIEW,
  UNIT_FX_CURVE_LUT,
  UNIT_FX_PARTICLE_LAYERS,
  UNIT_FX_SCORCH_CELLS,
  UNIT_FX_SCORCH_DATA,
  UNIT_FX_SHADOW_DYNAMIC,
  UNIT_FX_SHADOW_STATIC,
  fxSharedBufferBindings,
} from '../../src/index.ts';
import type { BufH } from '@faf/render';

/**
 * Source of @faf/render to check against. `FAF_RENDER_SRC` points the check at another checkout
 * (merge check, e.g. the MS3 worktree: `FAF_RENDER_SRC=<ms3>/packages/render/src`).
 */
const RENDER_SRC = process.env['FAF_RENDER_SRC'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../render/src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Texture units / uniform-block slots render binds anywhere: every `unit: X` / `slot: X` in its
 * sources, X a literal or a `UNIT_*` / `SLOT_*` constant declared with a literal value.
 */
function scanRender(kind: 'unit' | 'slot'): Map<string, number> {
  const src = tsFiles(RENDER_SRC).map((f) => readFileSync(f, 'utf8'));
  const consts = new Map<string, number>();
  for (const s of src) for (const m of s.matchAll(/\b(?:const|let)\s+((?:UNIT|SLOT)_[A-Z0-9_]+)\s*=\s*(\d+)\s*;/g)) consts.set(m[1]!, Number(m[2]));
  const used = new Map<string, number>();
  const re = kind === 'unit' ? /\bunit:\s*([A-Za-z_0-9]+)/g : /\bslot:\s*([A-Za-z_0-9]+)/g;
  for (const s of src) {
    for (const m of s.matchAll(re)) {
      const tok = m[1]!;
      if (/^\d+$/.test(tok)) used.set(tok, Number(tok));
      else if (consts.has(tok)) used.set(tok, consts.get(tok)!);
    }
  }
  return used;
}

describe('slot table', () => {
  const fxSlots = [SLOT_FX_VIEW, SLOT_FX_SHADOW, SLOT_FX_SCORCH];
  const fxUnits = [...FX_RECEIVER_UNITS, ...FX_PROGRAM_UNITS];

  it('matches the common contract exactly', () => {
    expect(fxSlots).toEqual([6, 7, 8]);
    expect(FX_RECEIVER_UNITS).toEqual([UNIT_FX_SHADOW_STATIC, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_SCORCH_DATA, UNIT_FX_SCORCH_CELLS]);
    expect(FX_RECEIVER_UNITS).toEqual([12, 13, 14, 15]);
    expect(FX_PROGRAM_UNITS).toEqual([UNIT_FX_CURVE_LUT, UNIT_FX_PARTICLE_LAYERS]);
    expect(FX_PROGRAM_UNITS).toEqual([0, 1]);
    expect(FX_TIME_WRAP_S).toBe(4096);
  });

  it('receiver samplers of CSM and scorch use the receiver units', () => {
    expect(SHADOW_RECV_SAMPLERS.map((s) => s.unit)).toEqual([UNIT_FX_SHADOW_STATIC, UNIT_FX_SHADOW_DYNAMIC]);
    expect(SCORCH_SAMPLERS.map((s) => s.unit)).toEqual([UNIT_FX_SCORCH_DATA, UNIT_FX_SCORCH_CELLS]);
  });

  it('finds the units and slots render binds (scan sanity)', () => {
    const units = scanRender('unit');
    const slots = scanRender('slot');
    expect(units.get('UNIT_HEIGHTMAP')).toBe(UNIT_HEIGHTMAP);
    expect(units.size).toBeGreaterThanOrEqual(8);
    expect([...slots.values()]).toEqual(expect.arrayContaining([SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT]));
  });

  it('receiver units never collide with any unit render binds', () => {
    const units = scanRender('unit');
    for (const [name, u] of units) {
      for (const r of FX_RECEIVER_UNITS) expect(u, `render ${name} = ${u} collides with FX receiver unit ${r}`).not.toBe(r);
    }
  });

  it('FX slots never collide with render slots (incl. reserved 4/5)', () => {
    const slots = new Set([...scanRender('slot').values(), SLOT_FRAME, SLOT_PALETTE, SLOT_PASS, SLOT_TERRAIN_HEIGHT, 4, 5]);
    for (const s of fxSlots) expect(slots.has(s), `FX slot ${s} collides with render`).toBe(false);
  });

  it('stays unique: FX-program units never reuse a receiver unit', () => {
    expect(new Set(fxSlots).size).toBe(fxSlots.length);
    expect(new Set(fxUnits).size).toBe(fxUnits.length);
  });

  it('a render program plus all receivers fits 16 units (terrain FS worst case)', () => {
    const renderUnits = new Set(scanRender('unit').values());
    expect(renderUnits.size + FX_RECEIVER_UNITS.length).toBeLessThanOrEqual(16);
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
