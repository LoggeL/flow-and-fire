/**
 * Renderer facade (PLAN §3.7, MS1 subset): fixed passes Ground → Units → Overlay on top of the
 * WebGL2 RHI backend.
 *
 * Per frame the caller hands in a {@link RenderView}: the camera, the UnitRecord bytes of the
 * current sim frame (unchanged, 48 B per record), an optional highlight byte per record, the
 * interpolation alpha, client overlays and the clock. The renderer never allocates in the steady
 * state; unit data are only re-sorted/re-uploaded when `units.version` changes (or is omitted).
 */
import type { RtsCamera } from './camera.ts';
import type { PlaceholderSpec } from './mesh/placeholder.ts';
import { createPlaceholderMesh } from './mesh/placeholder.ts';
import { GroundPass } from './passes/ground.ts';
import type { GroundOptions } from './passes/ground.ts';
import type { Overlays } from './passes/overlay.ts';
import { OverlayPass } from './passes/overlay.ts';
import {
  DEFAULT_ARMY_COLORS,
  FRAME_LAYOUT,
  MAX_ARMY_COLORS,
  MAX_VISUALS,
  PALETTE_LAYOUT,
  SLOT_FRAME,
  SLOT_PALETTE,
  rgbHex,
} from './passes/shared.ts';
import { UnitPass } from './passes/units.ts';
import type { BindGroupH, BufH, GpuDevice, PassDesc } from './rhi/types.ts';
import { Std140Writer } from './std140.ts';
import type { DeviceCanvas, WebGL2DeviceOptions } from './webgl2/device.ts';
import { createWebGL2Device } from './webgl2/device.ts';

/** One entry of the visual table (index = `UnitRecord.visual`). */
export interface VisualEntry {
  readonly spec: PlaceholderSpec;
  /** Base color: 0xRRGGBB or linear [r, g, b]; falls back to `spec.color`, then pure team color. */
  readonly color?: number | readonly [number, number, number];
  /** Weight of the base color against the army color (0 = team color only). Default 0.3 with a color. */
  readonly baseWeight?: number;
}

/** Map-free visual table: `table[visual]`; holes render as a small grey fallback cube. */
export type VisualTable = readonly (VisualEntry | undefined | null)[];

export interface RenderUnits {
  /** UnitRecords, 48 B each (4-byte aligned for the fast path). */
  readonly bytes: Uint8Array;
  readonly count: number;
  /**
   * Content version of `bytes`/`highlight` (e.g. frame seq). Equal version ⇒ no re-sort/upload.
   * Omit to upload every frame.
   */
  readonly version?: number;
}

export interface RenderView {
  readonly camera: RtsCamera;
  readonly units: RenderUnits;
  /** One byte per record in `units.bytes` order; ≠ 0 ⇒ highlighted (selection). */
  readonly highlight?: Uint8Array;
  /** Content version of `highlight`; omitted ⇒ re-uploaded every frame while `highlight` is set. */
  readonly highlightVersion?: number;
  /** Interpolation factor prev → cur in [0, 1]. */
  readonly alpha: number;
  readonly overlays?: Overlays;
  /** Clock in ms (e.g. `performance.now()`), used for overlay animation. */
  readonly timeMs: number;
}

export interface RenderStats {
  /** Draw calls of the last frame. */
  drawCalls: number;
  instances: number;
  uploadBytes: number;
  /** Main-thread JS time of the last `render()` call in ms. */
  cpuMs: number;
  /** Latest resolved GPU frame time (EXT_disjoint_timer_query_webgl2), otherwise undefined. */
  gpuMs: number | undefined;
  /** Visuals with at least one instance in the last frame. */
  visualsDrawn: number;
  /** Records skipped because their visual is outside the table. */
  droppedUnits: number;
  /** Rendered frames (skipped frames while the context is lost are not counted). */
  frames: number;
  lost: boolean;
}

export interface RendererCanvas extends DeviceCanvas {
  width: number;
  height: number;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
}

export interface RendererOptions {
  /** Drawing-buffer scale relative to CSS pixels × devicePixelRatio (Medium preset 0.8). Default 1. */
  readonly renderScale?: number;
  /** Device pixel ratio override (tests); default `globalThis.devicePixelRatio ?? 1`. */
  readonly pixelRatio?: number;
  readonly ground?: GroundOptions;
  readonly device?: WebGL2DeviceOptions;
  /** Army colors as 0xRRGGBB (up to 16); default palette otherwise. */
  readonly armyColors?: readonly number[];
  readonly clearColor?: readonly [number, number, number];
}

export interface Renderer {
  readonly device: GpuDevice;
  readonly stats: Readonly<RenderStats>;
  /** Re-reads the canvas CSS size and resizes the drawing buffer; returns true when it changed. */
  resize(): boolean;
  setVisuals(table: VisualTable): void;
  setArmyColors(colors: readonly number[]): void;
  configureGround(opts: GroundOptions): void;
  render(view: RenderView): void;
  dispose(): void;
}

/** Fixed passes that are not per-visual: ground, waypoint lines, click markers. */
export const FIXED_PASS_DRAWS = 3;

const FALLBACK_SPEC: PlaceholderSpec = { hull: 'box', size: [1, 1, 1] };
const SUN = normalize3(0.45, 0.8, 0.35);

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

class RendererImpl implements Renderer {
  readonly device: GpuDevice;
  readonly stats: RenderStats = {
    drawCalls: 0,
    instances: 0,
    uploadBytes: 0,
    cpuMs: 0,
    gpuMs: undefined,
    visualsDrawn: 0,
    droppedUnits: 0,
    frames: 0,
    lost: false,
  };

  private readonly frameData = new Std140Writer(FRAME_LAYOUT);
  private readonly paletteData = new Std140Writer(PALETTE_LAYOUT);
  private readonly frameUbo: BufH;
  private readonly paletteUbo: BufH;
  private readonly frameGroup: BindGroupH;
  private readonly paletteGroup: BindGroupH;
  private readonly ground: GroundPass;
  private readonly units: UnitPass;
  private readonly overlay: OverlayPass;
  private readonly passDesc: PassDesc;
  private readonly renderScale: number;
  private readonly pixelRatio: number | undefined;
  private sizeDirty = true;
  private readonly observer: ResizeObserver | null = null;
  private readonly emptyOverlays: Overlays = { markers: [], lines: [] };
  private disposed = false;

  private readonly offCamPosInt = FRAME_LAYOUT.offsetOf('camPosInt');
  private readonly offViewProj = FRAME_LAYOUT.offsetOf('viewProj');
  private readonly offCamFrac = FRAME_LAYOUT.offsetOf('camFrac');
  private readonly offCamMod = FRAME_LAYOUT.offsetOf('camMod');
  private readonly offFog = FRAME_LAYOUT.offsetOf('fog');
  private readonly offViewport = FRAME_LAYOUT.offsetOf('viewport');

  constructor(
    private readonly canvas: RendererCanvas,
    opts: RendererOptions,
  ) {
    this.renderScale = opts.renderScale ?? 1;
    this.pixelRatio = opts.pixelRatio;
    const dev = createWebGL2Device(canvas, opts.device ?? {});
    this.device = dev;

    const fd = this.frameData;
    fd.vec4(FRAME_LAYOUT.offsetOf('sunDir'), SUN[0], SUN[1], SUN[2], 0);
    fd.vec4(FRAME_LAYOUT.offsetOf('sunColor'), 0.85, 0.8, 0.72, 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('skyColor'), 0.42, 0.48, 0.58, 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('groundColor'), 0.2, 0.18, 0.15, 1);
    const clear = opts.clearColor ?? [0.52, 0.6, 0.68];
    fd.vec4(this.offFog, clear[0], clear[1], clear[2], 400);
    this.passDesc = { label: 'main', clearColor: [clear[0], clear[1], clear[2], 1], clearDepth: 1 };

    this.frameUbo = dev.createBuffer({
      label: 'frame.ubo',
      usage: 'uniform',
      size: FRAME_LAYOUT.size,
      dynamic: true,
      restore: (h) => dev.writeBuffer(h, 0, this.frameData.bytes),
    });
    this.paletteUbo = dev.createBuffer({
      label: 'palette.ubo',
      usage: 'uniform',
      size: PALETTE_LAYOUT.size,
      restore: (h) => dev.writeBuffer(h, 0, this.paletteData.bytes),
    });
    this.frameGroup = dev.createBindGroup({ label: 'frame', buffers: [{ slot: SLOT_FRAME, buffer: this.frameUbo }] });
    this.paletteGroup = dev.createBindGroup({ label: 'palette', buffers: [{ slot: SLOT_PALETTE, buffer: this.paletteUbo }] });

    this.ground = new GroundPass(dev, this.frameGroup, opts.ground ?? {});
    this.units = new UnitPass(dev, this.frameGroup, this.paletteGroup);
    this.overlay = new OverlayPass(dev, this.frameGroup);

    if (opts.armyColors !== undefined) this.writeArmyColors(opts.armyColors);
    else
      for (let a = 0; a < MAX_ARMY_COLORS; a++) {
        const c = DEFAULT_ARMY_COLORS[a]!;
        this.paletteData.vec4(PALETTE_LAYOUT.offsetOf('army') + a * 16, c[0], c[1], c[2], 1);
      }
    this.setVisuals([]);

    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO !== undefined && isElement(canvas)) {
      this.observer = new RO(() => {
        this.sizeDirty = true;
      });
      this.observer.observe(canvas);
    }
    this.resize();
  }

  resize(): boolean {
    this.sizeDirty = false;
    const c = this.canvas;
    const cssW = c.clientWidth ?? c.width;
    const cssH = c.clientHeight ?? c.height;
    const dpr = this.pixelRatio ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const w = Math.max(1, Math.round(cssW * dpr * this.renderScale));
    const h = Math.max(1, Math.round(cssH * dpr * this.renderScale));
    if (c.width === w && c.height === h) return false;
    c.width = w;
    c.height = h;
    return true;
  }

  setVisuals(table: VisualTable): void {
    if (table.length > MAX_VISUALS) throw new Error(`setVisuals: at most ${MAX_VISUALS} visuals, got ${table.length}`);
    const meshes = [];
    const base = PALETTE_LAYOUT.offsetOf('visual');
    const pd = this.paletteData;
    for (let v = 0; v < table.length; v++) {
      const e = table[v];
      const spec = e?.spec ?? FALLBACK_SPEC;
      meshes.push(createPlaceholderMesh(spec));
      const raw = e?.color ?? spec.color;
      let rgb: readonly [number, number, number] = [0.5, 0.5, 0.5];
      let weight = e === undefined || e === null ? 0.8 : 0;
      if (raw !== undefined) {
        rgb = typeof raw === 'number' ? rgbHex(raw) : raw;
        weight = e?.baseWeight ?? 0.3;
      } else if (e?.baseWeight !== undefined) weight = e.baseWeight;
      pd.vec4(base + v * 16, rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, weight)));
    }
    this.units.setMeshes(meshes);
    this.device.writeBuffer(this.paletteUbo, 0, pd.bytes);
  }

  setArmyColors(colors: readonly number[]): void {
    this.writeArmyColors(colors);
    this.device.writeBuffer(this.paletteUbo, 0, this.paletteData.bytes);
  }

  private writeArmyColors(colors: readonly number[]): void {
    const off = PALETTE_LAYOUT.offsetOf('army');
    for (let a = 0; a < MAX_ARMY_COLORS; a++) {
      const hex = colors[a];
      const c = hex === undefined ? DEFAULT_ARMY_COLORS[a]! : rgbHex(hex);
      this.paletteData.vec4(off + a * 16, c[0], c[1], c[2], 1);
    }
  }

  configureGround(opts: GroundOptions): void {
    this.ground.configure(opts);
  }

  render(view: RenderView): void {
    if (this.disposed) throw new Error('render: renderer disposed');
    const t0 = performance.now();
    const dev = this.device;
    const st = this.stats;
    st.lost = dev.isLost();
    if (st.lost) {
      st.drawCalls = 0;
      st.cpuMs = performance.now() - t0;
      return;
    }
    if (this.sizeDirty) this.resize();

    const cam = view.camera;
    const cssW = this.canvas.clientWidth ?? this.canvas.width;
    const cssH = this.canvas.clientHeight ?? this.canvas.height;
    if (cam.viewportWidth !== cssW || cam.viewportHeight !== cssH) cam.setViewport(cssW, cssH);
    cam.update();

    // ---- frame uniforms
    const fd = this.frameData;
    fd.mat4(this.offViewProj, cam.viewProj32);
    const ci = cam.camPosInt;
    fd.ivec4(this.offCamPosInt, ci[0]!, ci[1]!, ci[2]!, 0);
    const alpha = view.alpha < 0 ? 0 : view.alpha > 1 ? 1 : view.alpha;
    fd.vec4(this.offCamFrac, cam.camFrac[0]!, cam.camFrac[1]!, cam.camFrac[2]!, alpha);
    const seconds = (view.timeMs / 1000) % 3600;
    fd.vec4(this.offCamMod, mod32WU(ci[0]!), mod32WU(ci[1]!), mod32WU(ci[2]!), seconds);
    const fogStart = Math.max(250, cam.distance * 3);
    fd.float(this.offFog + 12, fogStart);
    const bw = this.canvas.width;
    const bh = this.canvas.height;
    fd.vec4(this.offViewport, bw, bh, 1 / bw, 1 / bh);

    dev.beginFrame();
    dev.writeBuffer(this.frameUbo, 0, fd.bytes);

    // ---- CPU prep: bucket sort + ring upload (only on new data), overlays
    const u = view.units;
    this.units.prepare(u.bytes, u.count, view.highlight, u.version, view.highlightVersion);
    this.overlay.prepare(view.overlays ?? this.emptyOverlays, view.timeMs);

    // ---- passes: Ground → Units → Overlay
    const enc = dev.beginPass(this.passDesc);
    this.ground.draw(enc);
    this.units.draw(enc);
    this.overlay.draw(enc);
    enc.end();
    dev.endFrame();

    const c = dev.counters;
    st.drawCalls = c.drawCalls;
    st.instances = c.instances;
    st.uploadBytes = c.uploadBytes;
    st.gpuMs = dev.gpuTimeMs();
    st.visualsDrawn = this.units.activeVisuals();
    st.droppedUnits = this.units.buckets.dropped;
    st.frames++;
    st.cpuMs = performance.now() - t0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    this.overlay.dispose();
    this.units.dispose();
    this.ground.dispose();
    const dev = this.device;
    dev.destroyBindGroup(this.frameGroup);
    dev.destroyBindGroup(this.paletteGroup);
    dev.destroyBuffer(this.frameUbo);
    dev.destroyBuffer(this.paletteUbo);
    dev.destroy();
  }
}

/** `v mod 32 WU` for a raw coordinate, in WU (always in [0, 32)). */
function mod32WU(raw: number): number {
  const m = raw % 131072;
  return (m < 0 ? m + 131072 : m) / 4096;
}

function isElement(c: RendererCanvas): c is RendererCanvas & Element {
  const El = (globalThis as { Element?: typeof Element }).Element;
  return El !== undefined && c instanceof El;
}

/** Creates the WebGL2 renderer for a canvas (throws if WebGL2 is unavailable). */
export function createRenderer(canvas: RendererCanvas, opts: RendererOptions = {}): Renderer {
  return new RendererImpl(canvas, opts);
}
