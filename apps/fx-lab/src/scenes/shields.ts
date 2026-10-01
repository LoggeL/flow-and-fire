import type { LabContext, LabScene } from '../app/context.ts';
import { groundPos, raw, sceneFx } from './fx.ts';
class ShieldsScene implements LabScene {
  readonly name = 'shields' as const;
  readonly camera = { targetWu: [256, 256] as const, distanceWu: 195, pitchDeg: 54, headingDeg: -90 };
  private readonly bubbles: { x: number; z: number; radius: number }[] = [];
  private hits = 0;
  private nextHit = 0.1;
  init(ctx: LabContext): void {
    for (let i = 0; i < 20; i++) {
      const x = 176 + i % 5 * 40, z = 196 + Math.floor(i / 5) * 40;
      this.bubbles.push({ x, z, radius: ctx.rng.range(6, 20) });
      ctx.units.add({ kind: 'shieldgen', army: i % 2, xWu: x, zWu: z, yaw: 0 });
      ctx.units.add({ kind: 'arty', army: 1, xWu: x + 22, zWu: z - 20, yaw: 0 });
    }
    this.update(ctx, 0);
  }
  update(ctx: LabContext, t: number): void {
    const fx = sceneFx(ctx);
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i]!;
      const phase = t % 12;
      const up = i === 0 ? phase < 8 ? 1 : phase < 9 ? 9 - phase : phase < 10 ? 0 : (phase - 10) / 2 : 1;
      fx.shield(i, { centerRaw: raw(groundPos(ctx, b.x, b.z, 1)), radiusWu: b.radius, color: i % 2 ? [0.35, 0.7, 1.3] : [0.55, 1, 1.4], hpFrac: i === 0 ? phase < 8 ? 1 - phase / 8 : phase < 10 ? 0 : up : 0.8, upFrac: up });
    }
    while (t >= this.nextHit) {
      const i = ctx.rng.next() % 20, b = this.bubbles[i]!;
      const hit = groundPos(ctx, b.x + b.radius * 0.7, b.z - b.radius * 0.4, b.radius * 0.55);
      fx.fireWeapon('artillery', groundPos(ctx, b.x + 25, b.z - 25, 3), hit, t);
      fx.hitShield(i, hit, t);
      if (this.hits % 4 === 0) fx.impact('ground_large', groundPos(ctx, b.x - b.radius - 4, b.z), t);
      this.hits++; this.nextHit += 0.1;
    }
  }
  stats(): Readonly<Record<string, number>> { return { shields: this.bubbles.length, hits: this.hits }; }
  dispose(): void { this.bubbles.length = 0; }
}
export function createShieldsScene(): LabScene { return new ShieldsScene(); }
