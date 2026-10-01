/**
 * AI command codecs. Positions, Build, targets and FactoryQueue use the real game wire layouts.
 * FactoryRepeat remains an internal queue plan (on + items); the sim-host game adapter expands
 * it into actual FactoryQueue commands plus the protocol's one-byte repeat switch before recording.
 */
import { asFx } from '@faf/fixed';
import { decodeMove, encodeMove, decodeBuild as decodeProtocolBuild, encodeBuild as encodeProtocolBuild, encodeFactoryQueue as encodeProtocolFactoryQueue, Op } from '@faf/protocol';
import { fromFxRaw, toFxRaw } from '../det.ts';

export const AI_PAYLOAD_VERSION = 2;

export const BUILD_PAYLOAD_BYTES = 12;
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
  check('bp', bp, 0, 0xfffe);
  check('rot', rot, 0, 3);
  return encodeProtocolBuild({ bp, yaw: rot * 16384, x: asFx(toFxRaw(x)), z: asFx(toFxRaw(z)) });
}

export function decodeBuild(bytes: Uint8Array): BuildPayload {
  const { bp, yaw, x: xRaw, z: zRaw } = decodeProtocolBuild(bytes);
  if (yaw % 16384 !== 0) throw new RangeError('AI Build yaw must be a quarter turn');
  return { bp, x: fromFxRaw(xRaw), z: fromFxRaw(zRaw), xRaw, zRaw, rot: yaw / 16384 };
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
  return encodeProtocolFactoryQueue({bp,count});
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
