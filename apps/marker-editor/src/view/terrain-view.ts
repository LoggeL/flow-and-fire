/**
 * three.js terrain view of the marker editor (PLAN §3.2: three.js is allowed in tools; the game
 * renderer packages/render is not used here). Renders on demand: every change calls
 * requestRender(), frames are bundled per animation frame.
 */
import type { RtsMap } from '@faf/formats';
import { sampleHeightRaw, type Heightfield } from '@faf/rules';
import * as THREE from 'three';
import { CameraRig } from './camera-rig.ts';
import { buildTerrainGeometry, DEFAULT_MAX_VERTS_PER_SIDE } from './geometry.ts';
import { buildGridPositions } from './grid.ts';
import { sunDirection } from './light.ts';
import { buildWaterGeometry } from './water.ts';

export interface TerrainViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly maxVertsPerSide?: number;
}

export interface TerrainViewStats {
  /** Frames rendered since construction. */
  readonly frames: number;
  /** CPU time of the last render call (ms, performance.now). */
  readonly lastFrameMs: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

/** Clear colour around the map. */
const BACKGROUND = 0x161b22;
/** Light intensities (three.js physical units, tuned by eye against the map strata colours). */
const SUN_INTENSITY = 2.6;
const AMBIENT_INTENSITY = 1.6;

/** Render-order constants shared with overlays: terrain 0, grid 1, water 2, markers ≥ 10. */
export const RENDER_ORDER = { terrain: 0, grid: 1, water: 2, overlay: 10 } as const;

/** `count` unit normals pointing up (+y). */
function upNormals(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) out[i * 3 + 1] = 1;
  return out;
}

export class TerrainView {
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  /** Group holding the map meshes (terrain, water, grid); overlays add their own objects to `scene`. */
  readonly mapGroup = new THREE.Group();
  private readonly maxVertsPerSide: number;
  private currentMap: RtsMap | null = null;
  private hf: Heightfield | null = null;
  private terrain: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null = null;
  private water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> | null = null;
  private grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private gridVisible = true;
  private readonly sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  private readonly ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  private readonly beforeRender: (() => void)[] = [];
  private raf = 0;
  private frames = 0;
  private lastFrameMs = 0;
  private triangles = 0;
  private drawCalls = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(opts: TerrainViewOptions) {
    this.canvas = opts.canvas;
    this.maxVertsPerSide = opts.maxVertsPerSide ?? DEFAULT_MAX_VERTS_PER_SIDE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(BACKGROUND, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 10_000);
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.add(this.mapGroup, this.ambient, this.sun, this.sun.target);
    this.rig = new CameraRig(this.camera, this.canvas, {
      heightAt: (x, z) => (this.hf === null ? 0 : this.heightWuAt(x, z)),
      onChange: () => this.requestRender(),
    });
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(this.canvas);
    this.resize();
  }

  get map(): RtsMap | null {
    return this.currentMap;
  }

  /** Builds terrain, water and grid for `map`, sets the map light and fits the camera. */
  setMap(map: RtsMap): void {
    this.clearMapMeshes();
    this.currentMap = map;
    this.hf = { sizeWu: map.meta.sizeWu, dim: map.meta.sizeWu + 1, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
    const size = map.meta.sizeWu;

    const t = buildTerrainGeometry(map, this.maxVertsPerSide);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(t.colors, 3));
    tg.setIndex(new THREE.BufferAttribute(t.indices, 1));
    tg.computeBoundingBox();
    tg.computeBoundingSphere();
    const tm = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.terrain = new THREE.Mesh(tg, tm);
    this.terrain.name = 'terrain';
    this.terrain.renderOrder = RENDER_ORDER.terrain;
    this.mapGroup.add(this.terrain);

    const w = buildWaterGeometry(map);
    if (w !== null) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(upNormals(w.positions.length / 3), 3));
      wg.setAttribute('color', new THREE.BufferAttribute(w.colors, 4));
      wg.setIndex(new THREE.BufferAttribute(w.indices, 1));
      wg.computeBoundingSphere();
      const wm = new THREE.MeshPhongMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        // Low, tight highlight: a broad Phong lobe washes large calm water planes out to white.
        shininess: 160,
        specular: new THREE.Color(0.05, 0.06, 0.07),
      });
      this.water = new THREE.Mesh(wg, wm);
      this.water.name = 'water';
      this.water.renderOrder = RENDER_ORDER.water;
      this.mapGroup.add(this.water);
    }

    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(buildGridPositions(map), 3));
    gg.computeBoundingSphere();
    const gm = new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.28, depthWrite: false });
    this.grid = new THREE.LineSegments(gg, gm);
    this.grid.name = 'chunk-grid';
    this.grid.renderOrder = RENDER_ORDER.grid;
    this.grid.visible = this.gridVisible;
    this.mapGroup.add(this.grid);

    const L = map.meta.light;
    const d = sunDirection(L);
    const c = size / 2;
    this.sun.color.setRGB(L.sun[0] / 255, L.sun[1] / 255, L.sun[2] / 255, THREE.SRGBColorSpace);
    this.sun.position.set(c + d[0] * size, d[1] * size, c + d[2] * size);
    this.sun.target.position.set(c, 0, c);
    this.sun.target.updateMatrixWorld();
    this.ambient.color.setRGB(L.ambient[0] / 255, L.ambient[1] / 255, L.ambient[2] / 255, THREE.SRGBColorSpace);

    this.rig.setBounds(size);
    this.fitCamera();
  }

  /** Terrain height (WU) at a world position (WU), via @faf/rules sampleHeightRaw (clamped to the map). */
  heightWuAt(xWu: number, zWu: number): number {
    const hf = this.hf;
    if (hf === null) return 0;
    return sampleHeightRaw(hf, Math.round(xWu * 4096), Math.round(zWu * 4096)) / 4096;
  }

  /** Schedules one render on the next animation frame (several requests share one frame). */
  requestRender(): void {
    if (this.raf !== 0 || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Registers a callback run before every render; returns the unsubscribe function. */
  onBeforeRender(cb: () => void): () => void {
    this.beforeRender.push(cb);
    return () => {
      const i = this.beforeRender.indexOf(cb);
      if (i >= 0) this.beforeRender.splice(i, 1);
    };
  }

  setGridVisible(v: boolean): void {
    this.gridVisible = v;
    if (this.grid !== null) this.grid.visible = v;
    this.requestRender();
  }

  get gridIsVisible(): boolean {
    return this.gridVisible;
  }

  /** Overview of the whole map (north = z 0 at the top). */
  fitCamera(): void {
    const size = this.currentMap?.meta.sizeWu ?? 512;
    const aspect = Math.max(0.2, this.camera.aspect);
    const halfFov = (this.camera.fov * Math.PI) / 360;
    const pitch = (62 * Math.PI) / 180;
    // Fit the map's half-diagonal-ish extent vertically; narrow viewports need more distance.
    const fit = (size * 0.7) / Math.tan(halfFov);
    const distance = aspect >= 1 ? fit : fit / aspect;
    this.rig.setPose({ targetX: size / 2, targetZ: size / 2, distance, yaw: 0, pitch });
  }

  /** Centres the view on (xWu, zWu) and zooms in to a working distance. */
  focus(xWu: number, zWu: number): void {
    const size = this.currentMap?.meta.sizeWu ?? 512;
    const working = Math.max(48, size * 0.18);
    this.rig.setPose({ targetX: xWu, targetZ: zWu, distance: Math.min(this.rig.distance, working) });
  }

  /** Matches the drawing buffer and the camera aspect to the canvas' CSS size. */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  stats(): TerrainViewStats {
    return { frames: this.frames, lastFrameMs: this.lastFrameMs, triangles: this.triangles, drawCalls: this.drawCalls };
  }

  /** Renders synchronously now (tests, screenshots); a pending animation-frame render is kept. */
  renderNow(): void {
    if (this.disposed) return;
    for (const cb of this.beforeRender.slice()) cb();
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.lastFrameMs = performance.now() - t0;
    const info = this.renderer.info.render;
    this.triangles = info.triangles;
    this.drawCalls = info.calls;
    this.frames++;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.rig.dispose();
    this.clearMapMeshes();
    this.beforeRender.length = 0;
    this.renderer.dispose();
  }

  private readonly frame = (): void => {
    this.raf = 0;
    this.renderNow();
  };

  private clearMapMeshes(): void {
    for (const o of [this.terrain, this.water, this.grid]) {
      if (o === null) continue;
      this.mapGroup.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    this.terrain = null;
    this.water = null;
    this.grid = null;
  }
}
