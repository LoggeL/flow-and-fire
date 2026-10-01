/** Expands private-safe mount observations into render-only poses for the original GLB hierarchy. */
import { HANDLE_INDEX_MASK } from '@faf/fixed';
import {
  DEFAULT_FRAME_CAPS, MAX_PARTS_PER_UNIT, PART_RECORD_BYTES, UNIT_RECORD_BYTES,
  UNIT_OFF_FLAGS, UNIT_OFF_PART_BASE, UNIT_OFF_PART_COUNT, UNIT_OFF_RESERVED, UnitFlags,
  type FrameReader,
} from '@faf/protocol';
import type { VisualTable } from '@faf/render';
import type { RigVisualEntry } from './visuals.ts';

export interface RigPoseStats {
  animatedUnits: number;
  walkingUnits: number;
  observedMounts: number;
  overflowUnits: number;
}

/** Fixed buffers/history are reused. The adapter never writes the accepted frame or Sim state. */
export class RigPoseAdapter {
  readonly stats: RigPoseStats = { animatedUnits: 0, walkingUnits: 0, observedMounts: 0, overflowUnits: 0 };
  readonly unitBuffer = new Uint8Array(DEFAULT_FRAME_CAPS.units * UNIT_RECORD_BYTES);
  readonly partBuffer: Uint8Array;
  units: Uint8Array = this.unitBuffer;
  parts: Uint8Array;
  partCount = 0;
  version = 0;
  private readonly unitView = new DataView(this.unitBuffer.buffer);
  private readonly partView: DataView;
  private readonly handles = new Uint32Array(DEFAULT_FRAME_CAPS.units);
  private readonly seen = new Uint32Array(DEFAULT_FRAME_CAPS.units);
  private readonly masks = new Uint8Array(DEFAULT_FRAME_CAPS.units);
  private readonly visuals = new Uint16Array(DEFAULT_FRAME_CAPS.units);
  private readonly yaw = new Uint16Array(DEFAULT_FRAME_CAPS.units * MAX_PARTS_PER_UNIT);
  private readonly pitch = new Int16Array(DEFAULT_FRAME_CAPS.units * MAX_PARTS_PER_UNIT);
  private readonly gaitPhase = new Float64Array(DEFAULT_FRAME_CAPS.units);
  private readonly gaitPitch = new Int16Array(DEFAULT_FRAME_CAPS.units);
  private epoch = 0;
  private tick = -1;
  private viewer = -2;

  constructor(readonly partCapacity = DEFAULT_FRAME_CAPS.parts) {
    if (!Number.isInteger(partCapacity) || partCapacity < 0 || partCapacity > DEFAULT_FRAME_CAPS.parts) throw new RangeError('rig part capacity');
    this.partBuffer = new Uint8Array(partCapacity * PART_RECORD_BYTES);
    this.parts = this.partBuffer;
    this.partView = new DataView(this.partBuffer.buffer);
  }

  reset(): void {
    this.seen.fill(0);
    this.masks.fill(0);
    this.epoch = 0;
    this.tick = -1;
    this.viewer = -2;
  }

  update(frame: FrameReader, units: Uint8Array, parts: Uint8Array, table: VisualTable): void {
    if (frame.tick !== this.tick + 1 || frame.viewer !== this.viewer || this.epoch === 0xffffffff) this.reset();
    this.tick = frame.tick;
    this.viewer = frame.viewer;
    const epoch = ++this.epoch;
    this.version++;
    const stats = this.stats;
    stats.animatedUnits = stats.walkingUnits = stats.observedMounts = stats.overflowUnits = 0;
    let flagged = false;
    for (let i = 0; i < frame.unitCount; i++) if ((frame.unitFlags(i) & UnitFlags.MountAimParts) !== 0) { flagged = true; break; }
    this.units = units;
    this.parts = parts;
    this.partCount = frame.partCount;
    if (!flagged) return;
    // The public frame capacity bounds the accepted live output. Reject malformed oversized input.
    if (frame.unitCount > DEFAULT_FRAME_CAPS.units) throw new RangeError('rig unit capacity');
    this.unitBuffer.set(units);
    this.units = this.unitBuffer;
    this.parts = this.partBuffer;
    this.partCount = 0;
    const dv = this.unitView;
    for (let i = 0; i < frame.unitCount; i++) {
      const o = i * UNIT_RECORD_BYTES;
      const flags = frame.unitFlags(i);
      const sourceBase = frame.unitPartBase(i);
      const sourceCount = frame.unitPartCount(i);
      const outBase = this.partCount;
      if ((flags & UnitFlags.MountAimParts) === 0) {
        // Preserve legacy direct mesh-part records and their addressing after repacking.
        if (sourceBase + sourceCount <= frame.partCount && outBase + sourceCount <= this.partCapacity) {
          for (let k = 0; k < sourceCount; k++) this.copyPart(frame, sourceBase + k);
          dv.setUint32(o + UNIT_OFF_PART_BASE, outBase, true);
        } else {
          dv.setUint8(o + UNIT_OFF_PART_COUNT, 0);
          stats.overflowUnits++;
        }
        continue;
      }
      dv.setUint16(o + UNIT_OFF_FLAGS, flags & ~UnitFlags.MountAimParts, true);
      dv.setUint8(o + UNIT_OFF_RESERVED, 0);
      dv.setUint8(o + UNIT_OFF_PART_COUNT, 0);
      const visual = frame.unitVisual(i);
      const rig = (table[visual] as RigVisualEntry | null | undefined)?.rig;
      if (rig === undefined || rig.length < 2) continue;
      const count = rig.length - 1;
      if (count > MAX_PARTS_PER_UNIT || outBase + count > this.partCapacity || sourceBase + sourceCount > frame.partCount) {
        stats.overflowUnits++;
        continue;
      }
      const handle = frame.unitHandle(i);
      const slot = handle & HANDLE_INDEX_MASK;
      const bounded = slot < this.handles.length;
      const mask = frame.unitMountAimMask(i) & ((1 << Math.min(sourceCount, MAX_PARTS_PER_UNIT)) - 1);
      const history = bounded && this.seen[slot] !== 0 && this.seen[slot] === epoch - 1 && this.handles[slot] === handle && this.visuals[slot] === visual && (flags & UnitFlags.NoInterp) === 0;
      const previousMask = history ? this.masks[slot]! : 0;
      // One four-WU travel cycle, opposite 24-degree hip swings. There is no wall-clock
      // motion: paused or stationary accepted frames return the legs to their rest pose.
      const distance = (flags & UnitFlags.NoInterp) !== 0 ? 0 : Math.hypot(
        frame.unitCur(i, 0) - frame.unitPrev(i, 0), frame.unitCur(i, 2) - frame.unitPrev(i, 2)) / 4096;
      const previousPhase = history ? this.gaitPhase[slot]! : 0;
      const phase = (previousPhase + distance * Math.PI / 2) % (Math.PI * 2);
      const gaitPitch = distance > 0 ? Math.round(Math.sin(phase) * 4369) : 0;
      const previousGaitPitch = history ? this.gaitPitch[slot]! : 0;
      let walking = false;
      for (let k = 1; k <= count; k++) {
        const binding = rig[k];
        let py = 0, cy = 0, pp = 0, cp = 0;
        if (binding?.gait !== undefined) {
          pp = previousGaitPitch * binding.gait;
          cp = gaitPitch * binding.gait;
          walking ||= distance > 0;
        } else if (binding !== undefined && binding.mount >= 0 && binding.mount < sourceCount && (mask & (1 << binding.mount)) !== 0) {
          const m = binding.mount;
          const index = sourceBase + m;
          const worldYaw = frame.partCurYaw(index);
          const elevation = frame.partCurPitch(index);
          const h = slot * MAX_PARTS_PER_UNIT + m;
          const prior = (previousMask & (1 << m)) !== 0;
          if (binding.yaw) {
            cy = (worldYaw - frame.unitCurYaw(i)) & 65535;
            // On a reset hold the observed world direction while the hull moves, except NoInterp.
            py = ((prior ? this.yaw[h]! : worldYaw) - ((flags & UnitFlags.NoInterp) !== 0 ? frame.unitCurYaw(i) : frame.unitPrevYaw(i))) & 65535;
          }
          if (binding.pitch) { cp = elevation; pp = prior ? this.pitch[h]! : elevation; }
        }
        this.writePart(py, cy, pp, cp);
      }
      if (bounded) {
        for (let m = 0; m < Math.min(sourceCount, MAX_PARTS_PER_UNIT); m++) {
          const h = slot * MAX_PARTS_PER_UNIT + m;
          this.yaw[h] = frame.partCurYaw(sourceBase + m);
          this.pitch[h] = frame.partCurPitch(sourceBase + m);
          if ((mask & (1 << m)) !== 0) stats.observedMounts++;
        }
        this.seen[slot] = epoch;
        this.handles[slot] = handle;
        this.visuals[slot] = visual;
        this.masks[slot] = mask;
        this.gaitPhase[slot] = phase;
        this.gaitPitch[slot] = gaitPitch;
      }
      dv.setUint32(o + UNIT_OFF_PART_BASE, outBase, true);
      dv.setUint8(o + UNIT_OFF_PART_COUNT, count);
      stats.animatedUnits++;
      if (walking) stats.walkingUnits++;
    }
  }

  /** On-demand diagnostics of the buffers actually submitted to the renderer. No World access. */
  inspect(frame: FrameReader, handle: number, alpha: number): Readonly<{
    handle: number; tick: number; viewer: number; alpha: number; observationMask: number;
    bodyPrevYaw: number; bodyCurYaw: number;
    parts: readonly Readonly<{ id: number; prevYaw: number; curYaw: number; prevPitch: number; curPitch: number }>[];
  }> | null {
    let index = -1;
    for (let i = 0; i < frame.unitCount; i++) if (frame.unitHandle(i) === handle) { index = i; break; }
    if (index < 0) return null;
    const u = new DataView(this.units.buffer, this.units.byteOffset, this.units.byteLength);
    const p = new DataView(this.parts.buffer, this.parts.byteOffset, this.parts.byteLength);
    const base = u.getUint32(index * UNIT_RECORD_BYTES + UNIT_OFF_PART_BASE, true);
    const count = u.getUint8(index * UNIT_RECORD_BYTES + UNIT_OFF_PART_COUNT);
    const parts = [];
    for (let k = 0; k < count; k++) {
      const o = (base + k) * PART_RECORD_BYTES;
      parts.push({ id: k + 1, prevYaw: p.getUint16(o, true), curYaw: p.getUint16(o + 2, true),
        prevPitch: p.getInt16(o + 4, true), curPitch: p.getInt16(o + 6, true) });
    }
    return { handle, tick: frame.tick, viewer: frame.viewer, alpha, observationMask: frame.unitMountAimMask(index),
      bodyPrevYaw: frame.unitPrevYaw(index), bodyCurYaw: frame.unitCurYaw(index), parts };
  }

  private copyPart(f: FrameReader, i: number): void {
    this.writePart(f.partPrevYaw(i), f.partCurYaw(i), f.partPrevPitch(i), f.partCurPitch(i));
  }

  private writePart(py: number, cy: number, pp: number, cp: number): void {
    const o = this.partCount++ * PART_RECORD_BYTES;
    this.partView.setUint16(o, py, true);
    this.partView.setUint16(o + 2, cy, true);
    this.partView.setInt16(o + 4, pp, true);
    this.partView.setInt16(o + 6, cp, true);
  }
}
