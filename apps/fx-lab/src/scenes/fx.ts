/** Gameplay-shaped lab wiring. Positions at this boundary are WU; GPU records are Q20.12. */
import { BeamPass, ParticleSystem, ShieldPass, TrailPass, VARKAN_BEAM_STYLES, VARKAN_EFFECTS, VARKAN_EVENT_FX, VARKAN_TRAIL_STYLES, compileEffectLibrary, particleCapForPreset } from '@faf/render-fx';
import type { ShieldState, VarkanDeathClass, VarkanImpactClass, VarkanWeaponClass } from '@faf/render-fx';
import type { PassEncoder } from '@faf/render';
import type { LabContext, LabFx, LabFxStats } from '../app/context.ts';

export type Pos = readonly [number, number, number];
export interface SceneFx extends LabFx {
  burst(id: string, p: Pos, t: number, scale?: number): void;
  emitter(id: string, p: Pos, target?: Pos, rate?: number): number;
  moveEmitter(h: number, p: Pos, target?: Pos): void;
  stopEmitter(h: number): void;
  fireWeapon(kind: VarkanWeaponClass, from: Pos, to: Pos, t: number): void;
  impact(kind: VarkanImpactClass, p: Pos, t: number): void;
  killUnit(index: number, kind: VarkanDeathClass, t: number): void;
  stream(kind: 'build' | 'reclaim', from: Pos, to: Pos): number;
  shield(id: number, state: ShieldState): void;
  hitShield(id: number, p: Pos, t: number): void;
}
export function sceneFx(ctx: LabContext): SceneFx { return ctx.fx as SceneFx; }
export function raw(p: Pos): Int32Array { return new Int32Array(p.map(v => Math.round(v * 4096))); }
export function groundPos(ctx: LabContext, x: number, z: number, lift = 0): Pos { return [x, ctx.groundHeight(x, z) + lift, z]; }

interface Projectile { kind: VarkanWeaponClass; from: Pos; to: Pos; born: number; life: number; prev: Int32Array; cur: Int32Array; smoke: number; }
interface Stream { kind: 'build' | 'reclaim'; from: Pos; to: Pos; }
interface Wreck { index: number; emitter: number; until: number; }
const LIBRARY = compileEffectLibrary(VARKAN_EFFECTS);

class RealLabFx implements SceneFx {
  private readonly particles: ParticleSystem;
  private readonly beams: BeamPass;
  private readonly trails: TrailPass;
  private readonly shields: ShieldPass;
  private readonly projectiles: Projectile[] = [];
  private readonly streams = new Map<number, Stream>();
  private readonly wrecks: Wreck[] = [];
  constructor(private readonly ctx: LabContext) {
    const bindings = ctx.frame.bindings;
    this.particles = new ParticleSystem(ctx.dev, bindings, LIBRARY, {
      cap: particleCapForPreset(ctx.preset),
      onShake: (effect, pos, t) => ctx.shake.addFromEffect(effect, [pos[0]! / 4096, pos[1]! / 4096, pos[2]! / 4096], t),
    });
    this.beams = new BeamPass(ctx.dev, bindings);
    this.trails = new TrailPass(ctx.dev, bindings);
    this.shields = new ShieldPass(ctx.dev, bindings);
  }
  burst(id: string, p: Pos, _t: number, scale = 1): void {
    if (this.ctx.params.fx) this.particles.spawn(LIBRARY.indexOf(id), raw(p), { seed: this.ctx.rng.next(), scale });
  }
  emitter(id: string, p: Pos, target?: Pos, rate = 1): number {
    if (!this.ctx.params.fx) return -1;
    const h = this.particles.createEmitter(LIBRARY.indexOf(id), raw(p), { seed: this.ctx.rng.next(), ...(target ? { targetRaw: raw(target) } : {}) });
    this.particles.setEmitterRate(h, rate);
    return h;
  }
  moveEmitter(h: number, p: Pos, target?: Pos): void {
    if (h < 0) return;
    this.particles.moveEmitter(h, raw(p), target ? raw(target) : undefined);
    const s = this.streams.get(h);
    if (s) { s.from = p; if (target) s.to = target; }
  }
  stopEmitter(h: number): void { if (h >= 0) this.particles.destroyEmitter(h); this.streams.delete(h); }
  stream(kind: 'build' | 'reclaim', from: Pos, to: Pos): number {
    const h = this.emitter(VARKAN_EVENT_FX[kind][0]!, from, to);
    if (h >= 0) this.streams.set(h, { kind, from, to });
    return h;
  }
  fireWeapon(kind: VarkanWeaponClass, from: Pos, to: Pos, t: number): void {
    if (!this.ctx.params.fx) return;
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], length = Math.hypot(...d) || 1;
    for (const id of VARKAN_EVENT_FX.weapon[kind]) this.particles.spawn(LIBRARY.indexOf(id), raw(from), { dir: d.map(v => v / length), seed: this.ctx.rng.next() });
    if (this.projectiles.length >= 2048) return;
    const life = kind === 'artillery' ? 1.4 : kind === 'missile' ? 1.05 : 0.35;
    this.projectiles.push({ kind, from, to, born: t, life, prev: raw(from), cur: raw(from), smoke: kind === 'missile' ? this.emitter(VARKAN_EVENT_FX.missileTrail[0]!, from) : -1 });
  }
  impact(kind: VarkanImpactClass, p: Pos, t: number): void {
    for (const id of VARKAN_EVENT_FX.impact[kind]) this.burst(id, p, t);
    if (kind === 'ground' || kind === 'ground_large') this.ctx.scorch.add({ xWu: p[0], zWu: p[2], radiusWu: kind === 'ground_large' ? 3.5 : 1.3, kind: 'scorch', rotation: this.ctx.rng.range(0, 6.28), seed: this.ctx.rng.next(), tS: t, lifetimeS: 30, emberS: 2 });
  }
  killUnit(index: number, kind: VarkanDeathClass, t: number): void {
    const u = this.ctx.units.get(index);
    if (!u) return;
    const p: Pos = [u.xWu, u.yWu, u.zWu];
    for (const id of VARKAN_EVENT_FX.death[kind]) this.burst(id, p, t);
    this.ctx.units.remove(index);
    const w = this.ctx.units.add({ kind: 'wreck', army: u.army, xWu: u.xWu, zWu: u.zWu, yaw: u.yaw, hp: 0.1, glow: 0.4 });
    this.wrecks.push({ index: w, emitter: this.emitter(VARKAN_EVENT_FX.wreck[0]!, p), until: t + 3 });
    this.ctx.scorch.add({ xWu: p[0], zWu: p[2], radiusWu: kind === 'acu' ? 17 : kind === 'large' ? 5 : 2.5, kind: kind === 'acu' ? 'crater' : 'scorch', rotation: this.ctx.rng.range(0, 6.28), seed: this.ctx.rng.next(), tS: t, lifetimeS: 60, emberS: kind === 'acu' ? 8 : 3 });
  }
  shield(id: number, state: ShieldState): void { if (this.ctx.params.fx) this.shields.set(id, state); }
  hitShield(id: number, p: Pos, t: number): void { if (this.ctx.params.fx) { this.shields.hit(id, raw(p), t); this.impact('shield', p, t); } }
  update(ctx: LabContext, t: number, _dt: number): void {
    this.trails.begin();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.prev.set(p.cur);
      const a = Math.min(1, (t - p.born) / p.life);
      for (let k = 0; k < 3; k++) p.cur[k] = Math.round((p.from[k]! + (p.to[k]! - p.from[k]!) * a + (k === 1 && p.kind === 'artillery' ? Math.sin(a * Math.PI) * 25 : 0)) * 4096);
      if (p.smoke >= 0) this.particles.moveEmitter(p.smoke, p.cur);
      const style = p.kind === 'direct_small' ? 'tracer' : p.kind;
      this.trails.add(p.prev, p.cur, VARKAN_TRAIL_STYLES[style]);
      if (a >= 1) { this.impact(VARKAN_EVENT_FX.groundImpactForWeapon[p.kind], p.to, t); this.stopEmitter(p.smoke); this.projectiles.splice(i, 1); }
    }
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i]!;
      if (t >= w.until) { ctx.units.remove(w.index); this.stopEmitter(w.emitter); this.wrecks.splice(i, 1); }
    }
    this.beams.update(t);
    this.shields.update(t);
    this.particles.update(t, ctx.camera);
  }
  encodeShields(enc: PassEncoder): number { return this.ctx.params.fx ? this.shields.encode(enc) : 0; }
  encodeParticles(enc: PassEncoder): number { return this.ctx.params.fx ? this.particles.encode(enc) : 0; }
  encodeBeams(enc: PassEncoder): number {
    if (!this.ctx.params.fx) return 0;
    this.beams.begin();
    for (const s of this.streams.values()) this.beams.add(raw(s.from), raw(s.to), s.kind === 'build' ? VARKAN_BEAM_STYLES.buildStream : VARKAN_BEAM_STYLES.reclaimStream);
    return this.trails.encode(enc) + this.beams.encode(enc);
  }
  stats(): LabFxStats {
    const p = this.particles.stats, s = this.shields.stats;
    return { particles: { alive: p.alive, cap: p.cap, capacity: p.capacity, spawnedFrame: p.spawnedFrame, dropped: p.dropped, culled: p.culled, uploadBytes: p.uploadBytesFrame }, shields: { count: s.shields, ripplesActive: s.ripplesActive }, beams: this.beams.stats.beams, trails: this.trails.stats.trails };
  }
  destroy(): void { this.particles.destroy(); this.beams.destroy(); this.trails.destroy(); this.shields.destroy(); }
}
export function createLabFx(ctx: LabContext): SceneFx { return new RealLabFx(ctx); }
