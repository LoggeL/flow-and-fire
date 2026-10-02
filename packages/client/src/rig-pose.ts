/** Expands accepted mount and activity observations into render-only poses for the original GLB hierarchy. */
import { HANDLE_INDEX_MASK } from '@faf/fixed';
import {
  DEFAULT_FRAME_CAPS, MAX_PARTS_PER_UNIT, PART_RECORD_BYTES, UNIT_RECORD_BYTES,
  UNIT_OFF_FLAGS, UNIT_OFF_PART_BASE, UNIT_OFF_PART_COUNT, UNIT_OFF_RESERVED, FlowFlags, UnitFlags,
  type FrameReader,
} from '@faf/protocol';
import type { VisualTable } from '@faf/render';
import type { RigVisualEntry } from './visuals.ts';

/** Five-degree pump stroke, within the authored collar and piston-guide clearance. */
const PUMP_PITCH = 910;

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
  private readonly activityPhase = new Uint16Array(DEFAULT_FRAME_CAPS.units);
  private readonly gatePitch = new Int16Array(DEFAULT_FRAME_CAPS.units);
  private readonly flowIndices = new Int32Array(DEFAULT_FRAME_CAPS.units);
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
    const repeated = frame.tick === this.tick;
    if ((!repeated && frame.tick !== this.tick + 1) || frame.viewer !== this.viewer || this.epoch === 0xffffffff) this.reset();
    this.tick = frame.tick;
    this.viewer = frame.viewer;
    const epoch = ++this.epoch;
    this.version++;
    const stats = this.stats;
    stats.animatedUnits = stats.walkingUnits = stats.observedMounts = stats.overflowUnits = 0;
    let flagged = false;
    for (let i = 0; i < frame.unitCount; i++) {
      const rig = (table[frame.unitVisual(i)] as RigVisualEntry | null | undefined)?.rig;
      if ((frame.unitFlags(i) & UnitFlags.MountAimParts) !== 0 || rig?.some(p => p?.activity !== undefined)) { flagged = true; break; }
    }
    this.units = units;
    this.parts = parts;
    this.partCount = frame.partCount;
    if (!flagged) return;
    // The public frame capacity bounds the accepted live output. Reject malformed oversized input.
    if (frame.unitCount > DEFAULT_FRAME_CAPS.units) throw new RangeError('rig unit capacity');
    // Economy observations are private to the viewer. Index once, with handle-generation
    // checks at each lookup, rather than searching the whole flow section per unit.
    this.flowIndices.fill(-1);
    if (frame.flowTick === frame.tick) {
      for (let f = 0; f < frame.flowCount; f++) {
        const slot = frame.flowHandle(f) & HANDLE_INDEX_MASK;
        if (slot < this.flowIndices.length && frame.flowArmy(f) === frame.viewer) this.flowIndices[slot] = f;
      }
    }
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
      const visual = frame.unitVisual(i);
      const rig = (table[visual] as RigVisualEntry | null | undefined)?.rig;
      const mountParts = (flags & UnitFlags.MountAimParts) !== 0;
      if (!mountParts && !rig?.some(p => p?.activity !== undefined)) {
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
      const frozen = repeated || frame.paused;
      // One four-WU travel cycle, opposite 24-degree hip swings. There is no wall-clock
      // motion: stationary accepted frames return to rest; paused/repeated frames hold.
      const distance = frozen || (flags & UnitFlags.NoInterp) !== 0 ? 0 : Math.hypot(
        frame.unitCur(i, 0) - frame.unitPrev(i, 0), frame.unitCur(i, 2) - frame.unitPrev(i, 2)) / 4096;
      const previousPhase = history ? this.gaitPhase[slot]! : 0;
      const phase = (previousPhase + distance * Math.PI / 2) % (Math.PI * 2);
      const previousGaitPitch = history ? this.gaitPitch[slot]! : 0;
      const gaitPitch = frozen ? previousGaitPitch : distance > 0 ? Math.round(Math.sin(phase) * 4369) : 0;
      const priorActivity = history ? this.activityPhase[slot]! : 0;
      const priorGate = history ? this.gatePitch[slot]! : 0;
      let activityPhase = priorActivity, gatePitch = priorGate;
      const complete = frame.unitBuild(i) === 255 && (flags & (UnitFlags.Wreck | UnitFlags.Ghost | UnitFlags.Blip)) === 0;
      const blocked = frozen || (flags & (UnitFlags.Paused | UnitFlags.Stalled | UnitFlags.NoInterp)) !== 0;
      const flow = this.flowIndex(frame, handle);
      const flowFlags = flow >= 0 && frame.flowBp(flow) === visual ? frame.flowFlags(flow) : 0;
      const enabled = (flowFlags & FlowFlags.Enabled) !== 0 && (flowFlags & (FlowFlags.Paused | FlowFlags.BuildSite)) === 0;
      const upkeep = enabled && (flowFlags & FlowFlags.Billed) !== 0 && flow >= 0 &&
        (frame.flowMassSpent(flow) > 0 || frame.flowEnergySpent(flow) > 0);
      const targetFlow = flow >= 0 ? this.flowIndex(frame, frame.flowTarget(flow)) : -1;
      const production = enabled && (flags & UnitFlags.Idle) === 0 && (flowFlags & FlowFlags.Contributing) !== 0 &&
        targetFlow >= 0 && (frame.flowFlags(targetFlow) & FlowFlags.Paused) === 0 && frame.flowEffectivePower(targetFlow) > 0 &&
        (frame.flowMassSpent(targetFlow) > 0 || frame.flowEnergySpent(targetFlow) > 0);
      let walking = false;
      for (let k = 1; k <= count; k++) {
        const binding = rig[k];
        let py = 0, cy = 0, pp = 0, cp = 0;
        if (!mountParts && k <= sourceCount) {
          const source = sourceBase + k - 1;
          py = frame.partPrevYaw(source); cy = frame.partCurYaw(source);
          pp = frame.partPrevPitch(source); cp = frame.partCurPitch(source);
        }
        if (binding?.activity !== undefined) {
          if (binding.activity === 'factory-gate') {
            // Open the top-hinged gate for observed production; close at a known idle.
            // Missing/private flow, stalls and pauses retain the last observed pose.
            if (!complete) gatePitch = 0;
            else if (!blocked && production) gatePitch = Math.min(14564, priorGate + 1365);
            else if (!blocked && ((flags & UnitFlags.Idle) !== 0 || (enabled && (flowFlags & FlowFlags.Contributing) === 0))) gatePitch = Math.max(0, priorGate - 1365);
            pp = blocked || !history || !complete ? gatePitch : priorGate; cp = gatePitch;
          } else {
            if (!complete) activityPhase = 0;
            else if (!blocked && upkeep) activityPhase = (priorActivity + (binding.activity === 'radar-spin' ? 1092 : 2731)) & 65535;
            if (binding.activity === 'radar-spin') {
              py = blocked || !history || !complete ? activityPhase : priorActivity; cy = activityPhase;
            } else {
              cp = Math.round(Math.sin(activityPhase * Math.PI / 32768) * PUMP_PITCH);
              pp = blocked || !history || !complete ? cp : Math.round(Math.sin(priorActivity * Math.PI / 32768) * PUMP_PITCH);
            }
          }
        } else if (binding?.gait !== undefined && mountParts) {
          pp = (frozen ? gaitPitch : previousGaitPitch) * binding.gait;
          cp = gaitPitch * binding.gait;
          walking ||= distance > 0;
        } else if (mountParts && binding !== undefined && binding.mount >= 0 && binding.mount < sourceCount && (mask & (1 << binding.mount)) !== 0) {
          const m = binding.mount;
          const index = sourceBase + m;
          const worldYaw = frame.partCurYaw(index);
          const elevation = frame.partCurPitch(index);
          const h = slot * MAX_PARTS_PER_UNIT + m;
          const prior = (previousMask & (1 << m)) !== 0;
          if (binding.yaw) {
            cy = (worldYaw - frame.unitCurYaw(i)) & 65535;
            // On a reset hold the observed world direction while the hull moves, except NoInterp.
            py = frozen ? cy : ((prior ? this.yaw[h]! : worldYaw) - ((flags & UnitFlags.NoInterp) !== 0 ? frame.unitCurYaw(i) : frame.unitPrevYaw(i))) & 65535;
          }
          if (binding.pitch) { cp = elevation; pp = !frozen && prior ? this.pitch[h]! : elevation; }
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
        this.activityPhase[slot] = activityPhase;
        this.gatePitch[slot] = gatePitch;
      }
      dv.setUint32(o + UNIT_OFF_PART_BASE, outBase, true);
      dv.setUint8(o + UNIT_OFF_PART_COUNT, count);
      stats.animatedUnits++;
      if (walking) stats.walkingUnits++;
    }
  }

  private flowIndex(frame: FrameReader, handle: number): number {
    const slot = handle & HANDLE_INDEX_MASK;
    const index = slot < this.flowIndices.length ? this.flowIndices[slot]! : -1;
    return index >= 0 && frame.flowHandle(index) === handle ? index : -1;
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
