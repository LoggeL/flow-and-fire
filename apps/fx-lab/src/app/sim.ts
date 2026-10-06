/**
 * Scene simulation of the fx-lab, independent of the GPU frame: builds the per-scene LabContext,
 * drives the fixed-step clock and runs `scene.update` + `ScorchDecals.update` + `LabFx.update` once per
 * step. Used by the app and by the headless determinism tests (same seed/freeze → same checksum,
 * regardless of the frame intervals).
 */
import type { RenderPreset, RtsCamera, WebGL2Device } from '@faf/render';
import { CameraShake, FxRng, SCORCH_CAPS, ScorchDecals, fxHash32 } from '@faf/render-fx';
import type { FxFrameUniforms } from '@faf/render-fx';
import { FixedStepClock } from './clock.ts';
import { LAB_WORLD_WU } from './context.ts';
import type { LabContext, LabFx, LabParams, LabScene, SceneName } from './context.ts';
import { isTriggerableScene } from './context.ts';
import { labGroundHeight } from './ground.ts';
import { createNullLabFx } from './null-fx.ts';
import type { LabUnitList } from './units.ts';

/** What every scene context shares (created once by the app). */
export interface LabWorld {
  readonly dev: WebGL2Device;
  readonly camera: RtsCamera;
  readonly frame: FxFrameUniforms;
  readonly preset: RenderPreset;
  readonly params: LabParams;
  readonly units: LabUnitList;
}

export type SceneFactory = () => LabScene;
export type FxFactory = (ctx: LabContext) => LabFx;

/** Builds a fresh context for a scene: new scorch pool, shake, rng (params.seed); FX placeholder. */
export function createLabContext(world: LabWorld): LabContext {
  const ctx: LabContext = {
    dev: world.dev,
    camera: world.camera,
    frame: world.frame,
    preset: world.preset,
    params: world.params,
    units: world.units,
    scorch: new ScorchDecals({ cap: SCORCH_CAPS[world.preset.name], mapSizeWu: LAB_WORLD_WU }),
    shake: new CameraShake(),
    rng: new FxRng(world.params.seed),
    groundHeight: labGroundHeight,
    fx: createNullLabFx(),
  };
  return ctx;
}

/** Deterministic hash of the scene state (units, scorch pool, scene stats, shake). */
export function labStateChecksum(ctx: LabContext, scene: LabScene): number {
  let h = fxHash32(ctx.units.checksum(), ctx.scorch.count, ctx.shake.activeCount);
  const s = ctx.scorch.stats;
  h = fxHash32(h, s.replaced, s.expired);
  const st = scene.stats?.();
  if (st !== undefined) {
    for (const k of Object.keys(st).sort()) {
      let kh = 0;
      for (let i = 0; i < k.length; i++) kh = fxHash32(kh, k.charCodeAt(i));
      h = fxHash32(h, kh, Math.round((st[k] ?? 0) * 1000) | 0);
    }
  }
  return h >>> 0;
}

export class LabSimulation {
  readonly clock: FixedStepClock;
  ctx: LabContext;
  scene: LabScene;
  /** scene.update time of the last {@link advance} (ms). */
  labJsMs = 0;
  /** LabFx.update + scorch update time of the last {@link advance} (ms). */
  fxJsMs = 0;
  /** Steps of the last {@link advance}. */
  lastSteps = 0;

  constructor(
    private readonly world: LabWorld,
    factory: SceneFactory,
    private readonly fxFactory: FxFactory,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.clock = new FixedStepClock(world.params.freeze);
    this.ctx = createLabContext(world);
    this.scene = factory();
    this.start();
  }

  get sceneName(): SceneName {
    return this.scene.name;
  }

  private start(): void {
    const ctx = this.ctx;
    ctx.fx = this.fxFactory(ctx);
    this.scene.init(ctx);
  }

  /** Disposes the running scene and its FX, clears the units and starts `factory` at t = 0. */
  switchScene(factory: SceneFactory): void {
    this.scene.dispose(this.ctx);
    this.ctx.fx.destroy();
    this.world.units.clear();
    this.clock.reset();
    this.ctx = createLabContext(this.world);
    this.scene = factory();
    this.start();
  }

  /** Feeds a frame interval (s), simulates the due steps and returns their count. */
  advance(frameDtS: number): number {
    const n = this.clock.advance(frameDtS);
    this.labJsMs = 0;
    this.fxJsMs = 0;
    for (let k = 0; k < n; k++) this.step();
    this.lastSteps = n;
    return n;
  }

  /** One fixed step: snapshot units, scene logic, scorch expiry, FX update. */
  private step(): void {
    const ctx = this.ctx;
    const clock = this.clock;
    ctx.units.snapshot();
    const t = clock.tick();
    const a = this.now();
    this.scene.update(ctx, t, clock.step);
    const b = this.now();
    ctx.scorch.update(t);
    ctx.fx.update(ctx, t, clock.step);
    this.labJsMs += b - a;
    this.fxJsMs += this.now() - b;
  }

  /** Immediate trigger of the running scene (scene 'big'); false when it has none. */
  trigger(): boolean {
    if (!isTriggerableScene(this.scene)) return false;
    this.scene.trigger(this.ctx, this.clock.simTime);
    return true;
  }

  checksum(): number {
    return labStateChecksum(this.ctx, this.scene);
  }

  destroy(): void {
    this.scene.dispose(this.ctx);
    this.ctx.fx.destroy();
    this.world.units.clear();
  }
}
