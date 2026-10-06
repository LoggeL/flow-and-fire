/**
 * Cascaded shadow maps with a static cache (PLAN §3.7 "CSM: Terrain und Props statisch gecacht, pro
 * Frame nur Units mit reduziertem LOD", MS14 "CSM mit 2 Kaskaden ≤ 2,5 ms"). Reusable version of the
 * SPK4 prototype (tools/render-bench/src/proto/shadows.ts, DECISIONS 17), not coupled to terrain,
 * props or units: casters are callbacks that draw into the pass they are given.
 *
 * Per frame:
 * 1. `update(camera, sunDir)` fits the cascades, refits cached boxes if needed and writes the receiver
 *    uniforms (camera-relative matrices change with every camera move).
 * 2. `renderStatic(draw)` re-renders the STATIC depth layer of dirty cascades only (terrain/props).
 * 3. `renderDynamic(draw)` renders the DYNAMIC depth layer of every cascade (units, every frame).
 * 4. Receivers include `SHADOW_RECEIVE_GLSL` and mix `receiverBindings()` into their bind groups.
 *
 * Context loss: the device registry re-creates the depth arrays (empty) and UBOs with the same
 * handles; `dev.onRestored` marks every static layer dirty so the next `renderStatic` refills it.
 */
import type {
  BindGroupH,
  BufferBinding,
  BufH,
  Frustum,
  GpuDevice,
  PassDesc,
  PassEncoder,
  RtsCamera,
  TexH,
  TextureBinding,
} from '@faf/render';
import { SLOT_FX_SHADOW, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_SHADOW_STATIC } from '../core/slots.ts';
import { CascadeFitter, MAX_CASCADES } from './cascades.ts';
import type { Cascade } from './cascades.ts';
import { SHADOW_CASTER_LAYOUT, SHADOW_CASTER_SLOT, SHADOW_RECV_LAYOUT } from './shadow-glsl.ts';

export interface CascadedShadowsOptions {
  /** Shadow map size (texels, square; default 2048). */
  readonly size?: number;
  /** Cascade count (default 2). */
  readonly cascades?: 1 | 2;
  /** Practical split weight (default 0.55). */
  readonly lambda?: number;
  /** Cached box half extent / needed sphere radius (default 1.4). */
  readonly headroom?: number;
  /** Maximum shadow distance (view depth, WU; default 600). */
  readonly maxDistanceWu?: number;
  /** Shadow darkness 0..1 (default 0.72 as in SPK4). */
  readonly strength?: number;
  /** World AABB containing every caster (WU; default: the largest map 4096² WU, heights −64..512). */
  readonly worldMin?: readonly [number, number, number];
  readonly worldMax?: readonly [number, number, number];
}

/** What a caster callback gets for one cascade and layer. */
export interface ShadowCasterView {
  readonly cascade: number;
  readonly layer: 'static' | 'dynamic';
  /** Bind group holding only the caster UBO at {@link casterSlot} (set it next to the caster's own groups). */
  readonly bindGroup: BindGroupH;
  /** The same UBO as a binding, to mix into the caster's own bind group instead. */
  readonly bindGroupEntry: BufferBinding;
  /** Slot of the `FxShadowCaster` block (render's SLOT_PASS). */
  readonly casterSlot: number;
  /** Anchor of the caster space (raw Q20.12 world position); caster VS use `posRaw − anchor`. */
  readonly anchorRaw: Int32Array;
  /** Light-box planes in anchor-relative WU (cull casters with `(pos − anchor) / 4096`). */
  readonly frustum: Frustum;
  /** Anchor-relative WU → light clip (float32 copy of the UBO matrix). */
  readonly lightViewProj: Float32Array;
  /** Texel size of the cascade in WU. */
  readonly texelWu: number;
}

/** Draws the casters of one cascade/layer into `enc` (pipeline + bind groups are the caster's). Returns draws. */
export type ShadowCasterFn = (enc: PassEncoder, cascade: number, caster: ShadowCasterView) => number;

export interface CascadedShadowsStats {
  /** `renderStatic` calls that re-rendered at least one cascade. */
  staticRefreshes: number;
  /** Static cascade layers re-rendered in total. */
  staticCascadeRefreshes: number;
  /** Cached box refits (all cascades). */
  refits: number;
  /** Draws of the last `renderStatic` / `renderDynamic`. */
  staticDraws: number;
  dynamicDraws: number;
  /** Context restores seen. */
  restores: number;
}

class CasterView implements ShadowCasterView {
  constructor(
    readonly cascade: number,
    readonly layer: 'static' | 'dynamic',
    readonly bindGroup: BindGroupH,
    readonly bindGroupEntry: BufferBinding,
    private readonly cas: Cascade,
  ) {}
  get casterSlot(): number {
    return SHADOW_CASTER_SLOT;
  }
  get anchorRaw(): Int32Array {
    return this.cas.anchor;
  }
  get frustum(): Frustum {
    return this.cas.frustum;
  }
  get lightViewProj(): Float32Array {
    return this.cas.lightVP32;
  }
  get texelWu(): number {
    return this.cas.texelWu;
  }
}

interface CascadeGpu {
  readonly staticPass: PassDesc;
  readonly dynamicPass: PassDesc;
  readonly ubo: BufH;
  readonly staging: ArrayBuffer;
  readonly f32: Float32Array;
  readonly i32: Int32Array;
  readonly group: BindGroupH;
  readonly staticView: CasterView;
  readonly dynamicView: CasterView;
}

export const DEFAULT_SHADOW_SIZE = 2048;
export const DEFAULT_SHADOW_STRENGTH = 0.72;

export class CascadedShadows {
  readonly fitter: CascadeFitter;
  readonly staticTex: TexH;
  readonly dynamicTex: TexH;
  readonly size: number;
  readonly cascadeCount: number;
  readonly stats: CascadedShadowsStats = { staticRefreshes: 0, staticCascadeRefreshes: 0, refits: 0, staticDraws: 0, dynamicDraws: 0, restores: 0 };
  strength: number;
  private readonly recvUbo: BufH;
  private readonly recvStaging: Float32Array;
  private readonly recvBindings: { readonly buffers: readonly BufferBinding[]; readonly textures: readonly TextureBinding[] };
  private readonly gpu: CascadeGpu[] = [];
  private readonly dirty: boolean[];
  private readonly updateResult: { readonly staticDirty: readonly boolean[] };
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    opts: CascadedShadowsOptions = {},
  ) {
    const size = opts.size ?? DEFAULT_SHADOW_SIZE;
    if (!Number.isInteger(size) || size < 16 || size > dev.caps.maxTextureSize) {
      throw new RangeError(`CascadedShadows: size ${size} outside 16..${dev.caps.maxTextureSize}`);
    }
    const cascades = opts.cascades ?? 2;
    this.size = size;
    this.cascadeCount = cascades;
    this.strength = opts.strength ?? DEFAULT_SHADOW_STRENGTH;
    this.fitter = new CascadeFitter({
      size,
      cascades,
      lambda: opts.lambda ?? 0.55,
      headroom: opts.headroom ?? 1.4,
      maxDistanceWu: opts.maxDistanceWu ?? 600,
      minRadiusWu: 4,
      worldMin: opts.worldMin ?? [0, -64, 0],
      worldMax: opts.worldMax ?? [4096, 512, 4096],
    });
    this.dirty = new Array<boolean>(cascades).fill(true);
    this.updateResult = { staticDirty: this.dirty };
    const texDesc = {
      width: size,
      height: size,
      format: 'depth24' as const,
      dimension: '2d-array' as const,
      layers: cascades,
      compare: 'lequal' as const,
      filter: 'linear' as const,
      wrap: 'clamp' as const,
    };
    this.staticTex = dev.createTexture({ ...texDesc, label: 'fx.csm.static' });
    this.dynamicTex = dev.createTexture({ ...texDesc, label: 'fx.csm.dynamic' });
    this.recvStaging = new Float32Array(SHADOW_RECV_LAYOUT.size >> 2);
    this.recvUbo = dev.createBuffer({ label: 'fx.csm.recv', usage: 'uniform', size: SHADOW_RECV_LAYOUT.size, dynamic: true });
    this.recvBindings = {
      buffers: [{ slot: SLOT_FX_SHADOW, buffer: this.recvUbo }],
      textures: [
        { unit: UNIT_FX_SHADOW_STATIC, texture: this.staticTex },
        { unit: UNIT_FX_SHADOW_DYNAMIC, texture: this.dynamicTex },
      ],
    };
    for (let c = 0; c < cascades; c++) {
      const staging = new ArrayBuffer(SHADOW_CASTER_LAYOUT.size);
      const ubo = dev.createBuffer({
        label: `fx.csm.caster${c}`,
        usage: 'uniform',
        size: SHADOW_CASTER_LAYOUT.size,
        // Written only on refits: re-upload after a context restore.
        restore: (b) => dev.writeBuffer(b, 0, new Uint8Array(staging)),
      });
      const entry: BufferBinding = { slot: SHADOW_CASTER_SLOT, buffer: ubo };
      const group = dev.createBindGroup({ label: `fx.csm.caster${c}`, buffers: [entry] });
      const cas = this.fitter.cascades[c]!;
      this.gpu.push({
        staticPass: { label: `fx.csm.static${c}`, depthAttachment: { texture: this.staticTex, layer: c }, clearDepth: 1 },
        dynamicPass: { label: `fx.csm.dynamic${c}`, depthAttachment: { texture: this.dynamicTex, layer: c }, clearDepth: 1 },
        ubo,
        staging,
        f32: new Float32Array(staging),
        i32: new Int32Array(staging),
        group,
        staticView: new CasterView(c, 'static', group, entry, cas),
        dynamicView: new CasterView(c, 'dynamic', group, entry, cas),
      });
    }
    this.writeReceiverDisabled();
    this.unsubscribe = dev.onRestored(() => {
      // The depth arrays came back empty: the static cache must be re-rendered.
      this.dirty.fill(true);
      this.stats.restores++;
    });
  }

  /**
   * Fits the cascades to the camera (sunDir points towards the sun). Returns which static layers are
   * dirty (re-rendered by the next {@link renderStatic}); the array is reused between calls.
   */
  update(camera: RtsCamera, sunDir: readonly [number, number, number] | ArrayLike<number>): { readonly staticDirty: readonly boolean[] } {
    const refit = this.fitter.update(camera, sunDir);
    for (let c = 0; c < this.cascadeCount; c++) {
      if (((refit >> c) & 1) === 0) continue;
      this.dirty[c] = true;
      this.writeCaster(c);
    }
    this.stats.refits = this.fitter.refits;
    this.writeReceiver(camera);
    return this.updateResult;
  }

  /** Marks every static layer dirty (terrain edited, props destroyed, …). */
  invalidateStatic(): void {
    this.dirty.fill(true);
  }

  /** Changes the caster bounds (new map); refits every cascade on the next update. */
  setWorldBounds(min: readonly [number, number, number], max: readonly [number, number, number]): void {
    this.fitter.setWorldBounds(min, max);
    this.dirty.fill(true);
  }

  /** Re-renders the static layer of every dirty cascade. Returns the draws. */
  renderStatic(draw: ShadowCasterFn): number {
    const dev = this.dev;
    if (dev.isLost()) return 0;
    let draws = 0;
    let any = false;
    for (let c = 0; c < this.cascadeCount; c++) {
      if (!this.dirty[c] || !this.fitter.cascades[c]!.valid) continue;
      const g = this.gpu[c]!;
      const enc = dev.beginPass(g.staticPass);
      draws += draw(enc, c, g.staticView);
      enc.end();
      this.dirty[c] = false;
      this.stats.staticCascadeRefreshes++;
      any = true;
    }
    if (any) this.stats.staticRefreshes++;
    this.stats.staticDraws = draws;
    return draws;
  }

  /** Renders the dynamic layer of every cascade (clears it even without casters). Returns the draws. */
  renderDynamic(draw: ShadowCasterFn): number {
    const dev = this.dev;
    let draws = 0;
    for (let c = 0; c < this.cascadeCount; c++) {
      if (!this.fitter.cascades[c]!.valid) continue;
      const g = this.gpu[c]!;
      const enc = dev.beginPass(g.dynamicPass);
      draws += draw(enc, c, g.dynamicView);
      enc.end();
    }
    this.stats.dynamicDraws = draws;
    return draws;
  }

  /** Buffer/texture bindings to mix into the bind groups of receiver passes (cached object). */
  receiverBindings(): { readonly buffers: readonly BufferBinding[]; readonly textures: readonly TextureBinding[] } {
    return this.recvBindings;
  }

  /** Caster view of cascade c (e.g. for CPU culling before the draw callbacks run). */
  casterView(c: number, layer: 'static' | 'dynamic'): ShadowCasterView {
    const g = this.gpu[c];
    if (g === undefined) throw new RangeError(`CascadedShadows: cascade ${c} out of range`);
    return layer === 'static' ? g.staticView : g.dynamicView;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    const dev = this.dev;
    for (const g of this.gpu) {
      dev.destroyBindGroup(g.group);
      dev.destroyBuffer(g.ubo);
    }
    dev.destroyBuffer(this.recvUbo);
    dev.destroyTexture(this.staticTex);
    dev.destroyTexture(this.dynamicTex);
  }

  // -------------------------------------------------------------------------------------------------

  private writeCaster(c: number): void {
    const g = this.gpu[c]!;
    const cas = this.fitter.cascades[c]!;
    const L = SHADOW_CASTER_LAYOUT;
    g.f32.set(cas.lightVP32, L.offsetOf('lightVP') >> 2);
    const a = L.offsetOf('anchor') >> 2;
    g.i32[a] = cas.anchor[0]!;
    g.i32[a + 1] = cas.anchor[1]!;
    g.i32[a + 2] = cas.anchor[2]!;
    g.i32[a + 3] = 0;
    const info = L.offsetOf('info') >> 2;
    g.f32[info] = c;
    g.f32[info + 1] = cas.texelWu;
    g.f32[info + 2] = 0;
    g.f32[info + 3] = 0;
    this.dev.writeBuffer(g.ubo, 0, g.f32);
  }

  private writeReceiver(cam: RtsCamera): void {
    const r = this.recvStaging;
    const L = SHADOW_RECV_LAYOUT;
    const mat = L.offsetOf('mat') >> 2;
    for (let c = 0; c < this.cascadeCount; c++) this.fitter.receiverMatrix(c, cam.camPosInt, r, mat + c * 16);
    const s = this.fitter.splits;
    const n = this.cascadeCount;
    const end = s[n]!;
    const split = n > 1 ? s[1]! : end;
    const fwd = L.offsetOf('fwd') >> 2;
    r[fwd] = cam.forward[0]!;
    r[fwd + 1] = cam.forward[1]!;
    r[fwd + 2] = cam.forward[2]!;
    r[fwd + 3] = 1;
    const sp = L.offsetOf('split') >> 2;
    r[sp] = split;
    r[sp + 1] = end;
    r[sp + 2] = end * 0.1;
    r[sp + 3] = n > 1 ? split * 0.12 : 0;
    const c0 = this.fitter.cascades[0]!;
    const c1 = this.fitter.cascades[Math.min(1, n - 1)]!;
    const p = L.offsetOf('params') >> 2;
    r[p] = this.strength;
    r[p + 1] = c0.texelWu * 1.2;
    r[p + 2] = c1.texelWu * 1.2;
    r[p + 3] = 0.75 / this.size;
    const info = L.offsetOf('info') >> 2;
    r[info] = n;
    r[info + 1] = 1 / this.size;
    r[info + 2] = 0;
    r[info + 3] = 0;
    this.dev.writeBuffer(this.recvUbo, 0, r);
  }

  /** Before the first update the receivers see "shadows off" (fwd.w = 0). */
  private writeReceiverDisabled(): void {
    this.recvStaging.fill(0);
    this.recvStaging[(SHADOW_RECV_LAYOUT.offsetOf('info') >> 2)] = this.cascadeCount;
    this.dev.writeBuffer(this.recvUbo, 0, this.recvStaging);
  }
}

/**
 * Receiver bindings for passes that include `SHADOW_RECEIVE_GLSL` while no CSM is active (Low/Medium
 * with blob shadows): 1×1 depth arrays and a block with shadows switched off (`fxShadow` → 1).
 */
export class NullShadowReceiver {
  private readonly ubo: BufH;
  private readonly tex: TexH;
  private readonly bindings: { readonly buffers: readonly BufferBinding[]; readonly textures: readonly TextureBinding[] };

  constructor(private readonly dev: GpuDevice) {
    const zero = new Float32Array(SHADOW_RECV_LAYOUT.size >> 2);
    this.ubo = dev.createBuffer({ label: 'fx.csm.null', usage: 'uniform', size: SHADOW_RECV_LAYOUT.size, restore: (b) => dev.writeBuffer(b, 0, zero) });
    dev.writeBuffer(this.ubo, 0, zero);
    this.tex = dev.createTexture({
      label: 'fx.csm.null',
      width: 1,
      height: 1,
      format: 'depth24',
      dimension: '2d-array',
      layers: MAX_CASCADES,
      compare: 'lequal',
      filter: 'linear',
    });
    this.bindings = {
      buffers: [{ slot: SLOT_FX_SHADOW, buffer: this.ubo }],
      textures: [
        { unit: UNIT_FX_SHADOW_STATIC, texture: this.tex },
        { unit: UNIT_FX_SHADOW_DYNAMIC, texture: this.tex },
      ],
    };
  }

  receiverBindings(): { readonly buffers: readonly BufferBinding[]; readonly textures: readonly TextureBinding[] } {
    return this.bindings;
  }

  destroy(): void {
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyTexture(this.tex);
  }
}
