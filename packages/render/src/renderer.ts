/**
 * Renderer facade (PLAN §3.7): fixed passes Terrain → Units → Water → Overlay on top of the WebGL2
 * RHI backend.
 *
 * Per frame the caller hands in a {@link RenderView}: the camera, the UnitRecord bytes of the
 * current sim frame (unchanged, 48 B per record), optionally the PartStream, a highlight byte per
 * record, the interpolation alpha, client overlays and the clock. The renderer never allocates in
 * the steady state; unit data are only culled/re-sorted/re-uploaded when `units.version` or the
 * camera changes (or the version is omitted).
 *
 * Terrain (MS2): `setTerrain(desc)` sets the CDLOD heightmap terrain with decals, optional water and
 * the GPU height probe. Every map — the flat test plane included — is such a terrain; until one is
 * set only units and overlays are drawn over the clear color. Presets (`setPreset`) set splat layers, LOD bias, water quality and the render scale used by
 * `resize()`.
 */
import type { RtsCamera } from './camera.ts';
import { Frustum } from './frustum.ts';
import type { MeshData, PlaceholderSpec } from './mesh/placeholder.ts';
import { createPlaceholderLods } from './mesh/placeholder.ts';
import type { Overlays } from './passes/overlay.ts';
import { OverlayPass } from './passes/overlay.ts';
import { HeightProbe } from './passes/probe.ts';
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
import { TerrainHeightResources, TerrainPass } from './passes/terrain.ts';
import { UnitPass } from './passes/units.ts';
import type { UnitPartsView, UnitVisualMeshes } from './passes/units.ts';
import { WaterPass } from './passes/water.ts';
import type { RenderPreset, RenderPresetName } from './presets.ts';
import { RENDER_PRESETS, backbufferSize, resolvePreset } from './presets.ts';
import type { BindGroupH, BufH, GpuDevice, PassDesc } from './rhi/types.ts';
import { Std140Writer } from './std140.ts';
import type { DecalBinStats, TerrainDecal } from './terrain/decals.ts';
import type { TerrainDesc, TerrainLight } from './terrain/heightfield.ts';
import type { DeviceCanvas, WebGL2DeviceOptions } from './webgl2/device.ts';
import { createWebGL2Device } from './webgl2/device.ts';

/** One entry of the visual table (index = `UnitRecord.visual`). */
export interface VisualEntry {
  readonly spec: PlaceholderSpec;
  /** Base color: 0xRRGGBB or linear [r, g, b]; falls back to `spec.color`, then pure team color. */
  readonly color?: number | readonly [number, number, number];
  /** Weight of the base color against the army color (0 = team color only). Default 0.3 with a color. */
  readonly baseWeight?: number;
  /**
   * 1–3 LOD meshes (asset pipeline, merged-part with `partId`s); replace the placeholder LODs of
   * `spec`. Fewer than 3 ⇒ the last mesh is reused for the coarser levels.
   */
  readonly meshes?: readonly MeshData[];
  /** LOD switch distances in WU (camera distance; × preset LOD bias). Default [60, 180]. */
  readonly lodDistancesWU?: readonly [number, number];
}

/** Map-free visual table: `table[visual]`; holes render as a small grey fallback cube. */
export type VisualTable = readonly (VisualEntry | undefined | null)[];

export interface RenderUnits {
  /** UnitRecords, 48 B each (4-byte aligned for the fast path). */
  readonly bytes: Uint8Array;
  readonly count: number;
  /**
   * Content version of `bytes`/`highlight` (e.g. frame seq). Equal version and camera ⇒ no
   * re-cull/sort/upload. Omit to upload every frame.
   */
  readonly version?: number;
}

export interface RenderView {
  readonly camera: RtsCamera;
  readonly units: RenderUnits;
  /** PartStream of the frame (merged-part turret/barrel angles); omitted ⇒ all units rigid. */
  readonly parts?: UnitPartsView;
  /** One byte per record in `units.bytes` order; ≠ 0 ⇒ highlighted (selection). */
  readonly highlight?: Uint8Array;
  /** Content version of `highlight`; omitted ⇒ re-uploaded every frame while `highlight` is set. */
  readonly highlightVersion?: number;
  /** Interpolation factor prev → cur in [0, 1]. */
  readonly alpha: number;
  readonly overlays?: Overlays;
  /** Clock in ms (e.g. `performance.now()`), used for overlay and water animation. */
  readonly timeMs: number;
}

/** Draw calls per fixed pass of the last frame. */
export interface PassDraws {
  terrain: number;
  water: number;
  units: number;
  overlay: number;
}

export interface RenderStats {
  /** Draw calls of the last frame. */
  drawCalls: number;
  drawsByPass: PassDraws;
  /** Instances drawn (all passes). */
  instances: number;
  /** Unit instances drawn after culling. */
  unitInstances: number;
  /** Unit records culled by the frustum test in the last cull. */
  culledInstances: number;
  /** Visible unit instances per LOD level [0, 1, 2]. */
  readonly lodInstances: Uint32Array;
  /** Visible terrain patches (0 without terrain). */
  terrainPatches: number;
  /** Terrain decals uploaded / (decal, chunk) pairs over the per-chunk limit / decals over the cap. */
  decals: number;
  decalChunkOverflow: number;
  decalsDropped: number;
  uploadBytes: number;
  /** Main-thread JS time of the last `render()` call in ms. */
  cpuMs: number;
  /** Latest resolved GPU frame time (EXT_disjoint_timer_query_webgl2), otherwise undefined. */
  gpuMs: number | undefined;
  /** Visuals with at least one visible instance in the last frame. */
  visualsDrawn: number;
  /** Records skipped because their visual is outside the table. */
  droppedUnits: number;
  /** Rendered frames (skipped frames while the context is lost are not counted). */
  frames: number;
  lost: boolean;
  preset: RenderPresetName;
}

export interface RendererCanvas extends DeviceCanvas {
  width: number;
  height: number;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
}

export interface RendererOptions {
  /**
   * Drawing-buffer scale relative to CSS pixels × devicePixelRatio. Default: the preset's render
   * scale (1 without a preset, i.e. MS1 behavior).
   */
  readonly renderScale?: number;
  /** Device pixel ratio override (tests); default `globalThis.devicePixelRatio ?? 1`. */
  readonly pixelRatio?: number;
  /**
   * false ⇒ the renderer never touches `canvas.width/height`; the caller sizes the canvas (e.g. with
   * {@link backbufferSize}). Default true.
   */
  readonly manageCanvasSize?: boolean;
  /** Initial terrain (otherwise none until `setTerrain`). */
  readonly terrain?: TerrainDesc;
  /** Initial preset (default: none set explicitly → 'high' values with render scale from `renderScale`). */
  readonly preset?: RenderPresetName | RenderPreset;
  readonly device?: WebGL2DeviceOptions;
  /** Army colors as 0xRRGGBB (up to 16); default palette otherwise. */
  readonly armyColors?: readonly number[];
  readonly clearColor?: readonly [number, number, number];
}

export interface Renderer {
  readonly device: GpuDevice;
  readonly stats: Readonly<RenderStats>;
  /** Active preset. */
  readonly preset: RenderPreset;
  /** Current terrain (null = none set). */
  readonly terrain: TerrainDesc | null;
  /** Re-reads the canvas CSS size and resizes the drawing buffer; returns true when it changed. */
  resize(): boolean;
  setVisuals(table: VisualTable): void;
  setArmyColors(colors: readonly number[]): void;
  /** Sets (or clears with null) the heightmap terrain incl. water and light. */
  setTerrain(desc: TerrainDesc | null): void;
  /** Terrain decals (rings/discs, ≤ 4,096, ≤ 32 per chunk); kept across `setTerrain`. */
  setTerrainDecals(decals: readonly TerrainDecal[]): DecalBinStats;
  /** GPU heights (raw) at `xzRaw = [x0, z0, …]` via the shared GLSL height function (tests/debug). */
  probeTerrainHeights(xzRaw: Int32Array, out: Int32Array): void;
  setPreset(p: RenderPresetName | RenderPreset): void;
  render(view: RenderView): void;
  dispose(): void;
}

/**
 * Draw calls of the fixed passes that are not per (visual, LOD): terrain, water, waypoint
 * lines, click markers. Draw calls ≤ non-empty (visual, LOD) buckets + FIXED_PASS_DRAWS.
 */
export const FIXED_PASS_DRAWS = 4;

const FALLBACK_SPEC: PlaceholderSpec = { hull: 'box', size: [1, 1, 1] };
const DEFAULT_SUN = normalize3(0.45, 0.8, 0.35);
const DEFAULT_SUN_COLOR: readonly [number, number, number] = [0.85, 0.8, 0.72];
const DEFAULT_SKY: readonly [number, number, number] = [0.42, 0.48, 0.58];
const DEFAULT_GROUND: readonly [number, number, number] = [0.2, 0.18, 0.15];
const NO_DECAL_STATS: DecalBinStats = { decals: 0, droppedDecals: 0, chunkOverflow: 0, listEntries: 0 };

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/**
 * Unit direction towards the sun from the .rtsmap light convention (formats `MapLight`): azimuth
 * in degrees around +y with 0° = sun from +z and 90° = sun from +x, elevation above the horizon
 * (clamped to 1..90°): `(sin az · cos el, sin el, cos az · cos el)`.
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (Math.max(1, Math.min(90, elevationDeg)) * Math.PI) / 180;
  return normalize3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

class RendererImpl implements Renderer {
  readonly device: GpuDevice;
  readonly stats: RenderStats = {
    drawCalls: 0,
    drawsByPass: { terrain: 0, water: 0, units: 0, overlay: 0 },
    instances: 0,
    unitInstances: 0,
    culledInstances: 0,
    lodInstances: new Uint32Array(3),
    terrainPatches: 0,
    decals: 0,
    decalChunkOverflow: 0,
    decalsDropped: 0,
    uploadBytes: 0,
    cpuMs: 0,
    gpuMs: undefined,
    visualsDrawn: 0,
    droppedUnits: 0,
    frames: 0,
    lost: false,
    preset: 'high',
  };
  preset: RenderPreset;
  terrain: TerrainDesc | null = null;

  private readonly frameData = new Std140Writer(FRAME_LAYOUT);
  private readonly paletteData = new Std140Writer(PALETTE_LAYOUT);
  private readonly frameUbo: BufH;
  private readonly paletteUbo: BufH;
  private readonly frameGroup: BindGroupH;
  private readonly paletteGroup: BindGroupH;
  private readonly units: UnitPass;
  private readonly overlay: OverlayPass;
  private terrainRes: TerrainHeightResources | null = null;
  private terrainPass: TerrainPass | null = null;
  private waterPass: WaterPass | null = null;
  private probe: HeightProbe | null = null;
  private decals: readonly TerrainDecal[] = [];
  private decalStats: DecalBinStats = NO_DECAL_STATS;
  private readonly frustum = new Frustum();
  private frustumVersion = -1;
  private readonly passDesc: PassDesc;
  private renderScale: number;
  private readonly explicitScale: boolean;
  private readonly pixelRatio: number | undefined;
  private readonly manageSize: boolean;
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
    this.preset = resolvePreset(opts.preset ?? RENDER_PRESETS.high);
    this.stats.preset = this.preset.name;
    this.explicitScale = opts.renderScale !== undefined;
    this.renderScale = opts.renderScale ?? (opts.preset !== undefined ? this.preset.renderScale : 1);
    this.pixelRatio = opts.pixelRatio;
    this.manageSize = opts.manageCanvasSize !== false;
    const dev = createWebGL2Device(canvas, opts.device ?? {});
    this.device = dev;

    const fd = this.frameData;
    this.writeLight(undefined);
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

    this.units = new UnitPass(dev, this.frameGroup, this.paletteGroup);
    this.units.setLodBias(this.preset.lodBias);
    this.overlay = new OverlayPass(dev, this.frameGroup);

    if (opts.armyColors !== undefined) this.writeArmyColors(opts.armyColors);
    else
      for (let a = 0; a < MAX_ARMY_COLORS; a++) {
        const c = DEFAULT_ARMY_COLORS[a]!;
        this.paletteData.vec4(PALETTE_LAYOUT.offsetOf('army') + a * 16, c[0], c[1], c[2], 1);
      }
    this.setVisuals([]);
    if (opts.terrain !== undefined) this.setTerrain(opts.terrain);

    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO !== undefined && isElement(canvas) && this.manageSize) {
      this.observer = new RO(() => {
        this.sizeDirty = true;
      });
      this.observer.observe(canvas);
    }
    this.resize();
  }

  private writeLight(light: TerrainLight | undefined): void {
    const fd = this.frameData;
    const dir = light === undefined ? DEFAULT_SUN : sunDirection(light.azimuthDeg, light.elevationDeg);
    const sun = light === undefined ? DEFAULT_SUN_COLOR : ([light.sun[0] / 255, light.sun[1] / 255, light.sun[2] / 255] as const);
    const sky = light === undefined ? DEFAULT_SKY : ([light.ambient[0] / 255, light.ambient[1] / 255, light.ambient[2] / 255] as const);
    const ground = light === undefined ? DEFAULT_GROUND : ([sky[0] * 0.45, sky[1] * 0.42, sky[2] * 0.38] as const);
    fd.vec4(FRAME_LAYOUT.offsetOf('sunDir'), dir[0], dir[1], dir[2], 0);
    fd.vec4(FRAME_LAYOUT.offsetOf('sunColor'), sun[0], sun[1], sun[2], 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('skyColor'), sky[0], sky[1], sky[2], 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('groundColor'), ground[0], ground[1], ground[2], 1);
  }

  resize(): boolean {
    this.sizeDirty = false;
    if (!this.manageSize) return false;
    const c = this.canvas;
    const cssW = c.clientWidth ?? c.width;
    const cssH = c.clientHeight ?? c.height;
    const dpr = this.pixelRatio ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const size = backbufferSize(cssW, cssH, dpr, this.renderScale, this.device.caps.maxTextureSize);
    if (c.width === size.width && c.height === size.height) return false;
    c.width = size.width;
    c.height = size.height;
    return true;
  }

  setPreset(p: RenderPresetName | RenderPreset): void {
    const preset = resolvePreset(p);
    this.preset = preset;
    this.stats.preset = preset.name;
    if (!this.explicitScale && this.renderScale !== preset.renderScale) {
      this.renderScale = preset.renderScale;
      this.sizeDirty = true;
    }
    this.units.setLodBias(preset.lodBias);
    this.terrainPass?.setMaxSplatLayers(preset.splatLayers);
    this.terrainPass?.setTriplanar(preset.triplanar);
    this.waterPass?.setQuality(preset.waterQuality);
    if (this.decals.length > preset.caps.decals && this.terrainPass !== null) this.applyDecals();
  }

  setVisuals(table: VisualTable): void {
    if (table.length > MAX_VISUALS) throw new Error(`setVisuals: at most ${MAX_VISUALS} visuals, got ${table.length}`);
    const visuals: UnitVisualMeshes[] = [];
    const base = PALETTE_LAYOUT.offsetOf('visual');
    const pd = this.paletteData;
    for (let v = 0; v < table.length; v++) {
      const e = table[v];
      const spec = e?.spec ?? FALLBACK_SPEC;
      const lods = e?.meshes !== undefined && e.meshes.length > 0 ? e.meshes : createPlaceholderLods(spec);
      visuals.push(e?.lodDistancesWU !== undefined ? { lods, lodDistancesWU: e.lodDistancesWU } : { lods });
      const raw = e?.color ?? spec.color;
      let rgb: readonly [number, number, number] = [0.5, 0.5, 0.5];
      let weight = e === undefined || e === null ? 0.8 : 0;
      if (raw !== undefined) {
        rgb = typeof raw === 'number' ? rgbHex(raw) : raw;
        weight = e?.baseWeight ?? 0.3;
      } else if (e?.baseWeight !== undefined) weight = e.baseWeight;
      pd.vec4(base + v * 16, rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, weight)));
    }
    this.units.setVisualMeshes(visuals);
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

  setTerrain(desc: TerrainDesc | null): void {
    this.releaseTerrain();
    this.terrain = desc;
    this.writeLight(desc?.light);
    this.frustumVersion = -1;
    if (desc === null) {
      this.decalStats = NO_DECAL_STATS;
      return;
    }
    const dev = this.device;
    const res = new TerrainHeightResources(dev, desc);
    this.terrainRes = res;
    this.terrainPass = new TerrainPass(dev, this.frameGroup, res, { maxSplatLayers: this.preset.splatLayers, triplanar: this.preset.triplanar });
    this.waterPass = desc.waterLevelRaw !== null ? new WaterPass(dev, this.frameGroup, res, this.preset.waterQuality) : null;
    this.probe = new HeightProbe(dev, res);
    this.applyDecals();
  }

  private releaseTerrain(): void {
    this.probe?.dispose();
    this.waterPass?.dispose();
    this.terrainPass?.dispose();
    this.terrainRes?.dispose();
    this.probe = null;
    this.waterPass = null;
    this.terrainPass = null;
    this.terrainRes = null;
  }

  setTerrainDecals(decals: readonly TerrainDecal[]): DecalBinStats {
    this.decals = decals;
    return this.applyDecals();
  }

  private applyDecals(): DecalBinStats {
    const tp = this.terrainPass;
    if (tp === null) {
      this.decalStats = NO_DECAL_STATS;
      return this.decalStats;
    }
    const cap = this.preset.caps.decals;
    const list = this.decals.length > cap ? this.decals.slice(0, cap) : this.decals;
    const st = tp.setDecals(list);
    this.decalStats = { ...st, droppedDecals: st.droppedDecals + (this.decals.length - list.length) };
    return this.decalStats;
  }

  probeTerrainHeights(xzRaw: Int32Array, out: Int32Array): void {
    if (this.probe === null) throw new Error('probeTerrainHeights: no terrain set');
    this.probe.probe(xzRaw, out);
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
    if (cam.version !== this.frustumVersion) {
      this.frustum.setFromViewProj(cam.viewProj);
      this.frustumVersion = cam.version;
    }

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

    // ---- CPU prep: patch culling, instance culling/LOD + bucket sort + ring upload, parts, overlays
    const tp = this.terrainPass;
    const patches = tp === null ? 0 : tp.prepare(this.frustum, ci, cam.version);
    const u = view.units;
    this.units.prepareParts(view.parts);
    this.units.prepare(u.bytes, u.count, view.highlight, u.version, view.highlightVersion, this.frustum, ci, cam.camFrac, cam.version);
    this.overlay.prepare(view.overlays ?? this.emptyOverlays, view.timeMs);

    // ---- passes: Terrain → Units → Water → Overlay
    const c = dev.counters;
    const pd = st.drawsByPass;
    const enc = dev.beginPass(this.passDesc);
    let d0 = c.drawCalls;
    tp?.draw(enc);
    pd.terrain = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.units.draw(enc);
    pd.units = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.waterPass?.draw(enc);
    pd.water = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.overlay.draw(enc);
    pd.overlay = c.drawCalls - d0;
    enc.end();
    dev.endFrame();

    const cull = this.units.lastCull;
    st.drawCalls = c.drawCalls;
    st.instances = c.instances;
    st.unitInstances = this.units.buckets.total;
    st.culledInstances = cull.culled;
    st.lodInstances.set(cull.perLod);
    st.terrainPatches = patches;
    st.decals = this.decalStats.decals;
    st.decalChunkOverflow = this.decalStats.chunkOverflow;
    st.decalsDropped = this.decalStats.droppedDecals;
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
    this.releaseTerrain();
    this.overlay.dispose();
    this.units.dispose();
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
