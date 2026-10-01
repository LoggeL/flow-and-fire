/**
 * The two renderers the benchmark drives with the same scene, camera flight and measurement loop:
 *
 * - {@link FacadeBench} (`ms2`): the game's `createRenderer` facade from @faf/render as the client
 *   uses it (terrain + water + spot decals + units, Medium preset) – the MS2 acceptance flight.
 * - {@link PrototypeBench} (`full`, `fallback`): the SPK4 pipeline composed from the exported render
 *   building blocks (TerrainHeightResources, WaterPass, UnitPass with merged-part/culling/LOD, the GLSL
 *   modules) plus the prototype passes in `proto/` (terrain with CSM, props, CSM, blob shadows,
 *   impostors, HDR post). Pass order: shadow static (on cache refresh) → shadow units → scene
 *   (terrain, props, units, blob shadows, impostors, water) into RGBA16F → bloom → composite → FXAA.
 *
 * Both hide EXT_disjoint_timer_query_webgl2 from the RHI device (see gpu-timer.ts) so the benchmark's
 * own per-frame timer can wrap the whole frame.
 */
import {
  DEFAULT_ARMY_COLORS,
  FRAME_LAYOUT,
  Frustum,
  MAX_ARMY_COLORS,
  PALETTE_LAYOUT,
  SLOT_FRAME,
  SLOT_PALETTE,
  Std140Writer,
  TerrainHeightResources,
  UnitPass,
  WaterPass,
  createRenderer,
  createWebGL2Device,
  meshBoundingRadius,
  rgbHex,
  sunDirection,
} from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, Renderer, RtsCamera, TerrainDesc } from '@faf/render';
import { UNIT_VARIANTS, propMeshes, unitVariantLods, unitVisualTable } from './meshes.ts';
import { PropGrid } from './prop-grid.ts';
import { BlobShadowPass } from './proto/blob.ts';
import { ImpostorPass } from './proto/impostor.ts';
import { PostChain } from './proto/post.ts';
import { PropMeshBuffers, PropPass } from './proto/props.ts';
import { CsmShadows } from './proto/shadows.ts';
import { BenchTerrainPass, TerrainPatchMesh } from './proto/terrain.ts';
import type { ScenarioConfig } from './scenarios.ts';
import { terrainDesc } from './scene.ts';
import type { BenchScene } from './scene.ts';

export const CLEAR_COLOR: readonly [number, number, number] = [0.52, 0.6, 0.68];

/** Draw calls per pass group of the last frame. */
export interface PassDrawStats {
  shadowStatic: number;
  shadowUnits: number;
  terrain: number;
  props: number;
  units: number;
  blob: number;
  impostors: number;
  water: number;
  post: number;
  overlay: number;
}

export interface BenchFrameStats {
  draws: number;
  readonly byPass: PassDrawStats;
  /** Unit instances drawn (main pass). */
  unitInstances: number;
  /** Prop instances drawn as meshes / as impostors. */
  propInstances: number;
  impostorInstances: number;
  terrainPatches: number;
  /** Cumulative CSM cache refreshes. */
  shadowRefreshes: number;
  /** Unit instances drawn into the shadow maps (all cascades). */
  casterUnits: number;
}

export interface BenchRenderer {
  readonly device: GpuDevice;
  readonly stats: BenchFrameStats;
  /** Human-readable facts for the report (formats, targets, fallbacks). */
  readonly info: Record<string, string | number | boolean>;
  /**
   * Renders one frame. `phase(k)` is called when GPU segment k starts (1 = scene pass, 2 = post);
   * segment 0 (uploads + shadows) is opened by the caller before the call.
   */
  render(camera: RtsCamera, alpha: number, timeMs: number, phase?: (segment: number) => void): void;
  /** GPU segments per frame (1 for the facade, 3 for the prototype). */
  readonly segments: number;
  dispose(): void;
}

function emptyStats(): BenchFrameStats {
  return {
    draws: 0,
    byPass: { shadowStatic: 0, shadowUnits: 0, terrain: 0, props: 0, units: 0, blob: 0, impostors: 0, water: 0, post: 0, overlay: 0 },
    unitInstances: 0,
    propInstances: 0,
    impostorInstances: 0,
    terrainPatches: 0,
    shadowRefreshes: 0,
    casterUnits: 0,
  };
}

// -------------------------------------------------------------------------------------------------
// ms2: the game's renderer facade
// -------------------------------------------------------------------------------------------------

export class FacadeBench implements BenchRenderer {
  readonly device: GpuDevice;
  readonly segments = 1;
  readonly stats = emptyStats();
  readonly info: Record<string, string | number | boolean>;
  private readonly renderer: Renderer;

  constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private readonly scene: BenchScene,
    cfg: ScenarioConfig,
  ) {
    const desc = terrainDesc(scene.map, 0);
    this.renderer = createRenderer(canvas, {
      preset: cfg.preset,
      manageCanvasSize: false,
      device: { context: gl },
      terrain: desc,
      clearColor: CLEAR_COLOR,
    });
    this.renderer.setTerrainDecals(scene.decals);
    this.renderer.setVisuals(unitVisualTable());
    this.device = this.renderer.device;
    this.info = { pipeline: 'facade (@faf/render createRenderer)', preset: cfg.preset.name, sceneFormat: 'canvas rgba8', splatLayers: 0 };
  }

  render(camera: RtsCamera, alpha: number, timeMs: number): void {
    const u = this.scene.units;
    this.renderer.render({
      camera,
      units: { bytes: u.writer.bytes, count: u.count, version: u.version },
      parts: u.partStream,
      alpha,
      timeMs,
    });
    const rs = this.renderer.stats;
    const st = this.stats;
    st.draws = rs.drawCalls;
    st.byPass.terrain = rs.drawsByPass.terrain;
    st.byPass.water = rs.drawsByPass.water;
    st.byPass.units = rs.drawsByPass.units;
    // MS3: the strategic IconPass (1 draw at far zoom) is reported with the overlay column.
    st.byPass.overlay = rs.drawsByPass.overlay + rs.drawsByPass.icons;
    st.unitInstances = rs.unitInstances;
    st.terrainPatches = rs.terrainPatches;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// -------------------------------------------------------------------------------------------------
// full / fallback: the SPK4 prototype pipeline
// -------------------------------------------------------------------------------------------------

export class PrototypeBench implements BenchRenderer {
  readonly device: GpuDevice;
  readonly segments = 3;
  readonly stats = emptyStats();
  readonly info: Record<string, string | number | boolean>;
  private readonly frameData = new Std140Writer(FRAME_LAYOUT);
  private readonly paletteData = new Std140Writer(PALETTE_LAYOUT);
  private readonly frameUbo: BufH;
  private readonly paletteUbo: BufH;
  private readonly frameGroup: BindGroupH;
  private readonly paletteGroup: BindGroupH;
  private readonly heights: TerrainHeightResources;
  private readonly patch: TerrainPatchMesh;
  private readonly terrain: BenchTerrainPass;
  private readonly units: UnitPass;
  private readonly water: WaterPass | null;
  private readonly propMeshes: PropMeshBuffers | null;
  private readonly props: PropPass | null;
  private readonly impostors: ImpostorPass | null;
  private readonly csm: CsmShadows | null;
  private readonly blob: BlobShadowPass | null;
  private readonly post: PostChain;
  private readonly frustum = new Frustum();
  private frustumVersion = -1;
  private readonly lodBias: number;
  private readonly offViewProj = FRAME_LAYOUT.offsetOf('viewProj');
  private readonly offCamPosInt = FRAME_LAYOUT.offsetOf('camPosInt');
  private readonly offCamFrac = FRAME_LAYOUT.offsetOf('camFrac');
  private readonly offCamMod = FRAME_LAYOUT.offsetOf('camMod');
  private readonly offFog = FRAME_LAYOUT.offsetOf('fog');
  private readonly offViewport = FRAME_LAYOUT.offsetOf('viewport');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private readonly scene: BenchScene,
    cfg: ScenarioConfig,
  ) {
    const dev = createWebGL2Device(canvas, { context: gl });
    this.device = dev;
    const preset = cfg.preset;
    this.lodBias = preset.lodBias;
    const desc: TerrainDesc = terrainDesc(scene.map, cfg.splatLayers, scene.splat);

    // ---- shared uniforms: frame (camera, light, fog) and palette (army + visual colors)
    const light = desc.light;
    const sun = light === undefined ? [0.45, 0.8, 0.35] : sunDirection(light.azimuthDeg, light.elevationDeg);
    const hdrSun = cfg.hdr && dev.caps.colorBufferFloat ? 1.35 : 1;
    const fd = this.frameData;
    fd.vec4(FRAME_LAYOUT.offsetOf('sunDir'), sun[0]!, sun[1]!, sun[2]!, 0);
    const sc = light?.sun ?? [217, 204, 184];
    const am = light?.ambient ?? [107, 122, 148];
    fd.vec4(FRAME_LAYOUT.offsetOf('sunColor'), (sc[0] / 255) * hdrSun, (sc[1] / 255) * hdrSun, (sc[2] / 255) * hdrSun, 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('skyColor'), am[0] / 255, am[1] / 255, am[2] / 255, 1);
    fd.vec4(FRAME_LAYOUT.offsetOf('groundColor'), (am[0] / 255) * 0.45, (am[1] / 255) * 0.42, (am[2] / 255) * 0.38, 1);
    fd.vec4(this.offFog, CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], 400);
    this.frameUbo = dev.createBuffer({ label: 'bench.frame.ubo', usage: 'uniform', size: FRAME_LAYOUT.size, dynamic: true, restore: (h) => dev.writeBuffer(h, 0, fd.bytes) });
    const pd = this.paletteData;
    for (let a = 0; a < MAX_ARMY_COLORS; a++) {
      const c = DEFAULT_ARMY_COLORS[a]!;
      pd.vec4(PALETTE_LAYOUT.offsetOf('army') + a * 16, c[0], c[1], c[2], 1);
    }
    UNIT_VARIANTS.forEach((v, i) => {
      const c = rgbHex(v.color);
      pd.vec4(PALETTE_LAYOUT.offsetOf('visual') + i * 16, c[0], c[1], c[2], 0.35);
    });
    this.paletteUbo = dev.createBuffer({ label: 'bench.palette.ubo', usage: 'uniform', size: PALETTE_LAYOUT.size, restore: (h) => dev.writeBuffer(h, 0, pd.bytes) });
    dev.writeBuffer(this.paletteUbo, 0, pd.bytes);
    this.frameGroup = dev.createBindGroup({ label: 'bench.frame', buffers: [{ slot: SLOT_FRAME, buffer: this.frameUbo }] });
    this.paletteGroup = dev.createBindGroup({ label: 'bench.palette', buffers: [{ slot: SLOT_PALETTE, buffer: this.paletteUbo }] });

    // ---- terrain + height resources (shared by terrain, water, blob, casters)
    this.heights = new TerrainHeightResources(dev, desc);
    this.patch = new TerrainPatchMesh(dev);

    // ---- props
    this.propMeshes = cfg.props ? new PropMeshBuffers(dev, propMeshes()) : null;
    const grid = this.propMeshes !== null ? new PropGrid(scene.props, desc.sizeWu, this.propMeshes.heights, this.propMeshes.radii) : null;

    // ---- units (the real UnitPass) and the caster view of the same visuals
    const lods = UNIT_VARIANTS.map((v) => unitVariantLods(v));
    const radii = lods.map((l) => Math.max(...l.map((m) => meshBoundingRadius(m))));
    this.units = new UnitPass(dev, this.frameGroup, this.paletteGroup);
    this.units.setVisualMeshes(UNIT_VARIANTS.map((v, i) => ({ lods: lods[i]!, lodDistancesWU: v.lod })));
    this.units.setLodBias(preset.lodBias);

    // ---- shadows
    const b = this.heights.bounds;
    this.csm =
      cfg.shadows === 'csm'
        ? new CsmShadows(
            dev,
            this.heights,
            this.patch,
            this.propMeshes,
            grid,
            UNIT_VARIANTS.map((v, i) => ({ lods: lods[i]!, radius: radii[i]!, lodDistancesWU: v.lod })),
            scene.units.count,
            { size: cfg.shadowMapSize, cascades: cfg.cascades, sunDir: sun, minHeightWU: b.mapMinRaw / 4096, maxHeightWU: b.mapMaxRaw / 4096, strength: 0.72 },
          )
        : null;
    this.blob = cfg.shadows === 'blob' ? new BlobShadowPass(dev, this.frameGroup, this.heights, radii.map((r) => r * 0.62), scene.units.count) : null;

    const recv = this.csm?.recvGroup ?? null;
    this.terrain = new BenchTerrainPass(dev, this.frameGroup, this.heights, this.patch, recv, { splatLayers: cfg.splatLayers, csm: this.csm !== null, decalGlow: hdrSun > 1 ? 1 : 0 });
    this.terrain.setDecals(scene.decals);
    this.props =
      this.propMeshes !== null && grid !== null
        ? new PropPass(dev, this.frameGroup, grid, this.propMeshes, recv, { csm: this.csm !== null, lod0DistanceWU: cfg.propLodDistanceWU, impostorDistanceWU: cfg.impostorDistanceWU })
        : null;
    this.props?.setLodBias(preset.lodBias);
    this.impostors = this.props !== null && this.propMeshes !== null && Number.isFinite(cfg.impostorDistanceWU) ? new ImpostorPass(dev, this.frameGroup, this.propMeshes, this.props) : null;
    this.water = desc.waterLevelRaw !== null ? new WaterPass(dev, this.frameGroup, this.heights, preset.waterQuality) : null;

    // ---- post
    this.post = new PostChain(dev, { hdr: cfg.hdr, bloom: cfg.bloom, bloomLevels: cfg.bloomLevels, fxaa: cfg.fxaa, exposure: 1.1, bloomIntensity: 0.55, bloomThreshold: 0.9 }, CLEAR_COLOR);
    this.post.resize(canvas.width, canvas.height);

    this.info = {
      pipeline: 'SPK4 prototype',
      preset: preset.name,
      sceneFormat: this.post.sceneFormat,
      hdr: this.post.hdrActive,
      ldrFallback: cfg.hdr && !this.post.hdrActive,
      splatLayers: cfg.splatLayers,
      shadows: cfg.shadows,
      shadowMapSize: cfg.shadowMapSize,
      cascades: cfg.cascades,
      props: scene.props.count,
      impostorDistanceWU: Number.isFinite(cfg.impostorDistanceWU) ? cfg.impostorDistanceWU : 'none',
      bloomLevels: cfg.bloom ? cfg.bloomLevels : 0,
      fxaa: cfg.fxaa,
      multiDraw: dev.caps.multiDraw,
    };
  }

  render(camera: RtsCamera, alpha: number, timeMs: number, phase?: (segment: number) => void): void {
    const dev = this.device;
    const st = this.stats;
    const bp = st.byPass;
    const c = dev.counters;
    if (dev.isLost()) {
      st.draws = 0;
      return;
    }
    camera.update();
    if (camera.version !== this.frustumVersion) {
      this.frustum.setFromViewProj(camera.viewProj);
      this.frustumVersion = camera.version;
    }
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

    // ---- frame uniforms
    const fd = this.frameData;
    const ci = camera.camPosInt;
    fd.mat4(this.offViewProj, camera.viewProj32);
    fd.ivec4(this.offCamPosInt, ci[0]!, ci[1]!, ci[2]!, 0);
    fd.vec4(this.offCamFrac, camera.camFrac[0]!, camera.camFrac[1]!, camera.camFrac[2]!, a);
    fd.vec4(this.offCamMod, mod32WU(ci[0]!), mod32WU(ci[1]!), mod32WU(ci[2]!), (timeMs / 1000) % 3600);
    fd.float(this.offFog + 12, Math.max(250, camera.distance * 3));
    const bw = this.canvas.width;
    const bh = this.canvas.height;
    fd.vec4(this.offViewport, bw, bh, 1 / bw, 1 / bh);
    dev.beginFrame();
    dev.writeBuffer(this.frameUbo, 0, fd.bytes);

    // ---- CPU: culling, LOD, sorting, uploads
    const u = this.scene.units;
    st.terrainPatches = this.terrain.prepare(this.frustum, ci, camera.version);
    this.units.prepareParts(u.partStream);
    this.units.prepare(u.writer.bytes, u.count, undefined, u.version, undefined, this.frustum, ci, camera.camFrac, camera.version);
    this.props?.prepare(this.frustum, ci, camera.camFrac, camera.version);
    this.blob?.prepare(u.writer.bytes, u.count, u.version);
    this.csm?.prepare(camera, { bytes: u.writer.bytes, count: u.count, version: u.version }, u.partStream, this.lodBias, a);

    // ---- GPU
    let d0 = c.drawCalls;
    this.csm?.renderStatic();
    bp.shadowStatic = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.csm?.renderDynamic();
    bp.shadowUnits = c.drawCalls - d0;

    phase?.(1);
    const enc = dev.beginPass(this.post.scenePass);
    d0 = c.drawCalls;
    this.terrain.draw(enc);
    bp.terrain = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.props?.draw(enc);
    bp.props = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.units.draw(enc);
    bp.units = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.blob?.draw(enc);
    bp.blob = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.impostors?.draw(enc);
    bp.impostors = c.drawCalls - d0;
    d0 = c.drawCalls;
    this.water?.draw(enc);
    bp.water = c.drawCalls - d0;
    enc.end();
    phase?.(2);
    d0 = c.drawCalls;
    this.post.run();
    bp.post = c.drawCalls - d0;
    dev.endFrame();

    st.draws = c.drawCalls;
    st.unitInstances = this.units.buckets.total;
    st.propInstances = this.props?.meshInstances() ?? 0;
    st.impostorInstances = this.impostors?.instances() ?? 0;
    st.shadowRefreshes = this.csm?.stats.refreshes ?? 0;
    st.casterUnits = this.csm?.stats.casterUnits ?? 0;
  }

  dispose(): void {
    this.post.dispose();
    this.water?.dispose();
    this.impostors?.dispose();
    this.props?.dispose();
    this.blob?.dispose();
    this.csm?.dispose();
    this.terrain.dispose();
    this.units.dispose();
    this.propMeshes?.dispose();
    this.patch.dispose();
    this.heights.dispose();
    const dev = this.device;
    dev.destroyBindGroup(this.frameGroup);
    dev.destroyBindGroup(this.paletteGroup);
    dev.destroyBuffer(this.frameUbo);
    dev.destroyBuffer(this.paletteUbo);
    dev.destroy();
  }
}

/** `v mod 32 WU` of a raw coordinate, in WU (same as the renderer facade). */
function mod32WU(raw: number): number {
  const m = raw % 131072;
  return (m < 0 ? m + 131072 : m) / 4096;
}
