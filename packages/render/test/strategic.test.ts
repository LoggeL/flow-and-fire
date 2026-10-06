// MS3 (C2): strategic zoom – crossfade math, zoom levels, near/far plane, IconPass (exactly one draw),
// unit-pass skip in Z2, icon geometry shared with the client (iconScreenRect), HP bar mask, atlas +
// context loss, placeholder turret.
import { describe, expect, it } from 'vitest';
import { RtsCamera, nearPlaneForHeight } from '../src/camera.ts';
import { UnitRecordWriter } from '../src/instance-layout.ts';
import { createPlaceholderLods, createPlaceholderMesh, meshBoundingRadius } from '../src/mesh/placeholder.ts';
import { HP_BAR_ALL, HP_BAR_DAMAGED, HP_BAR_SELECTED, hpBarMask, hpBarVisible } from '../src/passes/hpbars.ts';
import { FRAME_LAYOUT } from '../src/passes/shared.ts';
import { createRenderer } from '../src/renderer.ts';
import type { RenderView, VisualEntry } from '../src/renderer.ts';
import {
  ICON_FADE_BAND,
  ICON_SIZE_PX,
  STRATEGIC_GLSL,
  ZOOM_Z1_FACTOR,
  ZOOM_Z2_FACTOR,
  iconFade,
  iconProjectionScale,
  iconScreenRect,
  strategicZoom,
  unitIconFade,
  unitProjectedPx,
  zoomFlags,
} from '../src/strategic.ts';
import type { IconAtlasMetrics } from '../src/icons/atlas.ts';
import { GL } from '../src/webgl2/gl-const.ts';
import { FakeCanvas } from './support/fake-gl.ts';

const W = (wu: number): number => Math.round(wu * 4096);
/** Box 1 WU: selection radius 0.6 WU (1.2 × half extent), threshold 14 px. */
const BOX: VisualEntry = { spec: { hull: 'box', size: [1, 1, 1] } };
const TANK: VisualEntry = {
  spec: { hull: 'box', size: [1.45, 0.46, 1], turret: { hull: 'box', size: [0.62, 0.26, 0.56], offset: [-0.12, 0.46, 0] } },
  icon: 'land_direct',
  tech: 2,
  iconThreshold: 14,
  selectionRadius: 0.9,
};

function units(n: number, at: (i: number) => [number, number], extra: (i: number) => { hp?: number; flags?: number } = () => ({})): UnitRecordWriter {
  const w = new UnitRecordWriter(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const [x, z] = at(i);
    w.write(i, { prevX: W(x), prevY: 0, prevZ: W(z), x: W(x), y: 0, z: W(z), prevYaw: 0, yaw: 0, visual: i % 2, army: i & 1, ...extra(i) });
  }
  return w;
}

/** Camera looking straight down at (x, z) from `distance` WU. */
function topDown(x: number, z: number, distance: number): RtsCamera {
  const cam = new RtsCamera({ distance, pitch: (89.9 * Math.PI) / 180, maxDistance: 5000, maxPitch: (89.95 * Math.PI) / 180 });
  cam.setTargetWU(x, 0, z);
  return cam;
}

function view(camera: RtsCamera, w: UnitRecordWriter, n: number, extra: Partial<RenderView> = {}): RenderView {
  return { camera, units: { bytes: w.bytes, count: n, version: 1 }, alpha: 1, timeMs: 1000, ...extra };
}

/** Frame UBO content as uploaded (latest write of the buffer with the Frame block size). */
function frameUbo(canvas: FakeCanvas): Float32Array {
  let found: ArrayBufferView | null = null;
  for (const [, data] of canvas.gl.state.bufferData) if (data.byteLength === FRAME_LAYOUT.size) found = data;
  if (found === null) throw new Error('no frame UBO upload');
  return new Float32Array(found.buffer.slice(found.byteOffset, found.byteOffset + found.byteLength));
}

describe('crossfade math', () => {
  it('switches at the threshold with a linear band up to 1.5 × threshold', () => {
    expect(ICON_FADE_BAND).toBe(1.5);
    expect(iconFade(14, 14)).toBe(1);
    expect(iconFade(10, 14)).toBe(1);
    expect(iconFade(14.01, 14)).toBeLessThan(1);
    expect(iconFade(17.5, 14)).toBeCloseTo(0.5, 12);
    expect(iconFade(21, 14)).toBe(0);
    expect(iconFade(40, 14)).toBe(0);
    // Threshold 0 disables the icon, the zoom force still applies.
    expect(iconFade(1, 0)).toBe(0);
    expect(iconFade(1, 0, 0.3)).toBe(0.3);
    expect(iconFade(40, 14, 1)).toBe(1);
    // Projection: 2 r projK / d.
    const k = iconProjectionScale(600, Math.PI / 4);
    expect(k).toBeCloseTo(600 / (2 * Math.tan(Math.PI / 8)), 9);
    expect(unitProjectedPx(0.5, 100, k)).toBeCloseTo(k / 100, 9);
    // The GLSL mirror uses the same constants.
    expect(STRATEGIC_GLSL).toContain('1.5000 * thr - px');
    expect(STRATEGIC_GLSL).toContain('0.5000 * thr');
  });

  it('zoom levels are relative to the map size, the icon force ramps up to Z2', () => {
    for (const map of [256, 512, 1024, 4096]) {
      const z1 = Math.max(ZOOM_Z1_FACTOR * map, 60);
      const z2 = Math.max(ZOOM_Z2_FACTOR * map, 180);
      expect(strategicZoom(z1 - 1, map).level).toBe(0);
      expect(strategicZoom(z1, map).level).toBe(1);
      expect(strategicZoom(z2 - 0.01, map).level).toBe(1);
      expect(strategicZoom(z2, map).level).toBe(2);
      expect(strategicZoom(z2 * 0.8, map).iconForce).toBe(0);
      expect(strategicZoom(z2 * 0.925, map).iconForce).toBeCloseTo(0.5, 9);
      expect(strategicZoom(z2, map).iconForce).toBe(1);
      let last = -1;
      for (let d = z2 * 0.8; d <= z2 * 1.1; d += z2 / 50) {
        const f = strategicZoom(d, map).iconForce;
        expect(f).toBeGreaterThanOrEqual(last);
        last = f;
      }
    }
    expect(zoomFlags(0)).toMatchObject({ meshes: true, shadows: true, decalDetail: true });
    expect(zoomFlags(1)).toMatchObject({ meshes: true, shadows: false, props: false, decalDetail: false });
    expect(zoomFlags(2).meshes).toBe(false);
  });

  it('near plane = clamp(h · 0.02, 0.05, 32); the far plane covers the whole map (4,096 WU)', () => {
    expect(nearPlaneForHeight(1)).toBe(0.05);
    expect(nearPlaneForHeight(100)).toBeCloseTo(2, 12);
    expect(nearPlaneForHeight(5000)).toBe(32);
    const cam = new RtsCamera({ distance: 5000, maxDistance: 6000, pitch: (60 * Math.PI) / 180 });
    cam.setTargetWU(2048, 0, 2048);
    cam.mapSizeWU = 4096;
    cam.update();
    expect(cam.near).toBe(32);
    const out = new Float64Array(4);
    for (const [x, z] of [
      [0, 0],
      [4096, 0],
      [0, 4096],
      [4096, 4096],
    ] as const) {
      cam.project(W(x), 0, W(z), out);
      expect(out[2]!).toBeLessThan(1); // inside the depth range
      expect(out[2]!).toBeGreaterThan(-1);
    }
    // A low camera over the corner of a big map still reaches the opposite corner.
    const low = new RtsCamera({ distance: 40, pitch: (30 * Math.PI) / 180 });
    low.setTargetWU(10, 0, 10);
    low.mapSizeWU = 4096;
    low.update();
    expect(low.far).toBeGreaterThan(Math.hypot(4096, 4096));
    expect(low.near).toBeCloseTo(nearPlaneForHeight(low.height), 12);
  });
});

describe('IconPass and strategic zoom in the renderer (fake WebGL2)', () => {
  it('fades a unit mesh → icon with the camera distance (band, icon-only bucket, stats)', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas, { pixelRatio: 1 });
    r.setVisuals([BOX, BOX]);
    const w = units(1, () => [100, 100]);
    const k = iconProjectionScale(600, Math.PI / 4);
    // Distances with px = 2 · 0.6 · k / d at 1.6 T (mesh), 1.25 T (band), 0.8 T (icon only).
    const at = (px: number): number => (2 * 0.6 * k) / px;
    const run = (d: number): { units: number; icons: number; st: typeof r.stats } => {
      const cam = topDown(100, 100, d);
      gl.resetCalls();
      r.render(view(cam, w, 1));
      const st = r.stats;
      const fade = unitIconFade(cam, W(100), 0, W(100), 0.6, 14, st.iconForce);
      if (fade > 0 && fade < 1) expect(st.fadedUnits).toBe(1);
      return { units: st.drawsByPass.units, icons: st.drawsByPass.icons, st };
    };
    const mesh = run(at(14 * 1.6));
    expect(mesh).toMatchObject({ units: 1, icons: 0 });
    expect(mesh.st.iconCount).toBe(0);
    const band = run(at(14 * 1.25));
    expect(band).toMatchObject({ units: 1, icons: 1 });
    expect(band.st.fadedUnits).toBe(1);
    expect(band.st.iconCount).toBe(1);
    expect(band.st.iconOnlyUnits).toBe(0);
    const icon = run(at(14 * 0.8));
    expect(icon).toMatchObject({ units: 0, icons: 1 });
    expect(icon.st.iconOnlyUnits).toBe(1);
    expect(icon.st.zoomLevel).toBe(0);
    // The icon draw covers the visible records with ONE instanced draw of 6 vertices each.
    const draws = gl.named('drawArraysInstanced');
    expect(draws.length).toBe(1);
    expect(draws[0]!.args.slice(2)).toEqual([6, 1]);
    // Frame block: icon-only instances start at 0 (the only record is icon-only).
    const f = frameUbo(canvas);
    const iconOff = FRAME_LAYOUT.offsetOf('iconParams') / 4;
    expect(f[iconOff]).toBe(ICON_SIZE_PX);
    expect(f[iconOff + 1]).toBe(0);
    r.dispose();
  });

  it('draws exactly ONE icon draw for 1 and for 8,000 units (0 draws without units); Z2 skips the unit pass', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas, { pixelRatio: 1 });
    r.setVisuals([BOX, TANK]);
    const cam = topDown(512, 512, 900); // map 1024 (no terrain) ⇒ Z2 from 768 WU
    for (const n of [0, 1, 8000]) {
      const side = Math.ceil(Math.sqrt(Math.max(n, 1)));
      const w = units(n, (i) => [256 + ((i % side) * 512) / side, 256 + (Math.floor(i / side) * 512) / side]);
      gl.resetCalls();
      r.render(view(cam, w, n));
      const st = r.stats;
      expect(st.zoomLevel).toBe(2);
      expect(st.drawsByPass.units).toBe(0);
      expect(st.drawsByPass.icons).toBe(n === 0 ? 0 : 1);
      expect(st.passDraws).toBe(st.drawsByPass);
      expect(st.unitInstances).toBe(n);
      expect(st.iconOnlyUnits).toBe(n);
      expect(gl.named('drawElementsInstanced').length).toBe(0);
      const icons = gl.named('drawArraysInstanced');
      expect(icons.length).toBe(n === 0 ? 0 : 1);
      if (n > 0) expect(icons[0]!.args[3]).toBe(n);
      if (n === 8000) {
        // Main-JS of a frame with new unit data (cull + fade classification + sort + upload), fake GL.
        const ms: number[] = [];
        for (let k = 2; k < 22; k++) {
          r.render({ ...view(cam, w, n), units: { bytes: w.bytes, count: n, version: k } });
          ms.push(r.stats.cpuMs);
        }
        ms.sort((a, b) => a - b);
        console.log(`[strategic] 8,000 units in Z2, new frame data: render() median ${ms[10]!.toFixed(3)} ms (fake GL, local, Apple M5 Pro)`);
      }
    }
    r.dispose();
  });

  it('iconScreenRect matches the icon quad the VS builds from the uploaded frame block', () => {
    const canvas = new FakeCanvas();
    const r = createRenderer(canvas, { pixelRatio: 2, iconSizePx: 24 });
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    r.setVisuals([BOX]);
    const cam = new RtsCamera({ distance: 400, pitch: (55 * Math.PI) / 180 });
    cam.setTargetWU(300, 0, 280);
    const pts: [number, number][] = [
      [300, 280],
      [260, 250],
      [350, 320],
    ];
    const w = units(pts.length, (i) => pts[i]!);
    r.render(view(cam, w, pts.length));
    const f = frameUbo(canvas);
    const vp = f.subarray(0, 16); // column-major viewProj (camera-relative)
    const off = (name: string): number => FRAME_LAYOUT.offsetOf(name) / 4;
    const ci = new Int32Array(f.buffer, FRAME_LAYOUT.offsetOf('camPosInt'), 3);
    const viewport = f.subarray(off('viewport'), off('viewport') + 4);
    const strategic = f.subarray(off('strategic'), off('strategic') + 4);
    const size = f[off('iconParams')]! * strategic[2]!; // device px
    expect(strategic[2]).toBe(2);
    const rect = new Float64Array(4);
    for (const [x, z] of pts) {
      // VS: clip = viewProj · rel; corner = clip.xy + offPx · 2 / viewport · clip.w (q ∈ {0, 1}).
      const rx = (W(x) - ci[0]!) / 4096;
      const ry = (0 - ci[1]!) / 4096;
      const rz = (W(z) - ci[2]!) / 4096;
      const cx = vp[0]! * rx + vp[4]! * ry + vp[8]! * rz + vp[12]!;
      const cy = vp[1]! * rx + vp[5]! * ry + vp[9]! * rz + vp[13]!;
      const cw = vp[3]! * rx + vp[7]! * ry + vp[11]! * rz + vp[15]!;
      const corner = (qx: number, qy: number): [number, number] => {
        const nx = cx / cw + (qx - 0.5) * size * 2 * viewport[2]!;
        const ny = cy / cw + (qy - 0.5) * size * 2 * viewport[3]!;
        return [(nx * 0.5 + 0.5) * 800, (0.5 - ny * 0.5) * 600]; // CSS px
      };
      const [x0, y1] = corner(0, 0);
      const [x1, y0] = corner(1, 1);
      expect(iconScreenRect(cam, W(x), 0, W(z), rect, 24)).toBe(true);
      expect(rect[0]).toBeCloseTo(x0, 2);
      expect(rect[1]).toBeCloseTo(y0, 2);
      expect(rect[2]).toBeCloseTo(x1, 2);
      expect(rect[3]).toBeCloseTo(y1, 2);
      expect(rect[2]! - rect[0]!).toBeCloseTo(24, 9);
    }
    // Behind the camera ⇒ false.
    expect(iconScreenRect(cam, W(300), W(5000), W(280), rect)).toBe(false);
    r.dispose();
  });

  it('writes glyph, tech, threshold, selection radius and mesh top per visual; resolves icon ids against the atlas', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals([BOX, TANK]);
    const metrics: IconAtlasMetrics = {
      width: 96,
      height: 48,
      cellPx: 48,
      pxRange: 4,
      alphaRange: 12,
      glyphs: [
        { id: 'land_direct', x: 0, y: 0, w: 48, h: 48 },
        { id: 'tech2', x: 48, y: 0, w: 48, h: 48 },
      ],
    };
    const pixels = new Uint8Array(96 * 48 * 4).map((_, i) => i & 255);
    r.setIconAtlas(pixels, 96, 48, metrics);
    expect(r.iconAtlas).toBe(metrics);
    const cam = topDown(10, 10, 60);
    r.render(view(cam, units(2, () => [10, 10]), 2));
    const vd = [...gl.state.textures].filter(([o, t]) => o.gen === gl.state.generation && t.internalFormat === GL.RGBA32F && t.height === 4);
    expect(vd.length).toBe(1);
    const ups = vd[0]![1].uploads;
    const data = ups[ups.length - 1]!.data as Float32Array;
    // visual 1 (tank): glyph 0 ('land_direct'), tech 2, threshold 14, selection radius 0.9
    expect(Array.from(data.subarray(4, 8))).toEqual([0, 2, 14, Math.fround(0.9)]);
    // visual 0 (box): no icon ⇒ −1 (fallback), defaults
    expect(data[0]).toBe(-1);
    expect(data[2]).toBe(14);
    expect(data[3]).toBeCloseTo(0.6, 6);
    // mesh top (row 1): tank turret top 0.46 + 0.26
    const w = data.length / 16;
    expect(data[(w + 1) * 4]).toBeCloseTo(0.72, 6);
    // row 3: tech2 glyph found, tech1/3, blip, ghost, fallback missing; hasAtlas, glyph count
    const row3 = 3 * w * 4;
    expect(Array.from(data.subarray(row3, row3 + 8))).toEqual([-1, 1, -1, -1, -1, -1, 1, 2]);
    expect(() => r.setIconAtlas(pixels, 96, 47, metrics)).toThrow(/metrics say/);
    r.dispose();
  });

  it('context loss re-creates and re-uploads the atlas and the visual data; draws stay identical', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas, { pixelRatio: 1 });
    r.setVisuals([BOX, TANK]);
    const metrics: IconAtlasMetrics = { width: 48, height: 48, cellPx: 48, pxRange: 4, alphaRange: 12, glyphs: [{ id: 'land_direct', x: 0, y: 0, w: 48, h: 48 }] };
    const pixels = new Uint8Array(48 * 48 * 4).map((_, i) => (i * 7) & 255);
    r.setIconAtlas(pixels, 48, 48, metrics);
    const cam = topDown(512, 512, 900);
    const w = units(50, (i) => [400 + i, 500]);
    r.render(view(cam, w, 50));
    const before = { ...r.stats.drawsByPass };
    expect(before.icons).toBe(1);
    gl.lose();
    r.render(view(cam, w, 50));
    expect(r.stats.lost).toBe(true);
    gl.restore();
    const atlas = [...gl.state.textures].filter(([o, t]) => o.gen === gl.state.generation && t.internalFormat === GL.RGBA8 && t.width === 48 && t.height === 48);
    expect(atlas.length).toBe(1);
    expect(Array.from(atlas[0]![1].uploads[0]!.data as Uint8Array)).toEqual(Array.from(pixels));
    const vd = [...gl.state.textures].filter(([o, t]) => o.gen === gl.state.generation && t.internalFormat === GL.RGBA32F && t.height === 4);
    expect(vd.length).toBe(1);
    expect((vd[0]![1].uploads[0]!.data as Float32Array)[4]).toBe(0); // tank glyph 0
    r.render(view(cam, w, 50));
    expect(r.stats.lost).toBe(false);
    expect(r.stats.drawsByPass).toEqual(before);
    r.dispose();
  });

  it('HP bars: one draw for selected or damaged units (mask), none otherwise', () => {
    expect(hpBarMask('auto')).toBe(HP_BAR_SELECTED | HP_BAR_DAMAGED);
    expect(hpBarMask('off')).toBe(0);
    expect(hpBarVisible(hpBarMask('auto'), false, 255)).toBe(false);
    expect(hpBarVisible(hpBarMask('auto'), true, 255)).toBe(true);
    expect(hpBarVisible(hpBarMask('auto'), false, 254)).toBe(true);
    expect(hpBarVisible(hpBarMask('selected'), false, 10)).toBe(false);
    expect(hpBarVisible(hpBarMask('damaged'), true, 255)).toBe(false);
    expect(hpBarVisible(HP_BAR_ALL, false, 255)).toBe(true);

    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas, { pixelRatio: 1 });
    r.setVisuals([{ ...BOX, iconThreshold: 0 }, { ...BOX, iconThreshold: 0 }]);
    const cam = topDown(50, 50, 30);
    const healthy = units(10, (i) => [45 + i, 50]);
    const hpDraws = (): number => gl.named('drawArraysInstanced').length;
    gl.resetCalls();
    r.render(view(cam, healthy, 10));
    expect(hpDraws()).toBe(0);
    expect(r.stats.drawsByPass.overlay).toBe(0);
    const hl = new Uint8Array(10);
    hl[3] = 1;
    gl.resetCalls();
    r.render(view(cam, healthy, 10, { highlight: hl, highlightVersion: 1 }));
    expect(hpDraws()).toBe(1);
    expect(gl.named('drawArraysInstanced')[0]!.args[3]).toBe(10); // all visible records, VS masks
    const damaged = units(10, (i) => [45 + i, 50], (i) => ({ hp: i === 7 ? 100 : 255 }));
    gl.resetCalls();
    r.render(view(cam, damaged, 10));
    expect(hpDraws()).toBe(1);
    r.setHpBars('off');
    gl.resetCalls();
    r.render({ ...view(cam, damaged, 10), units: { bytes: damaged.bytes, count: 10, version: 2 } });
    expect(hpDraws()).toBe(0);
    r.dispose();
  });
});

describe('placeholder turret', () => {
  it('builds hull (part 0) + turret with barrel (part 1) with its pivot at the offset; LOD 2 without barrel', () => {
    const spec = TANK.spec;
    const m = createPlaceholderMesh(spec, 0);
    const parts = new Set(m.partIds);
    expect(parts).toEqual(new Set([0, 1]));
    expect(Array.from(m.partPivots!.subarray(3, 6)).map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.12, 0.46, 0]);
    expect(m.partParents![1]).toBe(0);
    expect(m.bounds[4]).toBeCloseTo(0.72, 6);
    const hullOnly = createPlaceholderMesh({ hull: 'box', size: [1.45, 0.46, 1] }, 0);
    expect(m.vertexCount).toBe(hullOnly.vertexCount + 24 + 24); // turret box + barrel box
    const lods = createPlaceholderLods(spec);
    expect(lods[0]).toBe(lods[1]); // box hull + box turret: LOD 0 = LOD 1
    expect(lods[2].vertexCount).toBe(8 + 8); // low boxes, no barrel
    expect(new Set(lods[2].partIds)).toEqual(new Set([0, 1]));
    // The turret can turn: the bounding sphere covers every rotation around its pivot.
    expect(meshBoundingRadius(m)).toBeGreaterThan(meshBoundingRadius(hullOnly));
    const cyl = createPlaceholderLods({ hull: 'box', size: [1, 0.4, 0.8], turret: { hull: 'cyl', size: [0.4, 0.2, 0.4], offset: [0, 0.4, 0] } });
    expect(cyl[0]).not.toBe(cyl[1]);
    expect(() => createPlaceholderMesh({ hull: 'box', size: [1, 1, 1], turret: { hull: 'box', size: [0, 1, 1], offset: [0, 1, 0] } })).toThrow(/turret/);
  });
});
