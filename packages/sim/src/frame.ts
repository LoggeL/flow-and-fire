/**
 * Output of a frame for a viewer (PLAN §3.6) through the protocol FrameWriter.
 * MS1 has no fog: viewer −1 (observer) and every army see all units. Units that are dead are
 * already released by Cleanup and never appear.
 */
import { UnitFlags, type FrameWriter } from '@faf/protocol';
import { MoverState, UnitBits, UnitState } from './constants.ts';
import { WH_LAST_HASH, WH_LAST_HASH_TICK, WH_TICK } from './schema.ts';
import type { World } from './world.ts';

/** Header fields owned by the host (sequence, timing, speed, paused bit). */
export interface FrameMeta {
  /** Frame sequence number (host counter). */
  seq: number;
  /** Duration of the last tick in µs (host measurement). */
  tickTimeUs: number;
  /** Game speed in ‰ (1000 = 1x). */
  speedPermille: number;
  /** FrameFlags (e.g. Paused). */
  flags: number;
}

const DEFAULT_META: FrameMeta = { seq: 0, tickTimeUs: 0, speedPermille: 1000, flags: 0 };

/** Scales hp to u8: 255 = full, ≥ 1 while alive. */
export function hpToU8(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  if (hp >= maxHp) return 255;
  const v = Math.floor((hp * 255) / maxHp);
  return v < 1 ? 1 : v;
}

/**
 * Writes the frame of `viewer` (−1 = all) into `target` and returns its packed byte length.
 * Header: tick, ackSeq of the viewer (0xFFFFFFFF = none/observer), last hash tick + hash.
 */
export function writeFrame(w: World, viewer: number, writer: FrameWriter, target: Uint8Array, meta: FrameMeta = DEFAULT_META): number {
  const h = w.header;
  const ack = viewer >= 0 && viewer < w.armyCount ? w.armies.col.lastAckSeq[viewer]! : -1;
  writer.beginFrame(
    target,
    meta.seq,
    h.i32[WH_TICK]!,
    meta.tickTimeUs,
    meta.speedPermille,
    viewer,
    meta.flags,
    ack >>> 0,
    h.i32[WH_LAST_HASH_TICK]!,
    h.u32[WH_LAST_HASH]!,
  );
  const units = w.units;
  const alive = units.alive;
  const U = units.col;
  const M = w.movers.col;
  const maxHp = w.bp.maxHpCol;
  const hw = units.highWater;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1) continue;
    const f = U.flags[i]!;
    if ((f & UnitBits.Dead) !== 0) continue;
    const bp = U.bp[i]!;
    const hp = U.hp[i]!;
    const mhp = maxHp[bp]!;
    let flags = 0;
    if ((f & UnitBits.NoInterp) !== 0) flags |= UnitFlags.NoInterp;
    const row = U.mover[i]!;
    if (U.state[i] === UnitState.Idle && (row < 0 || (M.state[row] === MoverState.Idle && M.speed[row] === 0))) {
      flags |= UnitFlags.Idle;
    }
    if (hp < mhp) flags |= UnitFlags.Damaged;
    writer.writeUnit(
      U.px[i]!,
      U.py[i]!,
      U.pz[i]!,
      U.x[i]!,
      U.y[i]!,
      U.z[i]!,
      U.pyaw[i]!,
      U.yaw[i]!,
      bp,
      U.army[i]!,
      hpToU8(hp, mhp),
      255,
      U.bank[i]!,
      flags,
      units.handle(i),
      0,
      0,
    );
  }
  return writer.endFrame();
}
