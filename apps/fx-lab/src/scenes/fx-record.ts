/**
 * Recording FX parts for headless runs (no GPU device: tests, `createLabFx` without a device). They
 * implement the {@link LabFxParts} interfaces, draw nothing and fold every call into a checksum
 * ({@link FxCallLog}) – same seed → same log, the determinism tests compare these checksums. Effects
 * with a `shake` definition call the onShake hook like the real ParticleSystem does.
 */
import type { PassEncoder, RtsCamera } from '@faf/render';
import { fxHash32 } from '@faf/render-fx';
import type {
  BeamPassStats,
  BeamStyle,
  EffectLibrary,
  ParticleSpawnOptions,
  ParticleStats,
  ShieldPassStats,
  ShieldState,
  TrailPassStats,
  TrailStyle,
} from '@faf/render-fx';
import type { LabBeamBackend, LabFxParts, LabParticleBackend, LabShakeHook, LabShieldBackend, LabTrailBackend } from './fx.ts';

/** Operation codes of the call log. */
export const OP = {
  update: 1,
  spawn: 2,
  createEmitter: 3,
  moveEmitter: 4,
  setEmitterRate: 5,
  destroyEmitter: 6,
  beamBegin: 10,
  beamAdd: 11,
  beamTimed: 12,
  beamUpdate: 13,
  trailBegin: 20,
  trailAdd: 21,
  shieldSet: 30,
  shieldHit: 31,
  shieldRemove: 32,
  shieldUpdate: 33,
} as const;

/** Order-sensitive checksum over all recorded calls plus per-opcode counters. */
export class FxCallLog {
  hash = 0x2545f491;
  calls = 0;
  readonly count = new Int32Array(64);

  op(code: number): void {
    this.calls++;
    this.count[code]!++;
    this.hash = fxHash32(this.hash, code, this.calls);
  }

  int(v: number): void {
    this.hash = fxHash32(this.hash, v | 0);
  }

  /** Floats are quantised to 1/64 (positions are already exact raw integers). */
  num(v: number): void {
    this.hash = fxHash32(this.hash, Math.round(v * 64) | 0);
  }

  vec(v: ArrayLike<number>): void {
    for (let i = 0; i < v.length; i++) this.int(v[i]!);
  }
}

class RecordingParticles implements LabParticleBackend {
  readonly stats: ParticleStats = {
    alive: 0,
    cap: 0,
    capacity: 0,
    spawnedFrame: 0,
    requested: [0, 0, 0],
    dropped: [0, 0, 0],
    culled: 0,
    uploadBytesFrame: 0,
    emitters: 0,
    overwritten: [0, 0, 0],
    window: 0,
    windowLimit: 0,
    relocated: 0,
    draws: 0,
  };
  /** Emitter handles in use (index | generation << 10, like ParticleSystem). */
  private readonly active = new Uint8Array(1024);
  private readonly gen = new Uint16Array(1024);
  private readonly shakePos = new Int32Array(3);
  /** Burst spawns per effect index. */
  readonly spawnsByEffect: Int32Array;

  constructor(
    readonly lib: EffectLibrary,
    private readonly log: FxCallLog,
    private readonly onShake: LabShakeHook | null,
    cap: number,
  ) {
    this.stats.cap = cap;
    this.stats.capacity = 65536;
    this.spawnsByEffect = new Int32Array(lib.effects.length);
  }

  private nowS = 0;

  spawn(effectIdx: number, posRaw: ArrayLike<number>, o?: ParticleSpawnOptions): number {
    const eff = this.lib.effects[effectIdx];
    if (eff === undefined) throw new RangeError(`spawn: unknown effect ${effectIdx}`);
    const log = this.log;
    log.op(OP.spawn);
    log.int(effectIdx);
    log.vec(posRaw);
    if (o?.dir !== undefined) for (let i = 0; i < 3; i++) log.num(o.dir[i]!);
    log.num(o?.scale ?? 1);
    log.int(o?.seed ?? 0);
    log.int(o?.tint ?? 0xffffff);
    this.spawnsByEffect[effectIdx]!++;
    this.stats.spawnedFrame += eff.maxBurst;
    this.stats.requested[eff.minPriority] += eff.maxBurst;
    if (eff.shake !== null && this.onShake !== null) {
      this.shakePos[0] = posRaw[0]!;
      this.shakePos[1] = posRaw[1]!;
      this.shakePos[2] = posRaw[2]!;
      this.onShake(eff, this.shakePos, this.nowS);
    }
    return eff.maxBurst;
  }

  createEmitter(effectIdx: number, posRaw: ArrayLike<number>, o?: ParticleSpawnOptions): number {
    const eff = this.lib.effects[effectIdx];
    if (eff === undefined) throw new RangeError(`createEmitter: unknown effect ${effectIdx}`);
    if (!eff.continuous) throw new Error(`createEmitter: effect ${eff.id} is not continuous`);
    const log = this.log;
    log.op(OP.createEmitter);
    log.int(effectIdx);
    log.vec(posRaw);
    if (o?.targetRaw !== undefined) log.vec(o.targetRaw);
    log.int(o?.seed ?? 0);
    for (let i = 0; i < 1024; i++) {
      if (this.active[i] === 0) {
        this.active[i] = 1;
        this.stats.emitters++;
        return i | (this.gen[i]! << 10);
      }
    }
    return -1;
  }

  private live(h: number): number {
    const i = h & 1023;
    return h >= 0 && this.active[i] === 1 && this.gen[i] === h >>> 10 ? i : -1;
  }

  moveEmitter(h: number, posRaw: ArrayLike<number>, targetRaw?: ArrayLike<number>): void {
    const log = this.log;
    log.op(OP.moveEmitter);
    log.int(h);
    log.vec(posRaw);
    if (targetRaw !== undefined) log.vec(targetRaw);
  }

  setEmitterRate(h: number, scale: number): void {
    this.log.op(OP.setEmitterRate);
    this.log.int(h);
    this.log.num(scale);
  }

  destroyEmitter(h: number): void {
    this.log.op(OP.destroyEmitter);
    this.log.int(h);
    const i = this.live(h);
    if (i < 0) return;
    this.active[i] = 0;
    this.gen[i] = (this.gen[i]! + 1) & 0x3fffff;
    this.stats.emitters--;
  }

  update(nowS: number, _camera: RtsCamera): void {
    this.nowS = nowS;
    this.log.op(OP.update);
    this.log.num(nowS);
    this.stats.spawnedFrame = 0;
  }

  encode(_enc: PassEncoder): number {
    return 0;
  }

  destroy(): void {}
}

class RecordingBeams implements LabBeamBackend {
  readonly stats: BeamPassStats = { beams: 0, timed: 0, dropped: 0, droppedTotal: 0, draws: 0, uploadBytes: 0 };
  constructor(private readonly log: FxCallLog) {}
  begin(): void {
    this.log.op(OP.beamBegin);
    this.stats.beams = 0;
  }
  add(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle): boolean {
    this.log.op(OP.beamAdd);
    this.log.vec(fromRaw);
    this.log.vec(toRaw);
    this.log.num(style.widthWu);
    this.stats.beams++;
    return true;
  }
  addTimed(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle, t0S: number, lifeS: number): boolean {
    this.log.op(OP.beamTimed);
    this.log.vec(fromRaw);
    this.log.vec(toRaw);
    this.log.num(style.widthWu);
    this.log.num(t0S);
    this.log.num(lifeS);
    this.stats.timed++;
    return true;
  }
  update(nowS: number): void {
    this.log.op(OP.beamUpdate);
    this.log.num(nowS);
  }
  encode(_enc: PassEncoder): number {
    return 0;
  }
  destroy(): void {}
}

class RecordingTrails implements LabTrailBackend {
  readonly stats: TrailPassStats = { trails: 0, dropped: 0, droppedTotal: 0, draws: 0, uploadBytes: 0 };
  constructor(private readonly log: FxCallLog) {}
  begin(): void {
    this.log.op(OP.trailBegin);
    this.stats.trails = 0;
  }
  add(prevRaw: ArrayLike<number>, curRaw: ArrayLike<number>, style: TrailStyle, lengthScale = 1): boolean {
    this.log.op(OP.trailAdd);
    this.log.vec(prevRaw);
    this.log.vec(curRaw);
    this.log.num(style.lengthWu);
    this.log.num(lengthScale);
    this.stats.trails++;
    return true;
  }
  encode(_enc: PassEncoder): number {
    return 0;
  }
  destroy(): void {}
}

class RecordingShields implements LabShieldBackend {
  readonly stats: ShieldPassStats = { shields: 0, ripplesActive: 0, draws: 0, uploadBytes: 0, rejected: 0, hits: 0, hitsIgnored: 0 };
  private readonly ids = new Set<number>();
  constructor(private readonly log: FxCallLog) {}
  set(id: number, s: ShieldState): boolean {
    const log = this.log;
    log.op(OP.shieldSet);
    log.int(id);
    log.vec(s.centerRaw);
    log.num(s.radiusWu);
    log.num(s.hpFrac);
    log.num(s.upFrac);
    this.ids.add(id);
    this.stats.shields = this.ids.size;
    return true;
  }
  hit(id: number, pointRaw: ArrayLike<number>, nowS: number, strength = 1): number {
    const log = this.log;
    log.op(OP.shieldHit);
    log.int(id);
    log.vec(pointRaw);
    log.num(nowS);
    log.num(strength);
    if (!this.ids.has(id)) {
      this.stats.hitsIgnored++;
      return -1;
    }
    this.stats.hits++;
    return 0;
  }
  remove(id: number): boolean {
    this.log.op(OP.shieldRemove);
    this.log.int(id);
    const had = this.ids.delete(id);
    this.stats.shields = this.ids.size;
    return had;
  }
  update(nowS: number): void {
    this.log.op(OP.shieldUpdate);
    this.log.num(nowS);
  }
  encode(_enc: PassEncoder): number {
    return 0;
  }
  destroy(): void {
    this.ids.clear();
  }
}

export interface RecordingFxParts extends LabFxParts {
  readonly log: FxCallLog;
  readonly particles: LabParticleBackend & { readonly spawnsByEffect: Int32Array };
}

/** Recording parts (no GPU). `cap` is reported as particle cap. */
export function createRecordingFxParts(lib: EffectLibrary, onShake: LabShakeHook | null, cap = 16384): RecordingFxParts {
  const log = new FxCallLog();
  return {
    log,
    particles: new RecordingParticles(lib, log, onShake, cap),
    beams: new RecordingBeams(log),
    trails: new RecordingTrails(log),
    shields: new RecordingShields(log),
  };
}
