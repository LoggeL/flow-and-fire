/** Small helpers shared by the fx-lab scenes. */
import { LAB_STEP_S, LAB_WORLD_WU } from '../app/context.ts';

export const CENTER = LAB_WORLD_WU / 2;
export const TWO_PI = Math.PI * 2;

/** Wraps an angle into [−π, π). */
export function wrapPi(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

/** Turns `yaw` towards `goal` by at most `rate·dt` (shortest direction). */
export function turnToward(yaw: number, goal: number, rate: number, dt: number): number {
  const d = wrapPi(goal - yaw);
  const m = rate * dt;
  return d > m ? yaw + m : d < -m ? yaw - m : yaw + d;
}

/**
 * Rate meter over whole seconds of fixed steps: `tick(total)` once per step with a cumulative counter;
 * `rate` is the increase during the last completed second.
 */
export class RateMeter {
  rate = 0;
  private steps = 0;
  private last = 0;
  private readonly perSecond = Math.round(1 / LAB_STEP_S);

  tick(total: number): void {
    if (++this.steps % this.perSecond !== 0) return;
    this.rate = total - this.last;
    this.last = total;
  }
}

export interface LabLabel {
  text: string;
  xWu: number;
  yWu: number;
  zWu: number;
}
