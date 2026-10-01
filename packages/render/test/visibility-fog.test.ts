import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { createRenderer, type RenderView } from '../src/renderer.ts';
import type { TerrainDesc } from '../src/terrain/heightfield.ts';
import { GL } from '../src/webgl2/gl-const.ts';
import { FakeCanvas } from './support/fake-gl.ts';

function terrain(waterLevelRaw: number | null = 6 * 4096): TerrainDesc {
  return { sizeWu: 128, dim: 129, heights: new Uint16Array(129 * 129).fill(512), heightScaleRaw: 32, waterLevelRaw,
    light: { azimuthDeg: 30, elevationDeg: 50, sun: [240, 230, 210], ambient: [110, 120, 140] } };
}
function setup(water: number | null = 6 * 4096) {
  const canvas = new FakeCanvas();
  const renderer = createRenderer(canvas, { terrain: terrain(water) });
  const camera = new RtsCamera({ distance: 150 });
  camera.setTargetWU(64, 4, 64);
  const view: RenderView = { camera, units: { bytes: new Uint8Array(0), count: 0 }, alpha: 1, timeMs: 1000 };
  const cells = new Uint8Array(16 * 16);
  cells[1] = 1; cells[2] = 2;
  const set = (version = 1, timeMs = 1000) => renderer.setVisibilityFog({ dim: 16, cells, version, timeMs });
  const render = (timeMs = 1000) => renderer.render({ ...view, timeMs });
  function fogTexture() {
    for (const [object, texture] of canvas.gl.state.textures) {
      if (object.gen === canvas.gl.state.generation && texture.internalFormat === GL.RGBA8 && texture.width === 16 && texture.height === 16) return texture;
    }
    throw new Error('missing fog texture');
  }
  return { canvas, renderer, cells, set, render, fogTexture };
}

describe('server visibility on actual renderer/RHI surfaces', () => {
  it('copies the 8-WU server grid, draws shared ground/water geometry, and needs only one existing height texture', () => {
    const s = setup(); s.set(); s.render();
    expect(s.renderer.stats.visibilityFog).toMatchObject({ enabled: true, active: true, dim: 16, version: 1, unknown: 254, explored: 1, visible: 1, uploads: 1, uploadBytes: 1024, draws: 2, transition: 1 });
    expect(s.renderer.stats.drawsByPass.fog).toBe(2);
    expect([...s.canvas.gl.state.textures.values()].filter(t => t.internalFormat === GL.R16UI)).toHaveLength(1);
    const data = s.fogTexture().uploads.at(-1)!.data as Uint8Array;
    expect(Array.from(data.subarray(0, 12))).toEqual([10, 10, 0, 255, 89, 89, 1, 255, 255, 255, 2, 255]);
    // A bright visible cell cannot spatially blend into a dark neighbouring cell.
    expect(s.fogTexture().params.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.NEAREST);
    expect(s.fogTexture().params.get(GL.TEXTURE_MAG_FILTER)).toBe(GL.NEAREST);
    s.cells.fill(2); s.render(1010);
    expect(s.renderer.stats.visibilityFog.unknown).toBe(254);
    expect(s.renderer.stats.visibilityFog.uploads).toBe(1);
    s.renderer.dispose();
  });

  it('draws only ground without water, and rejects a stale map-size grid at presentation', () => {
    const s = setup(null); s.set(); s.render();
    expect(s.renderer.stats.visibilityFog.draws).toBe(1);
    s.renderer.setTerrain({ ...terrain(null), sizeWu: 64, dim: 65, heights: new Uint16Array(65 * 65) });
    expect(s.renderer.stats.visibilityFog.version).toBe(-1);
    s.set(2); s.render();
    expect(s.renderer.stats.visibilityFog).toMatchObject({ enabled: true, active: false, draws: 0 });
    s.renderer.dispose();
  });

  it('observer/reveal all-visible snapshots skip both overlay draws and texture uploads', () => {
    const s = setup(); s.set(); s.render();
    s.cells.fill(2); s.set(2, 1001); s.render(1001);
    expect(s.renderer.stats.visibilityFog).toMatchObject({ enabled: false, active: false, unknown: 0, explored: 0, visible: 256, draws: 0, uploads: 1, transition: 1 });
    expect(s.renderer.stats.drawsByPass.fog).toBe(0);
    s.renderer.dispose();
  });

  it('starts a new transition from the brightness currently shown, and ignores duplicate/older versions', () => {
    const s = setup(); s.set(); s.cells[0] = 2; s.set(2); s.render(1075);
    expect(s.renderer.stats.visibilityFog.transition).toBe(0.5);
    s.cells[0] = 1; s.set(3, 1075); s.render(1075);
    expect(s.renderer.stats.visibilityFog.transition).toBe(0);
    const data = s.fogTexture().uploads.at(-1)!.data as Uint8Array;
    expect(Array.from(data.subarray(0, 4))).toEqual([133, 89, 1, 255]);
    s.cells.fill(0); s.set(2, 1080); s.set(3, 1080);
    expect(s.renderer.stats.visibilityFog.uploads).toBe(3);
    s.render(1225); expect(s.renderer.stats.visibilityFog.transition).toBe(1);
    s.renderer.setVisibilityFog(null); s.set(0, 1225); s.render(1225);
    expect(s.renderer.stats.visibilityFog).toMatchObject({ version: 0, transition: 1, unknown: 256 });
    s.renderer.dispose();
  });

  it('restores the latest fog grid, pipelines and uniform buffer through the real resource registry', () => {
    const s = setup(); s.set(); s.render();
    s.cells[0] = 2; s.set(2); s.render(1075);
    const before = s.fogTexture().uploads.at(-1)!.data;
    s.canvas.gl.lose(); s.render(1080); expect(s.renderer.stats.lost).toBe(true);
    s.canvas.gl.restore();
    expect(s.fogTexture().uploads.at(-1)!.data).toEqual(before);
    s.render(1150);
    expect(s.renderer.stats.lost).toBe(false);
    expect(s.renderer.stats.visibilityFog).toMatchObject({ version: 2, active: true, draws: 2, transition: 1 });
    s.renderer.dispose();
  });

  it('validates bounds and cell states before changing a previously accepted grid', () => {
    const s = setup(); s.set();
    expect(() => s.renderer.setVisibilityFog({ dim: 513, cells: new Uint8Array(513 * 513), version: 2, timeMs: 1000 })).toThrow(RangeError);
    expect(() => s.renderer.setVisibilityFog({ dim: 16, cells: new Uint8Array(1), version: 2, timeMs: 1000 })).toThrow(RangeError);
    s.cells[0] = 3; expect(() => s.set(2)).toThrow(RangeError);
    s.render(); expect(s.renderer.stats.visibilityFog).toMatchObject({ version: 1, unknown: 254, uploads: 1 });
    s.renderer.dispose();
  });
});
