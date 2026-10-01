import type { LabContext, LabTriggerableScene } from '../app/context.ts';
import { sceneFx } from './fx.ts';
class BigScene implements LabTriggerableScene {
  readonly name = 'big' as const;
  readonly camera = { targetWu: [256, 256] as const, distanceWu: 130, pitchDeg: 50, headingDeg: -90 };
  private next = 1;
  private explosions = 0;
  init(ctx: LabContext): void { ctx.units.add({ kind: 'acu', army: 0, xWu: 256, zWu: 256, yaw: 0, glow: 3 }); }
  trigger(ctx: LabContext, t: number): void {
    const fx = sceneFx(ctx);
    const acu = ctx.units.add({ kind: 'acu', army: 0, xWu: 256, zWu: 256, yaw: 0 });
    fx.killUnit(acu, 'acu', t);
    for (let i = 0; i < 27; i++) {
      const a = i * Math.PI * 2 / 27 + ctx.rng.range(-0.025, 0.025), r = i < 24 ? 23 : 34;
      const u = ctx.units.add({ kind: i >= 24 ? 'structure' : i % 2 ? 'tank' : 'bot', army: i % 2, xWu: 256 + Math.cos(a) * r, zWu: 256 + Math.sin(a) * r, yaw: a });
      fx.killUnit(u, i >= 24 ? 'large' : i % 2 ? 'medium' : 'small', t);
    }
    this.explosions++;
  }
  update(ctx: LabContext, t: number): void { if (t + 1e-8 >= this.next) { this.trigger(ctx, t); this.next += 8; } }
  stats(): Readonly<Record<string, number>> { return { explosions: this.explosions }; }
  dispose(): void { /* pools are owned by the scene context */ }
}
export function createBigScene(): LabTriggerableScene { return new BigScene(); }
