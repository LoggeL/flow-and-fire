import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import { fx } from '@faf/fixed';
import { createRtsMap, readAllCommands, readRtsReplay } from '@faf/formats';
import { decodeBatch, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { convertCommandLog, HeadlessSim, ReplayPlayer } from '@faf/sim-host';
import { GameClient, ClientMap } from '@faf/client';
import { UnitBits, unitHandles, writeFrame, type World } from '../../../packages/sim/src/index.ts';
import { gameSimBin } from '../../../packages/sim-host/test/support/fixtures.ts';
import { GameHudController } from '../src/hud/live.ts';
import type { Game } from '../src/game.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeTarget, FakeRenderer, ManualRaf } from '../../../packages/client/test/support/fakes.ts';

// Real HUD controller actions are serialized by the production client, applied by the real
// Sim and recorded; nothing mutates World state directly.
const SPOT = { kind: 'mass' as const, x: fx(24), z: fx(10) };
const map = createRtsMap({ sizeWu: 64, name: 'upgrade-cancel-resume', starts: [
  { army: 0, x: fx(10), z: fx(10) }, { army: 1, x: fx(56), z: fx(56) },
], spots: [SPOT] });
const OP_NAMES: Record<number, string> = { [Op.Upgrade]: 'Upgrade', [Op.TogglePause]: 'TogglePause', [Op.Stop]: 'Stop', [Op.Build]: 'Build' };
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function fixture() {
  const simBin = gameSimBin();
  const sim = new HeadlessSim({ simBin, map, seed: 41, armyCount: 2, playerArmy: 0, initialization: { kind: 'skirmish', faction: 0 }, keyframes: false });
  const link = new FakeSimLink({ units: 0, enemyUnits: 0 }), clientMap = ClientMap.testPlane(64);
  const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer: new FakeRenderer(), link, map: clientMap, visuals: [], playerArmy: 0, raf: new ManualRaf() });
  const game = { client, bp: sim.world.bp, map: clientMap, unitCap: 8192, replayMode: false, hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game);
  disposers.push(() => { controller.dispose(); client.dispose(); });
  const commander = unitHandles(sim.world, 0)[0]!;
  let seq = 0, sent = 0, selected: number[] = [commander];
  const publish = () => {
    const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes);
    seq++;
    const length = writeFrame(sim.world, 0, writer, bytes, { seq, tickTimeUs: 0, speedPermille: 1000, flags: 0 }, new Uint32Array(selected), selected.length);
    link.frames.deliver(bytes, seq, length); client.frame(seq * 100); client.selectHandles(selected); controller.update(true);
  };
  /** Every newly sent client batch, in send order, as decoded envelopes. */
  const drain = (): CommandEnvelope[] => link.sentBatches.slice(sent).flatMap(batch => { sent++; return decodeBatch(batch); });
  const advance = (ticks = 1) => { for (let n = 0; n < ticks; n++) { const commands = drain(); if (commands.length) sim.submit(commands); sim.step(); } publish(); };
  const select = (handles: number[]) => { selected = handles; publish(); };
  publish();
  return { sim, controller, client, commander, drain, advance, select, publish };
}
const unit = (w: World, handle: number) => w.units.resolve(handle);
const income = (w: World) => [w.armies.col.massIncome.get(0), w.armies.col.energyIncome.get(0)];
function finishedOfType(w: World, id: string): number[] {
  const bp = w.bp.indexOf(id), U = w.units.col, found: number[] = [];
  for (let i = 0; i < w.units.highWater; i++) if (w.units.isLive(i) && U.bp[i] === bp && U.army[i] === 0 && (U.flags[i]! & UnitBits.UnderConstruction) === 0) found.push(w.units.handle(i));
  return found;
}

describe('explicit upgrade cancel after pause', () => {
  it('commander: Upgrade → Pause → Cancel sends Stop before resume, restores income and build power, and a later land factory completes', () => {
    const f = fixture(), w = f.sim.world, U = w.units.col, acu = unit(w, f.commander);
    f.advance(2); const baseIncome = income(w);
    expect(baseIncome).toEqual([100, 2000]);

    f.controller.startCommanderUpgrade(); f.advance(5);
    expect(f.controller.commanderUpgrade.value).toMatchObject({ active: true, queued: true, paused: false });
    f.controller.pauseCommanderUpgrade(); f.advance(2);
    expect(U.ecoPaused[acu]).toBe(1);
    expect(income(w)).toEqual([0, 0]);
    expect(f.controller.commanderUpgrade.value).toMatchObject({ active: true, paused: true });
    expect(f.controller.pausedSelection.value).toEqual({ count: 1, total: 1, controllable: true });

    // Direct cancel without a prior resume.
    f.controller.cancelCommanderUpgrade();
    const cancel = f.drain();
    expect(cancel.map(c => c.op)).toEqual([Op.Stop, Op.TogglePause]);
    expect(cancel[0]!.seq).toBeLessThan(cancel[1]!.seq);
    expect(Array.from(cancel[1]!.payload)).toEqual([0]);
    expect(cancel.every(c => c.units.length === 1 && c.units[0] === f.commander)).toBe(true);
    f.sim.submit(cancel); f.sim.step(); f.publish();
    expect(U.ecoPaused[acu]).toBe(0);
    expect(U.orderHead[acu]).toBe(-1);
    expect(U.bp[acu]).toBe(w.bp.indexOf('core:cmd_commander'));
    f.advance(1);
    expect(income(w)).toEqual(baseIncome);
    expect(f.controller.pausedSelection.value).toBeNull();
    expect(f.controller.commanderUpgrade.value).toMatchObject({ active: false, queued: false, paused: false, enabled: true });

    const factory = w.bp.indexOf('core:fac_land_t1');
    f.client.commands.build([f.commander], factory, fx(18) + 2048, fx(18) + 2048, 0, false, 0);
    for (let n = 0; n < 600 && finishedOfType(w, 'core:fac_land_t1').length === 0; n++) f.advance(1);
    expect(finishedOfType(w, 'core:fac_land_t1')).toHaveLength(1);
    expect(w.tick).toBeLessThan(500);
  });

  it('extractor: Upgrade → Pause → Cancel restores T1 mass output without a hidden pause', () => {
    const f = fixture(), w = f.sim.world, U = w.units.col;
    f.client.commands.build([f.commander], w.bp.indexOf('core:str_t1_mex'), SPOT.x, SPOT.z, 0, false, 0);
    for (let n = 0; n < 400 && finishedOfType(w, 'core:str_t1_mex').length === 0; n++) f.advance(1);
    const [mex] = finishedOfType(w, 'core:str_t1_mex'); expect(mex).toBeDefined();
    f.select([mex!]); f.advance(3);
    const baseIncome = income(w);
    expect(baseIncome[0]).toBe(300); // Commander 100 + T1 extractor 200 milli/tick.

    f.controller.startExtractorUpgrade(); f.advance(5);
    expect(f.controller.extractorUpgrade.value).toMatchObject({ active: true, paused: false });
    f.controller.pauseExtractorUpgrade(); f.advance(2);
    expect(U.ecoPaused[unit(w, mex!)]).toBe(1); expect(income(w)[0]).toBe(100);

    f.controller.cancelExtractorUpgrade();
    const cancel = f.drain();
    expect(cancel.map(c => c.op)).toEqual([Op.Stop, Op.TogglePause]);
    f.sim.submit(cancel); f.sim.step(); f.publish();
    const i = unit(w, mex!);
    expect(U.ecoPaused[i]).toBe(0); expect(U.orderHead[i]).toBe(-1); expect(U.bp[i]).toBe(w.bp.indexOf('core:str_t1_mex'));
    f.advance(1); expect(income(w)[0]).toBe(baseIncome[0]);
    expect(f.controller.extractorUpgrade.value).toMatchObject({ active: false, paused: false, enabled: true });
  });

  it('a running (unpaused) upgrade cancel still sends Stop only', () => {
    const f = fixture();
    f.controller.startCommanderUpgrade(); f.advance(3);
    f.controller.cancelCommanderUpgrade();
    expect(f.drain().map(c => c.op)).toEqual([Op.Stop]);
  });

  it('generic Stop keeps an intentional manual pause; only the visible resume action lifts it', () => {
    const f = fixture(), w = f.sim.world, U = w.units.col, acu = unit(w, f.commander);
    f.controller.commands.activateOrder('pause', { button: 0, ctrl: false, alt: false, shift: false }); f.advance(2);
    expect(U.ecoPaused[acu]).toBe(1);
    f.controller.commands.activateOrder('stop', { button: 0, ctrl: false, alt: false, shift: false });
    const stop = f.drain(); expect(stop.map(c => c.op)).toEqual([Op.Stop]);
    f.sim.submit(stop); f.sim.step(); f.advance(2);
    expect(U.ecoPaused[acu]).toBe(1);
    expect(f.controller.pausedSelection.value).toEqual({ count: 1, total: 1, controllable: true });
    f.controller.resumeSelection();
    const resume = f.drain(); expect(resume.map(c => c.op)).toEqual([Op.TogglePause]);
    f.sim.submit(resume); f.sim.step(); f.publish();
    expect(U.ecoPaused[acu]).toBe(0); expect(f.controller.pausedSelection.value).toBeNull();
  });

  it('records the corrected order and replays it without divergence', () => {
    const f = fixture();
    f.advance(2); f.controller.startCommanderUpgrade(); f.advance(5);
    f.controller.pauseCommanderUpgrade(); f.advance(3);
    f.controller.cancelCommanderUpgrade(); f.advance(1);
    f.client.commands.build([f.commander], f.sim.world.bp.indexOf('core:fac_land_t1'), fx(18) + 2048, fx(18) + 2048, 0, false, 0);
    for (let n = 0; n < 600 && finishedOfType(f.sim.world, 'core:fac_land_t1').length === 0; n++) f.advance(1);
    f.advance(20);
    const finalHash = f.sim.fullHash(), bytes = f.sim.exportLog(), simBin = gameSimBin();
    const converted = convertCommandLog(bytes, { simBin, map });
    expect(converted.verified).toBe(true); expect(converted.mismatches).toEqual([]);
    const replay = readRtsReplay(converted.bytes);
    const ops = readAllCommands(replay).flatMap(entry => decodeBatch(entry.batch)).map(c => OP_NAMES[c.op]);
    expect(ops).toEqual(['Upgrade', 'TogglePause', 'Stop', 'TogglePause', 'Build']);
    const result = ReplayPlayer.open(replay, { simBin, map, keyframes: false }).playToEnd();
    expect(result.divergences).toEqual([]); expect(result.complete).toBe(true); expect(result.compared).toBeGreaterThan(0);
    expect(result.fullHash).toBe(finalHash);
  });
});
