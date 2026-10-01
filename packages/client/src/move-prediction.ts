/** Bounded first-Move presentation, private to the renderer. Never changes an accepted Frame. */
import { HANDLE_INDEX_MASK } from '@faf/fixed';
import { CmdFlags, DEFAULT_FRAME_CAPS, Op, UNIT_RECORD_BYTES, UNIT_OFF_CUR_POS, UNIT_OFF_PREV_POS,
  UNIT_OFF_CUR_YAW, UNIT_OFF_PREV_YAW, UNIT_OFF_PART_BASE, UNIT_OFF_PART_COUNT, PART_RECORD_BYTES, UnitFlags, type FrameReader } from '@faf/protocol';
import { MotionLayer } from '@faf/rules';
import type { VisualTable } from '@faf/render';
import { seqAcked } from './commands.ts';
import { BASE_TICK_MS } from './frames.ts';
import type { ClientMap } from './map.ts';
import { interpolatedPos } from './selection.ts';
import { interpolatedYaw } from './metrics.ts';
import type { RigVisualEntry } from './visuals.ts';

/** Public compiled blueprint metadata; no Sim/World reference or enemy observations. */
export interface MovePredictionMotion {
  readonly count: number;
  readonly speed: Int32Array;
  readonly turnRate: Int32Array;
  readonly layerCol: Uint8Array;
}
export const MOVE_PREVIEW_MS = 200;
export const MOVE_RECONCILE_MS = 100;
export const MOVE_PREVIEW_MAX_RAW = 2048;
const EXCLUDED = UnitFlags.Building | UnitFlags.Wreck | UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.NoInterp | UnitFlags.Paused;
const diff = (a: number, b: number): number => ((a - b + 98304) % 65536) - 32768;

export class MovePredictionAdapter {
  private readonly buffer = new Uint8Array(DEFAULT_FRAME_CAPS.units * UNIT_RECORD_BYTES);
  private readonly dv = new DataView(this.buffer.buffer);
  private readonly partBuffer = new Uint8Array(DEFAULT_FRAME_CAPS.parts * PART_RECORD_BYTES);
  private readonly partDv = new DataView(this.partBuffer.buffer);
  private readonly handles = new Uint32Array(DEFAULT_FRAME_CAPS.units);
  private readonly seen = new Uint32Array(DEFAULT_FRAME_CAPS.units);
  private readonly visuals = new Uint16Array(DEFAULT_FRAME_CAPS.units);
  private readonly armies = new Uint8Array(DEFAULT_FRAME_CAPS.units);
  private readonly phase = new Uint8Array(DEFAULT_FRAME_CAPS.units);
  private readonly appliedMotion = new Uint8Array(DEFAULT_FRAME_CAPS.units);
  private readonly seq = new Uint16Array(DEFAULT_FRAME_CAPS.units);
  private readonly begun = new Float64Array(DEFAULT_FRAME_CAPS.units);
  private readonly origins = new Float64Array(DEFAULT_FRAME_CAPS.units * 4);
  private readonly directions = new Float64Array(DEFAULT_FRAME_CAPS.units * 3);
  private readonly shown = new Float64Array(DEFAULT_FRAME_CAPS.units * 4);
  private readonly correction = new Float64Array(DEFAULT_FRAME_CAPS.units * 4);
  private readonly blendAt = new Float64Array(DEFAULT_FRAME_CAPS.units);
  private readonly p = new Float64Array(3);
  private lastTick = -1;
  private lastViewer = -2;
  private lastFrameSeq = 0;
  private epoch = 0;
  private sourceView: DataView<ArrayBufferLike> = this.dv;
  private overridden = false;
  active = 0;
  version = 0;
  units: Uint8Array = this.buffer;
  parts: Uint8Array = this.partBuffer;
  /** Cached view over the exact units most recently prepared for render/metrics. */
  rendered: DataView<ArrayBufferLike> = this.dv;

  reset(): void { this.phase.fill(0); this.active = 0; this.lastTick = -1; this.lastViewer = -2; this.lastFrameSeq = 0; }

  cancel(units: ArrayLike<number>): void {
    for (let k = 0; k < units.length; k++) {
      const h = units[k]! >>> 0, slot = h & HANDLE_INDEX_MASK;
      if (slot < this.phase.length && this.handles[slot] === h && this.phase[slot] !== 0) this.drop(slot);
    }
  }

  issued(op: number, flags: number, units: ArrayLike<number>, payload: Uint8Array, seq: number,
    now: number, frame: FrameReader | null, alpha: number, army: number,
    motion: MovePredictionMotion | undefined, paused: boolean): void {
    // Append never starts an immediate preview. It also cannot replace an earlier running order.
    if ((flags & CmdFlags.Queue) !== 0 && op !== Op.Stop) return;
    this.cancel(units);
    if (op !== Op.Move || payload.length !== 12 || frame === null || motion === undefined || paused) return;
    const wire = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const tx = wire.getInt32(0, true), tz = wire.getInt32(8, true);
    const wanted = new Set<number>();
    for (let k = 0; k < units.length; k++) wanted.add(units[k]! >>> 0);
    for (let i = 0; i < frame.unitCount; i++) {
      const h = frame.unitHandle(i), slot = h & HANDLE_INDEX_MASK, visual = frame.unitVisual(i);
      if (!wanted.has(h) || slot >= this.phase.length || frame.unitArmy(i) !== army || visual >= motion.count ||
        frame.unitBuild(i) !== 255 ||
        (frame.unitFlags(i) & (EXCLUDED | UnitFlags.Idle)) !== UnitFlags.Idle ||
        motion.layerCol[visual] !== MotionLayer.Land || motion.speed[visual]! <= 0 ||
        frame.unitPrevYaw(i) !== frame.unitCurYaw(i)) continue;
      let still = true;
      for (let c = 0; c < 3; c++) still &&= frame.unitPrev(i, c) === frame.unitCur(i, c);
      if (!still) continue;
      interpolatedPos(frame, i, alpha, this.p);
      const dx = tx - this.p[0]!, dz = tz - this.p[2]!, distance = Math.hypot(dx, dz);
      if (distance < 1) continue;
      const o = slot * 4, d = slot * 3;
      // A reset discards the render history. A new preview still has a real accepted basis,
      // even when no presentation update has happened since that reset.
      this.lastTick = frame.tick; this.lastViewer = frame.viewer; this.lastFrameSeq = frame.seq;
      this.handles[slot] = h; this.phase[slot] = 1; this.seq[slot] = seq;
      this.appliedMotion[slot] = 0;
      this.visuals[slot] = visual; this.armies[slot] = army;
      this.begun[slot] = now; this.active++;
      for (let c = 0; c < 3; c++) this.origins[o + c] = this.shown[o + c] = this.p[c]!;
      this.origins[o + 3] = this.shown[o + 3] = frame.unitCurYaw(i);
      this.directions[d] = dx / distance; this.directions[d + 1] = dz / distance;
      this.directions[d + 2] = Math.min(distance, MOVE_PREVIEW_MAX_RAW);
    }
  }

  update(frame: FrameReader, units: Uint8Array, parts: Uint8Array, alpha: number, now: number,
    newFrame: boolean, motion: MovePredictionMotion | undefined, map: ClientMap,
    table: VisualTable, paused: boolean): void {
    if (paused || motion === undefined || frame.unitCount > DEFAULT_FRAME_CAPS.units ||
      units.byteLength < frame.unitCount * UNIT_RECORD_BYTES || units.byteLength > this.buffer.byteLength || parts.byteLength > this.partBuffer.byteLength ||
      (newFrame && this.lastTick >= 0 && (frame.viewer !== this.lastViewer ||
        (frame.tick !== this.lastTick + 1 && (frame.seq !== this.lastFrameSeq || frame.tick !== this.lastTick))))) this.reset();
    if (newFrame) { this.lastTick = frame.tick; this.lastViewer = frame.viewer; this.lastFrameSeq = frame.seq; }
    this.units = units; this.parts = parts;
    if (this.active === 0) {
      if (this.overridden) { this.version++; this.overridden = false; }
      this.bind(units); return;
    }
    this.bind(units);
    const source = this.sourceView;
    if (++this.epoch === 0xffffffff) { this.seen.fill(0); this.epoch = 1; }
    this.buffer.set(units); this.partBuffer.set(parts);
    this.overridden = true;
    this.units = this.buffer; this.parts = this.partBuffer; this.rendered = this.dv; this.version++;
    for (let i = 0; i < frame.unitCount; i++) {
      const h = frame.unitHandle(i), slot = h & HANDLE_INDEX_MASK;
      if (slot >= this.phase.length || this.phase[slot] === 0 || this.handles[slot] !== h) continue;
      this.seen[slot] = this.epoch;
      if ((frame.unitFlags(i) & EXCLUDED) !== 0 || frame.unitBuild(i) !== 255 || frame.unitVisual(i) !== this.visuals[slot] || frame.unitArmy(i) !== this.armies[slot]) { this.drop(slot); continue; }
      const o = slot * 4, d = slot * 3, visual = frame.unitVisual(i);
      interpolatedPos(frame, i, alpha, this.p);
      const yaw = interpolatedYaw(frame, i, alpha, false);
      if (newFrame && (frame.unitPrevYaw(i) !== frame.unitCurYaw(i) || frame.unitPrev(i, 0) !== frame.unitCur(i, 0) ||
        frame.unitPrev(i, 2) !== frame.unitCur(i, 2))) this.appliedMotion[slot] = 1;
      // Cover one nominal tick of initial visual response. An accepted frame at alpha≈0
      // cannot hand control straight back to the delayed display before that response is shown.
      const elapsed = now - this.begun[slot]!;
      const rejected = newFrame && frame.ackSeq > 0 && seqAcked(frame.ackSeq, this.seq[slot]!) &&
        (frame.unitFlags(i) & UnitFlags.Idle) !== 0;
      if (this.phase[slot] === 1 && (elapsed >= MOVE_PREVIEW_MS || rejected ||
        (this.appliedMotion[slot] !== 0 && elapsed >= BASE_TICK_MS * 1000 / Math.max(1, frame.speedPermille)))) {
        this.phase[slot] = 2; this.blendAt[slot] = now;
        for (let c = 0; c < 3; c++) this.correction[o + c] = this.shown[o + c]! - this.p[c]!;
        this.correction[o + 3] = diff(this.shown[o + 3]!, yaw);
      }
      let shownYaw = yaw;
      if (this.phase[slot] === 1) {
        const ticks = Math.max(0, now - this.begun[slot]!) / BASE_TICK_MS * frame.speedPermille / 1000;
        // This first presentation uses the public top-speed bound, capped at half a WU.
        // It predicts no path, separation, acceleration or authoritative acceptance.
        const travel = Math.min(this.directions[d + 2]!, motion!.speed[visual]! * ticks);
        this.p[0] = this.origins[o]! + this.directions[d]! * travel;
        this.p[2] = this.origins[o + 2]! + this.directions[d + 1]! * travel;
        this.p[1] = map.heightAtRaw(Math.round(this.p[0]!), Math.round(this.p[2]!));
        const want = Math.atan2(this.directions[d + 1]!, this.directions[d]!) * 65536 / (2 * Math.PI);
        const turn = diff(want, this.origins[o + 3]!);
        const limit = motion!.turnRate[visual]! * ticks;
        shownYaw = this.origins[o + 3]! + Math.max(-limit, Math.min(limit, turn));
      } else {
        const k = Math.max(0, 1 - (now - this.blendAt[slot]!) / MOVE_RECONCILE_MS);
        if (k === 0) { this.drop(slot); continue; }
        for (let c = 0; c < 3; c++) this.p[c] = this.p[c]! + this.correction[o + c]! * k;
        shownYaw += this.correction[o + 3]! * k;
      }
      for (let c = 0; c < 3; c++) {
        const value = Math.round(this.p[c]!); this.shown[o + c] = value;
        this.dv.setInt32(i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_POS + c * 4, value, true);
        this.dv.setInt32(i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_POS + c * 4, value, true);
      }
      const angle = Math.round(shownYaw) & 65535; this.shown[o + 3] = angle;
      this.dv.setUint16(i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_YAW, angle, true);
      this.dv.setUint16(i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_YAW, angle, true);
      // Mount poses are relative to the hull. Preserve accepted world aim during body preview.
      const rig = (table[visual] as RigVisualEntry | undefined)?.rig;
      const partBase = source.getUint32(i * UNIT_RECORD_BYTES + UNIT_OFF_PART_BASE, true);
      const partCount = source.getUint8(i * UNIT_RECORD_BYTES + UNIT_OFF_PART_COUNT);
      const offset = diff(angle, yaw);
      for (let k = 0; k < partCount; k++) if (rig?.[k + 1]?.yaw) {
        const p = (partBase + k) * PART_RECORD_BYTES;
        this.partDv.setUint16(p, this.partDv.getUint16(p, true) - offset, true);
        this.partDv.setUint16(p + 2, this.partDv.getUint16(p + 2, true) - offset, true);
      }
    }
    // Missing/replaced handles cannot inherit a stale visual preview.
    for (let slot = 0; slot < this.phase.length; slot++) if (this.phase[slot] !== 0 && this.seen[slot] !== this.epoch) this.drop(slot);
  }

  private drop(slot: number): void { this.phase[slot] = 0; this.active--; }
  private bind(bytes: Uint8Array): void {
    if (this.sourceView.buffer !== bytes.buffer || this.sourceView.byteOffset !== bytes.byteOffset || this.sourceView.byteLength !== bytes.byteLength)
      this.sourceView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.rendered = this.sourceView;
  }
}
