/**
 * Scene 'big' (PLAN MS5 "ACU-Explosion mit Kamera-Shake", X4): every {@link BIG_PERIOD_S} s (first at
 * t = {@link BIG_FIRST_S} s) the commander in the middle dies – acu_explosion + acu_aftermath
 * (VARKAN_EVENT_FX.death.acu), permanent crater, camera shake through the particle system's onShake
 * hook. The shock front then kills the ring of units around it by distance (explosion_small/medium by
 * size class, wrecks, scorch) and the three structures (explosion_large + crater). The scene resets
 * {@link RESET_AFTER_S} s later. `trigger()` (HUD button, `__fxlab.triggerBigExplosion()`) fires at once.
 */
import type { LabContext, LabUnitKind } from '../app/context.ts';
import type { LabTriggerableScene } from '../app/context.ts';
import { CENTER, TWO_PI } from './common.ts';
import type { LabLabel } from './common.ts';
import { labFxKit } from './fx.ts';
import type { LabFxKit } from './fx.ts';

export const BIG_FIRST_S = 1;
export const BIG_PERIOD_S = 8;
/** The field is rebuilt this long after an explosion. */
export const RESET_AFTER_S = 6.5;
/** Speed of the lethal shock front (WU/s) and delay before it starts. */
const FRONT_WU_PER_S = 38;
const FRONT_DELAY_S = 0.12;

interface Victim {
  kind: LabUnitKind;
  army: number;
  x: number;
  z: number;
  yaw: number;
  /** Death delay after the explosion (s). */
  delay: number;
  index: number;
  dead: boolean;
}

class BigScene implements LabTriggerableScene {
  readonly name = 'big' as const;
  readonly camera = { targetWu: [CENTER, CENTER - 6] as const, distanceWu: 150, pitchDeg: 26, headingDeg: -90 };

  private kit: LabFxKit | null = null;
  private acu = -1;
  private readonly victims: Victim[] = [];
  private readonly wrecks: number[] = [];
  /** Time of the running explosion (NaN: none), next scheduled one. */
  private boomT = Number.NaN;
  private nextBoom = BIG_FIRST_S;
  private explosions = 0;
  private deaths = 0;
  private crater = -1;
  private shakeNow = 0;
  private tNow = 0;
  private readonly labelList: LabLabel[] = [{ text: 'Kommandant (Lotbruch)', xWu: CENTER, yWu: 12, zWu: CENTER }];

  init(ctx: LabContext): void {
    this.kit = labFxKit(ctx);
    const rng = ctx.rng;
    // Ring of units (two armies mixed), three structures at r = 30.
    const kinds: readonly LabUnitKind[] = ['tank', 'tank', 'bot', 'tank', 'arty', 'bot', 'engineer', 'tank'];
    for (let ring = 0; ring < 3; ring++) {
      const n = 8 + ring * 4;
      const r = 13 + ring * 11;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TWO_PI + ring * 0.37 + rng.range(-0.08, 0.08);
        const rr = r + rng.range(-2, 2);
        const x = CENTER + Math.cos(a) * rr;
        const z = CENTER + Math.sin(a) * rr;
        const yaw = a + Math.PI + rng.range(-0.6, 0.6);
        this.victims.push({ kind: kinds[(k + ring) % kinds.length]!, army: k % 2, x, z, yaw, delay: FRONT_DELAY_S + rr / FRONT_WU_PER_S + rng.range(0, 0.1), index: -1, dead: false });
      }
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TWO_PI + 0.5;
      const x = CENTER + Math.cos(a) * 42;
      const z = CENTER + Math.sin(a) * 42;
      this.victims.push({ kind: 'structure', army: k % 2, x, z, yaw: a, delay: FRONT_DELAY_S + 42 / FRONT_WU_PER_S + k * 0.18, index: -1, dead: false });
      this.labelList.push({ text: 'Struktur', xWu: x, yWu: 12, zWu: z });
    }
    this.populate(ctx);
  }

  /** (Re)builds the field: ACU in the middle, all victims alive; old wrecks are removed. */
  private populate(ctx: LabContext): void {
    const kit = this.kit!;
    for (const w of this.wrecks) kit.removeWreck(w);
    this.wrecks.length = 0;
    const units = ctx.units;
    if (this.acu >= 0 && units.has(this.acu) && units.kindOf(this.acu) === 'acu') units.remove(this.acu);
    this.acu = units.add({ kind: 'acu', army: 0, xWu: CENTER, zWu: CENTER, yaw: 0.6, glow: 2.4 });
    for (const v of this.victims) {
      if (!v.dead && v.index >= 0 && units.has(v.index)) units.remove(v.index);
      v.index = units.add({ kind: v.kind, army: v.army, xWu: v.x, zWu: v.z, yaw: v.yaw });
      v.dead = false;
    }
    this.boomT = Number.NaN;
  }

  /** ACU death at time t. */
  private explode(ctx: LabContext, t: number): void {
    const kit = this.kit!;
    kit.step(t);
    if (this.crater >= 0) ctx.scorch.remove(this.crater);
    kit.killUnit(t, this.acu, 'acu');
    this.crater = kit.lastDecal;
    this.acu = -1;
    this.boomT = t;
    this.explosions++;
  }

  update(ctx: LabContext, t: number): void {
    const kit = this.kit!;
    kit.step(t);
    if (!Number.isNaN(this.boomT)) {
      const age = t - this.boomT;
      for (const v of this.victims) {
        if (v.dead || age < v.delay) continue;
        v.dead = true;
        const w = kit.killUnit(t, v.index);
        if (w >= 0) this.wrecks.push(w);
        this.deaths++;
      }
      if (age >= RESET_AFTER_S) this.populate(ctx);
    }
    if (t >= this.nextBoom) {
      if (!Number.isNaN(this.boomT)) this.populate(ctx);
      this.explode(ctx, t);
      this.nextBoom += BIG_PERIOD_S;
    }
    this.shakeNow = ctx.shake.activeCount;
    this.tNow = t;
  }

  trigger(ctx: LabContext, t: number): void {
    if (!Number.isNaN(this.boomT)) this.populate(ctx);
    this.explode(ctx, t);
    this.nextBoom = t + BIG_PERIOD_S;
  }

  labels(): readonly LabLabel[] {
    return this.labelList;
  }

  stats(): Readonly<Record<string, number>> {
    return {
      explosions: this.explosions,
      deaths: this.deaths,
      wrecks: this.wrecks.length,
      sinceBoom: Number.isNaN(this.boomT) ? -1 : this.tNow - this.boomT,
      shakeSources: this.shakeNow,
      nextBoom: this.nextBoom,
    };
  }

  dispose(ctx: LabContext): void {
    const units = ctx.units;
    if (this.acu >= 0) units.remove(this.acu);
    for (const v of this.victims) if (v.index >= 0) units.remove(v.index);
    for (const w of this.wrecks) units.remove(w);
  }
}

export function createBigScene(): LabTriggerableScene {
  return new BigScene();
}
