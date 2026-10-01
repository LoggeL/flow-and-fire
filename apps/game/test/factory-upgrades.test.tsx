// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HudProvider, createHudModel, createRecordingCommands } from '@faf/hud';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { GameClient, ClientMap } from '@faf/client';
import { fx } from '@faf/fixed';
import { decodeBatch, encodeFactoryQueue, FrameWriter, Op } from '@faf/protocol';
import { createWorld, step, writeFrame } from '../../../packages/sim/src/index.ts';
import { spawnUnit } from '../../../packages/sim/src/units.ts';
import { GameHudController, type FactoryUpgradeState } from '../src/hud/live.ts';
import { LiveFactoryUpgrade } from '../src/hud/LiveFactoryUpgrade.tsx';
import type { Game } from '../src/game.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeTarget, FakeRenderer, ManualRaf } from '../../../packages/client/test/support/fakes.ts';

let compiled: SimBpTable;
beforeAll(async () => { compiled = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
const containers: HTMLElement[] = [];
afterEach(() => { for (const c of containers.splice(0)) { act(() => render(null, c)); c.remove(); } });

function controllerFixture(readOnlyCommands = false, factory = 'core:fac_land_t1') {
  const link = new FakeSimLink({ units: 0, enemyUnits: 0 }), map = ClientMap.testPlane(64);
  const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer: new FakeRenderer(), link, map, visuals: [], playerArmy: 0, raf: new ManualRaf(), readOnlyCommands });
  const world = createWorld({ bpTable: compiled, seed: 31, armyCount: 2, mapSizeWu: 64 });
  const u = spawnUnit(world, compiled.indexOf(factory), 0, fx(20) + 2048, fx(20) + 2048, 0), handle = world.units.handle(u);
  const game = { client, bp: compiled, map, unitCap: 8192, replayMode: readOnlyCommands, hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game); let seq = 0;
  const publish = () => {
    const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes); seq++;
    const length = writeFrame(world, 0, writer, bytes, { seq, tickTimeUs: 0, speedPermille: 1000, flags: 0 }, new Uint32Array([handle]), 1);
    link.frames.deliver(bytes, seq, length); client.frame(seq * 100); client.selectHandles([handle]); controller.update(true);
  };
  publish();
  return { controller, link, world, u, handle, publish, dispose: () => { controller.dispose(); client.dispose(); } };
}

describe('land factory upgrade controls', () => {
  it('shows the real successor, its costs and the units it unlocks, and serializes the upgrade', () => {
    const f = controllerFixture();
    try {
      expect(f.controller.factoryUpgrade.value).toMatchObject({ handle: f.handle, tier: 1, targetTier: 2, mass: 1400, energy: 11000, buildPower: 20, targetBuildPower: 40, enabled: true, targetTypeId: 'core:str_t2_fac_land' });
      expect(f.controller.factoryUpgrade.value!.unlocks).toEqual(['core:lnd_t2_tank']);
      f.controller.startFactoryUpgrade();
      const command = decodeBatch(f.link.sentBatches[0]!)[0]!;
      expect(command).toMatchObject({ op: Op.Upgrade, units: [f.handle] });
      expect(new DataView(command.payload.buffer, command.payload.byteOffset).getUint16(0, true)).toBe(compiled.indexOf('core:fac_land_t2'));
      step(f.world, [command, { ...command, seq: command.seq + 1, op: Op.FactoryQueue, payload: encodeFactoryQueue({ bp: compiled.indexOf('core:lnd_t1_tank'), count: 1 }) }]); f.publish();
      expect(f.controller.factoryUpgrade.value).toMatchObject({ queued: true, enabled: false });
      // While the factory upgrades itself the queue panel shows no product as current.
      expect(f.controller.model.factory.queue.value?.current).toBeNull();
      f.controller.cancelFactoryUpgrade();
      expect(decodeBatch(f.link.sentBatches.at(-1)!).map(c => c.op)).toEqual([Op.Stop]);
    } finally { f.dispose(); }
  });
  it('the production card lists every compiled unit the factory can build, on unique slots that the grid keys queue', () => {
    const t1 = controllerFixture(false, 'core:fac_land_t1');
    try {
      expect(t1.controller.cardCells().map(c => c.typeId).sort()).toEqual(['core:lnd_t1_arty', 'core:lnd_t1_engineer', 'core:lnd_t1_scout', 'core:lnd_t1_tank']);
    } finally { t1.dispose(); }
    const t3 = controllerFixture(false, 'core:fac_land_t3');
    try {
      const cells = t3.controller.cardCells();
      expect(cells.map(c => c.typeId).sort()).toEqual(['core:lnd_t1_arty', 'core:lnd_t1_engineer', 'core:lnd_t1_scout', 'core:lnd_t1_tank', 'core:lnd_t2_tank', 'core:lnd_t3_heavy']);
      expect(new Set(cells.map(c => c.slot)).size).toBe(cells.length);
      expect(cells.find(c => c.typeId === 'core:lnd_t1_tank')!.slot).toBe('KeyQ'); // roster slot kept
      const heavy = cells.find(c => c.typeId === 'core:lnd_t3_heavy')!;
      t3.controller.handleKey({ code: heavy.slot, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, repeat: false, target: null } as unknown as KeyboardEvent);
      const queued = decodeBatch(t3.link.sentBatches.at(-1)!)[0]!;
      expect(queued.op).toBe(Op.FactoryQueue);
      expect(new DataView(queued.payload.buffer, queued.payload.byteOffset).getUint16(0, true)).toBe(compiled.indexOf('core:lnd_t3_heavy'));
    } finally { t3.dispose(); }
  });
  it('offers no mutation for replays or foreign factories', () => {
    const f = controllerFixture(true);
    try { f.controller.startFactoryUpgrade(); expect(f.link.sentBatches).toHaveLength(0); expect(f.controller.factoryUpgrade.value?.controllable).toBe(false); } finally { f.dispose(); }
  });
});

describe('factory upgrade panel', () => {
  const state: FactoryUpgradeState = { handle: 7, currentTypeId: 'core:str_t1_fac_land', targetTypeId: 'core:str_t2_fac_land', tier: 1, targetTier: 2, unlocks: ['core:lnd_t2_tank'],
    active: false, queued: false, progress: 0, paused: false, stalled: false, enabled: true, controllable: true, mass: 1400, energy: 11000, buildPower: 20, hpMax: 4200, targetBuildPower: 40, targetHpMax: 8200, remainingS: null };
  function mount(value: FactoryUpgradeState) {
    const model = createHudModel(); model.locale.value = 'de';
    const controller = { factoryUpgrade: signal<FactoryUpgradeState | null>(value), startFactoryUpgrade: vi.fn(), pauseFactoryUpgrade: vi.fn(), cancelFactoryUpgrade: vi.fn() };
    const container = document.createElement('div'); document.body.append(container); containers.push(container);
    act(() => render(<HudProvider model={model} commands={createRecordingCommands().commands}><LiveFactoryUpgrade controller={controller}/></HudProvider>, container));
    return { container, controller };
  }
  it('names the successor, costs and unlocked units; explains that production rests while upgrading', () => {
    const { container, controller } = mount(state);
    const start = container.querySelector<HTMLButtonElement>('[data-testid=factory-upgrade-start]')!;
    expect(start.textContent).toContain('Landwerk II'); expect(start.textContent).toContain('1.400 M'); expect(start.textContent).toContain('neu: Meißel');
    act(() => start.click()); expect(controller.startFactoryUpgrade).toHaveBeenCalledOnce();
    act(() => { controller.factoryUpgrade.value = { ...state, active: true, queued: true, enabled: false, progress: .4 }; });
    expect(container.querySelector('[data-testid=factory-upgrade-note]')!.textContent).toContain('ruht die Produktion');
    expect(container.querySelector('[data-testid=factory-upgrade-cancel]')!.getAttribute('title')).toContain('Bauliste bleibt');
  });
});
