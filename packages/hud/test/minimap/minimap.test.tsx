// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { cameraTrapezoid, createMinimapDemo } from '../../src/demo/minimap.ts';
import { Minimap, MinimapRenderer } from '../../src/hud/minimap/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { fakeClock, fireEvent, flushSignals, lastCall, renderWithHud, screen } from '../support/index.tsx';
import { recordingBitmaps, recordingCtx } from './mock-ctx.ts';
import type { RecordingCtx } from './mock-ctx.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function filled(model: HudModel, available = true): void {
  const demo = createMinimapDemo({ own: 20, enemy: 10 });
  const mm = model.minimap;
  mm.mapName.value = 'Setons';
  mm.mapSizeWu.value = demo.mapSizeWu;
  mm.terrain.value = demo.terrain;
  mm.spots.value = demo.spots;
  mm.fog.value = demo.fog();
  mm.units.value = demo.units();
  mm.camera.value = demo.camera();
  mm.available.value = available;
}

function renderMinimap(available = true) {
  const model = createHudModel({ units: CAT });
  filled(model, available);
  const ctxs = new Map<string, RecordingCtx>();
  const bitmaps = recordingBitmaps();
  let renderer: MinimapRenderer | null = null;
  const r = renderWithHud(
    <Minimap
      getContext={(c) => {
        const ctx = recordingCtx();
        ctxs.set(c.getAttribute('data-layer') ?? '?', ctx);
        return ctx;
      }}
      createBitmap={bitmaps.create}
      onRenderer={(x) => (renderer = x)}
    />,
    { model },
  );
  return { ...r, ctxs, bitmaps, renderer: () => renderer! };
}

/** Mocks the overlay canvas rect: 200 × 200 CSS px at (100, 50). */
function mockRect(): HTMLElement {
  const canvas = screen.getByTestId('minimap-canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 50, left: 100, top: 50, width: 200, height: 200, right: 300, bottom: 250, toJSON: () => ({}) });
  return canvas;
}

describe('Minimap panel (ui.md §5.4)', () => {
  test('panel 216 × 220 slot with head tools and four canvas layers (terrain, fog, units, camera)', () => {
    const { container } = renderMinimap();
    const panel = screen.getByTestId('minimap');
    expect(panel.getAttribute('data-panel')).toBe('minimap');
    expect(panel.getAttribute('data-component')).toBe('Minimap');
    expect([...container.querySelectorAll('canvas')].map((c) => c.getAttribute('data-layer'))).toEqual(['terrain', 'fog', 'dynamic', 'overlay']);
    expect(screen.getByTestId('minimap-mode').classList.contains('is-on')).toBe(true);
    expect(screen.getByTestId('minimap-resources').getAttribute('aria-pressed')).toBe('true');
  });

  test('terrain drawn once from an offscreen bitmap (putImageData, no readback); fog and dynamic layers drawn', () => {
    const { ctxs, bitmaps, renderer } = renderMinimap();
    const terrainBmp = bitmaps.made.find((b) => b.w === 128)!;
    expect(terrainBmp.ctx.of('putImageData')).toHaveLength(1);
    expect(ctxs.get('terrain')!.of('drawImage')).toHaveLength(1);
    const dyn = ctxs.get('dynamic')!;
    expect(dyn.of('fill').length).toBeGreaterThan(0);
    expect(renderer().stats.fogBuilds).toBe(1);
    expect(ctxs.get('fog')!.of('drawImage')).toHaveLength(1); // fog layer drawn once for the first fog
    for (const c of ctxs.values()) expect(c.calls.some((x) => x[0] === 'getImageData' || x[0] === 'fillText')).toBe(false);
  });

  test('signals drive the layers: units → dynamic, fog → fog bitmap, mode → terrain, camera → overlay in one frame', async () => {
    const clock = fakeClock();
    const { model, ctxs, renderer } = renderMinimap();
    const stats = renderer().stats;
    const d0 = stats.dynamicDraws;
    const t0 = stats.terrainDraws;
    await flushSignals(() => {
      model.minimap.units.value = { ...model.minimap.units.value };
    });
    expect(stats.dynamicDraws).toBe(d0 + 1);
    // One batch with units + fog → one dynamic draw and one fog layer draw.
    const fogDraws = ctxs.get('fog')!.of('drawImage').length;
    await flushSignals(() => {
      model.minimap.units.value = { ...model.minimap.units.value };
      model.minimap.fog.value = { ...model.minimap.fog.value! };
    });
    expect(stats.dynamicDraws).toBe(d0 + 2);
    expect(stats.fogBuilds).toBe(2);
    expect(ctxs.get('fog')!.of('drawImage')).toHaveLength(fogDraws + 1);
    // Units alone leave the fog layer untouched.
    await flushSignals(() => {
      model.minimap.units.value = { ...model.minimap.units.value };
    });
    expect(ctxs.get('fog')!.of('drawImage')).toHaveLength(fogDraws + 1);
    expect(stats.dynamicDraws).toBe(d0 + 3);
    // The 1-Hz timer alone does not redraw.
    await flushSignals(() => {
      model.match.timeS.value = 999;
    });
    expect(stats.dynamicDraws).toBe(d0 + 3);
    await flushSignals(() => {
      model.minimap.mode.value = 'tactical';
    });
    expect(stats.terrainDraws).toBe(t0 + 1);
    await clock.frame(); // settle the frames scheduled on mount (palette, first camera)
    const o0 = stats.overlayDraws;
    await flushSignals(() => {
      model.minimap.camera.value = cameraTrapezoid(100, 100);
    });
    await flushSignals(() => {
      model.minimap.camera.value = cameraTrapezoid(120, 100);
    });
    expect(stats.overlayDraws).toBe(o0);
    await clock.frame();
    expect(stats.overlayDraws).toBe(o0 + 1);
    const overlay = ctxs.get('overlay')!;
    expect(overlay.of('lineTo').slice(-3)).toHaveLength(3);
  });

  test('team mode change re-reads the palette once (next frame)', async () => {
    const clock = fakeClock();
    const { model, renderer } = renderMinimap();
    const spy = vi.spyOn(renderer(), 'refreshPalette');
    await flushSignals(() => {
      model.teams.value = 'cvd';
    });
    await clock.frame();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('left click / drag → setCamera in world units; right click → minimapOrder (Shift appends)', () => {
    const { log } = renderMinimap();
    const canvas = mockRect();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 200, clientY: 150 });
    expect(lastCall(log, 'setCamera')?.args).toEqual([256, 256]);
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
    expect(lastCall(log, 'setCamera')?.args).toEqual([128, 128]);
    // Dragging beyond the edge clamps to the map.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 400 });
    expect(lastCall(log, 'setCamera')?.args).toEqual([512, 512]);
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const n = log.filter((c) => c.name === 'setCamera').length;
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
    expect(log.filter((c) => c.name === 'setCamera')).toHaveLength(n);
    fireEvent.pointerDown(canvas, { button: 2, pointerId: 2, clientX: 300, clientY: 50, shiftKey: true });
    expect(lastCall(log, 'minimapOrder')?.args).toEqual([512, 0, true]);
    fireEvent.pointerDown(canvas, { button: 2, pointerId: 3, clientX: 100, clientY: 250 });
    expect(lastCall(log, 'minimapOrder')?.args).toEqual([0, 512, false]);
  });

  test('context menu and mouse wheel have no effect (no world zoom over the minimap)', () => {
    renderMinimap();
    const canvas = mockRect();
    const ctxEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(ctxEv);
    expect(ctxEv.defaultPrevented).toBe(true);
    const outer = vi.fn();
    document.addEventListener('wheel', outer);
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('wheel', outer);
  });

  test('tools: mode toggle, resource spots, whole map', () => {
    const { log } = renderMinimap();
    fireEvent.click(screen.getByTestId('minimap-mode'));
    expect(lastCall(log, 'setMinimapMode')?.args).toEqual(['tactical']);
    fireEvent.click(screen.getByTestId('minimap-resources'));
    expect(lastCall(log, 'toggleResources')).toBeDefined();
    fireEvent.click(screen.getByTestId('minimap-whole'));
    expect(lastCall(log, 'showWholeMap')).toBeDefined();
  });

  test('available = false: map key figures instead of the canvas (UI-E2)', () => {
    const { container, model } = renderMinimap(false);
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByTestId('minimap-facts').textContent).toContain('Setons');
    expect(screen.getByTestId('minimap-facts-size').textContent).toBe('512 × 512 WU');
    const spots = model.minimap.spots.value;
    const free = spots.filter((s) => s.kind === 'mass' && !s.taken).length;
    const taken = spots.filter((s) => s.kind === 'mass' && s.taken).length;
    expect(screen.getByTestId('minimap-facts-mex').textContent).toBe(`${free} / ${taken}`);
    expect(screen.queryByTestId('minimap-mode')).toBeNull();
    expect(screen.getByTestId('minimap-whole')).not.toBeNull();
  });
});
