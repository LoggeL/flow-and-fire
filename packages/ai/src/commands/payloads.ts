/**
 * PROVISIONAL payload layouts of the AI commands (little-endian, `AI_PAYLOAD_VERSION`). They use
 * only ops that already exist in @faf/protocol (`Op`, `CmdFlags`); packages/protocol stays
 * unchanged. Adapter boundary: from MS6/MS9 the payload codecs move into @faf/protocol (same ops);
 * the arena decodes these layouts until then.
 *
 * Layouts:
 *   Move / AttackMove / Patrol / SetRally: protocol Move payload (i32 x | i32 y = 0 | i32 z, Fx raw)
 *   Build:           u16 bp | i32 x | i32 z | u8 rot                              (11 B)
 *   Attack / Assist / Guard / Repair / Reclaim / Overcharge: u32 target handle      (4 B)
 *   FactoryQueue:    u16 bp | u16 count                                             (4 B)
 *   FactoryRepeat:   u8 on | u8 n | u16[n] bp                                       (2 + 2n B)
 *   Upgrade:         u16 bp                                                          (2 B)
 *   Stop:            empty
 *
 * `bp` is the provisional blueprint id = `AiBlueprint.index` (position in the id-sorted table).
 * Semantics: `CmdFlags.Queue` (Shift) appends the order to the unit's queue (factories: appends to
 * the production queue), otherwise it replaces the current orders/queue. FactoryRepeat with on = 1
 * replaces the repeat loop by `bp[]`; on = 0 clears it (n must be 0).
 */
import { asFx } from '@faf/fixed';
import { decodeMove, encodeMove, Op } from '@faf/protocol';
import { fromFxRaw, toFxRaw } from '../det.ts';

export const AI_PAYLOAD_VERSION = 1;

export const BUILD_PAYLOAD_BYTES = 11;
export const TARGET_PAYLOAD_BYTES = 4;
export const FACTORY_QUEUE_PAYLOAD_BYTES = 4;
export const UPGRADE_PAYLOAD_BYTES = 2;
/** Maximum loop length of FactoryRepeat (u8 n). */
export const MAX_REPEAT_ITEMS = 255;

/** Ops whose payload is a position (protocol Move layout). */
export const POSITION_OPS: readonly number[] = [Op.Move, Op.AttackMove, Op.Patrol, Op.SetRally];
/** Ops whose payload is a target handle. */
export const TARGET_OPS: readonly number[] = [Op.Attack, Op.Assist, Op.Guard, Op.Repair, Op.Reclaim, Op.Overcharge];

function check(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what} out of range: ${v}`);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function need(bytes: Uint8Array, n: number, what: string): DataView {
  if (bytes.length !== n) throw new RangeError(`${what} payload must be ${n} bytes, got ${bytes.length}`);
  return view(bytes);
}

// ---- position ---------------------------------------------------------------------------------

/** Position payload (Move/AttackMove/Patrol/SetRally) from WU; y = 0 (ground). */
export function encodePosition(x: number, z: number): Uint8Array {
  return encodeMove({ x: asFx(toFxRaw(x)), y: asFx(0), z: asFx(toFxRaw(z)) });
}

export interface PositionPayload {
  /** WU. */
  readonly x: number;
  readonly z: number;
  /** Fx raw as transmitted. */
  readonly xRaw: number;
  readonly zRaw: number;
}

export function decodePosition(bytes: Uint8Array): PositionPayload {
  const m = decodeMove(bytes);
  return { x: fromFxRaw(m.x), z: fromFxRaw(m.z), xRaw: m.x, zRaw: m.z };
}

// ---- build --------------------------------------------------------------------------------------

export interface BuildPayload {
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly xRaw: number;
  readonly zRaw: number;
  /** 0..3 (90° steps). */
  readonly rot: number;
}

export function encodeBuild(bp: number, x: number, z: number, rot: number): Uint8Array {
  check('bp', bp, 0, 0xffff);
  check('rot', rot, 0, 3);
  const out = new Uint8Array(BUILD_PAYLOAD_BYTES);
  const dv = view(out);
  dv.setUint16(0, bp, true);
  dv.setInt32(2, toFxRaw(x), true);
  dv.setInt32(6, toFxRaw(z), true);
  dv.setUint8(10, rot);
  return out;
}

export function decodeBuild(bytes: Uint8Array): BuildPayload {
  const dv = need(bytes, BUILD_PAYLOAD_BYTES, 'Build');
  const xRaw = dv.getInt32(2, true);
  const zRaw = dv.getInt32(6, true);
  const rot = dv.getUint8(10);
  if (rot > 3) throw new RangeError(`Build rot out of range: ${rot}`);
  return { bp: dv.getUint16(0, true), x: fromFxRaw(xRaw), z: fromFxRaw(zRaw), xRaw, zRaw, rot };
}

// ---- target -------------------------------------------------------------------------------------

export function encodeTarget(target: number): Uint8Array {
  check('target', target, 0, 0xffffffff);
  const out = new Uint8Array(TARGET_PAYLOAD_BYTES);
  view(out).setUint32(0, target, true);
  return out;
}

export function decodeTarget(bytes: Uint8Array): number {
  return need(bytes, TARGET_PAYLOAD_BYTES, 'Target').getUint32(0, true);
}

// ---- factory ------------------------------------------------------------------------------------

export interface FactoryQueuePayload {
  readonly bp: number;
  readonly count: number;
}

export function encodeFactoryQueue(bp: number, count: number): Uint8Array {
  check('bp', bp, 0, 0xffff);
  check('count', count, 1, 0xffff);
  const out = new Uint8Array(FACTORY_QUEUE_PAYLOAD_BYTES);
  const dv = view(out);
  dv.setUint16(0, bp, true);
  dv.setUint16(2, count, true);
  return out;
}

export function decodeFactoryQueue(bytes: Uint8Array): FactoryQueuePayload {
  const dv = need(bytes, FACTORY_QUEUE_PAYLOAD_BYTES, 'FactoryQueue');
  const count = dv.getUint16(2, true);
  if (count === 0) throw new RangeError('FactoryQueue count must be ≥ 1');
  return { bp: dv.getUint16(0, true), count };
}

export interface FactoryRepeatPayload {
  readonly on: boolean;
  readonly items: readonly number[];
}

export function encodeFactoryRepeat(on: boolean, items: readonly number[]): Uint8Array {
  if (!on && items.length !== 0) throw new RangeError('FactoryRepeat off must not carry items');
  if (on && items.length === 0) throw new RangeError('FactoryRepeat on needs at least one item');
  check('repeat items', items.length, 0, MAX_REPEAT_ITEMS);
  const out = new Uint8Array(2 + 2 * items.length);
  const dv = view(out);
  dv.setUint8(0, on ? 1 : 0);
  dv.setUint8(1, items.length);
  for (let i = 0; i < items.length; i++) {
    check('bp', items[i]!, 0, 0xffff);
    dv.setUint16(2 + 2 * i, items[i]!, true);
  }
  return out;
}

export function decodeFactoryRepeat(bytes: Uint8Array): FactoryRepeatPayload {
  if (bytes.length < 2) throw new RangeError('FactoryRepeat payload too short');
  const dv = view(bytes);
  const on = dv.getUint8(0);
  const n = dv.getUint8(1);
  if (on > 1) throw new RangeError(`FactoryRepeat on flag ${on}`);
  if (bytes.length !== 2 + 2 * n) throw new RangeError('FactoryRepeat length mismatch');
  if ((on === 0) !== (n === 0)) throw new RangeError('FactoryRepeat on/n mismatch');
  const items: number[] = [];
  for (let i = 0; i < n; i++) items.push(dv.getUint16(2 + 2 * i, true));
  return { on: on === 1, items };
}

// ---- upgrade / stop -----------------------------------------------------------------------------

export function encodeUpgrade(bp: number): Uint8Array {
  check('bp', bp, 0, 0xffff);
  const out = new Uint8Array(UPGRADE_PAYLOAD_BYTES);
  view(out).setUint16(0, bp, true);
  return out;
}

export function decodeUpgrade(bytes: Uint8Array): number {
  return need(bytes, UPGRADE_PAYLOAD_BYTES, 'Upgrade').getUint16(0, true);
}

export function encodeStop(): Uint8Array {
  return new Uint8Array(0);
}

// ---- generic decode -----------------------------------------------------------------------------

export type AiPayload =
  | { readonly op: 'position'; readonly value: PositionPayload }
  | { readonly op: 'build'; readonly value: BuildPayload }
  | { readonly op: 'target'; readonly value: number }
  | { readonly op: 'factoryQueue'; readonly value: FactoryQueuePayload }
  | { readonly op: 'factoryRepeat'; readonly value: FactoryRepeatPayload }
  | { readonly op: 'upgrade'; readonly value: number }
  | { readonly op: 'stop' };

/** True for the ops the AI emits (provisional layouts above). */
export function isAiOp(op: number): boolean {
  return (
    POSITION_OPS.includes(op) ||
    TARGET_OPS.includes(op) ||
    op === Op.Build ||
    op === Op.FactoryQueue ||
    op === Op.FactoryRepeat ||
    op === Op.Upgrade ||
    op === Op.Stop
  );
}

/** Decodes the payload of an AI op; throws RangeError on malformed bytes or unknown ops. */
export function decodeAiPayload(op: number, payload: Uint8Array): AiPayload {
  if (POSITION_OPS.includes(op)) return { op: 'position', value: decodePosition(payload) };
  if (TARGET_OPS.includes(op)) return { op: 'target', value: decodeTarget(payload) };
  switch (op) {
    case Op.Build:
      return { op: 'build', value: decodeBuild(payload) };
    case Op.FactoryQueue:
      return { op: 'factoryQueue', value: decodeFactoryQueue(payload) };
    case Op.FactoryRepeat:
      return { op: 'factoryRepeat', value: decodeFactoryRepeat(payload) };
    case Op.Upgrade:
      return { op: 'upgrade', value: decodeUpgrade(payload) };
    case Op.Stop:
      if (payload.length !== 0) throw new RangeError('Stop payload must be empty');
      return { op: 'stop' };
    default:
      throw new RangeError(`op ${op} is not an AI op`);
  }
}
