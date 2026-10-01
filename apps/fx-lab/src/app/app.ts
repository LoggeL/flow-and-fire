/**
 * The fx-lab application: device, post chain, CSM, ground/props/units, scene simulation, GPU segment
 * timer, samples, HUD and the `window.__fxlab` hooks.
 *
 * Frame (PLAN §3.7 pass order):
 * 1. fixed-step scene logic (LabSimulation: scene.update, scorch expiry, LabFx.update per 60 Hz step),
 * 2. camera (preset + mouse + flight + shake) and FxFrameUniforms at the scene time (never wall clock),
 * 3. segment `shadow`: CascadedShadows.update, renderStatic (ground + props, only dirty cascades),
 *    renderDynamic (units, reduced geometry),
 * 4. segment `opaque`: PostChain.beginScene → ground, props, units,
 * 5. segments `shields`, `particles`, `beams`: LabFx.encode* in the same scene pass (skipped with fx=0),
 * 6. segment `post`: PostChain.resolve (bloom, ACES, FXAA → canvas).
 * Draws per segment come from dev.counters, GPU times from GpuSpanTimer (EXT_disjoint_timer_query_webgl2).
 */
import { RENDER_PRESETS, RtsCamera, backbufferSize, createWebGL2Device } from '@faf/render';
import type { BindGroupH, RenderPreset, RenderPresetName, WebGL2Device } from '@faf/render';
import {
  CascadedShadows,
  FxFrameUniforms,
  GpuSpanTimer,
  NullShadowReceiver,
  PostChain,
  fxSharedBufferBindings,
  hideTimerQueryFromDevice,
  postOptionsForPreset,
} from '@faf/render-fx';
import type { ShadowCasterFn } from '@faf/render-fx';
import { LabCameraRig } from './camera-rig.ts';
import { LAB_WORLD_WU } from './context.ts';
import type { LabParams, LabScene, SceneName } from './context.ts';
import { GroundPass, ScorchTextures, labGroundHeight } from './ground.ts';
import { LAB_CLEAR, LAB_LIGHT, LAB_SUN } from './glsl.ts';
import { LAB_SEGMENTS, SampleRing } from './hooks.ts';
import type { FxLabHooks, FxLabStats, SegmentRecord } from './hooks.ts';
import { LabHud } from './hud.ts';
import type { LabToggle } from './hud.ts';
import { labParamsToSearch } from './params.ts';
import { PropsPass } from './props.ts';
import { LabSimulation } from './sim.ts';
import type { FxFactory } from './sim.ts';
import { UnitPass } from './unit-pass.ts';
import { LabUnitList } from './units.ts';

const SEG_SHADOW = 0;
const SEG_OPAQUE = 1;
const SEG_SHIELDS = 2;
const SEG_PARTICLES = 3;
const SEG_BEAMS = 4;
const SEG_POST = 5;

/** Largest scene-time delta written into FxView.u_fxTime.y (s). */
const MAX_FX_DT_S = 0.25;

export interface LabAppOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element that receives the HUD (usually document.body). */
  readonly container: HTMLElement;
  readonly params: LabParams;
  /** The `window.__fxlab` object (already installed); the app fills in state and functions. */
  readonly hooks: FxLabHooks;
  readonly scenes: Readonly<Record<SceneName, (() => LabScene) | undefined>>;
  readonly createFx: FxFactory;
}

function zeroSegments(): SegmentRecord<number> {
  return { shadow: 0, opaque: 0, shields: 0, particles: 0, beams: 0, post: 0 };
}

export class LabApp {
  readonly dev: WebGL2Device;
  readonly preset: RenderPreset;
  readonly camera: RtsCamera;
  readonly frame: FxFrameUniforms;
  readonly units: LabUnitList;
  readonly post: PostChain;
  readonly csm: CascadedShadows;
  readonly sim: LabSimulation;
  readonly samples = new SampleRing();
  private readonly params: LabParams;
  private readonly hooks: FxLabHooks;
  private readonly canvas: HTMLCanvasElement;
  private readonly timer: GpuSpanTimer;
  private readonly nullRecv: NullShadowReceiver;
  private readonly ground: GroundPass;
  private readonly props: PropsPass;
  private readonly unitPass: UnitPass;
  private readonly scorchTex: ScorchTextures;
  private readonly sharedGroup: BindGroupH;
  private readonly csmGroup: BindGroupH;
  private readonly nullGroup: BindGroupH;
  private readonly rig: LabCameraRig;
  private readonly hud: LabHud | null;
  private readonly scenes: Readonly<Record<SceneName, (() => LabScene) | undefined>>;

  private running = true;
  private rafId = 0;
  private lastNow = -1;
  private lastRenderTime = 0;
  private readyPending = false;
  private checkErrorsPending = false;
  private pendingScene: SceneName | null = null;
  private maxTextureSize = 4096;
  private cssW = 0;
  private cssH = 0;
  private dpr = 0;
  private bw = 1;
  private bh = 1;
  private lastDraws = 0;
  private readonly drawsBySeg = zeroSegments();
  private readonly gpuLatest: SegmentRecord<number | null> = { shadow: null, opaque: null, shields: null, particles: null, beams: null, post: null };
  private shakeActive = false;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(o: LabAppOptions) {
    this.params = o.params;
    this.hooks = o.hooks;
    this.canvas = o.canvas;
    this.scenes = o.scenes;
    this.preset = RENDER_PRESETS[o.params.preset];
    const factory = o.scenes[o.params.scene];
    if (factory === undefined) throw new Error(`scene '${o.params.scene}' is not registered`);

    const gl = o.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      // Screenshots/pixel reads need the buffer (not in benchmark runs, which cost a copy otherwise).
      preserveDrawingBuffer: !o.params.bench || o.params.freeze !== null,
      powerPreference: 'high-performance',
    });
    if (gl === null) throw new Error('WebGL2 is not available');
    const timerExt = hideTimerQueryFromDevice(gl);
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.measureCanvas(true);
    const dev = createWebGL2Device(o.canvas, { context: gl });
    this.dev = dev;
    this.timer = new GpuSpanTimer(gl, timerExt, LAB_SEGMENTS);

    this.camera = new RtsCamera({ maxDistance: 900, minDistance: 8 });
    this.camera.setViewport(this.cssW, this.cssH);
    this.frame = new FxFrameUniforms(dev);
    this.units = new LabUnitList(dev, labGroundHeight);
    this.post = new PostChain(dev, { ...postOptionsForPreset(this.preset), hdr: o.params.hdr, bloom: o.params.bloom, fxaa: o.params.fxaa });
    this.post.resize(this.bw, this.bh);
    this.csm = new CascadedShadows(dev, {
      size: this.preset.name === 'low' ? 1024 : 2048,
      cascades: 2,
      worldMin: [0, -4, 0],
      worldMax: [LAB_WORLD_WU, 48, LAB_WORLD_WU],
    });
    this.nullRecv = new NullShadowReceiver(dev);
    const hdr = this.post.hdrActive;
    this.ground = new GroundPass(dev, hdr);
    this.props = new PropsPass(dev, hdr);
    this.unitPass = new UnitPass(dev, this.units, hdr);
    this.sharedGroup = dev.createBindGroup({ label: 'lab.shared', buffers: fxSharedBufferBindings(this.frame.bindings) });
    const rc = this.csm.receiverBindings();
    this.csmGroup = dev.createBindGroup({ label: 'lab.recv.csm', buffers: rc.buffers, textures: rc.textures });
    const rn = this.nullRecv.receiverBindings();
    this.nullGroup = dev.createBindGroup({ label: 'lab.recv.null', buffers: rn.buffers, textures: rn.textures });

    this.sim = new LabSimulation(
      { dev, camera: this.camera, frame: this.frame, preset: this.preset, params: o.params, units: this.units },
      factory,
      o.createFx,
    );
    this.scorchTex = new ScorchTextures(dev, this.sim.ctx.scorch);
    this.rig = new LabCameraRig(this.sim.scene.camera);

    this.unsubscribe.push(
      dev.onLost(() => {
        this.timer.reset();
      }),
      dev.onRestored(() => {
        this.timer.reset();
        this.csm.invalidateStatic();
        this.hooks.restoreCount++;
        this.checkErrorsPending = true;
      }),
    );

    this.hud = o.params.bench
      ? null
      : new LabHud(o.container, o.params, (n) => o.scenes[n] !== undefined, {
          setScene: (n) => this.requestScene(n),
          setPreset: (p) => this.reloadWith({ preset: p }),
          setToggle: (t, on) => this.setToggle(t, on),
          bigExplosion: () => this.triggerBig(),
          loseContext: () => this.loseAndAutoRestore(),
        });
    if (!o.params.bench) this.rig.attach(o.canvas, this.camera);
    this.installHooks();
    this.rafId = requestAnimationFrame(this.tick);
  }

  // -----------------------------------------------------------------------------------------------
  // Hooks

  private installHooks(): void {
    const h = this.hooks;
    h.ready = false;
    h.frame = 0;
    h.scene = this.sim.sceneName;
    h.preset = this.preset.name;
    h.error = null;
    h.restoreCount = 0;
    h.stats = () => this.stats();
    h.samples = () => this.samples.toArray();
    h.resetSamples = () => this.samples.reset();
    h.setScene = (name) => {
      if (this.scenes[name] === undefined) throw new Error(`scene '${String(name)}' is not available`);
      this.requestScene(name);
    };
    h.loseContext = () => (this.dev.isLost() ? false : this.dev.debugLoseContext());
    h.restoreContext = () => (this.dev.isLost() ? this.dev.debugRestoreContext() : false);
    h.triggerBigExplosion = () => this.triggerBig();
  }

  stats(): FxLabStats {
    const ctx = this.sim.ctx;
    const scene = this.sim.scene.stats?.() ?? {};
    const cs = this.csm.stats;
    const ps = this.post.stats;
    return {
      draws: this.lastDraws,
      drawsBySeg: { ...this.drawsBySeg },
      fx: ctx.fx.stats(),
      scene: { ...scene },
      units: this.units.count,
      decals: { count: ctx.scorch.count, cap: ctx.scorch.cap },
      csm: { enabled: this.params.csm, staticRefreshes: cs.staticRefreshes, staticDraws: cs.staticDraws, dynamicDraws: cs.dynamicDraws },
      post: { hdr: this.post.hdrActive, bloom: ps.bloomLevels > 0, levels: ps.bloomLevels, fxaa: ps.fxaa },
      shakeActive: this.shakeActive,
      gpuTimer: this.timer.available,
      canvas: [this.bw, this.bh],
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Controls

  private requestScene(name: SceneName): void {
    if (this.scenes[name] === undefined) return;
    this.pendingScene = name;
  }

  private switchScene(name: SceneName): void {
    const factory = this.scenes[name];
    if (factory === undefined) return;
    this.sim.switchScene(factory);
    this.scorchTex.setScorch(this.sim.ctx.scorch);
    this.rig.setPreset(this.sim.scene.camera);
    this.params.scene = name;
    this.hooks.scene = name;
    this.hooks.ready = false;
    this.readyPending = false;
    this.lastRenderTime = 0;
    this.hud?.setScene(name);
    this.updateUrl();
  }

  private triggerBig(): boolean {
    if (this.sim.sceneName !== 'big') return false;
    return this.sim.trigger();
  }

  private setToggle(t: LabToggle, on: boolean): void {
    const p = this.params;
    switch (t) {
      case 'hdr':
        p.hdr = on;
        this.post.setOptions({ hdr: on });
        this.applyHdr();
        break;
      case 'bloom':
        p.bloom = on;
        this.post.setOptions({ bloom: on });
        break;
      case 'fxaa':
        p.fxaa = on;
        this.post.setOptions({ fxaa: on });
        break;
      case 'csm':
        p.csm = on;
        if (on) this.csm.invalidateStatic();
        break;
      case 'fx':
        p.fx = on;
        break;
      case 'flight':
        p.flight = on;
        break;
    }
    this.hud?.setToggle(t, on);
    this.updateUrl();
  }

  /** Rebuilds the opaque pipelines for the scene format actually in use (emissive differs HDR/LDR). */
  private applyHdr(): void {
    const hdr = this.post.hdrActive;
    this.ground.setHdr(hdr);
    this.props.setHdr(hdr);
    this.unitPass.setHdr(hdr);
  }

  private loseAndAutoRestore(): void {
    if (!this.dev.debugLoseContext()) {
      this.hud?.showError('WEBGL_lose_context nicht verfügbar');
      return;
    }
    let tries = 0;
    const poll = (): void => {
      if (!this.running) return;
      if (this.dev.isLost()) {
        setTimeout(() => this.dev.debugRestoreContext(), 700);
        return;
      }
      if (++tries < 120) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  private updateUrl(): void {
    try {
      history.replaceState(null, '', labParamsToSearch(this.params));
    } catch (_e) {
      // Opaque origins (file://) reject replaceState; the URL is only a convenience.
    }
  }

  private reloadWith(patch: { preset: RenderPresetName }): void {
    location.search = labParamsToSearch({ ...this.params, ...patch });
  }

  // -----------------------------------------------------------------------------------------------
  // Frame

  private readonly tick = (nowMs: number): void => {
    if (!this.running) return;
    try {
      this.renderFrame(nowMs);
    } catch (e) {
      this.fail(e);
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private fail(e: unknown): void {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    if (this.hooks.error === null) this.hooks.error = msg;
    this.hud?.showError(msg);
    this.running = false;
  }

  private measureCanvas(force: boolean): boolean {
    const c = this.canvas;
    const cssW = Math.max(1, c.clientWidth || window.innerWidth);
    const cssH = Math.max(1, c.clientHeight || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    if (!force && cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return false;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const { width, height } = backbufferSize(cssW, cssH, dpr, this.preset.renderScale, this.maxTextureSize);
    this.bw = width;
    this.bh = height;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    return true;
  }

  private renderFrame(nowMs: number): void {
    const t0 = performance.now();
    const hooks = this.hooks;
    if (this.readyPending) {
      // The frame rendered in the previous callback has been presented.
      this.readyPending = false;
      hooks.ready = true;
      this.checkGl('after the first frame');
    }
    if (this.pendingScene !== null) {
      const name = this.pendingScene;
      this.pendingScene = null;
      this.switchScene(name);
    }
    const frameMs = this.lastNow < 0 ? 0 : nowMs - this.lastNow;
    this.lastNow = nowMs;
    if (this.measureCanvas(false)) {
      this.post.resize(this.bw, this.bh);
      this.camera.setViewport(this.cssW, this.cssH);
    }

    // 1. Scene logic (fixed steps).
    const sim = this.sim;
    sim.advance(frameMs / 1000);
    let fxJs = sim.fxJsMs;
    const labJs = sim.labJsMs;
    const clock = sim.clock;
    const ctx = sim.ctx;
    const tRender = clock.renderTime;
    const fxDt = Math.min(MAX_FX_DT_S, Math.max(0, tRender - this.lastRenderTime));
    this.lastRenderTime = tRender;

    // 2. Camera and frame uniforms.
    const params = this.params;
    const target = this.rig.computeTarget(tRender, params.flight, labGroundHeight);
    const shake = ctx.shake.sample(tRender, target);
    this.shakeActive = shake.active;
    this.rig.apply(this.camera, tRender, params.flight, shake);
    this.frame.update(this.camera, {
      timeS: tRender,
      dtS: fxDt,
      alpha: clock.alpha,
      sunDir: LAB_SUN,
      sunColor: LAB_LIGHT.sunColor,
      skyColor: LAB_LIGHT.skyColor,
      groundColor: LAB_LIGHT.groundColor,
      fog: LAB_LIGHT.fog,
      viewport: [this.bw, this.bh],
    });
    this.units.upload();

    const dev = this.dev;
    const timer = this.timer;
    const counters = dev.counters;
    const seg = this.drawsBySeg;
    dev.beginFrame();
    timer.beginFrame();
    const frameIndex = timer.frame;

    // 3. Shadows.
    let f0 = performance.now();
    timer.begin(SEG_SHADOW);
    let mark = counters.drawCalls;
    if (params.csm) {
      this.csm.update(this.camera, LAB_SUN);
      this.csm.renderStatic(this.drawStatic);
      this.csm.renderDynamic(this.drawDynamic);
    }
    seg.shadow = counters.drawCalls - mark;
    this.scorchTex.update(tRender, this.post.hdrActive);
    fxJs += performance.now() - f0;

    // 4. Opaque scene.
    timer.begin(SEG_OPAQUE);
    mark = counters.drawCalls;
    f0 = performance.now();
    const enc = this.post.beginScene(LAB_CLEAR);
    fxJs += performance.now() - f0;
    enc.setBindGroup(this.sharedGroup);
    enc.setBindGroup(params.csm ? this.csmGroup : this.nullGroup);
    enc.setBindGroup(this.scorchTex.group);
    this.ground.encode(enc);
    this.props.encode(enc);
    this.unitPass.encode(enc);
    seg.opaque = counters.drawCalls - mark;

    // 5. Transparent FX in PLAN §3.7 order.
    f0 = performance.now();
    const fx = ctx.fx;
    timer.begin(SEG_SHIELDS);
    mark = counters.drawCalls;
    if (params.fx) fx.encodeShields(enc);
    seg.shields = counters.drawCalls - mark;
    timer.begin(SEG_PARTICLES);
    mark = counters.drawCalls;
    if (params.fx) fx.encodeParticles(enc);
    seg.particles = counters.drawCalls - mark;
    timer.begin(SEG_BEAMS);
    mark = counters.drawCalls;
    if (params.fx) fx.encodeBeams(enc);
    seg.beams = counters.drawCalls - mark;
    enc.end();

    // 6. Post.
    timer.begin(SEG_POST);
    mark = counters.drawCalls;
    this.post.resolve();
    seg.post = counters.drawCalls - mark;
    timer.endFrame();
    dev.endFrame();
    fxJs += performance.now() - f0;
    timer.poll(this.gpuSink);
    this.lastDraws = counters.drawCalls;

    if (this.checkErrorsPending && !dev.isLost()) {
      this.checkErrorsPending = false;
      this.checkGl('after the context restore');
    }
    hooks.frame++;
    if (!hooks.ready && !this.readyPending && !clock.catchingUp) this.readyPending = true;

    if (this.hud !== null) {
      const labels = sim.scene.labels?.();
      this.hud.labels(labels ?? [], this.camera);
    }
    const particlesAlive = params.fx || this.hud !== null ? (fx.stats().particles?.alive ?? 0) : 0;
    const mainJs = performance.now() - t0;
    this.samples.push(frameIndex, tRender, frameMs, mainJs, fxJs, labJs, this.lastDraws, particlesAlive, seg.shields + seg.particles + seg.beams);
    this.hud?.frame({ frameMs, mainJsMs: mainJs, fxJsMs: fxJs, labJsMs: labJs, t: tRender }, nowMs, () => this.stats(), this.gpuLatest, hooks.restoreCount);
  }

  private readonly gpuSink = (frame: number, segment: number, ms: number): void => {
    this.samples.setGpu(frame, segment, ms);
    const name = LAB_SEGMENTS[segment];
    if (name !== undefined) this.gpuLatest[name] = ms;
  };

  private readonly drawStatic: ShadowCasterFn = (enc, _cascade, view) =>
    this.ground.encodeShadow(enc, view.bindGroup) + this.props.encodeShadow(enc, view.bindGroup);

  private readonly drawDynamic: ShadowCasterFn = (enc, _cascade, view) => this.unitPass.encodeShadow(enc, view.bindGroup);

  private checkGl(when: string): void {
    const errors = this.dev.checkErrors();
    if (errors.length > 0 && this.hooks.error === null) {
      this.hooks.error = `GL error ${when}: ${errors.join(', ')}`;
      this.hud?.showError(this.hooks.error);
    }
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const u of this.unsubscribe) u();
    this.rig.detach();
    this.hud?.destroy();
    this.sim.destroy();
    this.scorchTex.destroy();
    this.unitPass.destroy();
    this.props.destroy();
    this.ground.destroy();
    this.dev.destroyBindGroup(this.sharedGroup);
    this.dev.destroyBindGroup(this.csmGroup);
    this.dev.destroyBindGroup(this.nullGroup);
    this.nullRecv.destroy();
    this.csm.destroy();
    this.post.destroy();
    this.units.destroy();
    this.frame.destroy();
    this.timer.dispose();
  }
}
