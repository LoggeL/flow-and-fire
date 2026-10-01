// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HudProvider, createHudModel, createRecordingCommands, locale } from '@faf/hud';
import { LiveExtractorUpgrade } from '../src/hud/LiveExtractorUpgrade.tsx';
import type { ExtractorUpgradeState } from '../src/hud/live.ts';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { GameClient, ClientMap } from '@faf/client';
import { fx } from '@faf/fixed';
import { decodeBatch, FrameWriter, Op, type FrameReader } from '@faf/protocol';
import { createWorld, step, writeFrame } from '../../../packages/sim/src/index.ts';
import { spawnUnit } from '../../../packages/sim/src/units.ts';
import { GameHudController } from '../src/hud/live.ts';
import type { Game } from '../src/game.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeTarget, FakeRenderer, ManualRaf } from '../../../packages/client/test/support/fakes.ts';

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) { act(() => render(null, container)); container.remove(); }
  locale.value = 'de';
});

const available: ExtractorUpgradeState = {
  handle: 42, currentTypeId: 'core:str_t1_mex', targetTypeId: 'core:str_t2_mex',
  tier: 1, targetTier: 2, massIncome: 2, targetMassIncome: 6, energyUpkeep: 2, targetEnergyUpkeep: 9, active: false, queued: false, progress: 0, paused: false, stalled: false,
  enabled: true, controllable: true, mass: 900, energy: 5400, buildPower: 10, hpMax: 400,
  targetBuildPower: 15, targetHpMax: 2100, remainingS: null,
};

function fixture(state: ExtractorUpgradeState | null = available) {
  const model = createHudModel();
  model.locale.value = 'en';
  const controller = {
    extractorUpgrade: signal<ExtractorUpgradeState | null>(state),
    startExtractorUpgrade: vi.fn(), pauseExtractorUpgrade: vi.fn(), cancelExtractorUpgrade: vi.fn(),
  };
  const commands = createRecordingCommands().commands;
  const container = document.createElement('div');
  document.body.append(container); containers.push(container);
  act(() => render(<HudProvider model={model} commands={commands}><LiveExtractorUpgrade controller={controller}/></HudProvider>, container));
  const queryByTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const getByTestId = (id: string): HTMLElement => {
    const element = queryByTestId(id);
    if (!element) throw new Error(`Missing enhancement element ${id}`);
    return element;
  };
  return { controller, getByTestId, queryByTestId };
}

describe('visible extractor upgrade controls', () => {
  it('shows actual costs and improvements without expanding selection details and starts the real controller action', () => {
    const { getByTestId, controller } = fixture();
    const start = getByTestId('extractor-upgrade-start') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(getByTestId('extractor-upgrades').textContent).toContain('T1');
    expect(getByTestId('glyph-mass').getAttribute('data-kind')).toBe('mass');
    expect(start.textContent).toContain('900 M');
    expect(start.textContent).toContain('5,400 E');
    expect(start.textContent).toContain('Mass/s 2 → 6');
    expect(start.textContent).toContain('HP 400 → 2,100');
    act(() => start.click());
    expect(controller.startExtractorUpgrade).toHaveBeenCalledOnce();
    act(() => { controller.extractorUpgrade.value = { ...available, enabled: false }; });
    expect(start.disabled).toBe(true);
  });

  it('follows accepted running progress, pause and stall state and exposes pause/cancel actions', () => {
    const { getByTestId, controller } = fixture({ ...available, active: true, queued: true, enabled: false, progress: .35, remainingS: 12 });
    expect(getByTestId('extractor-upgrades').textContent).toContain('12 s');
    expect(getByTestId('extractor-upgrade-progress').getAttribute('aria-label')).toContain('35%');
    act(() => getByTestId('extractor-upgrade-pause').click());
    act(() => getByTestId('extractor-upgrade-cancel').click());
    expect(controller.pauseExtractorUpgrade).toHaveBeenCalledOnce();
    expect(controller.cancelExtractorUpgrade).toHaveBeenCalledOnce();
    act(() => { controller.extractorUpgrade.value = { ...available, active: true, queued: true, paused: true, enabled: false, progress: .35 }; });
    expect(getByTestId('extractor-upgrades').textContent).toContain('Paused');
    expect(getByTestId('extractor-upgrade-pause').textContent).toBe('Resume');
    act(() => { controller.extractorUpgrade.value = { ...available, active: true, queued: true, stalled: true, enabled: false, progress: .35 }; });
    expect(getByTestId('extractor-upgrades').textContent).toContain('Waiting for resources');
  });

  it('keeps queued upgrades distinguishable and removes controls when no extractor is selected', () => {
    const { getByTestId, queryByTestId, controller } = fixture({ ...available, queued: true, enabled: false });
    expect(getByTestId('extractor-upgrades').textContent).toContain('Queued');
    expect((getByTestId('extractor-upgrade-pause') as HTMLButtonElement).disabled).toBe(true);
    expect(queryByTestId('extractor-upgrade-start')).toBeNull();
    act(() => { controller.extractorUpgrade.value = null; });
    expect(queryByTestId('extractor-upgrades')).toBeNull();
  });

  it('disables mutation controls for inspected allied or replay extractors', () => {
    const { getByTestId } = fixture({ ...available, active: true, queued: true, enabled: false, controllable: false });
    expect((getByTestId('extractor-upgrade-pause') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('extractor-upgrade-cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('maximum extractor tier', () => {
  it('shows completed T3 production without an actionable successor', () => {
    const { getByTestId, queryByTestId } = fixture({ ...available, currentTypeId: 'core:str_t3_mex', targetTypeId: null, tier: 3, targetTier: null, massIncome: 18, targetMassIncome: 18, enabled: false });
    expect(getByTestId('extractor-upgrades').textContent).toContain('T3');
    expect(getByTestId('extractor-upgrades').textContent).toContain('Fully upgraded');
    expect(queryByTestId('extractor-upgrade-start')).toBeNull();
  });
});

// The controller consumes real compiled data and accepted Sim frames, then uses the production serializer.

let compiled: SimBpTable;
beforeAll(async () => { compiled = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
function controllerFixture(readOnlyCommands = false, army = 0) {
  const link = new FakeSimLink({ units: 0, enemyUnits: 0 }), canvas = new FakeCanvas(), map = ClientMap.testPlane(64);
  const client = new GameClient({ canvas, keyTarget: new FakeTarget(), renderer: new FakeRenderer(), link, map, visuals: [], playerArmy: 0, raf: new ManualRaf(), readOnlyCommands });
  const world = createWorld({ bpTable: compiled, seed: 29, armyCount: 2, mapSizeWu: 64 });
  const u = spawnUnit(world, compiled.indexOf('core:str_t1_mex'), army, fx(16), fx(16), 0), handle = world.units.handle(u);
  // Foreign units are deliberately visible for inspection; command ownership still remains own-only.
  world.units.col.visibleMask[u] = 3;
  const game = { client, bp: compiled, map, unitCap: 8192, replayMode: readOnlyCommands, hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game); let seq = 0;
  const publish = () => {
    const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes);
    seq++;
    const length = writeFrame(world, 0, writer, bytes, { seq, tickTimeUs: 0, speedPermille: 1000, flags: 0 }, new Uint32Array([handle]), 1);
    link.frames.deliver(bytes, seq, length); client.frame(seq * 100); client.selectHandles([handle]); controller.update(true);
  };
  publish();
  return { controller, client, link, world, u, handle, publish, dispose: () => { controller.dispose(); client.dispose(); } };
}

describe('accepted extractor controller actions', () => {
  it('shows actual compiled costs and serializes the selected real declared successor', () => {
    const f = controllerFixture();
    try {
      expect(f.controller.extractorUpgrade.value).toMatchObject({ handle: f.handle, tier: 1, targetTier: 2, mass: 900, energy: 5400, massIncome: 2, targetMassIncome: 6, enabled: true });
      f.controller.startExtractorUpgrade();
      const command = decodeBatch(f.link.sentBatches[0]!)[0]!;
      expect(command).toMatchObject({ op: Op.Upgrade, army: 0, units: [f.handle], flags: 0 });
      expect(new DataView(command.payload.buffer, command.payload.byteOffset, command.payload.byteLength).getUint16(0, true)).toBe(compiled.indexOf('core:str_t2_mex'));
      step(f.world, [command]); f.publish();
      expect(f.controller.extractorUpgrade.value).toMatchObject({ active: true, queued: true, enabled: false });
      expect(f.controller.extractorUpgrade.value!.progress).toBe(f.world.units.col.repairDone.get(f.u) / 65536);
      f.controller.pauseExtractorUpgrade(); expect(decodeBatch(f.link.sentBatches[1]!)[0]!.op).toBe(Op.TogglePause);
      f.controller.cancelExtractorUpgrade(); expect(decodeBatch(f.link.sentBatches[2]!)[0]!.op).toBe(Op.Stop);
    } finally { f.dispose(); }
  });
  it('prevents replay, foreign, unfinished, stale selection and duplicate starts from issuing an Upgrade', () => {
    for (const readOnly of [true, false]) {
      const f = controllerFixture(readOnly, readOnly ? 0 : 1);
      try { f.controller.startExtractorUpgrade(); expect(f.link.sentBatches).toHaveLength(0); } finally { f.dispose(); }
    }
    const f = controllerFixture();
    try {
      f.world.units.col.buildDone.set(f.u, 32768); f.publish(); f.controller.startExtractorUpgrade(); expect(f.link.sentBatches).toHaveLength(0);
      f.world.units.col.buildDone.set(f.u, 65536); f.publish();
      f.client.selectHandles([]); f.controller.startExtractorUpgrade(); expect(f.link.sentBatches).toHaveLength(0);
      f.client.selectHandles([f.handle]); f.controller.startExtractorUpgrade();
      step(f.world, [decodeBatch(f.link.sentBatches[0]!)[0]!]); f.publish(); f.controller.startExtractorUpgrade();
      expect(f.link.sentBatches).toHaveLength(1);
      // The authoritative upgrade watch is present, rather than local optimistic progress.
      expect((f.client.lastFrame as FrameReader).watchFactoryBp(0)).toBe(compiled.indexOf('core:str_t2_mex'));
    } finally { f.dispose(); }
  });
});
