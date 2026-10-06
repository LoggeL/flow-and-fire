import { describe, expect, it } from 'vitest';
import type { SceneName } from '../../src/app/context.ts';
import { applyCameraOverride } from '../../src/app/context.ts';
import { MAX_FREEZE_S, defaultScene, labParamsToSearch, parseLabParams } from '../../src/app/params.ts';

const onlyLighting = (n: SceneName): boolean => n === 'lighting';
const all = (): boolean => true;

describe('parseLabParams', () => {
  it('uses the documented defaults', () => {
    const w: string[] = [];
    const p = parseLabParams('', onlyLighting, w);
    expect(p).toEqual({
      scene: 'lighting',
      preset: 'medium',
      hdr: true,
      bloom: true,
      csm: true,
      fxaa: true,
      seed: 1,
      freeze: null,
      bench: false,
      flight: false,
      fx: true,
      fxParts: { shields: true, particles: true, beams: true },
      gpuSeg: 'fine',
    });
    expect(w).toEqual([]);
  });

  it('defaults to battle once it is registered', () => {
    expect(defaultScene(all)).toBe('battle');
    expect(defaultScene(onlyLighting)).toBe('lighting');
    expect(parseLabParams('?preset=high', all).scene).toBe('battle');
  });

  it('parses every parameter', () => {
    const p = parseLabParams('?scene=shields&preset=low&hdr=0&bloom=false&csm=off&fxaa=no&seed=4294967295&freeze=6.5&bench=1&flight=true&fx=0', all);
    expect(p).toEqual({
      scene: 'shields',
      preset: 'low',
      hdr: false,
      bloom: false,
      csm: false,
      fxaa: false,
      seed: 0xffffffff,
      freeze: 6.5,
      bench: true,
      flight: true,
      fx: false,
      fxParts: { shields: false, particles: false, beams: false },
      gpuSeg: 'fine',
    });
  });

  it('parses fx part lists and the GPU segment mode (round trip)', () => {
    const w: string[] = [];
    const p = parseLabParams('?scene=shields&fx=shields&gpuseg=pass', all, w);
    expect(w).toEqual([]);
    expect(p.fx).toBe(true);
    expect(p.fxParts).toEqual({ shields: true, particles: false, beams: false });
    expect(p.gpuSeg).toBe('pass');
    const q = labParamsToSearch(p);
    expect(q).toContain('fx=shields');
    expect(q).toContain('gpuseg=pass');
    expect(parseLabParams(q, all)).toEqual(p);
    const both = parseLabParams('?fx=particles,beams', all);
    expect(both.fxParts).toEqual({ shields: false, particles: true, beams: true });
    const bad: string[] = [];
    const d = parseLabParams('?fx=shields,lasers&gpuseg=coarse', all, bad);
    expect(d.fxParts).toEqual({ shields: true, particles: true, beams: true });
    expect(d.gpuSeg).toBe('fine');
    expect(bad).toHaveLength(2);
  });

  it('accepts the query string without the leading ?', () => {
    expect(parseLabParams('scene=lighting&seed=7', onlyLighting).seed).toBe(7);
  });

  it('falls back to defaults for invalid values and reports each one', () => {
    const w: string[] = [];
    const p = parseLabParams('?scene=nope&preset=insane&hdr=maybe&seed=-3&freeze=abc&fx=2', onlyLighting, w);
    expect(p.scene).toBe('lighting');
    expect(p.preset).toBe('medium');
    expect(p.hdr).toBe(true);
    expect(p.seed).toBe(1);
    expect(p.freeze).toBeNull();
    expect(p.fx).toBe(true);
    expect(w).toHaveLength(6);
    expect(w.join('\n')).toMatch(/scene='nope' is unknown/);
    expect(w.join('\n')).toMatch(/preset='insane'/);
  });

  it('rejects registered-but-unavailable scenes, fractional seeds and out-of-range freeze times', () => {
    const w: string[] = [];
    const p = parseLabParams(`?scene=battle&seed=1.5&freeze=${MAX_FREEZE_S + 1}`, onlyLighting, w);
    expect(p.scene).toBe('lighting');
    expect(p.seed).toBe(1);
    expect(p.freeze).toBeNull();
    expect(w[0]).toMatch(/not available yet/);
    expect(w).toHaveLength(3);
    expect(parseLabParams('?seed=', onlyLighting).seed).toBe(1);
    expect(parseLabParams('?freeze=', onlyLighting).freeze).toBeNull();
    expect(parseLabParams('?freeze=-1', onlyLighting).freeze).toBeNull();
    expect(parseLabParams('?freeze=0', onlyLighting).freeze).toBe(0);
  });

  it('round-trips through labParamsToSearch', () => {
    const p = parseLabParams('?scene=big&preset=ultra&hdr=0&seed=99&freeze=1.6&flight=1&fx=0', all);
    const s = labParamsToSearch(p);
    expect(s.startsWith('?')).toBe(true);
    expect(parseLabParams(s, all)).toEqual(p);
    expect(labParamsToSearch(parseLabParams('', onlyLighting))).toBe('?scene=lighting&preset=medium');
  });

  it('parses the optional camera override (cam=dist,pitch,heading[,x,z]) and applies it to a preset', () => {
    const w: string[] = [];
    const p = parseLabParams('?scene=gallery&cam=80,38,-90,256,300', all, w);
    expect(p.cam).toEqual({ distanceWu: 80, pitchDeg: 38, headingDeg: -90, targetWu: [256, 300] });
    expect(parseLabParams(labParamsToSearch(p), all)).toEqual(p);
    expect(parseLabParams('?cam=120,45,-60', all).cam).toEqual({ distanceWu: 120, pitchDeg: 45, headingDeg: -60, targetWu: null });
    expect('cam' in parseLabParams('', all)).toBe(false);
    for (const bad of ['1,45,0', '80,95,0', '80,45', '80,45,0,1', 'a,b,c']) {
      const ww: string[] = [];
      expect(parseLabParams(`?cam=${bad}`, all, ww).cam, bad).toBeUndefined();
      expect(ww[0]).toMatch(/cam=/);
    }
    const preset = { targetWu: [1, 2] as const, distanceWu: 100, pitchDeg: 40, headingDeg: 0 };
    expect(applyCameraOverride(preset, undefined)).toBe(preset);
    expect(applyCameraOverride(preset, { distanceWu: 50, pitchDeg: 30, headingDeg: 10, targetWu: null })).toEqual({ targetWu: [1, 2], distanceWu: 50, pitchDeg: 30, headingDeg: 10 });
    expect(w).toEqual([]);
  });
});
