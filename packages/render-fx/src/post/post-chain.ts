/**
 * Post chain (PLAN §3.7 "HDR RGBA16F (sonst LDR), Dual-Kawase-Bloom, ACES, FXAA"), reusable version of
 * the SPK4 prototype (tools/render-bench/src/proto/post.ts, DECISIONS 17):
 *
 * 1. Scene target: RGBA16F color (HDR) + DEPTH24 at the backbuffer size. Without EXT_color_buffer_float
 *    (or with `hdr: false`) the scene is RGBA8 (LDR) and the tonemapper is bypassed.
 * 2. Dual-Kawase bloom: `bloomLevels` downsamples (½ … 1/2^levels, the first with a soft threshold)
 *    and `bloomLevels − 1` upsamples (tent + the matching down level), all in the scene format.
 * 3. Composite: scene + bloom × intensity, exposure, ACES (Narkowicz) in linear space, luma into
 *    alpha → RGBA8 LDR target; without FXAA the composite writes straight into the canvas (alpha 1).
 * 4. FXAA into the canvas.
 *
 * Every step is one fullscreen-triangle draw: bloom 5 + FXAA = 5 + 4 + 1 + 1 = 11 draws.
 *
 * MSAA ("MSAA ab High") is not available: the RHI has no multisample renderbuffers, so FXAA runs on
 * every preset (documented deviation, docs/status/rfx-p2-light-post.md).
 *
 * Context loss: every texture, buffer and bind group lives in the device's registry and is re-created
 * with the same handle; the chain only marks its step uniforms dirty (`dev.onRestored`) and rewrites
 * them on the next {@link PostChain.resolve}. No re-initialisation needed.
 */
import { SLOT_PASS } from '@faf/render';
import type {
  BindGroupH,
  BufH,
  GpuDevice,
  PassDesc,
  PassEncoder,
  PipeH,
  PipelineDesc,
  Rect,
  TexH,
  TextureFormat,
  VertexStreamBinding,
} from '@faf/render';
import { COMPOSITE_FS, DOWN_FS, FULLSCREEN_STREAM, FULLSCREEN_TRIANGLE, FULLSCREEN_VS, FXAA_FS, POST_BLOCK_NAME, POST_LAYOUT, UP_FS } from './shaders.ts';
import { MAX_BLOOM_LEVELS, MIN_BLOOM_LEVELS, bloomLevelSize } from './tonemap.ts';

export interface PostOptions {
  /** HDR RGBA16F scene target (falls back to LDR RGBA8 without EXT_color_buffer_float). */
  readonly hdr: boolean;
  readonly bloom: boolean;
  /** Dual-Kawase levels 1..6 (default 5). */
  readonly bloomLevels: number;
  readonly fxaa: boolean;
  /** Linear exposure multiplier before ACES (HDR only). */
  readonly exposure: number;
  readonly bloomIntensity: number;
  /** Brightness (max channel, display-referred scene value) where bloom starts. */
  readonly bloomThreshold: number;
  /** Soft-knee width around the threshold. */
  readonly bloomKnee: number;
}

/** Defaults = the SPK4 prototype values (DECISIONS 17: exposure 1.1, bloom 0.55, threshold 0.9). */
export const DEFAULT_POST_OPTIONS: PostOptions = {
  hdr: true,
  bloom: true,
  bloomLevels: 5,
  fxaa: true,
  exposure: 1.1,
  bloomIntensity: 0.55,
  bloomThreshold: 0.9,
  bloomKnee: 0.45,
};

export interface PostStats {
  /** Draws of the last {@link PostChain.resolve} (= fullscreen passes). */
  draws: number;
  /** HDR scene target active. */
  hdr: boolean;
  /** Bloom levels in use (0 = bloom off). */
  bloomLevels: number;
  fxaa: boolean;
  /** Target (re)allocations so far (resize/option changes; not context restores). */
  allocations: number;
  /** Context restores seen. */
  restores: number;
}

/** Description of one render target of the chain (debug/tests/memory display). */
export interface PostTargetInfo {
  readonly label: string;
  readonly texture: TexH;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
}

interface Step {
  readonly pipeline: PipeH;
  readonly group: BindGroupH;
  pass: PassDesc;
  readonly toCanvas: boolean;
  readonly phase: PostPhase;
  /** First step of its phase (the `mark` callback of resolve runs before it). */
  readonly phaseStart: boolean;
  /** Byte offset of the step's block inside the shared UBO. */
  readonly uboOffset: number;
}

type StepKind = 'down' | 'up' | 'composite' | 'fxaa';

/** Phases of {@link PostChain.resolve} (for GPU segment timers). */
export type PostPhase = 'bloom' | 'composite' | 'fxaa';

const EMPTY_SCENE_PASS: PassDesc = {};

function validate(o: PostOptions): void {
  if (!Number.isInteger(o.bloomLevels) || o.bloomLevels < MIN_BLOOM_LEVELS || o.bloomLevels > MAX_BLOOM_LEVELS) {
    throw new RangeError(`PostChain: bloomLevels ${o.bloomLevels} outside ${MIN_BLOOM_LEVELS}..${MAX_BLOOM_LEVELS}`);
  }
  for (const k of ['exposure', 'bloomIntensity', 'bloomThreshold', 'bloomKnee'] as const) {
    if (!Number.isFinite(o[k]) || o[k] < 0) throw new RangeError(`PostChain: ${k} must be a finite value ≥ 0`);
  }
}

export class PostChain {
  readonly stats: PostStats = { draws: 0, hdr: false, bloomLevels: 0, fxaa: false, allocations: 0, restores: 0 };
  private opts: PostOptions;
  private hdr = false;
  private w = 0;
  private h = 0;
  private scene: TexH = 0 as TexH;
  private depth: TexH = 0 as TexH;
  private targets: PostTargetInfo[] = [];
  private steps: Step[] = [];
  private ubo: BufH = 0 as BufH;
  private uboStaging = new Float32Array(0);
  private uboDirty = true;
  private readonly uboStride: number;
  private readonly pipes = new Map<StepKind, PipeH>();
  private readonly triangle: BufH;
  private readonly streams: VertexStreamBinding[];
  private scenePassDesc: PassDesc = EMPTY_SCENE_PASS;
  private output: Rect | null = null;
  private readonly sceneClear: [number, number, number, number] = [Number.NaN, 0, 0, 0];
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    opts: PostOptions,
  ) {
    validate(opts);
    this.opts = { ...opts };
    const align = Math.max(16, dev.caps.uniformOffsetAlignment);
    this.uboStride = Math.ceil(POST_LAYOUT.size / align) * align;
    this.triangle = dev.createBuffer({
      label: 'fx.post.triangle',
      usage: 'vertex',
      size: FULLSCREEN_TRIANGLE.byteLength,
      restore: (b) => dev.writeBuffer(b, 0, FULLSCREEN_TRIANGLE),
    });
    dev.writeBuffer(this.triangle, 0, FULLSCREEN_TRIANGLE);
    this.streams = [{ buffer: this.triangle, offset: 0 }];
    this.unsubscribe = dev.onRestored(() => {
      // Targets, UBO and bind groups were re-created by the device registry with the same handles;
      // only our own cache (the step uniforms, written lazily) must be re-uploaded.
      this.uboDirty = true;
      this.stats.restores++;
    });
    const size = dev.drawingBufferSize();
    this.rebuild(size.width, size.height);
  }

  /** Current options (copy). */
  get options(): PostOptions {
    return { ...this.opts };
  }

  /** HDR RGBA16F scene target in use (`hdr` requested and EXT_color_buffer_float available). */
  get hdrActive(): boolean {
    return this.hdr;
  }

  /** Scene color target (RGBA16F with HDR, else RGBA8). Handle changes on resize/option changes. */
  get sceneColor(): TexH {
    return this.scene;
  }

  /** Scene depth target (DEPTH24). */
  get sceneDepth(): TexH {
    return this.depth;
  }

  get sceneFormat(): TextureFormat {
    return this.hdr ? 'rgba16f' : 'rgba8';
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** All render targets currently allocated by the chain. */
  targetInfo(): readonly PostTargetInfo[] {
    return this.targets;
  }

  /** Resizes the chain to a backbuffer of `w × h` device pixels; reallocates only on a real change. */
  resize(w: number, h: number): void {
    const nw = Math.max(1, Math.floor(w));
    const nh = Math.max(1, Math.floor(h));
    if (nw === this.w && nh === this.h) return;
    this.rebuild(nw, nh);
  }

  /**
   * Changes options. Exposure/bloom intensity/threshold/knee only rewrite uniforms; `hdr`, `bloom`,
   * `bloomLevels` and `fxaa` rebuild the targets/steps.
   */
  setOptions(partial: Partial<PostOptions>): void {
    const next: PostOptions = { ...this.opts, ...partial };
    validate(next);
    const prev = this.opts;
    this.opts = next;
    const structural =
      next.hdr !== prev.hdr || next.bloom !== prev.bloom || next.fxaa !== prev.fxaa || (next.bloom && next.bloomLevels !== prev.bloomLevels);
    if (structural) {
      this.rebuild(this.w, this.h);
    } else {
      this.writeParams();
    }
  }

  /**
   * Pass descriptor of the offscreen scene target (clears color and depth). The descriptor is cached
   * and only rebuilt when the clear color or the targets change (no per-frame allocation).
   */
  scenePass(clearColor: readonly [number, number, number, number] | readonly [number, number, number]): PassDesc {
    const c = this.sceneClear;
    const a = clearColor.length > 3 ? (clearColor as readonly number[])[3]! : 1;
    if (this.scenePassDesc === EMPTY_SCENE_PASS || c[0] !== clearColor[0] || c[1] !== clearColor[1] || c[2] !== clearColor[2] || c[3] !== a) {
      c[0] = clearColor[0];
      c[1] = clearColor[1];
      c[2] = clearColor[2];
      c[3] = a;
      this.scenePassDesc = {
        label: 'fx.scene',
        colorAttachments: [{ texture: this.scene }],
        depthAttachment: { texture: this.depth },
        clearColor: [c[0], c[1], c[2], c[3]],
        clearDepth: 1,
      };
    }
    return this.scenePassDesc;
  }

  /** Begins the offscreen scene pass (all scene passes render into {@link sceneColor}/{@link sceneDepth}). */
  beginScene(clearColor: readonly [number, number, number, number] | readonly [number, number, number]): PassEncoder {
    return this.dev.beginPass(this.scenePass(clearColor));
  }

  /**
   * Pass descriptor that continues rendering into the scene targets without clearing (e.g. transparent
   * FX passes recorded after the opaque scene pass).
   */
  sceneLoadPass(): PassDesc {
    return { label: 'fx.scene.load', colorAttachments: [{ texture: this.scene }], depthAttachment: { texture: this.depth } };
  }

  /**
   * Canvas rectangle (device pixels, GL convention: y from the bottom) the final pass writes to;
   * null = the whole drawing buffer (default). For split-screen comparisons and previews.
   */
  setOutputViewport(r: Rect | null): void {
    this.output = r === null ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
    for (const s of this.steps) if (s.toCanvas) s.pass = this.canvasPass(s.pass.label ?? 'fx.post.canvas');
  }

  private canvasPass(label: string): PassDesc {
    return this.output === null ? { label } : { label, viewport: this.output };
  }

  /**
   * Records bloom, composite and FXAA (canvas). Returns the number of draws. `mark` (optional) runs
   * before the first pass of every phase – e.g. to switch GPU timer segments.
   */
  resolve(mark?: (phase: PostPhase) => void): number {
    if (this.destroyed) throw new Error('PostChain: destroyed');
    const dev = this.dev;
    if (this.uboDirty && !dev.isLost()) {
      dev.writeBuffer(this.ubo, 0, this.uboStaging);
      this.uboDirty = false;
    }
    const streams = this.streams;
    for (const s of this.steps) {
      if (mark !== undefined && s.phaseStart) mark(s.phase);
      const enc = dev.beginPass(s.pass);
      enc.setPipeline(s.pipeline);
      enc.setBindGroup(s.group);
      enc.setVertexStreams(streams);
      enc.drawInstanced(3, 1);
      enc.end();
    }
    this.stats.draws = this.steps.length;
    return this.steps.length;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.releaseTargets();
    for (const p of this.pipes.values()) this.dev.destroyPipeline(p);
    this.pipes.clear();
    this.dev.destroyBuffer(this.triangle);
  }

  // -------------------------------------------------------------------------------------------------

  private pipeline(kind: StepKind): PipeH {
    let p = this.pipes.get(kind);
    if (p !== undefined) return p;
    const common: Omit<PipelineDesc, 'fragment'> = {
      label: `fx.post.${kind}`,
      vertex: FULLSCREEN_VS,
      streams: [FULLSCREEN_STREAM],
      uniformBlocks: [{ name: POST_BLOCK_NAME, slot: SLOT_PASS }],
      depthTest: false,
      depthWrite: false,
      cullMode: 'none',
      blend: 'none',
    };
    switch (kind) {
      case 'down':
        p = this.dev.createPipeline({ ...common, fragment: DOWN_FS, samplers: [{ name: 'u_src', unit: 0 }] });
        break;
      case 'up':
        p = this.dev.createPipeline({
          ...common,
          fragment: UP_FS,
          samplers: [
            { name: 'u_src', unit: 0 },
            { name: 'u_add', unit: 1 },
          ],
        });
        break;
      case 'composite':
        p = this.dev.createPipeline({
          ...common,
          fragment: COMPOSITE_FS,
          samplers: [
            { name: 'u_scene', unit: 0 },
            { name: 'u_bloom', unit: 1 },
          ],
        });
        break;
      case 'fxaa':
        p = this.dev.createPipeline({ ...common, fragment: FXAA_FS, samplers: [{ name: 'u_ldr', unit: 0 }] });
        break;
    }
    this.pipes.set(kind, p);
    return p;
  }

  private rebuild(w: number, h: number): void {
    const dev = this.dev;
    this.releaseTargets();
    this.w = w;
    this.h = h;
    const o = this.opts;
    this.hdr = o.hdr && dev.caps.colorBufferFloat;
    const fmt: TextureFormat = this.hdr ? 'rgba16f' : 'rgba8';
    const targets: PostTargetInfo[] = [];
    const tex = (label: string, tw: number, th: number, format: TextureFormat): TexH => {
      const t = dev.createTexture({ label, width: tw, height: th, format, filter: format === 'depth24' ? 'nearest' : 'linear', wrap: 'clamp' });
      targets.push({ label, texture: t, width: tw, height: th, format });
      return t;
    };
    this.scene = tex('fx.post.scene', w, h, fmt);
    this.depth = tex('fx.post.depth', w, h, 'depth24');
    const levels = o.bloom ? o.bloomLevels : 0;
    const down: TexH[] = [];
    const up: TexH[] = [];
    for (let i = 1; i <= levels; i++) {
      const s = bloomLevelSize(w, h, i);
      down.push(tex(`fx.post.down${i}`, s.width, s.height, fmt));
    }
    for (let i = 1; i < levels; i++) {
      const s = bloomLevelSize(w, h, i);
      up.push(tex(`fx.post.up${i}`, s.width, s.height, fmt));
    }
    const ldr = o.fxaa ? tex('fx.post.ldr', w, h, 'rgba8') : null;
    this.targets = targets;

    // Steps: down 1..L, up L-1..1, composite, fxaa (canvas).
    const stepCount = levels + Math.max(0, levels - 1) + 1 + (o.fxaa ? 1 : 0);
    const floats = this.uboStride >> 2;
    this.uboStaging = new Float32Array(stepCount * floats);
    this.ubo = dev.createBuffer({ label: 'fx.post.ubo', usage: 'uniform', size: stepCount * this.uboStride });
    const steps: Step[] = [];
    const add = (kind: StepKind, srcs: readonly TexH[], dst: TexH | null): void => {
      const uboOffset = steps.length * this.uboStride;
      const group = dev.createBindGroup({
        label: `fx.post.${kind}`,
        buffers: [{ slot: SLOT_PASS, buffer: this.ubo, offset: uboOffset, size: POST_LAYOUT.size }],
        textures: srcs.map((t, unit) => ({ unit, texture: t })),
      });
      const pass: PassDesc = dst === null ? this.canvasPass(`fx.post.${kind}.canvas`) : { label: `fx.post.${kind}`, colorAttachments: [{ texture: dst }] };
      const phase: PostPhase = kind === 'down' || kind === 'up' ? 'bloom' : kind;
      const phaseStart = steps.length === 0 || steps[steps.length - 1]!.phase !== phase;
      steps.push({ pipeline: this.pipeline(kind), group, pass, toCanvas: dst === null, phase, phaseStart, uboOffset });
    };
    let src = this.scene;
    for (let i = 0; i < levels; i++) {
      add('down', [src], down[i]!);
      src = down[i]!;
    }
    for (let i = levels - 2; i >= 0; i--) {
      const lower = i === levels - 2 ? down[levels - 1]! : up[i + 1]!;
      add('up', [lower, down[i]!], up[i]!);
    }
    const bloomTex = levels === 0 ? this.scene : levels === 1 ? down[0]! : up[0]!;
    add('composite', [this.scene, bloomTex], ldr);
    if (ldr !== null) add('fxaa', [ldr], null);
    this.steps = steps;
    this.scenePassDesc = EMPTY_SCENE_PASS;
    this.stats.hdr = this.hdr;
    this.stats.bloomLevels = levels;
    this.stats.fxaa = o.fxaa;
    this.stats.allocations++;
    this.writeParams();
  }

  /** Fills the step uniforms (texel sizes + parameters) and uploads them. */
  private writeParams(): void {
    const o = this.opts;
    const w = this.w;
    const h = this.h;
    const levels = this.stats.bloomLevels;
    const f = this.uboStaging;
    const floats = this.uboStride >> 2;
    const texelOff = POST_LAYOUT.offsetOf('texel') >> 2;
    const paramOff = POST_LAYOUT.offsetOf('params') >> 2;
    let k = 0;
    const put = (texel: readonly [number, number, number, number], params: readonly [number, number, number, number]): void => {
      const base = k * floats;
      for (let i = 0; i < 4; i++) {
        f[base + texelOff + i] = texel[i]!;
        f[base + paramOff + i] = params[i]!;
      }
      k++;
    };
    for (let i = 0; i < levels; i++) {
      const s = bloomLevelSize(w, h, i);
      const d = bloomLevelSize(w, h, i + 1);
      put([1 / s.width, 1 / s.height, 1 / d.width, 1 / d.height], [o.bloomThreshold, o.bloomKnee, i === 0 ? 1 : 0, 0]);
    }
    for (let i = levels - 2; i >= 0; i--) {
      // Target = level i + 1, source (lower) = level i + 2.
      const s = bloomLevelSize(w, h, i + 2);
      const d = bloomLevelSize(w, h, i + 1);
      put([1 / s.width, 1 / s.height, 1 / d.width, 1 / d.height], [1, 0, 0, 0]);
    }
    put([1 / w, 1 / h, 1 / w, 1 / h], [o.exposure, levels > 0 ? o.bloomIntensity : 0, this.hdr ? 1 : 0, o.fxaa ? 1 : 0]);
    if (o.fxaa) put([1 / w, 1 / h, 1 / w, 1 / h], [0, 0, 0, 0]);
    this.uboDirty = true;
    if (!this.dev.isLost()) {
      this.dev.writeBuffer(this.ubo, 0, f);
      this.uboDirty = false;
    }
  }

  private releaseTargets(): void {
    const dev = this.dev;
    for (const s of this.steps) dev.destroyBindGroup(s.group);
    this.steps = [];
    if (this.ubo !== 0) dev.destroyBuffer(this.ubo);
    this.ubo = 0 as BufH;
    for (const t of this.targets) dev.destroyTexture(t.texture);
    this.targets = [];
    this.scenePassDesc = EMPTY_SCENE_PASS;
  }
}
