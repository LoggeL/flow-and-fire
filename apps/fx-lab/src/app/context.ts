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
  fx: boolean;
}

export interface LabCameraPreset {
  targetWu: readonly [number, number];
  distanceWu: number;
  pitchDeg: number;
  headingDeg: number;
}

export type { LabUnitKind, LabUnitInit } from './units.ts';

export interface LabFxStats {
  particles: {
    alive: number;
    cap: number;
    capacity: number;
    spawnedFrame: number;
    dropped: readonly [number, number, number];
    culled: number;
    uploadBytes: number;
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
  stats?(): Readonly<Record<string, number>>;
  dispose(ctx: LabContext): void;
}

/**
 * Optional scene extension (additive to the contract): an immediate trigger, used by
 * `__fxlab.triggerBigExplosion()` and the HUD button for the scene 'big'.
 */
export interface LabTriggerableScene extends LabScene {
  trigger(ctx: LabContext, t: number): void;
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
