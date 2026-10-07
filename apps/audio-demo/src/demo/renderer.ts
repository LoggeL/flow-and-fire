/**
 * Canvas2D top-down view of the demo battle: field, ponds, bases, units, projectiles (tracers),
 * muzzle flashes, impacts, explosions and alert pings. Effects come from the same event batches the
 * audio engine receives (pooled ring, no allocation per event).
 */

import { FX_ONE, type AudioEventSource } from '@faf/audio';
import { DEFAULT_EVENT_TYPES } from '@faf/audio/events';
import type { Camera } from './camera.ts';
import { BASES, FIELD_SIZE, PLAYER_ARMY, PONDS, TICK_S, type GefechtScenario } from './scenario.ts';

const FX_MUZZLE = 0;
const FX_IMPACT = 1;
const FX_EXPLOSION = 2;
const FX_COMMANDER = 3;
const FX_ALERT = 4;
const FX_BUILD = 5;
/** Lifetime per effect kind in sim seconds. */
const FX_LIFE = [0.12, 0.3, 0.8, 2.2, 3, 1.2];

const EFFECT_CAPACITY = 4096;

const T_FIRE = DEFAULT_EVENT_TYPES.weaponFire;
const T_IMPACT = DEFAULT_EVENT_TYPES.projectileImpact;
const T_DEATH = DEFAULT_EVENT_TYPES.unitDeath;
const T_COMMANDER_DEATH = DEFAULT_EVENT_TYPES.commanderDeath;
const T_ALERT = DEFAULT_EVENT_TYPES.alert;
const T_BUILD = DEFAULT_EVENT_TYPES.buildComplete;

const ARMY_COLOURS = ['#6fb7ff', '#ff7a5c'];
const ARMY_DARK = ['#2d5a85', '#8a3a2a'];

/** A move-order marker (right click). */
export interface MoveMarker {
  x: number;
  z: number;
  /** performance.now() of the order. */
  atMs: number;
}

export class BattleRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fxX = new Float64Array(EFFECT_CAPACITY);
  private readonly fxZ = new Float64Array(EFFECT_CAPACITY);
  private readonly fxT = new Float64Array(EFFECT_CAPACITY);
  private readonly fxKind = new Uint8Array(EFFECT_CAPACITY);
  private readonly fxSize = new Float32Array(EFFECT_CAPACITY);
  private fxHead = 0;
  private fxCount = 0;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('Canvas2D not available');
    this.ctx = ctx;
  }

  /** Canvas size in CSS pixels. */
  get width(): number {
    return this.canvas.width / this.dpr;
  }

  get height(): number {
    return this.canvas.height / this.dpr;
  }

  /** Matches the backing store to the element size (call on resize). */
  resize(): void {
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  clearEffects(): void {
    this.fxCount = 0;
    this.fxHead = 0;
  }

  private addFx(kind: number, x: number, z: number, t: number, size: number): void {
    const i = this.fxHead;
    this.fxKind[i] = kind;
    this.fxX[i] = x;
    this.fxZ[i] = z;
    this.fxT[i] = t;
    this.fxSize[i] = size;
    this.fxHead = (i + 1) % EFFECT_CAPACITY;
    if (this.fxCount < EFFECT_CAPACITY) this.fxCount++;
  }

  /** Turns one event batch into visual effects (times in sim seconds incl. subTick). */
  addEvents(src: AudioEventSource): void {
    const n = src.eventCount;
    for (let i = 0; i < n; i++) {
      const type = src.eventType(i);
      const t = (src.eventTick(i) + src.eventSubTick(i) / 256) * TICK_S;
      const x = src.eventPos(i, 0) / FX_ONE;
      const z = src.eventPos(i, 2) / FX_ONE;
      if (type === T_FIRE) this.addFx(FX_MUZZLE, x, z, t, 1);
      else if (type === T_IMPACT) this.addFx(FX_IMPACT, x, z, t, src.eventAux(i) === 1 || src.eventAux(i) === 4 ? 1.4 : 1);
      else if (type === T_DEATH) this.addFx(FX_EXPLOSION, x, z, t, 1 + src.eventAux(i));
      else if (type === T_COMMANDER_DEATH) this.addFx(FX_COMMANDER, x, z, t, 1);
      else if (type === T_ALERT) this.addFx(FX_ALERT, x, z, t, 1);
      else if (type === T_BUILD) this.addFx(FX_BUILD, x, z, t, 1);
    }
  }

  draw(sc: GefechtScenario | null, cam: Camera, simNow: number, marker: MoveMarker | null, nowMs: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#12110d';
    ctx.fillRect(0, 0, w, h);

    // World transform: screen = centre + s · (right·Δ, down·Δ).
    const s = cam.scale(w);
    const rx = cam.rightX;
    const rz = cam.rightZ;
    const a = s * rx;
    const b = -s * rz;
    const c = s * rz;
    const d = s * rx;
    const e = w / 2 - (a * cam.x + c * cam.z);
    const f = h / 2 - (b * cam.x + d * cam.z);
    ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
    const px = 1 / s; // one CSS pixel in WU

    // Ground, grid, ponds, bases.
    ctx.fillStyle = '#23201a';
    ctx.fillRect(0, 0, FIELD_SIZE, FIELD_SIZE);
    ctx.strokeStyle = '#2f2b23';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let g = 0; g <= FIELD_SIZE; g += 32) {
      ctx.moveTo(g, 0);
      ctx.lineTo(g, FIELD_SIZE);
      ctx.moveTo(0, g);
      ctx.lineTo(FIELD_SIZE, g);
    }
    ctx.stroke();
    ctx.fillStyle = '#1d3a4f';
    for (const p of PONDS) {
      ctx.beginPath();
      ctx.arc(p.x, p.z, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < BASES.length; k++) {
      const base = BASES[k]!;
      ctx.strokeStyle = ARMY_DARK[k]!;
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(base.x - 36, base.z - 180, 72, 360);
    }
    ctx.strokeStyle = '#5a5140';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(0, 0, FIELD_SIZE, FIELD_SIZE);

    if (sc !== null) {
      this.drawUnits(sc, px);
      this.drawProjectiles(sc, simNow, px);
    }
    this.drawEffects(simNow, px);

    if (marker !== null) {
      const age = (nowMs - marker.atMs) / 1000;
      if (age < 1.2) {
        ctx.strokeStyle = `rgba(120, 255, 140, ${1 - age / 1.2})`;
        ctx.lineWidth = 2 * px;
        const r = 3 + age * 6;
        ctx.beginPath();
        ctx.arc(marker.x, marker.z, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Screen-space overlay: focus cross and compass (camera right vector).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8, h / 2);
    ctx.lineTo(w / 2 + 8, h / 2);
    ctx.moveTo(w / 2, h / 2 - 8);
    ctx.lineTo(w / 2, h / 2 + 8);
    ctx.stroke();
    const cx = 36;
    const cy = h - 36;
    ctx.strokeStyle = '#cfc6b0';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.stroke();
    // World +x axis on screen: (rx, -rz) in screen coordinates.
    ctx.fillStyle = '#cfc6b0';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+x', cx + rx * 30, cy - rz * 30);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + rx * 18, cy - rz * 18);
    ctx.stroke();
  }

  private drawUnits(sc: GefechtScenario, px: number): void {
    const ctx = this.ctx;
    for (let army = 0; army < 2; army++) {
      ctx.fillStyle = ARMY_COLOURS[army]!;
      for (let i = 0; i < sc.unitCount; i++) {
        if (sc.ualive[i] === 0 || sc.uarmy[i] !== army) continue;
        const k = sc.kind(i);
        const r = Math.max(k.radius, 1.5 * px);
        const x = sc.ux[i]!;
        const z = sc.uz[i]!;
        if (k.role === 'structure') {
          ctx.fillRect(x - r, z - r, 2 * r, 2 * r);
        } else if (k.role === 'air') {
          ctx.beginPath();
          ctx.moveTo(x, z - r);
          ctx.lineTo(x + r, z + r);
          ctx.lineTo(x - r, z + r);
          ctx.fill();
        } else {
          ctx.fillRect(x - r * 0.7, z - r * 0.7, 1.4 * r, 1.4 * r);
        }
        if (k.role === 'commander') {
          ctx.strokeStyle = army === PLAYER_ARMY ? '#e8f4ff' : '#ffe1d8';
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.arc(x, z, r * 1.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  private drawProjectiles(sc: GefechtScenario, simNow: number, px: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255, 214, 120, 0.8)';
    ctx.lineWidth = Math.max(0.25, px);
    ctx.beginPath();
    for (let p = 0; p < sc.inFlight; p++) {
      const t0 = sc.pT0[p]!;
      const t1 = sc.pT1[p]!;
      const f = (simNow - t0) / (t1 - t0);
      if (f < 0 || f > 1) continue;
      const sx = sc.pSx[p]!;
      const sz = sc.pSz[p]!;
      const dx = sc.pTx[p]! - sx;
      const dz = sc.pTz[p]! - sz;
      const tail = Math.max(0, f - 0.08);
      ctx.moveTo(sx + dx * tail, sz + dz * tail);
      ctx.lineTo(sx + dx * f, sz + dz * f);
    }
    ctx.stroke();
  }

  private drawEffects(simNow: number, px: number): void {
    const ctx = this.ctx;
    const n = this.fxCount;
    for (let k = 0; k < n; k++) {
      const i = (this.fxHead - 1 - k + EFFECT_CAPACITY) % EFFECT_CAPACITY;
      const kind = this.fxKind[i]!;
      const age = simNow - this.fxT[i]!;
      const life = FX_LIFE[kind]!;
      if (age < 0 || age > life) continue;
      const q = 1 - age / life;
      const x = this.fxX[i]!;
      const z = this.fxZ[i]!;
      const size = this.fxSize[i]!;
      ctx.beginPath();
      if (kind === FX_MUZZLE) {
        ctx.fillStyle = `rgba(255, 240, 180, ${q})`;
        ctx.arc(x, z, Math.max(0.8, 2 * px), 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === FX_IMPACT) {
        ctx.fillStyle = `rgba(255, 160, 60, ${0.8 * q})`;
        ctx.arc(x, z, (1 + (1 - q) * 1.5) * size, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === FX_EXPLOSION) {
        ctx.fillStyle = `rgba(255, 110, 40, ${0.7 * q})`;
        ctx.arc(x, z, (2 + (1 - q) * 4) * size, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === FX_COMMANDER) {
        ctx.strokeStyle = `rgba(255, 250, 220, ${q})`;
        ctx.lineWidth = 3 * px;
        ctx.arc(x, z, 6 + (1 - q) * 60, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === FX_ALERT) {
        ctx.strokeStyle = `rgba(255, 60, 60, ${q})`;
        ctx.lineWidth = 2 * px;
        ctx.arc(x, z, 4 + (1 - q) * 24, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(140, 255, 160, ${q})`;
        ctx.lineWidth = 2 * px;
        ctx.arc(x, z, 4 + (1 - q) * 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
