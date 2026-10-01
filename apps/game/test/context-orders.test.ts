import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { ClientMap, GameClient } from '@faf/client';
import { CmdFlags, FrameFlags, FrameReader, FrameWriter, Op, UnitFlags, decodeBatch } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import type { Game } from '../src/game.ts';
import { contextOrders, contextTarget } from '../src/hud/context-orders.ts';
import { GameHudController } from '../src/hud/live.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget, ManualRaf, pointer } from '../../../packages/client/test/support/fakes.ts';

const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/generated/sim.bin'))));
interface Unit { handle: number; id?: string; army?: number; hp?: number; build?: number; flags?: number; x?: number; z?: number }
const engineer: Unit = { handle: 42, id: 'core:eng_t1', x: 20, z: 32 };
const tank: Unit = { handle: 43, id: 'core:lnd_t1_tank', x: 20, z: 36 };
const factory: Unit = { handle: 44, id: 'core:fac_land_t1', x: 20, z: 40 };
const friend: Unit = { handle: 50, id: 'core:fac_land_t1', x: 40, z: 32 };
const enemy: Unit = { handle: 51, id: 'core:lnd_t1_tank', army: 1, x: 40, z: 32 };

function acceptedFrame(units: readonly Unit[], paused = false) {
  const writer = new FrameWriter({ units: units.length, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0 });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, 1, 1, 0, 1000, 0, paused ? FrameFlags.Paused : 0, 0, 0, 0);
  for (const unit of units) {
    const visual = bp.indexOf(unit.id ?? 'core:cube');
    expect(visual).toBeGreaterThanOrEqual(0);
    const x = (unit.x ?? 32) * 4096, z = (unit.z ?? 32) * 4096;
    writer.writeUnit(x, 0, z, x, 0, z, 0, 0, visual, unit.army ?? 0, unit.hp ?? 255, unit.build ?? 255, 0, unit.flags ?? 0, unit.handle, 0, 0);
  }
  const frame = new FrameReader(), length = writer.endFrame();
  expect(frame.reset(bytes.subarray(0, length))).toBe(true);
  return { frame, bytes, length };
}
const allied = (army: number) => army === 0 || army === 2;
function decide(units: readonly Unit[], selected: number[], target: number | null, ground = true) {
  return contextOrders(acceptedFrame(units).frame, bp, selected, 0, allied, target, ground);
}

describe('context matrix from actual compiled capabilities and accepted frame records', () => {
  it('partitions mixed factory/mobile ground commands, excludes static structures and foreign/stale actors', () => {
    expect(decide([engineer, tank, factory, { handle: 45, id: 'core:str_t1_pgen' }, { ...tank, handle: 46, army: 1 }], [42, 43, 44, 45, 46, 999], null)).toEqual([
      { op: Op.SetRally, units: [44] }, { op: Op.Move, units: [42, 43] },
    ]);
    expect(decide([tank], [43], null, false)).toEqual([]);
    expect(decide([tank], [], null)).toEqual([]);
  });
  it('attacks visible enemies only with armed actors; wholly unarmed selection moves to ground', () => {
    expect(bp.mountCount(bp.indexOf(engineer.id!))).toBe(0);
    expect(bp.mountCount(bp.indexOf(tank.id!))).toBeGreaterThan(0);
    expect(decide([engineer, tank, enemy], [42, 43], 2)).toEqual([{ op: Op.Attack, units: [43], target: 51 }]);
    expect(decide([engineer, enemy], [42], 1)).toEqual([{ op: Op.Move, units: [42] }]);
    expect(decide([engineer, enemy], [42], 1, false)).toEqual([]);
  });
  it.each([
    ['unfinished footprint', { ...friend, build: 80, hp: 80, flags: UnitFlags.Building }, Op.Assist],
    ['completed damaged footprint', { ...friend, hp: 180, flags: UnitFlags.Building }, Op.Repair],
    ['healthy completed footprint', { ...friend, flags: UnitFlags.Building }, Op.Guard],
    ['healthy allied mobile', { ...friend, id: 'core:eng_t1', army: 2 }, Op.Guard],
  ] as const)('resolves %s, preserving non-builder orders on repair/assist', (_name, target, op) => {
    expect(decide([engineer, tank, target], [42, 43], 2)).toEqual([{ op, units: op === Op.Guard ? [42, 43] : [42], target: 50 }]);
  });
  it('never changes an incapable unit to a substitute move on friendly construction/damage', () => {
    expect(decide([tank, { ...friend, build: 80 }], [43], 1)).toEqual([]);
    expect(decide([tank, { ...friend, hp: 80 }], [43], 1)).toEqual([]);
    expect(decide([engineer], [42], 0)).toEqual([]);
    expect(decide([{ ...engineer, build: 80 }, friend], [42], 1)).toEqual([]);
  });
  it('reclaims only real visible wreck records with actual RECLAIM builders', () => {
    const wreck = { ...enemy, handle: 0x80033, flags: UnitFlags.Wreck, army: 255 };
    const bit = bp.categoryNames.indexOf('RECLAIM');
    expect(bp.categoryWord(bp.indexOf(engineer.id!), bit >>> 5) & (1 << (bit & 31))).not.toBe(0);
    expect(decide([engineer, tank, wreck], [42, 43], 2)).toEqual([{ op: Op.Reclaim, units: [42], target: wreck.handle }]);
    expect(decide([tank, wreck], [43], 1)).toEqual([{ op: Op.Move, units: [43] }]);
    expect(decide([engineer, friend], [42], 1)).toEqual([{ op: Op.Guard, units: [42], target: 50 }]);
  });
  it.each([UnitFlags.Ghost, UnitFlags.Blip])('hidden flags %i never supply a target command or commandable actor', flags => {
    expect(decide([tank, { ...enemy, flags }], [43], 1)).toEqual([{ op: Op.Move, units: [43] }]);
    expect(decide([{ ...tank, flags }, enemy], [43], 1)).toEqual([]);
  });
  it('picks only full records, never mutates selection, and breaks equidistant hits by stable handle', () => {
    const frame = acceptedFrame([{ ...enemy, flags: UnitFlags.Blip }, { ...friend, handle: 90 }, { ...friend, handle: 70 }]).frame;
    const screen = () => ({ x: 100, y: 100 });
    expect(contextTarget(frame, 100, 100, screen)).toBe(2);
    expect(contextTarget(frame, 100, 100, screen, i => frame.unitArmy(i) === 1)).toBeNull();
    expect(contextTarget(frame, 200, 200, screen)).toBeNull();
    expect(contextTarget(frame, 100, 100, () => null)).toBeNull();
  });
});

function nativeRig(units: readonly Unit[], selected: number[], readOnly = false, paused = false) {
  const link = new FakeSimLink({ units: 0, enemyUnits: 0 }), canvas = new FakeCanvas(), map = ClientMap.testPlane(64);
  const client = new GameClient({ canvas, keyTarget: new FakeTarget(), renderer: new FakeRenderer(), link, map, visuals: [], playerArmy: 0, raf: new ManualRaf(), readOnlyCommands: readOnly });
  const game = { client, bp, map, unitCap: 8192, replayMode: readOnly, hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game), accepted = acceptedFrame(units, paused);
  link.frames.deliver(accepted.bytes, 1, accepted.length); client.frame(100); client.selectHandles(selected); controller.update(true);
  const clickTarget = (handle: number, shift = false) => {
    const p = client.unitScreenPos(handle)!; expect(p).not.toBeNull();
    canvas.dispatch(pointer('pointerdown', p.x, p.y, 2, { shiftKey: shift, timeStamp: 1234 }));
  };
  const commands = () => link.sentBatches.flatMap(bytes => decodeBatch(bytes));
  const dispose = () => { controller.dispose(); client.dispose(); };
  return { link, canvas, client, controller, clickTarget, commands, dispose };
}
describe('native input through the real HUD interceptor and wire encoder', () => {
  it.each([
    [{ ...enemy }, Op.Attack, [43]],
    [{ ...friend, hp: 100 }, Op.Repair, [42]],
    [{ ...friend, build: 80, hp: 80 }, Op.Assist, [42]],
    [{ ...friend }, Op.Guard, [42, 43]],
  ] as const)('encodes target and Shift queue with eligible actor subset for opcode %i', (target, op, actors) => {
    const f = nativeRig([engineer, tank, target], [42, 43]);
    try {
      f.clickTarget(target.handle, true);
      const command = f.commands(); expect(command).toHaveLength(1);
      expect(command[0]!.op).toBe(op); expect(command[0]!.flags).toBe(CmdFlags.Queue); expect(command[0]!.units).toEqual(actors);
      expect(new DataView(command[0]!.payload.buffer, command[0]!.payload.byteOffset, command[0]!.payload.byteLength).getUint32(0, true)).toBe(target.handle);
    } finally { f.dispose(); }
  });
  it('routes empty-ground mixed selection through real Move and SetRally encoders', () => {
    const f = nativeRig([engineer, factory], [42, 44]);
    try {
      const x = 900, y = 400, pick = f.client.pickAt(x, y)!; expect(pick).not.toBeNull();
      f.canvas.dispatch(pointer('pointerdown', x, y, 2, { timeStamp: 1234 }));
      expect(f.commands().map(c => [c.op, c.units])).toEqual([[Op.SetRally, [44]], [Op.Move, [42]]]);
      for (const command of f.commands()) {
        const payload = new DataView(command.payload.buffer, command.payload.byteOffset, command.payload.byteLength);
        expect(payload.getInt32(0, true)).toBe(Math.round(pick.x)); expect(payload.getInt32(8, true)).toBe(Math.round(pick.z));
      }
      expect(f.client.metricsSnapshot().clicks).toBe(1);
    } finally { f.dispose(); }
  });
  it('read-only replay and menu consume context commands, while paused gameplay can enqueue without advancing', () => {
    for (const readonly of [true, false]) {
      const f = nativeRig([tank, enemy], [43], readonly, !readonly);
      try {
        if (readonly) { f.clickTarget(51); expect(f.commands()).toEqual([]); }
        else { const tick = f.client.tick; f.clickTarget(51); expect(f.commands()[0]!.op).toBe(Op.Attack); expect(f.client.tick).toBe(tick); }
        f.controller.model.menus.gameMenu.open.value = true;
        const count = f.commands().length; f.clickTarget(51); expect(f.commands()).toHaveLength(count);
      } finally { f.dispose(); }
    }
  });
  it('first right click cancels an armed order or build gesture; only a separate next click contextualizes', () => {
    const f = nativeRig([{ ...engineer, id: 'core:cmd_commander' }, enemy], [42]);
    try {
      f.controller.commands.activateOrder('attack', { button: 0, shift: false, ctrl: false, alt: false });
      f.clickTarget(51); expect(f.commands()).toEqual([]);
      f.clickTarget(51); expect(f.commands()[0]!.op).toBe(Op.Attack);
      f.controller.commands.cardActivate('KeyW', { button: 0, shift: false, ctrl: false, alt: false });
      expect(f.controller.model.card.placingTypeId.peek()).not.toBeNull();
      f.canvas.dispatch(pointer('pointerdown', 600, 350, 0, { shiftKey: true }));
      f.canvas.dispatch(pointer('pointermove', 700, 350, 0, { shiftKey: true, buttons: 1 }));
      const before = f.commands().length;
      f.canvas.dispatch(pointer('pointerdown', 700, 350, 2, { shiftKey: true }));
      f.canvas.dispatch(pointer('pointerup', 700, 350, 0, { shiftKey: true }));
      expect(f.commands()).toHaveLength(before); expect(f.controller.model.card.placingTypeId.peek()).toBeNull();
    } finally { f.dispose(); }
  });
});
