/**
 * Per-frame uniforms of the FX passes: render's `Frame` block (FRAME_LAYOUT, written exactly like
 * `@faf/render`'s renderer does) and the FX view block (camera axes, wrapped FX time, pixel scale).
 *
 * Standalone use (fx-lab, smoke harness): the class owns both buffers and writes both blocks.
 * Integration into the render renderer: pass `{ frameUbo: <renderer's frame buffer> }` (implies
 * `writeFrame: false`) – render keeps writing the Frame block and this class only writes FxView.
 */
import type { BufH, GpuDevice, RtsCamera } from '@faf/render';
import { FRAME_LAYOUT, Std140Writer, strategicZoom, iconProjectionScale, ICON_SIZE_PX, hpBarMask } from '@faf/render';
import { FX_TIME_WRAP_S } from './slots.ts';
import type { FxBindings } from './view.ts';
import { FX_VIEW_LAYOUT } from './view.ts';

export type Vec3Like = readonly [number, number, number];

export interface FxFrameInput {
  /** Clock in seconds (monotonic, e.g. performance.now() / 1000 or sim time). */
  readonly timeS: number;
  /** Frame delta in seconds. */
  readonly dtS: number;
  /** Interpolation alpha prev → cur in [0, 1] (default 1). */
  readonly alpha?: number;
  /** Unit vector towards the sun (default: render's default sun). */
  readonly sunDir?: Vec3Like;
  readonly sunColor?: Vec3Like;
  readonly skyColor?: Vec3Like;
  /** Hemisphere ground bounce color. */
  readonly groundColor?: Vec3Like;
  /** Fog color (default: render's default clear color). */
  readonly fog?: Vec3Like;
  /** Fog start distance in WU (default like render: max(250, camera distance × 3)). */
  readonly fogStart?: number;
  /** Drawing-buffer size in device pixels. */
  readonly viewport: readonly [number, number];
  readonly mapSizeWU?: number;
  readonly iconSizePx?: number;
  readonly iconOnlyStart?: number;
  readonly hpBarMode?: number;
}

export interface FxFrameOptions {
  /**
   * External Frame buffer (render's frame UBO). When given, this class never writes the Frame block.
   */
  readonly frameUbo?: BufH;
  /** false = do not write the Frame block (only meaningful together with `frameUbo`). Default true without `frameUbo`. */
  readonly writeFrame?: boolean;
}

function normalize3(x: number, y: number, z: number): Vec3Like {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Defaults identical to `@faf/render`'s renderer without a terrain light. */
export const FX_DEFAULT_LIGHT = {
  sunDir: normalize3(0.45, 0.8, 0.35),
  sunColor: [0.85, 0.8, 0.72] as Vec3Like,
  skyColor: [0.42, 0.48, 0.58] as Vec3Like,
  groundColor: [0.2, 0.18, 0.15] as Vec3Like,
  fog: [0.52, 0.6, 0.68] as Vec3Like,
} as const;

/** Wraps a clock in seconds into [0, FX_TIME_WRAP_S) (the FX time seen by shaders). */
export function wrapFxTime(timeS: number): number {
  const m = timeS % FX_TIME_WRAP_S;
  return m < 0 ? m + FX_TIME_WRAP_S : m;
}

/** Same as render's `mod32WU`: (raw mod 32 WU) in WU, always non-negative. */
function mod32WU(raw: number): number {
  const m = raw % 131072;
  return (m < 0 ? m + 131072 : m) / 4096;
}

export class FxFrameUniforms {
  readonly frameUbo: BufH;
  readonly fxViewUbo: BufH;
  readonly bindings: FxBindings;
  /** CPU copies of both blocks (tests, debugging, restore). */
  readonly frameData = new Std140Writer(FRAME_LAYOUT);
  readonly viewData = new Std140Writer(FX_VIEW_LAYOUT);
  /** Wrapped FX time written by the last update (seconds mod FX_TIME_WRAP_S). */
  fxTime = 0;
  /** Pixels per WU at distance 1 written by the last update. */
  pixelsPerWuAt1 = 1;

  private readonly writeFrame: boolean;
  private readonly ownsFrame: boolean;
  private destroyed = false;

  private readonly offViewProj = FRAME_LAYOUT.offsetOf('viewProj');
  private readonly offCamPosInt = FRAME_LAYOUT.offsetOf('camPosInt');
  private readonly offCamFrac = FRAME_LAYOUT.offsetOf('camFrac');
  private readonly offCamMod = FRAME_LAYOUT.offsetOf('camMod');
  private readonly offSunDir = FRAME_LAYOUT.offsetOf('sunDir');
  private readonly offSunColor = FRAME_LAYOUT.offsetOf('sunColor');
  private readonly offSkyColor = FRAME_LAYOUT.offsetOf('skyColor');
  private readonly offGroundColor = FRAME_LAYOUT.offsetOf('groundColor');
  private readonly offFog = FRAME_LAYOUT.offsetOf('fog');
  private readonly offViewport = FRAME_LAYOUT.offsetOf('viewport');
  private readonly offStrategic = FRAME_LAYOUT.offsetOf('strategic');
  private readonly offIconParams = FRAME_LAYOUT.offsetOf('iconParams');
  private readonly zoom = { level: 0 as 0 | 1 | 2, iconForce: 0, z1: 0, z2: 0 };
  private readonly offRight = FX_VIEW_LAYOUT.offsetOf('fxRight');
  private readonly offUp = FX_VIEW_LAYOUT.offsetOf('fxUp');
  private readonly offFwd = FX_VIEW_LAYOUT.offsetOf('fxFwd');
  private readonly offTime = FX_VIEW_LAYOUT.offsetOf('fxTime');

  constructor(
    private readonly dev: GpuDevice,
    opts: FxFrameOptions = {},
  ) {
    this.ownsFrame = opts.frameUbo === undefined;
    this.writeFrame = opts.writeFrame ?? this.ownsFrame;
    this.frameUbo =
      opts.frameUbo ??
      dev.createBuffer({
        label: 'fx.frame.ubo',
        usage: 'uniform',
        size: FRAME_LAYOUT.size,
        dynamic: true,
        restore: (h) => dev.writeBuffer(h, 0, this.frameData.bytes),
      });
    this.fxViewUbo = dev.createBuffer({
      label: 'fx.view.ubo',
      usage: 'uniform',
      size: FX_VIEW_LAYOUT.size,
      dynamic: true,
      restore: (h) => dev.writeBuffer(h, 0, this.viewData.bytes),
    });
    this.bindings = { frame: this.frameUbo, fxView: this.fxViewUbo };
  }

  /**
   * Updates the camera (`camera.update()`, cheap when unchanged) and writes both blocks. The camera's
   * CSS viewport (`setViewport`) is the caller's business, `o.viewport` is the drawing buffer size.
   */
  update(camera: RtsCamera, o: FxFrameInput): void {
    if (this.destroyed) throw new Error('FxFrameUniforms: update after destroy');
    camera.update();
    const bw = o.viewport[0];
    const bh = o.viewport[1];

    if (this.writeFrame) {
      const fd = this.frameData;
      fd.mat4(this.offViewProj, camera.viewProj32);
      const ci = camera.camPosInt;
      fd.ivec4(this.offCamPosInt, ci[0]!, ci[1]!, ci[2]!, 0);
      const a = o.alpha ?? 1;
      const alpha = a < 0 ? 0 : a > 1 ? 1 : a;
      const cf = camera.camFrac;
      fd.vec4(this.offCamFrac, cf[0]!, cf[1]!, cf[2]!, alpha);
      fd.vec4(this.offCamMod, mod32WU(ci[0]!), mod32WU(ci[1]!), mod32WU(ci[2]!), o.timeS % 3600);
      const sd = o.sunDir ?? FX_DEFAULT_LIGHT.sunDir;
      const sc = o.sunColor ?? FX_DEFAULT_LIGHT.sunColor;
      const sk = o.skyColor ?? FX_DEFAULT_LIGHT.skyColor;
      const gc = o.groundColor ?? FX_DEFAULT_LIGHT.groundColor;
      const fog = o.fog ?? FX_DEFAULT_LIGHT.fog;
      fd.vec4(this.offSunDir, sd[0], sd[1], sd[2], 0);
      fd.vec4(this.offSunColor, sc[0], sc[1], sc[2], 1);
      fd.vec4(this.offSkyColor, sk[0], sk[1], sk[2], 1);
      fd.vec4(this.offGroundColor, gc[0], gc[1], gc[2], 1);
      fd.vec4(this.offFog, fog[0], fog[1], fog[2], o.fogStart ?? Math.max(250, camera.distance * 3));
      fd.vec4(this.offViewport, bw, bh, 1 / bw, 1 / bh);
      const zoom = strategicZoom(camera.distance, o.mapSizeWU ?? 1024, this.zoom);
      fd.vec4(this.offStrategic, iconProjectionScale(camera.viewportHeight, camera.fovY), zoom.iconForce, bw / Math.max(1, camera.viewportWidth), zoom.level);
      fd.vec4(this.offIconParams, o.iconSizePx ?? ICON_SIZE_PX, o.iconOnlyStart ?? 0, o.hpBarMode ?? hpBarMask('auto'), 0);
      this.dev.writeBuffer(this.frameUbo, 0, fd.bytes);
    }

    // Camera axes from the view matrix rows (column-major: row i = m[i], m[4+i], m[8+i]).
    const v = camera.view;
    const vd = this.viewData;
    vd.vec4(this.offRight, v[0]!, v[4]!, v[8]!, 0);
    vd.vec4(this.offUp, v[1]!, v[5]!, v[9]!, 0);
    vd.vec4(this.offFwd, -v[2]!, -v[6]!, -v[10]!, 0);
    this.fxTime = wrapFxTime(o.timeS);
    this.pixelsPerWuAt1 = (0.5 * bh) / Math.tan(camera.fovY / 2);
    vd.vec4(this.offTime, this.fxTime, o.dtS, this.pixelsPerWuAt1, camera.distance);
    this.dev.writeBuffer(this.fxViewUbo, 0, vd.bytes);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.ownsFrame) this.dev.destroyBuffer(this.frameUbo);
    this.dev.destroyBuffer(this.fxViewUbo);
  }
}
