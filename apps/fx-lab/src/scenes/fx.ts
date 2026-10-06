/**
 * Real LabFx of the fx-lab (rfx-p6): ParticleSystem (cap from the preset, onShake → CameraShake),
 * ShieldPass, TrailPass and BeamPass in PLAN §3.7 order, plus the lab helpers the scenes use to
 * "play" gameplay events. Effect selection goes through VARKAN_EVENT_FX, i.e. exactly the mapping the
 * later MS5/MS7 event integration uses (weapon class → muzzle, impact class → impact, death class →
 * explosion, build/reclaim → streams, damaged → smoke, wreck → smolder).
 *
 * Time: every helper takes the scene time `t` of the running fixed step. The first call of a step runs
 * the per-step update of the GPU systems (ParticleSystem.update, BeamPass.update, ShieldPass.update)
 * so bursts spawned by the scene get t0 = t exactly, independent of how many steps a frame runs.
 * `LabFx.update` (after scene.update) then advances projectiles (prev/cur per step, closed-form paths),
 * moves attached emitters and rebuilds the immediate-mode beams/trails of the step.
 *
 * The GPU systems sit behind small structural interfaces ({@link LabFxParts}); ParticleSystem, BeamPass,
 * TrailPass and ShieldPass satisfy them directly. Headless runs (tests, no device) use the recording
 * parts of fx-record.ts, which log every call into a checksum.
 */
import { DEFAULT_ARMY_COLORS } from '@faf/render';
import type { PassEncoder, RtsCamera } from '@faf/render';
import {
  BeamPass,
  ParticleSystem,
  ShieldPass,
  TrailPass,
  VARKAN_BEAM_STYLES,
  VARKAN_EFFECTS,
  VARKAN_EVENT_FX,
  VARKAN_SCORCH,
  VARKAN_TRAIL_STYLES,
  compileEffectLibrary,
  fxHash32,
  glowTintForArmyColor,
  particleCapForPreset,
} from '@faf/render-fx';
import type {
  BeamPassStats,
  BeamStyle,
  EffectDefCompiled,
  EffectLibrary,
  ParticleSpawnOptions,
  ParticleStats,
  ShieldPassStats,
  ShieldState,
  TrailPassStats,
  TrailStyle,
} from '@faf/render-fx';
import type { LabContext, LabFx, LabFxStats, LabUnitKind } from '../app/context.ts';
import { LAB_UNIT_CAPACITY, LAB_UNIT_SHAPES } from '../app/units.ts';

// -------------------------------------------------------------------------------------------------
// Structural interfaces of the GPU systems (real classes satisfy them; fx-record.ts records them).

export interface LabParticleBackend {
  readonly lib: EffectLibrary;
  readonly stats: Readonly<ParticleStats>;
  spawn(effectIdx: number, posRaw: ArrayLike<number>, o?: ParticleSpawnOptions): number;
  createEmitter(effectIdx: number, posRaw: ArrayLike<number>, o?: ParticleSpawnOptions): number;
  moveEmitter(h: number, posRaw: ArrayLike<number>, targetRaw?: ArrayLike<number>): void;
  setEmitterRate(h: number, scale: number): void;
  destroyEmitter(h: number): void;
  update(nowS: number, camera: RtsCamera): void;
  encode(enc: PassEncoder): number;
  destroy(): void;
}

export interface LabBeamBackend {
  readonly stats: Readonly<BeamPassStats>;
  begin(): void;
  add(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle): boolean;
  addTimed(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle, t0S: number, lifeS: number): boolean;
  update(nowS: number): void;
  encode(enc: PassEncoder): number;
  destroy(): void;
}

export interface LabTrailBackend {
  readonly stats: Readonly<TrailPassStats>;
  begin(): void;
  add(prevRaw: ArrayLike<number>, curRaw: ArrayLike<number>, style: TrailStyle, lengthScale?: number): boolean;
  encode(enc: PassEncoder): number;
  destroy(): void;
}

export interface LabShieldBackend {
  readonly stats: Readonly<ShieldPassStats>;
  set(id: number, s: ShieldState): boolean;
  hit(id: number, pointRaw: ArrayLike<number>, nowS: number, strength?: number): number;
  remove(id: number): boolean;
  update(nowS: number): void;
  encode(enc: PassEncoder): number;
  destroy(): void;
}

export interface LabFxParts {
  readonly particles: LabParticleBackend;
  readonly beams: LabBeamBackend;
  readonly trails: LabTrailBackend;
  readonly shields: LabShieldBackend;
}

/** onShake hook of the particle system (effects with a `shake` definition, e.g. acu_explosion). */
export type LabShakeHook = (effect: EffectDefCompiled, posRaw: ArrayLike<number>, tS: number) => void;

// -------------------------------------------------------------------------------------------------
// Constants

const RAW = 4096;
const TWO_PI = Math.PI * 2;

/** The compiled Varkan library (pure data, compiled once per page). */
let varkanLib: EffectLibrary | null = null;
export function labEffectLibrary(): EffectLibrary {
  varkanLib ??= compileEffectLibrary(VARKAN_EFFECTS);
  return varkanLib;
}

export type LabWeapon = 'direct_small' | 'cannon' | 'artillery' | 'missile' | 'aa';
export type LabImpactKind = 'ground' | 'ground_large' | 'unit' | 'shield' | 'water';
export type LabDeathClass = 'small' | 'medium' | 'large' | 'structure' | 'acu';

export const LAB_WEAPONS: readonly LabWeapon[] = ['direct_small', 'cannon', 'artillery', 'missile', 'aa'];

/** Projectile targets. */
export const TARGET_GROUND = 0;
export const TARGET_UNIT = 1;
export const TARGET_SHIELD = 2;

/** Projectile pool size (enough for 2×200 units with in-flight artillery). */
export const LAB_MAX_PROJECTILES = 2048;
/** Build/reclaim streams that can run at once. */
export const LAB_MAX_STREAMS = 64;
/** Shields the kit tracks (ShieldPass capacity). */
export const LAB_MAX_SHIELDS = 64;
/**
 * Effect scale of the lab: the lab's box units are ≈ 3–4× the game reference size the Varkan effects are
 * authored for (T1 ≈ 1 WU, varkan.ts), so event effects are spawned at this scale to keep the
 * unit/effect proportions of the game. The commander explosion uses {@link LAB_ACU_FX_SCALE}, streams
 * {@link LAB_STREAM_FX_SCALE}.
 */
export const LAB_FX_SCALE = 2.5;
export const LAB_ACU_FX_SCALE = 1.6;
export const LAB_STREAM_FX_SCALE = 1.5;
/** A wreck smoulders this long after the death (s). */
export const WRECK_SMOLDER_S = 24;

/** Trail style of each weapon class. */
const WEAPON_TRAIL: Readonly<Record<LabWeapon, TrailStyle>> = {
  direct_small: VARKAN_TRAIL_STYLES.tracer,
  cannon: VARKAN_TRAIL_STYLES.cannon,
  artillery: VARKAN_TRAIL_STYLES.artillery,
  missile: VARKAN_TRAIL_STYLES.missile,
  aa: VARKAN_TRAIL_STYLES.aa,
};

/** Flight model per weapon: speed (WU/s) for direct weapons, arc apex / lateral wiggle factors. */
interface Ballistics {
  readonly speed: number;
  /** Apex height = arcK · distance + arcC (WU). */
  readonly arcK: number;
  readonly arcC: number;
  /** Lateral wiggle amplitude = wiggleK · distance (missiles). */
  readonly wiggleK: number;
  /** Minimum and maximum flight time (s). */
  readonly minFlight: number;
  readonly maxFlight: number;
}

const BALLISTICS: Readonly<Record<LabWeapon, Ballistics>> = {
  direct_small: { speed: 70, arcK: 0, arcC: 0, wiggleK: 0, minFlight: 0.08, maxFlight: 1 },
  cannon: { speed: 55, arcK: 0.025, arcC: 0, wiggleK: 0, minFlight: 0.1, maxFlight: 1.5 },
  artillery: { speed: 42, arcK: 0.32, arcC: 5, wiggleK: 0, minFlight: 1.4, maxFlight: 5.5 },
  missile: { speed: 30, arcK: 0.16, arcC: 2, wiggleK: 0.1, minFlight: 0.5, maxFlight: 3 },
  aa: { speed: 80, arcK: 0, arcC: 0, wiggleK: 0, minFlight: 0.08, maxFlight: 1.2 },
};

/** Death class of a unit kind (VARKAN_EVENT_FX.death). */
export function deathClassOf(kind: LabUnitKind): LabDeathClass {
  switch (kind) {
    case 'arty':
    case 'shieldgen':
      return 'medium';
    case 'structure':
      return 'structure';
    case 'acu':
      return 'acu';
    default:
      return 'small';
  }
}

/**
 * Muzzle / tool tip of a unit kind in unit-local coordinates (x = facing): front end of shape part 2
 * (barrel, arm), at its mid height.
 */
export function muzzleLocal(kind: LabUnitKind): readonly [number, number, number] {
  const p = LAB_UNIT_SHAPES[kind][2];
  return [p.offset[0] + p.size[0], p.offset[1] + p.size[1] * 0.5, p.offset[2]];
}

const MUZZLES: Readonly<Record<LabUnitKind, readonly [number, number, number]>> = {
  tank: muzzleLocal('tank'),
  bot: muzzleLocal('bot'),
  arty: muzzleLocal('arty'),
  engineer: muzzleLocal('engineer'),
  acu: muzzleLocal('acu'),
  shieldgen: muzzleLocal('shieldgen'),
  structure: muzzleLocal('structure'),
  wreck: muzzleLocal('wreck'),
};

function scale3(c: readonly [number, number, number], k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Per-army build/reclaim beam styles and spawn tints (white-hot armies per faction.md §4.3). */
interface ArmyFx {
  readonly tint: number;
  readonly build: BeamStyle;
  readonly reclaim: BeamStyle;
}

function armyFx(army: number): ArmyFx {
  const rgb = DEFAULT_ARMY_COLORS[army % DEFAULT_ARMY_COLORS.length]!;
  const g = glowTintForArmyColor(rgb);
  const base = VARKAN_BEAM_STYLES.buildStream;
  const build: BeamStyle = g.whiteHot ? { ...base, core: scale3(g.core, 2.6), glow: scale3(g.falloff, 1.2) } : base;
  return { tint: g.tint, build, reclaim: VARKAN_BEAM_STYLES.reclaimStream };
}

/** Effect indices resolved once from VARKAN_EVENT_FX. */
interface EffectIds {
  readonly weapon: Readonly<Record<LabWeapon, readonly number[]>>;
  readonly impact: Readonly<Record<LabImpactKind, readonly number[]>>;
  readonly groundFor: Readonly<Record<LabWeapon, LabImpactKind>>;
  readonly death: Readonly<Record<LabDeathClass, readonly number[]>>;
  readonly build: number;
  readonly reclaim: number;
  readonly damaged: number;
  readonly wreck: number;
  readonly missileTrail: number;
  readonly sparks: number;
}

function resolveIds(lib: EffectLibrary): EffectIds {
  const ids = (list: readonly string[]): number[] => list.map((id) => lib.indexOf(id));
  const ev = VARKAN_EVENT_FX;
  const first = (list: readonly string[]): number => lib.indexOf(list[0]!);
  return {
    weapon: {
      direct_small: ids(ev.weapon.direct_small),
      cannon: ids(ev.weapon.cannon),
      artillery: ids(ev.weapon.artillery),
      missile: ids(ev.weapon.missile),
      aa: ids(ev.weapon.aa),
    },
    impact: {
      ground: ids(ev.impact.ground),
      ground_large: ids(ev.impact.ground_large),
      unit: ids(ev.impact.unit),
      shield: ids(ev.impact.shield),
      water: ids(ev.impact.water),
    },
    groundFor: {
      direct_small: ev.groundImpactForWeapon.direct_small,
      cannon: ev.groundImpactForWeapon.cannon,
      artillery: ev.groundImpactForWeapon.artillery,
      missile: ev.groundImpactForWeapon.missile,
      aa: ev.groundImpactForWeapon.aa,
    },
    death: {
      small: ids(ev.death.small),
      medium: ids(ev.death.medium),
      large: ids(ev.death.large),
      structure: ids(ev.death.structure),
      acu: ids(ev.death.acu),
    },
    build: first(ev.build),
    reclaim: first(ev.reclaim),
    damaged: first(ev.damaged),
    wreck: first(ev.wreck),
    missileTrail: first(ev.missileTrail),
    sparks: lib.indexOf('varkan:sparks_burst'),
  };
}

const WEAPON_ID: Readonly<Record<LabWeapon, number>> = { direct_small: 0, cannon: 1, artillery: 2, missile: 3, aa: 4 };

/**
 * Impact callback: `targetKind` TARGET_*, `targetId` unit index / shield id / −1, `hit` = the projectile
 * reached its unit/shield target (false: fell on the ground), impact position in WU.
 */
export type LabImpactHandler = (
  t: number,
  targetKind: number,
  targetId: number,
  damage: number,
  hit: boolean,
  xWu: number,
  zWu: number,
  army: number,
) => void;

/** Counters of the kit (cumulative; scenes derive rates from them). */
export interface LabFxCounters {
  /** Spawned effect instances (bursts + created emitters). */
  effects: number;
  projectiles: number;
  impacts: number;
  shieldHits: number;
  kills: number;
  decals: number;
}

type MutableParticleStats = {
  alive: number;
  cap: number;
  capacity: number;
  spawnedFrame: number;
  dropped: [number, number, number];
  culled: number;
  uploadBytes: number;
  window: number;
  windowLimit: number;
  overwritten: [number, number, number];
  relocated: number;
};

// -------------------------------------------------------------------------------------------------

export class LabFxKit implements LabFx {
  readonly lib: EffectLibrary;
  readonly parts: LabFxParts;
  readonly ids: EffectIds;
  readonly counters: LabFxCounters = { effects: 0, projectiles: 0, impacts: 0, shieldHits: 0, kills: 0, decals: 0 };
  /** Set by the scene: receives every projectile impact (damage bookkeeping). */
  onImpact: LabImpactHandler | null = null;
  /** Scorch handle of the last killUnit decal (−1: none). */
  lastDecal = -1;
  /** Scale of event effects (see {@link LAB_FX_SCALE}). */
  fxScale = LAB_FX_SCALE;

  private readonly ctx: LabContext;
  private readonly armies: ArmyFx[] = [];
  private stepT = Number.NaN;
  private seedCounter = 0;
  private readonly seedBase: number;

  // ---- scratch (no allocation in the hot paths) ----
  private readonly rawA = new Int32Array(3);
  private readonly rawB = new Int32Array(3);
  private readonly dir = new Float64Array(3);
  private readonly spawnOpts: { dir: Float64Array; scale: number; seed: number; tint: number } = { dir: this.dir, scale: 1, seed: 0, tint: 0xffffff };
  private readonly streamOpts: { dir: Float64Array; scale: number; seed: number; tint: number; targetRaw: Int32Array } = {
    dir: this.dir,
    scale: 1,
    seed: 0,
    tint: 0xffffff,
    targetRaw: this.rawB,
  };
  private readonly muzzle = new Float64Array(3);
  private readonly stats_: { particles: MutableParticleStats | null; shields: { count: number; ripplesActive: number } | null; beams: number; trails: number };

  // ---- projectiles (dense SoA with swap-remove) ----
  private nProj = 0;
  private readonly pWeapon = new Uint8Array(LAB_MAX_PROJECTILES);
  private readonly pArmy = new Uint8Array(LAB_MAX_PROJECTILES);
  private readonly pTarget = new Uint8Array(LAB_MAX_PROJECTILES);
  private readonly pTargetId = new Int32Array(LAB_MAX_PROJECTILES);
  private readonly pEmitter = new Int32Array(LAB_MAX_PROJECTILES);
  /** from xyz, to xyz, prev xyz, cur xyz, t0, flight, apex, wiggle, damage, travelled. */
  private readonly pF = new Float64Array(LAB_MAX_PROJECTILES * PF);

  // ---- unit attachments ----
  private readonly damageEm = new Int32Array(LAB_UNIT_CAPACITY).fill(-1);
  private readonly wreckEm = new Int32Array(LAB_UNIT_CAPACITY).fill(-1);
  private readonly wreckUntil = new Float64Array(LAB_UNIT_CAPACITY);

  // ---- streams ----
  private readonly sMode = new Uint8Array(LAB_MAX_STREAMS);
  private readonly sEng = new Int32Array(LAB_MAX_STREAMS);
  private readonly sSrc = new Int32Array(LAB_MAX_STREAMS);
  private readonly sEm = new Int32Array(LAB_MAX_STREAMS);
  private readonly sArmy = new Uint8Array(LAB_MAX_STREAMS);
  private readonly sTarget = new Float64Array(LAB_MAX_STREAMS * 3);
  private readonly sGen = new Uint32Array(LAB_MAX_STREAMS);
  private streamsActive = 0;

  // ---- shields (state mirror for impacts) ----
  private readonly shState: { centerRaw: Int32Array; radiusWu: number; color: [number, number, number]; hpFrac: number; upFrac: number } = {
    centerRaw: new Int32Array(3),
    radiusWu: 1,
    color: [0, 0, 0],
    hpFrac: 1,
    upFrac: 1,
  };
  private readonly shIds = new Int32Array(LAB_MAX_SHIELDS).fill(-1);
  private readonly shF = new Float64Array(LAB_MAX_SHIELDS * 5);

  constructor(ctx: LabContext, parts: LabFxParts) {
    this.ctx = ctx;
    this.parts = parts;
    this.lib = parts.particles.lib;
    this.ids = resolveIds(this.lib);
    this.seedBase = fxHash32(ctx.params.seed >>> 0, 0x1ab0f7);
    for (let a = 0; a < DEFAULT_ARMY_COLORS.length; a++) this.armies.push(armyFx(a));
    this.stats_ = {
      particles: null,
      shields: null,
      beams: 0,
      trails: 0,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Time

  /** Per-step update of the GPU systems; idempotent within a step. */
  step(t: number): void {
    if (t === this.stepT) return;
    this.stepT = t;
    const p = this.parts;
    p.particles.update(t, this.ctx.camera);
    p.beams.update(t);
    p.shields.update(t);
  }

  private nextSeed(): number {
    return fxHash32(this.seedBase, this.seedCounter++) >>> 0;
  }

  private toRaw(out: Int32Array, x: number, y: number, z: number): Int32Array {
    out[0] = Math.round(x * RAW);
    out[1] = Math.round(y * RAW);
    out[2] = Math.round(z * RAW);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Low-level effect access (gallery, custom scenes)

  /** Spawns effect `effectIdx` at (x, y, z) WU along the axis (dx, dy, dz) (normalised here). Returns particles written. */
  spawnEffect(t: number, effectIdx: number, x: number, y: number, z: number, dx = 0, dy = 1, dz = 0, scale = this.fxScale, tint = 0xffffff): number {
    this.step(t);
    const l = Math.hypot(dx, dy, dz);
    const d = this.dir;
    if (l > 1e-9) {
      d[0] = dx / l;
      d[1] = dy / l;
      d[2] = dz / l;
    } else {
      d[0] = 0;
      d[1] = 1;
      d[2] = 0;
    }
    const o = this.spawnOpts;
    o.scale = scale;
    o.seed = this.nextSeed();
    o.tint = tint;
    this.counters.effects++;
    return this.parts.particles.spawn(effectIdx, this.toRaw(this.rawA, x, y, z), o);
  }

  /** Spawns every effect of an event list (VARKAN_EVENT_FX entry). */
  private spawnList(t: number, list: readonly number[], x: number, y: number, z: number, dx: number, dy: number, dz: number, scale = this.fxScale, tint = 0xffffff): void {
    for (let i = 0; i < list.length; i++) this.spawnEffect(t, list[i]!, x, y, z, dx, dy, dz, scale, tint);
  }

  /** Creates a continuous emitter (optionally a stream to a target). −1 when the emitter pool is full. */
  createEffectEmitter(
    t: number,
    effectIdx: number,
    x: number,
    y: number,
    z: number,
    tint = 0xffffff,
    target?: readonly [number, number, number],
    scale = target !== undefined ? LAB_STREAM_FX_SCALE : this.fxScale,
  ): number {
    this.step(t);
    this.counters.effects++;
    const d = this.dir;
    d[0] = 0;
    d[1] = 1;
    d[2] = 0;
    const pos = this.toRaw(this.rawA, x, y, z);
    if (target !== undefined) {
      const o = this.streamOpts;
      o.scale = scale;
      o.seed = this.nextSeed();
      o.tint = tint;
      this.toRaw(this.rawB, target[0], target[1], target[2]);
      return this.parts.particles.createEmitter(effectIdx, pos, o);
    }
    const o = this.spawnOpts;
    o.scale = scale;
    o.seed = this.nextSeed();
    o.tint = tint;
    return this.parts.particles.createEmitter(effectIdx, pos, o);
  }

  moveEffectEmitter(h: number, x: number, y: number, z: number, tx?: number, ty?: number, tz?: number): void {
    if (h < 0) return;
    const pos = this.toRaw(this.rawA, x, y, z);
    if (tx !== undefined && ty !== undefined && tz !== undefined) this.parts.particles.moveEmitter(h, pos, this.toRaw(this.rawB, tx, ty, tz));
    else this.parts.particles.moveEmitter(h, pos);
  }

  destroyEffectEmitter(h: number): void {
    if (h >= 0) this.parts.particles.destroyEmitter(h);
  }

  /** Timed beam (laser, lightning) from a to b for `lifeS`. */
  timedBeam(t: number, style: BeamStyle, ax: number, ay: number, az: number, bx: number, by: number, bz: number, lifeS: number): void {
    this.step(t);
    this.parts.beams.addTimed(this.toRaw(this.rawA, ax, ay, az), this.toRaw(this.rawB, bx, by, bz), style, t, lifeS);
  }

  // ---------------------------------------------------------------------------------------------
  // Units

  /** World position of the muzzle/tool tip of unit i (written into and returned as `out`). */
  muzzleOf(i: number, out: Float64Array = this.muzzle): Float64Array {
    const u = this.ctx.units;
    const m = MUZZLES[u.kindOf(i)];
    const yaw = u.yawOf(i);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    out[0] = u.xWu(i) + m[0] * c - m[2] * s;
    out[1] = u.yWu(i) + m[1];
    out[2] = u.zWu(i) + m[0] * s + m[2] * c;
    return out;
  }

  /** Spawn tint of an army (white-hot glow for red/orange team colors). */
  tintOf(army: number): number {
    return this.armies[army % this.armies.length]!.tint;
  }

  /**
   * Fires weapon `weapon` of unit `unit` at (tx, ty, tz): muzzle effect (VARKAN_EVENT_FX.weapon) along
   * the aim and a projectile with trail. Returns the projectile slot (−1 when the pool is full).
   */
  fireWeapon(t: number, unit: number, weapon: LabWeapon, tx: number, ty: number, tz: number, targetKind = TARGET_GROUND, targetId = -1, damage = 0): number {
    const m = this.muzzleOf(unit);
    const mx = m[0]!;
    const my = m[1]!;
    const mz = m[2]!;
    let dx = tx - mx;
    let dz = tz - mz;
    const horiz = Math.hypot(dx, dz);
    if (horiz > 1e-6) {
      dx /= horiz;
      dz /= horiz;
    } else {
      dx = 1;
      dz = 0;
    }
    // Indirect weapons point upwards (artillery ~45°, missiles ~35°), direct fire horizontally.
    const up = weapon === 'artillery' ? 1 : weapon === 'missile' ? 0.7 : weapon === 'aa' ? 2 : (ty - my) / Math.max(horiz, 1);
    this.spawnList(t, this.ids.weapon[weapon], mx, my, mz, dx, up, dz, this.fxScale, this.tintOf(this.ctx.units.armyOf(unit)));
    return this.spawnProjectile(t, weapon, this.ctx.units.armyOf(unit), mx, my, mz, tx, ty, tz, targetKind, targetId, damage);
  }

  /**
   * Launches a projectile from (fx, fy, fz) to (tx, ty, tz) on the flight path of its weapon class:
   * straight (direct fire, cannon with a slight drop), parabolic arc (artillery) or wiggling arc with a
   * missile_smoke_trail emitter (missile). Unit targets are homed at (the end point follows the unit).
   * Returns the projectile slot or −1 when the pool is full.
   */
  spawnProjectile(
    t: number,
    weapon: LabWeapon,
    army: number,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    targetKind = TARGET_GROUND,
    targetId = -1,
    damage = 0,
  ): number {
    this.step(t);
    if (this.nProj >= LAB_MAX_PROJECTILES) return -1;
    const k = this.nProj++;
    const b = BALLISTICS[weapon];
    const dist = Math.hypot(tx - fx, ty - fy, tz - fz);
    const flight = Math.min(b.maxFlight, Math.max(b.minFlight, dist / b.speed));
    this.pWeapon[k] = WEAPON_ID[weapon];
    this.pArmy[k] = army;
    this.pTarget[k] = targetKind;
    this.pTargetId[k] = targetId;
    const f = this.pF;
    const o = k * PF;
    f[o + P_FROM] = fx;
    f[o + P_FROM + 1] = fy;
    f[o + P_FROM + 2] = fz;
    f[o + P_TO] = tx;
    f[o + P_TO + 1] = ty;
    f[o + P_TO + 2] = tz;
    f[o + P_PREV] = fx;
    f[o + P_PREV + 1] = fy;
    f[o + P_PREV + 2] = fz;
    f[o + P_CUR] = fx;
    f[o + P_CUR + 1] = fy;
    f[o + P_CUR + 2] = fz;
    f[o + P_T0] = t;
    f[o + P_FLIGHT] = flight;
    f[o + P_APEX] = b.arcK * dist + b.arcC;
    // Missiles wiggle to a deterministic side.
    f[o + P_WIGGLE] = b.wiggleK * dist * ((this.nextSeed() & 1) === 0 ? 1 : -1);
    f[o + P_DAMAGE] = damage;
    f[o + P_TRAVEL] = 0;
    this.pEmitter[k] = weapon === 'missile' ? this.createEffectEmitter(t, this.ids.missileTrail, fx, fy, fz) : -1;
    this.counters.projectiles++;
    return k;
  }

  /** Projectiles in flight. */
  get projectileCount(): number {
    return this.nProj;
  }

  /** Current position (WU) of projectile slot k (tests/diagnostics). */
  projectilePos(k: number, out: Float64Array): Float64Array {
    const o = k * PF + P_CUR;
    out[0] = this.pF[o]!;
    out[1] = this.pF[o + 1]!;
    out[2] = this.pF[o + 2]!;
    return out;
  }

  /** Previous-step position (WU) of projectile slot k. */
  projectilePrev(k: number, out: Float64Array): Float64Array {
    const o = k * PF + P_PREV;
    out[0] = this.pF[o]!;
    out[1] = this.pF[o + 1]!;
    out[2] = this.pF[o + 2]!;
    return out;
  }

  /**
   * Impact effect of class `kind` (VARKAN_EVENT_FX.impact) at (x, y, z) with surface normal (nx, ny, nz);
   * large ground impacts leave a small scorch mark (VARKAN_SCORCH.impact_large).
   */
  impact(t: number, kind: LabImpactKind, x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): void {
    this.spawnList(t, this.ids.impact[kind], x, y, z, nx, ny, nz);
    this.counters.impacts++;
    if (kind === 'ground_large') {
      const s = VARKAN_SCORCH.impact_large;
      this.addDecal(t, x, z, s.kind, s.radiusWu, s.emberS, s.lifetimeS);
    }
  }

  private addDecal(t: number, x: number, z: number, kind: 'scorch' | 'crater' | 'scar', radiusWu: number, emberS: number, lifetimeS: number): number {
    const seed = this.nextSeed();
    this.lastDecal = this.ctx.scorch.add({ xWu: x, zWu: z, radiusWu, kind, rotation: ((seed >>> 8) / 16777216) * TWO_PI, seed, tS: t, lifetimeS, emberS });
    this.counters.decals++;
    return this.lastDecal;
  }

  /**
   * Kills unit i: death effects by size class (VARKAN_EVENT_FX.death, default from the kind), scorch mark
   * or crater (VARKAN_SCORCH). Small/medium/large deaths leave a wreck in place (same index, kind 'wreck')
   * with a wreck_smolder emitter for {@link WRECK_SMOLDER_S}; structures and ACUs are removed. Returns the
   * wreck index, or −1 when no wreck remains.
   */
  killUnit(t: number, i: number, cls?: LabDeathClass): number {
    const u = this.ctx.units;
    if (!u.has(i)) return -1;
    const kind = u.kindOf(i);
    const c = cls ?? deathClassOf(kind);
    const x = u.xWu(i);
    const y = u.yWu(i);
    const z = u.zWu(i);
    const lift = c === 'acu' ? 0.5 : c === 'structure' ? 2 : 0.9;
    this.spawnList(t, this.ids.death[c], x, y + lift, z, 0, 1, 0, c === 'acu' ? LAB_ACU_FX_SCALE : this.fxScale);
    const sc = VARKAN_SCORCH[c];
    this.addDecal(t, x, z, sc.kind, sc.radiusWu, sc.emberS, sc.lifetimeS);
    this.setDamaged(t, i, false);
    this.counters.kills++;
    if (c === 'structure' || c === 'acu' || kind === 'wreck') {
      this.detachWreck(i);
      u.remove(i);
      return -1;
    }
    u.set(i, { kind: 'wreck', hp: 0.55, glow: 0 });
    this.detachWreck(i);
    this.wreckEm[i] = this.createEffectEmitter(t, this.ids.wreck, x, y + 0.6, z);
    this.wreckUntil[i] = t + WRECK_SMOLDER_S;
    return i;
  }

  /**
   * Adds a wreck that died before the scene started (no explosion): wreck unit, old scorch mark without
   * embers and a wreck_smolder emitter for the remaining `smolderS` seconds. Returns the unit index (−1: full).
   */
  addWreck(t: number, x: number, z: number, yaw: number, army: number, smolderS: number, diedAgoS: number): number {
    const u = this.ctx.units;
    const i = u.add({ kind: 'wreck', army, xWu: x, zWu: z, yaw, hp: 0.55, glow: 0 });
    if (i < 0) return -1;
    const sc = VARKAN_SCORCH.small;
    this.addDecal(t - diedAgoS, x, z, sc.kind, sc.radiusWu, sc.emberS, sc.lifetimeS);
    if (smolderS > 0) {
      this.wreckEm[i] = this.createEffectEmitter(t, this.ids.wreck, x, u.yWu(i) + 0.6, z);
      this.wreckUntil[i] = t + smolderS;
    }
    return i;
  }

  /** Removes a wreck (reclaimed / sunk) and its smoulder emitter. */
  removeWreck(i: number): void {
    this.detachWreck(i);
    this.setDamaged(this.stepT, i, false);
    this.ctx.units.remove(i);
  }

  private detachWreck(i: number): void {
    const h = this.wreckEm[i]!;
    if (h >= 0) this.parts.particles.destroyEmitter(h);
    this.wreckEm[i] = -1;
  }

  /** Switches the smoke_damage emitter of unit i on/off (it follows the unit). */
  setDamaged(t: number, i: number, on: boolean): void {
    const h = this.damageEm[i]!;
    if (on) {
      if (h >= 0 || !this.ctx.units.has(i)) return;
      const u = this.ctx.units;
      this.damageEm[i] = this.createEffectEmitter(t, this.ids.damaged, u.xWu(i), u.yWu(i) + 1.4, u.zWu(i));
    } else if (h >= 0) {
      this.parts.particles.destroyEmitter(h);
      this.damageEm[i] = -1;
    }
  }

  isDamaged(i: number): boolean {
    return this.damageEm[i]! >= 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Build / reclaim streams

  /**
   * Engineer `eng` pours a build stream ("Gießstrom") at (tx, ty, tz): build_stream emitter (stream
   * motion) + BeamPass core with noise, both follow the engineer's tool tip. Returns a stream handle.
   */
  buildStream(t: number, eng: number, tx: number, ty: number, tz: number): number {
    return this.openStream(t, STREAM_BUILD, eng, -1, tx, ty, tz);
  }

  /** Engineer `eng` reclaims wreck `wreck`: reclaim_stream flows from the wreck to the tool tip. */
  reclaimStream(t: number, eng: number, wreck: number): number {
    const u = this.ctx.units;
    return this.openStream(t, STREAM_RECLAIM, eng, wreck, u.xWu(wreck), u.yWu(wreck) + 0.5, u.zWu(wreck));
  }

  /** Moves the target point of a build stream. */
  setStreamTarget(h: number, tx: number, ty: number, tz: number): void {
    const s = this.streamSlot(h);
    if (s < 0) return;
    this.sTarget[s * 3] = tx;
    this.sTarget[s * 3 + 1] = ty;
    this.sTarget[s * 3 + 2] = tz;
  }

  stopStream(h: number): void {
    const s = this.streamSlot(h);
    if (s < 0) return;
    this.destroyEffectEmitter(this.sEm[s]!);
    this.sMode[s] = 0;
    this.sGen[s] = (this.sGen[s]! + 1) & 0xffff;
    this.streamsActive--;
  }

  get streamCount(): number {
    return this.streamsActive;
  }

  private streamSlot(h: number): number {
    if (h < 0) return -1;
    const s = h & 0xff;
    return s < LAB_MAX_STREAMS && this.sMode[s] !== 0 && this.sGen[s] === h >>> 8 ? s : -1;
  }

  private openStream(t: number, mode: number, eng: number, src: number, tx: number, ty: number, tz: number): number {
    let s = -1;
    for (let k = 0; k < LAB_MAX_STREAMS; k++) {
      if (this.sMode[k] === 0) {
        s = k;
        break;
      }
    }
    if (s < 0) return -1;
    const army = this.ctx.units.armyOf(eng);
    this.sMode[s] = mode;
    this.sEng[s] = eng;
    this.sSrc[s] = src;
    this.sArmy[s] = army;
    this.sTarget[s * 3] = tx;
    this.sTarget[s * 3 + 1] = ty;
    this.sTarget[s * 3 + 2] = tz;
    const m = this.muzzleOf(eng);
    const effect = mode === STREAM_BUILD ? this.ids.build : this.ids.reclaim;
    // Build: tool tip → target. Reclaim: wreck → tool tip.
    this.sEm[s] =
      mode === STREAM_BUILD
        ? this.createEffectEmitter(t, effect, m[0]!, m[1]!, m[2]!, this.tintOf(army), [tx, ty, tz])
        : this.createEffectEmitter(t, effect, tx, ty, tz, this.tintOf(army), [m[0]!, m[1]!, m[2]!]);
    this.streamsActive++;
    return s | (this.sGen[s]! << 8);
  }

  // ---------------------------------------------------------------------------------------------
  // Shields

  /** Creates/updates shield `id` (centre WU, radius, color, hp 0..1, power 0..1). */
  setShield(id: number, x: number, y: number, z: number, radiusWu: number, color: readonly [number, number, number], hpFrac: number, upFrac: number): void {
    let slot = -1;
    let free = -1;
    for (let k = 0; k < LAB_MAX_SHIELDS; k++) {
      if (this.shIds[k] === id) {
        slot = k;
        break;
      }
      if (free < 0 && this.shIds[k] === -1) free = k;
    }
    if (slot < 0) slot = free;
    if (slot < 0) return;
    this.shIds[slot] = id;
    const f = this.shF;
    f[slot * 5] = x;
    f[slot * 5 + 1] = y;
    f[slot * 5 + 2] = z;
    f[slot * 5 + 3] = radiusWu;
    f[slot * 5 + 4] = upFrac;
    const s = this.shState;
    this.toRaw(s.centerRaw, x, y, z);
    s.radiusWu = radiusWu;
    s.color[0] = color[0];
    s.color[1] = color[1];
    s.color[2] = color[2];
    s.hpFrac = hpFrac;
    s.upFrac = upFrac;
    this.parts.shields.set(id, s);
  }

  removeShield(id: number): void {
    for (let k = 0; k < LAB_MAX_SHIELDS; k++) if (this.shIds[k] === id) this.shIds[k] = -1;
    this.parts.shields.remove(id);
  }

  private shieldSlot(id: number): number {
    for (let k = 0; k < LAB_MAX_SHIELDS; k++) if (this.shIds[k] === id) return k;
    return -1;
  }

  /** True when shield `id` exists and is powered (upFrac ≥ 0.5). */
  shieldUp(id: number): boolean {
    const s = this.shieldSlot(id);
    return s >= 0 && this.shF[s * 5 + 4]! >= 0.5;
  }

  /** Hit on shield `id` at (x, y, z): ShieldPass ripple + impact_shield along the surface normal. */
  shieldHit(t: number, id: number, x: number, y: number, z: number, strength = 1): void {
    this.step(t);
    const s = this.shieldSlot(id);
    if (s < 0) return;
    const f = this.shF;
    this.parts.shields.hit(id, this.toRaw(this.rawA, x, y, z), t, strength);
    this.impact(t, 'shield', x, y, z, x - f[s * 5]!, y - f[s * 5 + 1]!, z - f[s * 5 + 2]!);
    this.counters.shieldHits++;
  }

  // ---------------------------------------------------------------------------------------------
  // LabFx

  update(_ctx: LabContext, t: number, _dt = 0): void {
    this.step(t);
    this.advanceProjectiles(t);
    this.updateAttachments(t);
    this.rebuildStreams();
  }

  private advanceProjectiles(t: number): void {
    const f = this.pF;
    const units = this.ctx.units;
    const trails = this.parts.trails;
    trails.begin();
    let k = 0;
    while (k < this.nProj) {
      const o = k * PF;
      const weapon = LAB_WEAPONS[this.pWeapon[k]!]!;
      const tk = this.pTarget[k]!;
      const tid = this.pTargetId[k]!;
      // Home in on a living unit target.
      if (tk === TARGET_UNIT && units.has(tid) && units.kindOf(tid) !== 'wreck') {
        f[o + P_TO] = units.xWu(tid);
        f[o + P_TO + 1] = units.yWu(tid) + 1;
        f[o + P_TO + 2] = units.zWu(tid);
      }
      const s = Math.min(1, (t - f[o + P_T0]!) / f[o + P_FLIGHT]!);
      f[o + P_PREV] = f[o + P_CUR]!;
      f[o + P_PREV + 1] = f[o + P_CUR + 1]!;
      f[o + P_PREV + 2] = f[o + P_CUR + 2]!;
      const fx = f[o + P_FROM]!;
      const fy = f[o + P_FROM + 1]!;
      const fz = f[o + P_FROM + 2]!;
      const dx = f[o + P_TO]! - fx;
      const dy = f[o + P_TO + 1]! - fy;
      const dz = f[o + P_TO + 2]! - fz;
      const arc = 4 * s * (1 - s);
      const w = f[o + P_WIGGLE]! * Math.sin(Math.PI * s);
      const hl = Math.hypot(dx, dz);
      const sx = hl > 1e-6 ? -dz / hl : 0;
      const sz = hl > 1e-6 ? dx / hl : 0;
      const cx = fx + dx * s + sx * w;
      const cy = fy + dy * s + f[o + P_APEX]! * arc;
      const cz = fz + dz * s + sz * w;
      f[o + P_TRAVEL] = f[o + P_TRAVEL]! + Math.hypot(cx - f[o + P_CUR]!, cy - f[o + P_CUR + 1]!, cz - f[o + P_CUR + 2]!);
      f[o + P_CUR] = cx;
      f[o + P_CUR + 1] = cy;
      f[o + P_CUR + 2] = cz;
      if (s >= 1) {
        this.land(t, k, weapon);
        this.removeProjectile(k);
        continue;
      }
      const em = this.pEmitter[k]!;
      if (em >= 0) this.parts.particles.moveEmitter(em, this.toRaw(this.rawA, cx, cy, cz));
      const style = WEAPON_TRAIL[weapon];
      trails.add(
        this.toRaw(this.rawA, f[o + P_PREV]!, f[o + P_PREV + 1]!, f[o + P_PREV + 2]!),
        this.toRaw(this.rawB, cx, cy, cz),
        style,
        Math.min(1, f[o + P_TRAVEL]! / style.lengthWu),
      );
      k++;
    }
  }

  /** Impact of projectile k at its end point. */
  private land(t: number, k: number, weapon: LabWeapon): void {
    const f = this.pF;
    const o = k * PF;
    const x = f[o + P_CUR]!;
    const y = f[o + P_CUR + 1]!;
    const z = f[o + P_CUR + 2]!;
    const tk = this.pTarget[k]!;
    const tid = this.pTargetId[k]!;
    const units = this.ctx.units;
    let hit = false;
    if (tk === TARGET_UNIT && units.has(tid) && units.kindOf(tid) !== 'wreck') {
      // Reverse flight direction as surface normal (sparks fly back towards the shooter).
      this.impact(t, 'unit', x, y, z, f[o + P_PREV]! - x, 0.6, f[o + P_PREV + 2]! - z);
      hit = true;
    } else if (tk === TARGET_SHIELD && this.shieldUp(tid)) {
      this.shieldHit(t, tid, x, y, z, weapon === 'artillery' ? 1.4 : 1);
      hit = true;
    } else {
      const gy = this.ctx.groundHeight(x, z);
      this.impact(t, this.ids.groundFor[weapon], x, gy, z);
    }
    this.onImpact?.(t, tk, tid, f[o + P_DAMAGE]!, hit, x, z, this.pArmy[k]!);
  }

  private removeProjectile(k: number): void {
    const em = this.pEmitter[k]!;
    if (em >= 0) this.parts.particles.destroyEmitter(em);
    const last = --this.nProj;
    if (k === last) return;
    this.pWeapon[k] = this.pWeapon[last]!;
    this.pArmy[k] = this.pArmy[last]!;
    this.pTarget[k] = this.pTarget[last]!;
    this.pTargetId[k] = this.pTargetId[last]!;
    this.pEmitter[k] = this.pEmitter[last]!;
    this.pF.copyWithin(k * PF, last * PF, last * PF + PF);
  }

  private updateAttachments(t: number): void {
    const units = this.ctx.units;
    const hw = units.highWater;
    for (let i = 0; i < hw; i++) {
      const d = this.damageEm[i]!;
      if (d >= 0) {
        if (units.has(i)) this.parts.particles.moveEmitter(d, this.toRaw(this.rawA, units.xWu(i), units.yWu(i) + 1.4, units.zWu(i)));
        else {
          this.parts.particles.destroyEmitter(d);
          this.damageEm[i] = -1;
        }
      }
      const w = this.wreckEm[i]!;
      if (w >= 0 && (t >= this.wreckUntil[i]! || !units.has(i))) this.detachWreck(i);
    }
  }

  private rebuildStreams(): void {
    const beams = this.parts.beams;
    const units = this.ctx.units;
    beams.begin();
    for (let s = 0; s < LAB_MAX_STREAMS; s++) {
      const mode = this.sMode[s]!;
      if (mode === 0) continue;
      const eng = this.sEng[s]!;
      if (!units.has(eng)) {
        this.stopStream(s | (this.sGen[s]! << 8));
        continue;
      }
      const m = this.muzzleOf(eng);
      let tx = this.sTarget[s * 3]!;
      let ty = this.sTarget[s * 3 + 1]!;
      let tz = this.sTarget[s * 3 + 2]!;
      const src = this.sSrc[s]!;
      if (mode === STREAM_RECLAIM && units.has(src)) {
        tx = units.xWu(src);
        ty = units.yWu(src) + 0.5;
        tz = units.zWu(src);
      }
      const af = this.armies[this.sArmy[s]! % this.armies.length]!;
      const em = this.sEm[s]!;
      if (mode === STREAM_BUILD) {
        const a = this.toRaw(this.rawA, m[0]!, m[1]!, m[2]!);
        const b = this.toRaw(this.rawB, tx, ty, tz);
        if (em >= 0) this.parts.particles.moveEmitter(em, a, b);
        beams.add(a, b, af.build);
      } else {
        const a = this.toRaw(this.rawA, tx, ty, tz);
        const b = this.toRaw(this.rawB, m[0]!, m[1]!, m[2]!);
        if (em >= 0) this.parts.particles.moveEmitter(em, a, b);
        beams.add(a, b, af.reclaim);
      }
    }
  }

  encodeShields(enc: PassEncoder): number {
    return this.ctx.params.fxParts.shields ? this.parts.shields.encode(enc) : 0;
  }

  encodeParticles(enc: PassEncoder): number {
    return this.ctx.params.fxParts.particles ? this.parts.particles.encode(enc) : 0;
  }

  /** Segment 'beams': trails first, then beams (PLAN §3.7 "Beams/Trails"). */
  encodeBeams(enc: PassEncoder): number {
    if (!this.ctx.params.fxParts.beams) return 0;
    return this.parts.trails.encode(enc) + this.parts.beams.encode(enc);
  }

  stats(): LabFxStats {
    const st = this.stats_;
    const ps = this.parts.particles.stats;
    const p = (st.particles ??= {
      alive: 0,
      cap: 0,
      capacity: 0,
      spawnedFrame: 0,
      dropped: [0, 0, 0],
      culled: 0,
      uploadBytes: 0,
      window: 0,
      windowLimit: 0,
      overwritten: [0, 0, 0],
      relocated: 0,
    });
    p.alive = ps.alive;
    p.cap = ps.cap;
    p.capacity = ps.capacity;
    p.spawnedFrame = ps.spawnedFrame;
    p.dropped[0] = ps.dropped[0];
    p.dropped[1] = ps.dropped[1];
    p.dropped[2] = ps.dropped[2];
    p.culled = ps.culled;
    p.uploadBytes = ps.uploadBytesFrame;
    p.window = ps.window;
    p.windowLimit = ps.windowLimit;
    p.overwritten[0] = ps.overwritten[0];
    p.overwritten[1] = ps.overwritten[1];
    p.overwritten[2] = ps.overwritten[2];
    p.relocated = ps.relocated;
    const ss = this.parts.shields.stats;
    const sh = (st.shields ??= { count: 0, ripplesActive: 0 });
    sh.count = ss.shields;
    sh.ripplesActive = ss.ripplesActive;
    st.beams = this.parts.beams.stats.beams;
    st.trails = this.parts.trails.stats.trails;
    return st;
  }

  destroy(): void {
    const p = this.parts;
    p.particles.destroy();
    p.beams.destroy();
    p.trails.destroy();
    p.shields.destroy();
  }
}

// Projectile float layout.
const P_FROM = 0;
const P_TO = 3;
const P_PREV = 6;
const P_CUR = 9;
const P_T0 = 12;
const P_FLIGHT = 13;
const P_APEX = 14;
const P_WIGGLE = 15;
const P_DAMAGE = 16;
const P_TRAVEL = 17;
const PF = 18;

const STREAM_BUILD = 1;
const STREAM_RECLAIM = 2;

/** GPU parts of a scene context: ParticleSystem (preset cap), BeamPass, TrailPass, ShieldPass. */
export function createGpuFxParts(ctx: LabContext, onShake: LabShakeHook): LabFxParts {
  const dev = ctx.dev;
  const b = ctx.frame.bindings;
  return {
    particles: new ParticleSystem(dev, b, labEffectLibrary(), { cap: particleCapForPreset(ctx.preset), onShake }),
    beams: new BeamPass(dev, b, { capacity: 1024, timedCapacity: 256 }),
    trails: new TrailPass(dev, b, { capacity: LAB_MAX_PROJECTILES }),
    shields: new ShieldPass(dev, b, { capacity: LAB_MAX_SHIELDS, subdivisions: 3 }),
  };
}

/** onShake → ctx.shake.addFromEffect (posRaw → WU). */
export function labShakeHook(ctx: LabContext): LabShakeHook {
  const pos = new Float64Array(3);
  return (effect, posRaw, tS) => {
    pos[0] = posRaw[0]! / RAW;
    pos[1] = posRaw[1]! / RAW;
    pos[2] = posRaw[2]! / RAW;
    ctx.shake.addFromEffect(effect, pos, tS);
  };
}

/** The kit of a scene context; throws when the context runs another LabFx (e.g. the null FX). */
export function labFxKit(ctx: LabContext): LabFxKit {
  const fx = ctx.fx;
  if (!(fx instanceof LabFxKit)) throw new Error('fx-lab: this scene needs the LabFxKit (createLabFx)');
  return fx;
}
