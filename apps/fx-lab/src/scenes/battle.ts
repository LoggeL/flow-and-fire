/**
 * Scene 'battle' (PLAN MS7 "2×200 mit Partikeln ≥ 60 FPS, der Cap greift"): two armies of 200 units
 * (tanks, bots with direct fire or missiles, artillery, engineers, one ACU each) advance on each other
 * and fight permanently.
 *
 * - Every shot plays muzzle flash → projectile with trail (tracer / cannon shell / artillery arc /
 *   missile with smoke emitter) → impact (metal on a hit, ground otherwise; artillery with splash and
 *   scorch marks). Effects come from VARKAN_EVENT_FX through the LabFxKit helpers.
 * - Deaths explode by size class, leave a smouldering wreck and a scorch mark; the slot respawns at the
 *   back of its army immediately, so 2×200 units are alive at all times.
 * - Damaged units (hp < 0.5) smoke. Per army 3 engineers pour a structure (build_stream) that explodes
 *   after completion and is rebuilt; 5 engineers reclaim wrecks (reclaim_stream).
 * Everything is derived from ctx.rng (params.seed) and fixed steps → deterministic.
 */
import type { LabContext, LabScene, LabUnitKind } from '../app/context.ts';
import { CENTER, RateMeter, turnToward } from './common.ts';
import type { LabLabel } from './common.ts';
import { TARGET_GROUND, TARGET_UNIT, labFxKit } from './fx.ts';
import type { LabFxKit, LabWeapon } from './fx.ts';

export const BATTLE_PER_ARMY = 200;
export const BATTLE_UNITS = 2 * BATTLE_PER_ARMY;

/** Composition of one army (sums to {@link BATTLE_PER_ARMY}). */
export const BATTLE_COMPOSITION: readonly (readonly [LabUnitKind, number])[] = [
  ['tank', 100],
  ['bot', 63],
  ['arty', 28],
  ['engineer', 8],
  ['acu', 1],
];

const LANE_HALF = 78;
const COLUMNS = 20;
const ROW_SPACING = 6;
const FIRST_ROW = 13;
/** Respawn distance behind the centre line. */
const BACK = 64;
const RETARGET_STEPS = 30;
const WRECK_LIFE_S = 30;
const MAX_WRECKS = 180;
const BUILDERS = 3;
/** Wrecks of the fighting "before t = 0" (the battle starts in its steady state). */
const INITIAL_WRECKS = 100;
const BUILD_S = 15;
const BUILD_HOLD_S = 5;
const BUILD_PAUSE_S = 3;
const RECLAIM_S = 4.5;
const RECLAIM_RANGE = 10;
const ARTY_SPLASH_WU = 4;
const TURN_RATE = 2.4;

interface WeaponSpec {
  weapon: LabWeapon | null;
  range: number;
  reload: number;
  damage: number;
  /** Hit probability of direct fire (artillery: splash instead). */
  accuracy: number;
  speed: number;
}

const SPEC: Readonly<Record<'tank' | 'bot' | 'missileBot' | 'arty' | 'engineer' | 'acu', WeaponSpec>> = {
  tank: { weapon: 'cannon', range: 24, reload: 2.0, damage: 0.075, accuracy: 0.55, speed: 4.2 },
  bot: { weapon: 'direct_small', range: 18, reload: 0.8, damage: 0.03, accuracy: 0.6, speed: 3.6 },
  missileBot: { weapon: 'missile', range: 34, reload: 3.6, damage: 0.11, accuracy: 0.8, speed: 3.4 },
  arty: { weapon: 'artillery', range: 95, reload: 5, damage: 0.22, accuracy: 1, speed: 2.6 },
  engineer: { weapon: null, range: 0, reload: 1, damage: 0, accuracy: 0, speed: 4.4 },
  acu: { weapon: 'cannon', range: 28, reload: 1.2, damage: 0.12, accuracy: 0.8, speed: 2.4 },
};

const ROLE_COMBAT = 0;
const ROLE_BUILDER = 1;
const ROLE_RECLAIM = 2;

const STRUCT_IDLE = 0;
const STRUCT_BUILDING = 1;
const STRUCT_DONE = 2;

class BattleScene implements LabScene {
  readonly name = 'battle' as const;
  readonly camera = { targetWu: [CENTER, CENTER + 6] as const, distanceWu: 118, pitchDeg: 38, headingDeg: -55 };

  // ---- slots (SoA, BATTLE_UNITS) ----
  private readonly unit = new Int32Array(BATTLE_UNITS).fill(-1);
  private readonly army = new Uint8Array(BATTLE_UNITS);
  private readonly kind: LabUnitKind[] = [];
  private readonly spec: WeaponSpec[] = [];
  private readonly role = new Uint8Array(BATTLE_UNITS);
  private readonly hp = new Float64Array(BATTLE_UNITS);
  private readonly cooldown = new Float64Array(BATTLE_UNITS);
  private readonly target = new Int32Array(BATTLE_UNITS).fill(-1);
  private readonly lane = new Float64Array(BATTLE_UNITS);
  private readonly wobble = new Float64Array(BATTLE_UNITS);
  /** Fraction of the weapon range at which a unit stops advancing (staggers the lines). */
  private readonly hold = new Float64Array(BATTLE_UNITS);
  /** Engineers: stream handle, wreck being reclaimed, reclaim progress. */
  private readonly stream = new Int32Array(BATTLE_UNITS).fill(-1);
  private readonly work = new Int32Array(BATTLE_UNITS).fill(-1);
  private readonly progress = new Float64Array(BATTLE_UNITS);
  private readonly unitToSlot = new Int32Array(1024).fill(-1);

  // ---- wrecks ----
  private readonly wreckIdx: number[] = [];
  private readonly wreckBorn: number[] = [];
  private readonly wreckClaim = new Int32Array(1024).fill(-1);

  // ---- structures (one site per army) ----
  private readonly site: [number, number][] = [
    [CENTER - 58, CENTER + 58],
    [CENTER + 58, CENTER - 58],
  ];
  private readonly structUnit = new Int32Array(2).fill(-1);
  private readonly structState = new Uint8Array(2);
  private readonly structHp = new Float64Array(2);
  private readonly structT = new Float64Array(2);

  private kit: LabFxKit | null = null;
  /** Context of the running scene (for the impact callback). */
  private ctx: LabContext | null = null;
  private stepCount = 0;
  /** Units with a target in weapon range during the last step. */
  private firing = 0;
  private firingLast = 0;
  private deaths = 0;
  private built = 0;
  private reclaimed = 0;
  private readonly effectRate = new RateMeter();
  private readonly deathRate = new RateMeter();
  private readonly labelList: LabLabel[] = [];

  init(ctx: LabContext): void {
    this.ctx = ctx;
    const kit = labFxKit(ctx);
    this.kit = kit;
    kit.onImpact = this.onImpact;
    const rng = ctx.rng;
    let slot = 0;
    for (let a = 0; a < 2; a++) {
      let n = 0;
      let bots = 0;
      let engineers = 0;
      for (const [kind, count] of BATTLE_COMPOSITION) {
        for (let k = 0; k < count; k++, n++, slot++) {
          this.kind[slot] = kind;
          this.army[slot] = a;
          let sp: WeaponSpec;
          if (kind === 'bot') sp = bots++ % 4 === 3 ? SPEC.missileBot : SPEC.bot;
          else sp = SPEC[kind as 'tank' | 'arty' | 'engineer' | 'acu'];
          this.spec[slot] = sp;
          if (kind === 'engineer') this.role[slot] = engineers++ < BUILDERS ? ROLE_BUILDER : ROLE_RECLAIM;
          else this.role[slot] = ROLE_COMBAT;
          const row = Math.floor(n / COLUMNS);
          const col = n % COLUMNS;
          this.lane[slot] = CENTER - LANE_HALF + ((col + 0.5) * 2 * LANE_HALF) / COLUMNS + rng.range(-1.6, 1.6);
          this.wobble[slot] = rng.range(0, 6.283);
          this.hold[slot] = rng.range(0.55, 0.95);
          const depth = kind === 'acu' ? FIRST_ROW + 50 : FIRST_ROW + row * ROW_SPACING + rng.range(-1, 1);
          this.spawnSlot(ctx, slot, depth, 0);
          this.cooldown[slot] = rng.range(0.2, sp.reload + 0.5);
          // Veterans of the running battle: part of them is already damaged (and smokes).
          if (kind !== 'acu' && rng.float01() < 0.45) this.hp[slot] = rng.range(0.3, 0.9);
        }
      }
    }
    for (let k = 0; k < INITIAL_WRECKS; k++) {
      const x = CENTER + rng.range(-34, 34);
      const z = CENTER + rng.range(-LANE_HALF, LANE_HALF);
      const age = rng.range(0, WRECK_LIFE_S - 6);
      const w = kit.addWreck(0, x, z, rng.range(0, 6.283), k % 2, Math.max(0, 24 - age), age);
      if (w >= 0) {
        this.wreckIdx.push(w);
        this.wreckBorn.push(-age);
        this.wreckClaim[w] = -1;
      }
    }
    this.labelList.push(
      { text: 'Armee Blau', xWu: CENTER - 70, yWu: 12, zWu: CENTER - LANE_HALF - 6 },
      { text: 'Armee Rot', xWu: CENTER + 70, yWu: 12, zWu: CENTER - LANE_HALF - 6 },
      { text: 'Gießstrom (Bau)', xWu: this.site[0]![0], yWu: 14, zWu: this.site[0]![1] },
      { text: 'Gießstrom (Bau)', xWu: this.site[1]![0], yWu: 14, zWu: this.site[1]![1] },
    );
  }

  /** Places slot `slot` as a fresh unit `depth` WU behind the centre line of its army. */
  private spawnSlot(ctx: LabContext, slot: number, depth: number, t: number): void {
    const a = this.army[slot]!;
    const s = a === 0 ? -1 : 1;
    const kind = this.kind[slot]!;
    const x = CENTER + s * depth;
    const z = this.lane[slot]!;
    const idx = ctx.units.add({ kind, army: a, xWu: x, zWu: z, yaw: a === 0 ? 0 : Math.PI, glow: kind === 'acu' ? 2 : kind === 'engineer' ? 1.4 : 1 });
    this.unit[slot] = idx;
    if (idx >= 0) this.unitToSlot[idx] = slot;
    this.hp[slot] = 1;
    this.target[slot] = -1;
    this.stream[slot] = -1;
    this.work[slot] = -1;
    this.progress[slot] = 0;
    this.cooldown[slot] = t + ctx.rng.range(0.5, 1.5);
  }

  update(ctx: LabContext, t: number, dt: number): void {
    const kit = this.kit!;
    kit.step(t);
    this.stepCount++;
    this.firingLast = this.firing;
    this.firing = 0;
    const units = ctx.units;
    for (let slot = 0; slot < BATTLE_UNITS; slot++) {
      const i = this.unit[slot]!;
      if (i < 0) continue;
      if ((slot + this.stepCount) % RETARGET_STEPS === 0 || !this.targetValid(slot)) this.retarget(ctx, slot);
      const role = this.role[slot]!;
      if (role === ROLE_BUILDER) this.updateBuilder(ctx, slot, t, dt);
      else if (role === ROLE_RECLAIM) this.updateReclaimer(ctx, slot, t, dt);
      else this.updateCombat(ctx, slot, t, dt);
      // ACU regenerates, damaged units smoke.
      if (this.kind[slot] === 'acu') this.hp[slot] = Math.min(1, this.hp[slot]! + 0.02 * dt);
      const damaged = this.hp[slot]! < 0.5;
      if (damaged !== kit.isDamaged(i)) kit.setDamaged(t, i, damaged);
      units.setHpGlow(i, this.hp[slot]!, this.kind[slot] === 'acu' ? 2 : this.kind[slot] === 'engineer' ? 1.4 : 1);
    }
    this.updateStructures(ctx, t, dt);
    this.expireWrecks(ctx, t);
    this.effectRate.tick(kit.counters.effects);
    this.deathRate.tick(this.deaths);
  }

  private targetValid(slot: number): boolean {
    const tg = this.target[slot]!;
    return tg >= 0 && this.unit[tg]! >= 0;
  }

  /** Nearest living enemy slot. */
  private retarget(ctx: LabContext, slot: number): void {
    const units = ctx.units;
    const i = this.unit[slot]!;
    const x = units.xWu(i);
    const z = units.zWu(i);
    const enemy = this.army[slot] === 0 ? BATTLE_PER_ARMY : 0;
    let best = -1;
    let bestD = Infinity;
    for (let k = enemy; k < enemy + BATTLE_PER_ARMY; k++) {
      const j = this.unit[k]!;
      if (j < 0) continue;
      const dx = units.xWu(j) - x;
      const dz = units.zWu(j) - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    this.target[slot] = best;
  }

  private updateCombat(ctx: LabContext, slot: number, t: number, dt: number): void {
    const units = ctx.units;
    const i = this.unit[slot]!;
    const sp = this.spec[slot]!;
    const s = this.army[slot] === 0 ? 1 : -1;
    let x = units.xWu(i);
    let z = units.zWu(i);
    let yaw = units.yawOf(i);
    const tg = this.target[slot]!;
    let dist = Infinity;
    let tx = 0;
    let tz = 0;
    if (tg >= 0) {
      const j = this.unit[tg]!;
      tx = units.xWu(j);
      tz = units.zWu(j);
      dist = Math.hypot(tx - x, tz - z);
    }
    const inRange = dist <= sp.range;
    const engaged = dist <= sp.range * this.hold[slot]!;
    if (!engaged) {
      // Advance, drifting back to the own lane with a slow wobble.
      const laneZ = this.lane[slot]! + Math.sin(t * 0.21 + this.wobble[slot]!) * 3;
      const vz = Math.max(-1, Math.min(1, (laneZ - z) * 0.4));
      const vx = s;
      const l = Math.hypot(vx, vz);
      x += (vx / l) * sp.speed * dt;
      z += (vz / l) * sp.speed * dt;
      yaw = turnToward(yaw, Math.atan2(vz, vx), TURN_RATE, dt);
    }
    if (inRange) {
      yaw = turnToward(yaw, Math.atan2(tz - z, tx - x), TURN_RATE, dt);
      this.firing++;
    }
    units.move(i, x, z, yaw);
    if (!inRange || sp.weapon === null || t < this.cooldown[slot]!) return;
    this.cooldown[slot] = t + sp.reload * ctx.rng.range(0.85, 1.15);
    this.fire(ctx, slot, tg, t);
  }

  private fire(ctx: LabContext, slot: number, tg: number, t: number): void {
    const kit = this.kit!;
    const units = ctx.units;
    const i = this.unit[slot]!;
    const j = this.unit[tg]!;
    const sp = this.spec[slot]!;
    const weapon = sp.weapon!;
    const rng = ctx.rng;
    const tx = units.xWu(j);
    const tz = units.zWu(j);
    if (weapon === 'artillery') {
      // Area fire: scatter around the target, splash damage on landing.
      const r = rng.range(0, 5);
      const a = rng.range(0, 6.2832);
      const ax = tx + Math.cos(a) * r;
      const az = tz + Math.sin(a) * r;
      kit.fireWeapon(t, i, weapon, ax, ctx.groundHeight(ax, az), az, TARGET_GROUND, -1, sp.damage);
      return;
    }
    if (rng.float01() < sp.accuracy) {
      kit.fireWeapon(t, i, weapon, tx, units.yWu(j) + 1, tz, TARGET_UNIT, j, sp.damage);
    } else {
      const r = rng.range(1.5, 4.5);
      const a = rng.range(0, 6.2832);
      const mx = tx + Math.cos(a) * r;
      const mz = tz + Math.sin(a) * r;
      kit.fireWeapon(t, i, weapon, mx, ctx.groundHeight(mx, mz), mz, TARGET_GROUND, -1, 0);
    }
  }

  /** Projectile impacts (kit callback): unit hits and artillery splash. */
  private readonly onImpact = (t: number, targetKind: number, targetId: number, damage: number, hit: boolean, x: number, z: number, army: number): void => {
    if (damage <= 0 || this.ctx === null) return;
    const ctx = this.ctx;
    if (targetKind === TARGET_UNIT) {
      if (!hit || targetId < 0) return;
      const slot = this.unitToSlot[targetId]!;
      if (slot >= 0 && this.army[slot] !== army) this.damage(ctx, slot, damage, t);
      return;
    }
    // Artillery splash: every enemy within ARTY_SPLASH_WU (linear falloff).
    const units = ctx.units;
    const enemy = army === 0 ? BATTLE_PER_ARMY : 0;
    for (let k = enemy; k < enemy + BATTLE_PER_ARMY; k++) {
      const j = this.unit[k]!;
      if (j < 0) continue;
      const d = Math.hypot(units.xWu(j) - x, units.zWu(j) - z);
      if (d < ARTY_SPLASH_WU) this.damage(ctx, k, damage * (1 - d / ARTY_SPLASH_WU), t);
    }
  };

  private damage(ctx: LabContext, slot: number, dmg: number, t: number): void {
    if (this.unit[slot]! < 0) return;
    const kind = this.kind[slot]!;
    if (kind === 'acu') {
      this.hp[slot] = Math.max(0.25, this.hp[slot]! - dmg * 0.08);
      return;
    }
    this.hp[slot] = this.hp[slot]! - dmg;
    if (this.hp[slot]! <= 0) this.killSlot(ctx, slot, t);
  }

  /** Death: explosion + wreck (LabFxKit.killUnit) and immediate respawn at the back. */
  private killSlot(ctx: LabContext, slot: number, t: number): void {
    const kit = this.kit!;
    const i = this.unit[slot]!;
    this.releaseWork(slot);
    this.unitToSlot[i] = -1;
    const wreck = kit.killUnit(t, i);
    if (wreck >= 0) {
      this.wreckIdx.push(wreck);
      this.wreckBorn.push(t);
      this.wreckClaim[wreck] = -1;
    }
    this.deaths++;
    this.unit[slot] = -1;
    this.spawnSlot(ctx, slot, BACK + ctx.rng.range(0, 16), t);
  }

  /** Stops the stream and claim of an engineer slot. */
  private releaseWork(slot: number): void {
    const kit = this.kit!;
    if (this.stream[slot]! >= 0) kit.stopStream(this.stream[slot]!);
    this.stream[slot] = -1;
    const w = this.work[slot]!;
    if (w >= 0 && this.role[slot] === ROLE_RECLAIM && this.wreckClaim[w] === slot) this.wreckClaim[w] = -1;
    this.work[slot] = -1;
    this.progress[slot] = 0;
  }

  /** Walks unit `slot` towards (gx, gz) until within `stopAt`; returns true when there. */
  private walkTo(ctx: LabContext, slot: number, gx: number, gz: number, stopAt: number, dt: number): boolean {
    const units = ctx.units;
    const i = this.unit[slot]!;
    const x = units.xWu(i);
    const z = units.zWu(i);
    const dx = gx - x;
    const dz = gz - z;
    const d = Math.hypot(dx, dz);
    const goalYaw = Math.atan2(dz, dx);
    if (d <= stopAt) {
      units.move(i, x, z, turnToward(units.yawOf(i), goalYaw, TURN_RATE, dt));
      return true;
    }
    const step = Math.min(d - stopAt, this.spec[slot]!.speed * dt);
    units.move(i, x + (dx / d) * step, z + (dz / d) * step, turnToward(units.yawOf(i), goalYaw, TURN_RATE, dt));
    return false;
  }

  private updateBuilder(ctx: LabContext, slot: number, t: number, dt: number): void {
    const a = this.army[slot]!;
    const [sx, sz] = this.site[a]!;
    // Three builders around the site (fixed angles per engineer).
    const k = slot % BUILDERS;
    const ang = (a === 0 ? 0 : Math.PI) + (k - 1) * 0.9;
    const px = sx - Math.cos(ang) * 9;
    const pz = sz - Math.sin(ang) * 9;
    const there = this.walkTo(ctx, slot, px, pz, 0.8, dt);
    const kit = this.kit!;
    const building = this.structState[a] === STRUCT_BUILDING && this.structUnit[a]! >= 0;
    if (there && building) {
      const units = ctx.units;
      const i = this.unit[slot]!;
      units.move(i, units.xWu(i), units.zWu(i), turnToward(units.yawOf(i), Math.atan2(sz - units.zWu(i), sx - units.xWu(i)), TURN_RATE, dt));
      const ty = ctx.groundHeight(sx, sz) + 1 + 4 * this.structHp[a]!;
      if (this.stream[slot]! < 0) this.stream[slot] = kit.buildStream(t, i, sx, ty, sz);
      else kit.setStreamTarget(this.stream[slot]!, sx, ty, sz);
    } else if (this.stream[slot]! >= 0) {
      kit.stopStream(this.stream[slot]!);
      this.stream[slot] = -1;
    }
  }

  private updateStructures(ctx: LabContext, t: number, dt: number): void {
    for (let a = 0; a < 2; a++) {
      const [sx, sz] = this.site[a]!;
      switch (this.structState[a]) {
        case STRUCT_IDLE:
          if (t >= this.structT[a]!) {
            const idx = ctx.units.add({ kind: 'structure', army: a, xWu: sx, zWu: sz, yaw: a === 0 ? 0.3 : 3.4, hp: 0.05, glow: 0.2 });
            this.structUnit[a] = idx;
            this.structHp[a] = 0.02;
            this.structState[a] = idx >= 0 ? STRUCT_BUILDING : STRUCT_IDLE;
            this.structT[a] = t + 1;
          }
          break;
        case STRUCT_BUILDING: {
          let pouring = 0;
          for (let s = a * BATTLE_PER_ARMY; s < (a + 1) * BATTLE_PER_ARMY; s++) if (this.role[s] === ROLE_BUILDER && this.stream[s]! >= 0) pouring++;
          this.structHp[a] = Math.min(1, this.structHp[a]! + (pouring > 0 ? dt / BUILD_S : 0));
          const i = this.structUnit[a]!;
          ctx.units.setHpGlow(i, this.structHp[a]!, 0.2 + 1.6 * this.structHp[a]!);
          if (this.structHp[a]! >= 1) {
            this.structState[a] = STRUCT_DONE;
            this.structT[a] = t + BUILD_HOLD_S;
            this.built++;
          }
          break;
        }
        default:
          if (t >= this.structT[a]!) {
            // The finished structure is shelled to pieces and poured again.
            this.kit!.killUnit(t, this.structUnit[a]!, 'structure');
            this.structUnit[a] = -1;
            this.structState[a] = STRUCT_IDLE;
            this.structT[a] = t + BUILD_PAUSE_S;
          }
      }
    }
  }

  private updateReclaimer(ctx: LabContext, slot: number, t: number, dt: number): void {
    const units = ctx.units;
    const kit = this.kit!;
    const a = this.army[slot]!;
    const s = a === 0 ? -1 : 1;
    let w = this.work[slot]!;
    if (w >= 0 && (!units.has(w) || units.kindOf(w) !== 'wreck')) {
      this.releaseWork(slot);
      w = -1;
    }
    if (w < 0) {
      w = this.claimWreck(ctx, slot);
      if (w < 0) {
        // Nothing to reclaim: wait near the own line.
        this.walkTo(ctx, slot, CENTER + s * 42, this.lane[slot]!, 1, dt);
        return;
      }
    }
    const wx = units.xWu(w);
    const wz = units.zWu(w);
    if (!this.walkTo(ctx, slot, wx, wz, RECLAIM_RANGE, dt)) return;
    const i = this.unit[slot]!;
    if (this.stream[slot]! < 0) this.stream[slot] = kit.reclaimStream(t, i, w);
    this.progress[slot] = this.progress[slot]! + dt / RECLAIM_S;
    units.setHpGlow(w, Math.max(0.05, 0.55 * (1 - this.progress[slot]!)), 0);
    if (this.progress[slot]! >= 1) {
      this.releaseWork(slot);
      this.removeWreck(w);
      this.reclaimed++;
    }
  }

  /** Nearest unclaimed wreck on the own half (±15 WU across the centre); claims it. */
  private claimWreck(ctx: LabContext, slot: number): number {
    const units = ctx.units;
    const i = this.unit[slot]!;
    const x = units.xWu(i);
    const z = units.zWu(i);
    const s = this.army[slot] === 0 ? -1 : 1;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < this.wreckIdx.length; k++) {
      const w = this.wreckIdx[k]!;
      if (this.wreckClaim[w] !== -1) continue;
      const wx = units.xWu(w);
      if ((wx - CENTER) * s < -15) continue;
      const d = Math.hypot(wx - x, units.zWu(w) - z);
      if (d < bestD && d < 70) {
        bestD = d;
        best = w;
      }
    }
    if (best >= 0) {
      this.wreckClaim[best] = slot;
      this.work[slot] = best;
      this.progress[slot] = 0;
    }
    return best;
  }

  private removeWreck(w: number): void {
    const k = this.wreckIdx.indexOf(w);
    if (k >= 0) {
      this.wreckIdx.splice(k, 1);
      this.wreckBorn.splice(k, 1);
    }
    this.wreckClaim[w] = -1;
    this.kit!.removeWreck(w);
  }

  /** Unclaimed wrecks sink after WRECK_LIFE_S; the oldest go first above MAX_WRECKS. */
  private expireWrecks(_ctx: LabContext, t: number): void {
    for (let k = 0; k < this.wreckIdx.length; ) {
      const w = this.wreckIdx[k]!;
      const old = t - this.wreckBorn[k]! > WRECK_LIFE_S || this.wreckIdx.length > MAX_WRECKS;
      if (old && this.wreckClaim[w] === -1) this.removeWreck(w);
      else k++;
    }
  }

  labels(): readonly LabLabel[] {
    return this.labelList;
  }

  stats(): Readonly<Record<string, number>> {
    let alive = 0;
    let damaged = 0;
    for (let s = 0; s < BATTLE_UNITS; s++) {
      if (this.unit[s]! < 0) continue;
      alive++;
      if (this.hp[s]! < 0.5) damaged++;
    }
    const kit = this.kit;
    return {
      units: alive,
      wrecks: this.wreckIdx.length,
      damaged,
      inRange: this.firingLast,
      deaths: this.deaths,
      deathsPerS: this.deathRate.rate,
      effectsPerS: this.effectRate.rate,
      projectiles: kit?.projectileCount ?? 0,
      streams: kit?.streamCount ?? 0,
      built: this.built,
      buildProgress: Math.round(100 * Math.max(this.structHp[0]!, this.structHp[1]!)),
      reclaimed: this.reclaimed,
    };
  }

  dispose(ctx: LabContext): void {
    if (this.kit !== null) this.kit.onImpact = null;
    for (let s = 0; s < BATTLE_UNITS; s++) if (this.unit[s]! >= 0) ctx.units.remove(this.unit[s]!);
    this.ctx = null;
  }
}

export function createBattleScene(): LabScene {
  return new BattleScene();
}
