import type { LabContext, LabScene, LabUnitKind } from '../app/context.ts';
import { groundPos, sceneFx } from './fx.ts';

interface Soldier { index: number; army: number; kind: LabUnitKind; phase: number; nextShot: number; smoke: number; }
class BattleScene implements LabScene {
  readonly name = 'battle' as const;
  readonly camera = { targetWu: [256, 256] as const, distanceWu: 175, pitchDeg: 55, headingDeg: -90 };
  private readonly soldiers: Soldier[] = [];
  private effects = 0;
  private deaths = 0;
  private nextDeath = 0.3;
  init(ctx: LabContext): void {
    const fx = sceneFx(ctx);
    for (let army = 0; army < 2; army++) for (let i = 0; i < 200; i++) {
      const kind: LabUnitKind = i === 0 ? 'acu' : i < 12 ? 'engineer' : i % 9 === 0 ? 'arty' : i % 3 === 0 ? 'bot' : 'tank';
      const phase = ctx.rng.range(0, Math.PI * 2);
      const x = 256 + (army === 0 ? -1 : 1) * (18 + i % 20 * 3), z = 210 + Math.floor(i / 20) * 9;
      const index = ctx.units.add({ kind, army, xWu: x, zWu: z, yaw: army * Math.PI, hp: i % 2 ? 0.4 : 1 });
      const smoke = i % 2 ? fx.emitter('varkan:smoke_damage', groundPos(ctx, x, z, 1.5), undefined, 5) : -1;
      this.soldiers.push({ index, army, kind, phase, nextShot: ctx.rng.range(0, 0.7), smoke });
      if (kind === 'engineer') fx.stream(i % 2 ? 'build' : 'reclaim', groundPos(ctx, x, z, 2), groundPos(ctx, x + 8, z + 5, 1));
    }
  }
  update(ctx: LabContext, t: number): void {
    const fx = sceneFx(ctx);
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i]!;
      const x = 256 + (s.army === 0 ? -1 : 1) * (18 + i % 20 * 3 + Math.sin(t * 0.3 + s.phase) * 5);
      const z = 210 + Math.floor((i % 200) / 20) * 9 + Math.sin(t * 0.4 + s.phase) * 3;
      ctx.units.move(s.index, x, z, s.army * Math.PI);
      if (s.smoke >= 0) fx.moveEmitter(s.smoke, groundPos(ctx, x, z, 1.5));
      if (t >= s.nextShot && s.kind !== 'engineer') {
        const weapon = s.kind === 'arty' ? 'artillery' : i % 11 === 0 ? 'missile' : s.kind === 'bot' ? 'direct_small' : 'cannon';
        fx.fireWeapon(weapon, groundPos(ctx, x, z, 2), groundPos(ctx, 512 - x, z + ctx.rng.range(-6, 6)), t);
        this.effects++; s.nextShot = t + ctx.rng.range(0.65, 1.25);
      }
    }
    if (t >= this.nextDeath) {
      const s = this.soldiers[1 + ctx.rng.next() % 399]!;
      const u = ctx.units.get(s.index)!;
      fx.killUnit(s.index, s.kind === 'bot' ? 'small' : 'medium', t);
      s.index = ctx.units.add({ kind: s.kind, army: s.army, xWu: u.xWu, zWu: u.zWu, yaw: u.yaw, hp: s.smoke >= 0 ? 0.4 : 1 });
      this.deaths++; this.effects++; this.nextDeath += 0.4;
    }
  }
  stats(): Readonly<Record<string, number>> { return { soldiers: this.soldiers.length, effects: this.effects, deaths: this.deaths }; }
  dispose(ctx: LabContext): void { for (const s of this.soldiers) { ctx.units.remove(s.index); sceneFx(ctx).stopEmitter(s.smoke); } this.soldiers.length = 0; }
}
export function createBattleScene(): LabScene { return new BattleScene(); }
