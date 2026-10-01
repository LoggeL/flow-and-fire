/**
 * Fixed-step clock of the fx-lab: scene logic runs in 60 Hz steps from an accumulator (at most
 * {@link MAX_STEPS_PER_FRAME} steps per frame; excess time is dropped so a stalled tab does not spiral).
 *
 * `freeze=T`: the clock ignores wall time, simulates exactly `ceil(T / step)` steps in batches of
 * {@link FREEZE_CATCHUP_STEPS} per frame (independent of the frame rate, so every run uploads the same
 * spawn batches) and then holds: no more steps, render time stays at the last step → the same frame is
 * rendered again and again (reproducible screenshots).
 */
import { LAB_STEP_S } from './context.ts';

export const MAX_STEPS_PER_FRAME = 4;
/** Steps simulated per frame while catching up to a freeze time. */
export const FREEZE_CATCHUP_STEPS = 8;
/** Largest frame interval fed into the accumulator (s). */
export const MAX_FRAME_DT_S = 0.25;
const EPS = 1e-9;

export class FixedStepClock {
  readonly step: number;
  /** Steps simulated so far. */
  steps = 0;
  /** Wall time not yet consumed by steps (s, < step). */
  acc = 0;
  /** Frames in which the step cap dropped time. */
  droppedFrames = 0;
  private readonly freezeSteps: number;

  constructor(
    readonly freeze: number | null,
    step = LAB_STEP_S,
  ) {
    if (!(step > 0)) throw new RangeError(`FixedStepClock: invalid step ${step}`);
    this.step = step;
    this.freezeSteps = freeze === null ? Number.POSITIVE_INFINITY : Math.ceil(freeze / step - EPS);
  }

  /** Scene time after the last simulated step (s). */
  get simTime(): number {
    return this.steps * this.step;
  }

  /** True once the freeze time is reached (never without freeze). */
  get frozen(): boolean {
    return this.steps >= this.freezeSteps;
  }

  /** Still catching up to the freeze time. */
  get catchingUp(): boolean {
    return this.freezeSteps !== Number.POSITIVE_INFINITY && this.steps < this.freezeSteps;
  }

  /** Time the rendered frame shows (FX time): last step + accumulator (frozen: the last step). */
  get renderTime(): number {
    return this.simTime + this.acc;
  }

  /** Interpolation factor between the previous and the current step (1 when frozen/catching up). */
  get alpha(): number {
    if (this.freezeSteps !== Number.POSITIVE_INFINITY) return 1;
    return Math.min(1, this.acc / this.step);
  }

  /**
   * Feeds one frame interval and returns how many steps to simulate now. The caller then calls
   * {@link tick} that many times.
   */
  advance(frameDtS: number): number {
    if (this.freezeSteps !== Number.POSITIVE_INFINITY) {
      this.acc = 0;
      return Math.min(FREEZE_CATCHUP_STEPS, Math.max(0, this.freezeSteps - this.steps));
    }
    const dt = Number.isFinite(frameDtS) ? Math.min(MAX_FRAME_DT_S, Math.max(0, frameDtS)) : 0;
    this.acc += dt;
    let n = Math.floor((this.acc + EPS) / this.step);
    if (n > MAX_STEPS_PER_FRAME) {
      n = MAX_STEPS_PER_FRAME;
      this.droppedFrames++;
    }
    this.acc = Math.max(0, this.acc - n * this.step);
    if (this.acc >= this.step) this.acc = this.step - EPS;
    return n;
  }

  /** Counts one simulated step and returns the scene time after it. */
  tick(): number {
    this.steps++;
    return this.simTime;
  }

  /** Back to t = 0 (scene switch). */
  reset(): void {
    this.steps = 0;
    this.acc = 0;
    this.droppedFrames = 0;
  }
}
