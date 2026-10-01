import { RtsCamera, std140Layout } from '@faf/render';
import type { Std140Field, Std140Type } from '@faf/render';
import { describe, expect, it } from 'vitest';
import {
  CascadeFitter,
  LIGHTING_GLSL,
  LIGHTING_GLSL_LDR,
  SHADOW_CASTER_GLSL,
  SHADOW_CASTER_LAYOUT,
  SHADOW_RECV_BLOCK_GLSL,
  SHADOW_RECV_LAYOUT,
  cascadeSplits,
  fxEmissiveRef,
  fxLightRef,
  lightingGlsl,
  shadowOptionsForPreset,
} from '../../src/light/index.ts';
import type { CascadeFitOptions } from '../../src/light/index.ts';

const SUN: [number, number, number] = [0.45, 0.8, 0.35];

function camera(x = 256, z = 256, distance = 80): RtsCamera {
  const cam = new RtsCamera({ distance });
  cam.setViewport(960, 540);
  cam.setTargetWU(x, 0, z);
  cam.update();
  return cam;
}

function fitter(o: Partial<CascadeFitOptions> = {}): CascadeFitter {
  return new CascadeFitter({
    size: 2048,
    cascades: 2,
    lambda: 0.55,
    headroom: 1.4,
    maxDistanceWu: 600,
    minRadiusWu: 4,
    worldMin: [0, -64, 0],
    worldMax: [4096, 512, 4096],
    ...o,
  });
}

/** Parses the members of a std140 GLSL block into fields (types used by the FX blocks only). */
function parseBlock(glsl: string): Std140Field[] {
  const body = glsl.slice(glsl.indexOf('{') + 1, glsl.indexOf('}'));
  const fields: Std140Field[] = [];
  for (const m of body.matchAll(/^\s*(\w+)\s+(\w+)(?:\[(\d+)\])?;/gm)) {
    const f: Std140Field = m[3] === undefined ? { name: m[2]!, type: m[1] as Std140Type } : { name: m[2]!, type: m[1] as Std140Type, count: Number(m[3]) };
    fields.push(f);
  }
  return fields;
}

describe('cascadeSplits', () => {
  it('interpolates between the uniform (λ = 0) and the logarithmic split (λ = 1)', () => {
    expect([...cascadeSplits(10, 250, 2, 0)]).toEqual([10, 130, 250]);
    expect(cascadeSplits(10, 250, 2, 1)[1]).toBeCloseTo(50, 10);
    const s = cascadeSplits(10, 250, 2, 0.55)[1]!;
    expect(s).toBeCloseTo(0.55 * 50 + 0.45 * 130, 10);
    const one = cascadeSplits(10, 250, 1, 0.55);
    expect([...one]).toEqual([10, 250]);
    const four = cascadeSplits(1, 1000, 4, 0.55);
    for (let i = 1; i < 5; i++) expect(four[i]!).toBeGreaterThan(four[i - 1]!);
  });

  it('fitter splits follow the camera zoom and respect maxDistanceWu', () => {
    const f = fitter();
    const cam = camera();
    f.update(cam, SUN);
    const near = f.splits[0]!;
    const end = f.splits[2]!;
    expect(near).toBeCloseTo(Math.max(0.05, cam.near), 10);
    expect(end).toBeCloseTo(Math.min(cam.far, cam.distance * 2.4 + 30, 600), 10);
    expect(f.splits[1]!).toBeCloseTo(cascadeSplits(near, end, 2, 0.55)[1]!, 10);
    const far = camera(256, 256, 400);
    f.update(far, SUN);
    expect(f.splits[2]!).toBe(600);
  });
});

describe('CascadeFitter cache', () => {
  it('snaps the cached box centre to the texel grid', () => {
    const f = fitter();
    f.update(camera(1234.567, 987.654), SUN);
    for (const cas of f.cascades) {
      expect(cas.valid).toBe(true);
      expect(cas.texelWu).toBeCloseTo((2 * cas.half) / 2048, 12);
      const kx = cas.cx / cas.texelWu;
      const ky = cas.cy / cas.texelWu;
      expect(Math.abs(kx - Math.round(kx))).toBeLessThan(1e-6);
      expect(Math.abs(ky - Math.round(ky))).toBeLessThan(1e-6);
      expect(cas.half).toBeCloseTo(cas.radius * 1.4, 10);
    }
    // The snapped box centre maps to the middle of the light clip space (ortho box is centred on it).
    const cas = f.cascades[0]!;
    const px = cas.cx * f.lx[0]! + cas.cy * f.ly[0]! - cas.anchor[0]! / 4096;
    const py = cas.cx * f.lx[1]! + cas.cy * f.ly[1]! - cas.anchor[1]! / 4096;
    const pz = cas.cx * f.lx[2]! + cas.cy * f.ly[2]! - cas.anchor[2]! / 4096;
    const m = cas.lightVP;
    // Remove the component along the light direction: ortho x/y do not depend on it.
    const clipX = m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!;
    const clipY = m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!;
    expect(Math.abs(clipX)).toBeLessThan(1e-6);
    expect(Math.abs(clipY)).toBeLessThan(1e-6);
  });

  it('small pans stay inside the headroom, large jumps refit', () => {
    const f = fitter();
    const cam = camera();
    expect(f.update(cam, SUN)).toBe(0b11);
    const refits = f.refits;
    // Pan by 1 WU per frame for 5 frames: far below the 40 % headroom of either cascade.
    for (let i = 0; i < 5; i++) {
      cam.pan(1, 0);
      cam.update();
      expect(f.update(cam, SUN)).toBe(0);
    }
    expect(f.refits).toBe(refits);
    cam.setTargetWU(1800, 0, 900);
    cam.update();
    expect(f.update(cam, SUN)).toBe(0b11);
    expect(f.refits).toBe(refits + 2);
  });

  it('zooming in far enough shrinks the box (quality), a sun change refits everything', () => {
    const f = fitter();
    const cam = camera(512, 512, 300);
    f.update(cam, SUN);
    const half0 = f.cascades[1]!.half;
    cam.distance = 40;
    cam.update();
    expect(f.update(cam, SUN) & 0b10).toBe(0b10);
    expect(f.cascades[1]!.half).toBeLessThan(half0);
    expect(f.update(cam, SUN)).toBe(0);
    expect(f.update(cam, [0.3, 0.9, 0.2])).toBe(0b11);
    // Same direction, different length: no refit.
    expect(f.update(cam, [0.6, 1.8, 0.4])).toBe(0);
  });

  it('receiver matrices map world points to the same shadow uv as the caster matrix', () => {
    const f = fitter();
    const cam = camera(700.25, 1900.75);
    f.update(cam, SUN);
    const recv = new Float32Array(32);
    for (let c = 0; c < 2; c++) {
      f.receiverMatrix(c, cam.camPosInt, recv, c * 16);
      const cas = f.cascades[c]!;
      const sphere = f.sliceSphereOf(cam, c);
      // Points around the slice sphere centre (camera-relative WU).
      for (const [dx, dy, dz] of [
        [0, 0, 0],
        [3, 1, -2],
        [-5, 0.5, 4],
      ] as const) {
        const rx = sphere[0]! + dx;
        const ry = sphere[1]! + dy;
        const rz = sphere[2]! + dz;
        const m = recv.subarray(c * 16, c * 16 + 16);
        const u = m[0]! * rx + m[4]! * ry + m[8]! * rz + m[12]!;
        const v = m[1]! * rx + m[5]! * ry + m[9]! * rz + m[13]!;
        const w = m[2]! * rx + m[6]! * ry + m[10]! * rz + m[14]!;
        // Caster path: world → anchor-relative → lightVP → clip → [0, 1].
        const ax = rx + (cam.camPosInt[0]! - cas.anchor[0]!) / 4096;
        const ay = ry + (cam.camPosInt[1]! - cas.anchor[1]!) / 4096;
        const az = rz + (cam.camPosInt[2]! - cas.anchor[2]!) / 4096;
        const l = cas.lightVP;
        const cu = (l[0]! * ax + l[4]! * ay + l[8]! * az + l[12]!) * 0.5 + 0.5;
        const cv = (l[1]! * ax + l[5]! * ay + l[9]! * az + l[13]!) * 0.5 + 0.5;
        const cw = (l[2]! * ax + l[6]! * ay + l[10]! * az + l[14]!) * 0.5 + 0.5;
        expect(u).toBeCloseTo(cu, 4);
        expect(v).toBeCloseTo(cv, 4);
        expect(w).toBeCloseTo(cw, 4);
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThan(1);
        // The caster frustum (anchor-relative) contains the point.
        expect(cas.frustum.sphereVisible(ax, ay, az, 0)).toBe(true);
      }
    }
  });

  it('covers all casters of the world bounds in depth', () => {
    const f = fitter({ worldMin: [0, -10, 0], worldMax: [1024, 200, 1024] });
    const cam = camera(512, 512);
    f.update(cam, SUN);
    const cas = f.cascades[0]!;
    // A caster high above the cascade (towards the sun) must still be inside the depth range.
    const sphere = f.sliceSphereOf(cam, 0);
    const wx = cam.camPosInt[0]! / 4096 + sphere[0]!;
    const wz = cam.camPosInt[2]! / 4096 + sphere[2]!;
    const ax = wx - cas.anchor[0]! / 4096;
    const ay = 200 - cas.anchor[1]! / 4096;
    const az = wz - cas.anchor[2]! / 4096;
    const l = cas.lightVP;
    const z = l[2]! * ax + l[6]! * ay + l[10]! * az + l[14]!;
    expect(z).toBeGreaterThan(-1);
    expect(z).toBeLessThan(1);
  });
});

describe('shadow and lighting GLSL', () => {
  it('receiver and caster blocks match their std140 layouts', () => {
    const recv = std140Layout(parseBlock(SHADOW_RECV_BLOCK_GLSL));
    expect(recv.size).toBe(SHADOW_RECV_LAYOUT.size);
    expect(recv.fields.map((x) => x.offset)).toEqual(SHADOW_RECV_LAYOUT.fields.map((x) => x.offset));
    const caster = std140Layout(parseBlock(SHADOW_CASTER_GLSL));
    expect(caster.size).toBe(SHADOW_CASTER_LAYOUT.size);
    expect(caster.fields.map((x) => x.offset)).toEqual(SHADOW_CASTER_LAYOUT.fields.map((x) => x.offset));
    expect(SHADOW_CASTER_GLSL).toContain('vec4 fxShadowCasterPos(ivec3 posRaw, vec3 localOffsetWu)');
  });

  it('fxLight/fxEmissive references: shadow darkens only the sun term, LDR emissive keeps the hue', () => {
    const l = { sunDir: [0, 1, 0] as const, sunColor: [1, 0.9, 0.8] as const, skyColor: [0.3, 0.35, 0.4] as const, groundColor: [0.1, 0.1, 0.1] as const };
    const lit = fxLightRef([0.5, 0.5, 0.5], [0, 1, 0], 1, l);
    const dark = fxLightRef([0.5, 0.5, 0.5], [0, 1, 0], 0, l);
    expect(lit[0]).toBeCloseTo(0.5 * (0.3 + 1), 10);
    expect(dark[0]).toBeCloseTo(0.5 * 0.3, 10);
    expect(fxEmissiveRef([1, 0.45, 0.1], 4, true)).toEqual([4, 1.8, 0.4]);
    const ldr = fxEmissiveRef([1, 0.45, 0.1], 4, false);
    expect(ldr[0]).toBe(1);
    expect(ldr[1]).toBeCloseTo(0.45, 10);
    expect(ldr[2]).toBeCloseTo(0.1, 10);
    expect(LIGHTING_GLSL).toContain('vec3 fxLight(vec3 albedo, vec3 normal, float shadow)');
    expect(LIGHTING_GLSL).toContain('vec3 fxEmissive(vec3 glow, float intensity)');
    expect(LIGHTING_GLSL_LDR).toContain('c / m');
    expect(lightingGlsl(true)).toBe(LIGHTING_GLSL);
    expect(lightingGlsl(false)).toBe(LIGHTING_GLSL_LDR);
  });

  it('preset target table: CSM only from High on', () => {
    expect(shadowOptionsForPreset('low')).toEqual({ mode: 'none', csm: null });
    expect(shadowOptionsForPreset('medium').mode).toBe('blob');
    expect(shadowOptionsForPreset('high').csm).toEqual({ size: 2048, cascades: 2 });
    expect(shadowOptionsForPreset('ultra').mode).toBe('csm');
  });
});
