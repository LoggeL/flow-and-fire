/**
 * Scene 'shields' (PLAN MS13 "20 Schilde ≤ 1 ms GPU"): 20 shield generators (radii 6–20 WU) on a
 * 5 × 4 grid under artillery fire from two batteries outside the grid.
 *
 * - Shells hit the bubble on the side facing the battery → ShieldPass.hit (ripple) + impact_shield.
 * - About 12 % of the shells land on the ground between the shields (impact_ground_large + scorch).
 * - Hits drain the shield hp (regenerating); shield {@link COLLAPSING} runs a fixed cycle: hp drains to
 *   0, the bubble collapses (upFrac → 0, sparks), stays down, powers up again.
 * Deterministic from ctx.rng and fixed steps.
 */
import type { LabContext, LabScene } from '../app/context.ts';
import { CENTER, RateMeter } from './common.ts';
import type { LabLabel } from './common.ts';
import { TARGET_GROUND, TARGET_SHIELD, labFxKit } from './fx.ts';
import type { LabFxKit } from './fx.ts';

export const SHIELD_COUNT = 20;
const COLS = 5;
const ROWS = 4;
const PITCH_X = 44;
const PITCH_Z = 42;
/** Index of the shield that collapses cyclically (middle of the grid). */
export const COLLAPSING = 7;
/** Collapse cycle: drain until DRAIN_S, collapse over COLLAPSE_S, down until RISE_AT_S, power-up. */
export const CYCLE_S = 10;
const DRAIN_S = 6.5;
const COLLAPSE_S = 0.35;
const RISE_AT_S = 8.2;
const RISE_S = 1.5;
const BATTERY = 12;
const RELOAD_S = 2.6;
const GROUND_SHARE = 0.12;
const FOCUS_SHARE = 0.3;
const HIT_DAMAGE = 0.05;
const REGEN_PER_S = 0.03;
/** Shield color (team blue, a little brighter than the team color). */
const SHIELD_COLOR: readonly [number, number, number] = [0.32, 0.66, 1.25];

class ShieldsScene implements LabScene {
  readonly name = 'shields' as const;
  readonly camera = { targetWu: [CENTER, CENTER + 8] as const, distanceWu: 235, pitchDeg: 52, headingDeg: -90 };

  private kit: LabFxKit | null = null;
  private readonly cx = new Float64Array(SHIELD_COUNT);
  private readonly cy = new Float64Array(SHIELD_COUNT);
  private readonly cz = new Float64Array(SHIELD_COUNT);
  private readonly radius = new Float64Array(SHIELD_COUNT);
  private readonly hp = new Float64Array(SHIELD_COUNT).fill(1);
  private readonly up = new Float64Array(SHIELD_COUNT).fill(1);
  private readonly gens: number[] = [];
  private readonly arty: number[] = [];
  private readonly reload = new Float64Array(2 * BATTERY);
  private collapses = 0;
  private groundHits = 0;
  private collapsedNow = false;
  private readonly hitRate = new RateMeter();
  private readonly labelList: LabLabel[] = [];

  init(ctx: LabContext): void {
    const kit = labFxKit(ctx);
    this.kit = kit;
    kit.onImpact = this.onImpact;
    const rng = ctx.rng;
    for (let k = 0; k < SHIELD_COUNT; k++) {
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      const x = CENTER + (col - (COLS - 1) / 2) * PITCH_X + rng.range(-2, 2);
      const z = CENTER + (row - (ROWS - 1) / 2) * PITCH_Z + rng.range(-2, 2);
      // Radii 6..20 WU; the collapsing shield is a large one so the effect reads well.
      const r = k === COLLAPSING ? 17 : 6 + (14 * ((k * 7) % SHIELD_COUNT)) / (SHIELD_COUNT - 1) + rng.range(-0.5, 0.5);
      this.cx[k] = x;
      this.cz[k] = z;
      this.cy[k] = ctx.groundHeight(x, z) + 1.2;
      this.radius[k] = Math.min(20, Math.max(6, r));
      this.gens.push(ctx.units.add({ kind: 'shieldgen', army: 0, xWu: x, zWu: z, yaw: rng.range(0, 6.283), glow: 1.5 }));
    }
    // Two batteries (army 1) west and east of the grid.
    for (let b = 0; b < 2; b++) {
      const s = b === 0 ? -1 : 1;
      for (let k = 0; k < BATTERY; k++) {
        const x = CENTER + s * (158 + (k % 3) * 7) + rng.range(-1.5, 1.5);
        const z = CENTER - 44 + Math.floor(k / 3) * 26 + rng.range(-3, 3);
        this.arty.push(ctx.units.add({ kind: 'arty', army: 1, xWu: x, zWu: z, yaw: b === 0 ? 0 : Math.PI }));
        this.reload[b * BATTERY + k] = rng.range(0.1, RELOAD_S);
      }
    }
    for (let k = 0; k < SHIELD_COUNT; k++) this.pushShield(k);
    this.labelList.push({ text: 'kollabiert zyklisch', xWu: this.cx[COLLAPSING]!, yWu: this.cy[COLLAPSING]! + this.radius[COLLAPSING]! + 4, zWu: this.cz[COLLAPSING]! });
    this.labelList.push({ text: 'Batterie West', xWu: CENTER - 165, yWu: 10, zWu: CENTER - 50 });
    this.labelList.push({ text: 'Batterie Ost', xWu: CENTER + 165, yWu: 10, zWu: CENTER - 50 });
  }

  private pushShield(k: number): void {
    this.kit!.setShield(k, this.cx[k]!, this.cy[k]!, this.cz[k]!, this.radius[k]!, SHIELD_COLOR, this.hp[k]!, this.up[k]!);
  }

  update(ctx: LabContext, t: number, dt: number): void {
    const kit = this.kit!;
    kit.step(t);
    this.updateCollapse(ctx, t);
    for (let k = 0; k < SHIELD_COUNT; k++) {
      if (k !== COLLAPSING) this.hp[k] = Math.min(1, this.hp[k]! + REGEN_PER_S * dt);
      this.pushShield(k);
    }
    for (let a = 0; a < this.arty.length; a++) {
      if (t < this.reload[a]!) continue;
      this.reload[a] = t + RELOAD_S * ctx.rng.range(0.85, 1.15);
      this.fire(ctx, a, t);
    }
    this.hitRate.tick(kit.counters.shieldHits);
  }

  /** Scripted hp/power of the collapsing shield. */
  private updateCollapse(ctx: LabContext, t: number): void {
    const k = COLLAPSING;
    const c = t % CYCLE_S;
    let hp: number;
    let up: number;
    if (c < DRAIN_S) {
      hp = Math.max(0, 1 - c / DRAIN_S);
      up = 1;
    } else if (c < DRAIN_S + COLLAPSE_S) {
      hp = 0;
      up = 1 - (c - DRAIN_S) / COLLAPSE_S;
    } else if (c < RISE_AT_S) {
      hp = 0;
      up = 0;
    } else {
      const r = Math.min(1, (c - RISE_AT_S) / RISE_S);
      hp = 0.25 + 0.75 * r;
      up = r;
    }
    const wasUp = this.up[k]! > 0.99;
    this.hp[k] = hp;
    this.up[k] = up;
    // Collapse burst when the bubble starts to fail.
    if (wasUp && up < 0.99 && c >= DRAIN_S && c < DRAIN_S + COLLAPSE_S) {
      const kit = this.kit!;
      const x = this.cx[k]!;
      const y = this.cy[k]!;
      const z = this.cz[k]!;
      const r = this.radius[k]!;
      kit.spawnEffect(t, kit.ids.sparks, x, y + r * 0.7, z, 0, 1, 0, 2.5);
      kit.impact(t, 'shield', x, y + r, z, 0, 1, 0);
      kit.spawnEffect(t, kit.ids.death.medium[0]!, x, ctx.groundHeight(x, z) + 1.5, z);
      this.collapses++;
    }
    this.collapsedNow = up < 0.5;
  }

  private fire(ctx: LabContext, a: number, t: number): void {
    const kit = this.kit!;
    const rng = ctx.rng;
    const units = ctx.units;
    const i = this.arty[a]!;
    const sx = units.xWu(i);
    const sz = units.zWu(i);
    const u = rng.float01();
    if (u < GROUND_SHARE) {
      // Between two neighbouring shields of the grid.
      const col = rng.int(0, COLS - 2);
      const row = rng.int(0, ROWS - 1);
      const x = CENTER + (col + 0.5 - (COLS - 1) / 2) * PITCH_X + rng.range(-3, 3);
      const z = CENTER + (row - (ROWS - 1) / 2) * PITCH_Z + rng.range(-14, 14) + PITCH_Z * 0.5;
      this.aim(ctx, i, x, z);
      kit.fireWeapon(t, i, 'artillery', x, ctx.groundHeight(x, z), z, TARGET_GROUND, -1, 0);
      return;
    }
    let k = rng.int(0, SHIELD_COUNT - 1);
    if (u < GROUND_SHARE + FOCUS_SHARE && this.up[COLLAPSING]! > 0.99) k = COLLAPSING;
    // Point on the bubble facing the battery: elevation 20–65°, azimuth ±40° around the direction.
    const r = this.radius[k]!;
    const base = Math.atan2(sz - this.cz[k]!, sx - this.cx[k]!);
    const az = base + rng.range(-0.7, 0.7);
    const el = rng.range(0.35, 1.13);
    const x = this.cx[k]! + Math.cos(az) * Math.cos(el) * r;
    const y = this.cy[k]! + Math.sin(el) * r;
    const z = this.cz[k]! + Math.sin(az) * Math.cos(el) * r;
    this.aim(ctx, i, x, z);
    kit.fireWeapon(t, i, 'artillery', x, y, z, TARGET_SHIELD, k, HIT_DAMAGE);
  }

  private aim(ctx: LabContext, i: number, x: number, z: number): void {
    const u = ctx.units;
    u.move(i, u.xWu(i), u.zWu(i), Math.atan2(z - u.zWu(i), x - u.xWu(i)));
  }

  private readonly onImpact = (_t: number, targetKind: number, targetId: number, damage: number, hit: boolean): void => {
    if (targetKind === TARGET_SHIELD && hit && targetId >= 0 && targetId !== COLLAPSING) {
      this.hp[targetId] = Math.max(0.15, this.hp[targetId]! - damage);
    } else if (!hit) {
      this.groundHits++;
    }
  };

  labels(): readonly LabLabel[] {
    return this.labelList;
  }

  stats(): Readonly<Record<string, number>> {
    const kit = this.kit;
    return {
      shields: SHIELD_COUNT,
      hits: kit?.counters.shieldHits ?? 0,
      hitsPerS: this.hitRate.rate,
      groundHits: this.groundHits,
      collapses: this.collapses,
      collapsed: this.collapsedNow ? 1 : 0,
      projectiles: kit?.projectileCount ?? 0,
    };
  }

  dispose(ctx: LabContext): void {
    if (this.kit !== null) {
      this.kit.onImpact = null;
      for (let k = 0; k < SHIELD_COUNT; k++) this.kit.removeShield(k);
    }
    for (const i of this.gens) ctx.units.remove(i);
    for (const i of this.arty) ctx.units.remove(i);
  }
}

export function createShieldsScene(): LabScene {
  return new ShieldsScene();
}
