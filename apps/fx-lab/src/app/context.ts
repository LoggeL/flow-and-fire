/**
 * fx-lab contracts (TRACK-RENDERFX, rfx-p5): the scene/FX interfaces that rfx-p6 (scenes, LabFx wiring)
 * and rfx-p7 (benchmarks, E2E) build on. Keep changes additive.
 *
 * Time model: scene logic runs in fixed 60 Hz steps; `LabScene.update(ctx, t, dt)` and
 * `LabFx.update(ctx, t, dt)` are called once per fixed step with `t` = scene time in seconds AFTER the
 * step and `dt` = 1/60. FX time on the GPU (FxView.u_fxTime.x) is the scene time of the rendered frame
 * (never wall clock), so `freeze=T` reproduces the same image.
 */
import type { PassEncoder, RenderPreset, RenderPresetName, RtsCamera, WebGL2Device } from '@faf/render';
import type { CameraShake, FxFrameUniforms, FxRng, ScorchDecals } from '@faf/render-fx';
import type { LabUnitList } from './units.ts';

export type SceneName = 'lighting' | 'battle' | 'shields' | 'big' | 'gallery';

export interface LabParams {
  scene: SceneName;
  preset: RenderPresetName;
  hdr: boolean;
  bloom: boolean;
  csm: boolean;
  fxaa: boolean;
  seed: number;
  freeze: number | null;
  bench: boolean;
  flight: boolean;
  /** Any transparent FX part drawn (`fxParts` has at least one part on). */
  fx: boolean;
  /** Which transparent FX parts are drawn (`fx=0|1|shields,particles,beams`); logic always runs. */
  fxParts: LabFxParts;
  /**
   * GPU timer granularity: 'fine' = six segments (shadow, opaque, shields, particles, beams, post;
   * the FX boundaries lie inside the open scene pass), 'pass' = boundaries only between passes
   * (shadow | scene = opaque + all FX | post) – no timer query starts or ends inside a pass.
   */
  gpuSeg: LabGpuSegMode;
  /** Optional camera override (`cam=dist,pitch,heading[,x,z]`, additive to the rfx-p5 contract). */
  cam?: LabCameraOverride;
}

/** Transparent FX parts that are drawn. */
export interface LabFxParts {
  readonly shields: boolean;
  readonly particles: boolean;
  readonly beams: boolean;
}

export type LabGpuSegMode = 'fine' | 'pass';

/** Camera override from the URL: replaces the scene preset's distance/angles (and target when given). */
export interface LabCameraOverride {
  distanceWu: number;
  pitchDeg: number;
  headingDeg: number;
  targetWu: readonly [number, number] | null;
}

export interface LabCameraPreset {
  targetWu: readonly [number, number];
  distanceWu: number;
  pitchDeg: number;
  headingDeg: number;
}

// Unit types live in unit-types.ts (shared with units.ts without an import cycle); re-exported here.
export type { LabUnitInit, LabUnitKind } from './unit-types.ts';

export interface LabFxStats {
  particles: {
    alive: number;
    cap: number;
    capacity: number;
    spawnedFrame: number;
    dropped: readonly [number, number, number];
    culled: number;
    uploadBytes: number;
    /** Records in the drawn ring window = particle VS instances per frame. */
    window: number;
    /** Current bound of the window (WINDOW_FACTOR · max(alive, cap)). */
    windowLimit: number;
    /** Live particles overwritten because the ring was full, per priority (cumulative). */
    overwritten: readonly [number, number, number];
    /** Live records relocated to keep the window bounded (cumulative). */
    relocated: number;
  } | null;
  shields: { count: number; ripplesActive: number } | null;
  beams: number;
  trails: number;
}

export interface LabFx {
  update(ctx: LabContext, t: number, dt: number): void;
  encodeShields(enc: PassEncoder): number;
  encodeParticles(enc: PassEncoder): number;
  encodeBeams(enc: PassEncoder): number;
  stats(): LabFxStats;
  destroy(): void;
}

export interface LabContext {
  readonly dev: WebGL2Device;
  readonly camera: RtsCamera;
  readonly frame: FxFrameUniforms;
  readonly preset: RenderPreset;
  readonly params: LabParams;
  readonly units: LabUnitList;
  readonly scorch: ScorchDecals;
  readonly shake: CameraShake;
  readonly rng: FxRng;
  groundHeight(xWu: number, zWu: number): number;
  fx: LabFx;
}

export interface LabScene {
  readonly name: SceneName;
  readonly camera: LabCameraPreset;
  init(ctx: LabContext): void;
  update(ctx: LabContext, t: number, dt: number): void;
  labels?(): readonly { text: string; xWu: number; yWu: number; zWu: number }[];
  /** World regions the E2E checks individually (gallery: one per effect tile). Additive, optional. */
  markers?(): readonly LabMarker[];
  stats?(): Readonly<Record<string, number>>;
  dispose(ctx: LabContext): void;
}

/** A named world-space disc (centre + radius, WU) of a scene, e.g. a gallery tile. */
export interface LabMarker {
  readonly id: string;
  readonly xWu: number;
  readonly yWu: number;
  readonly zWu: number;
  readonly radiusWu: number;
}

/**
 * Optional scene extension (additive to the contract): an immediate trigger, used by
 * `__fxlab.triggerBigExplosion()` and the HUD button for the scene 'big'.
 */
export interface LabTriggerableScene extends LabScene {
  trigger(ctx: LabContext, t: number): void;
}

/** Scene camera preset with the URL override applied. */
export function applyCameraOverride(p: LabCameraPreset, o: LabCameraOverride | undefined): LabCameraPreset {
  if (o === undefined) return p;
  return { targetWu: o.targetWu ?? p.targetWu, distanceWu: o.distanceWu, pitchDeg: o.pitchDeg, headingDeg: o.headingDeg };
}

export function isTriggerableScene(s: LabScene): s is LabTriggerableScene {
  return typeof (s as Partial<LabTriggerableScene>).trigger === 'function';
}

/** All scene names in HUD order. */
export const SCENE_NAMES: readonly SceneName[] = ['battle', 'shields', 'big', 'gallery', 'lighting'];

/** Fixed simulation step of the lab (60 Hz). */
export const LAB_STEP_S = 1 / 60;

/** Size of the lab world (square, WU). */
export const LAB_WORLD_WU = 512;
