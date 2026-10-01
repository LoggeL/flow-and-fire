// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HudProvider, createHudModel, createRecordingCommands, locale } from '@faf/hud';
import { LiveCommanderUpgrade } from '../src/hud/LiveCommanderUpgrade.tsx';
import type { CommanderUpgradeState } from '../src/hud/live.ts';

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) { act(() => render(null, container)); container.remove(); }
  locale.value = 'de';
});

const available: CommanderUpgradeState = {
  handle: 42, currentTypeId: 'core:cmd_commander', targetTypeId: 'core:cmd_commander_engineering',
  stage: 'base', active: false, queued: false, progress: 0, paused: false, stalled: false,
  enabled: true, controllable: true, mass: 300, energy: 1800, buildPower: 20, hpMax: 10000,
  targetBuildPower: 60, targetHpMax: 12000, remainingS: null,
};

function fixture(state: CommanderUpgradeState | null = available) {
  const model = createHudModel();
  model.locale.value = 'en';
  const controller = {
    commanderUpgrade: signal<CommanderUpgradeState | null>(state),
    startCommanderUpgrade: vi.fn(), pauseCommanderUpgrade: vi.fn(), cancelCommanderUpgrade: vi.fn(),
  };
  const commands = createRecordingCommands().commands;
  const container = document.createElement('div');
  document.body.append(container); containers.push(container);
  act(() => render(<HudProvider model={model} commands={commands}><LiveCommanderUpgrade controller={controller}/></HudProvider>, container));
  const queryByTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const getByTestId = (id: string): HTMLElement => {
    const element = queryByTestId(id);
    if (!element) throw new Error(`Missing enhancement element ${id}`);
    return element;
  };
  return { controller, getByTestId, queryByTestId };
}

describe('visible commander enhancement controls', () => {
  it('shows actual costs and improvements without expanding selection details and starts the real controller action', () => {
    const { getByTestId, controller } = fixture();
    const start = getByTestId('commander-upgrade-start') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('300 M');
    expect(start.textContent).toContain('1,800 E');
    expect(start.textContent).toContain('Build power 20 → 60');
    expect(start.textContent).toContain('HP 10,000 → 12,000');
    act(() => start.click());
    expect(controller.startCommanderUpgrade).toHaveBeenCalledOnce();
    act(() => { controller.commanderUpgrade.value = { ...available, enabled: false }; });
    expect(start.disabled).toBe(true);
  });

  it('follows accepted running progress, pause and stall state and exposes pause/cancel actions', () => {
    const { getByTestId, controller } = fixture({ ...available, active: true, queued: true, enabled: false, progress: .35, remainingS: 12 });
    expect(getByTestId('commander-upgrades').textContent).toContain('12 s');
    expect(getByTestId('commander-upgrade-progress').getAttribute('aria-label')).toContain('35%');
    act(() => getByTestId('commander-upgrade-pause').click());
    act(() => getByTestId('commander-upgrade-cancel').click());
    expect(controller.pauseCommanderUpgrade).toHaveBeenCalledOnce();
    expect(controller.cancelCommanderUpgrade).toHaveBeenCalledOnce();
    act(() => { controller.commanderUpgrade.value = { ...available, active: true, queued: true, paused: true, enabled: false, progress: .35 }; });
    expect(getByTestId('commander-upgrades').textContent).toContain('Paused');
    expect(getByTestId('commander-upgrade-pause').textContent).toBe('Resume');
    act(() => { controller.commanderUpgrade.value = { ...available, active: true, queued: true, stalled: true, enabled: false, progress: .35 }; });
    expect(getByTestId('commander-upgrades').textContent).toContain('Waiting for resources');
  });

  it('keeps queued upgrades distinguishable and removes controls when no commander is selected', () => {
    const { getByTestId, queryByTestId, controller } = fixture({ ...available, queued: true, enabled: false });
    expect(getByTestId('commander-upgrades').textContent).toContain('Queued');
    expect((getByTestId('commander-upgrade-pause') as HTMLButtonElement).disabled).toBe(true);
    expect(queryByTestId('commander-upgrade-start')).toBeNull();
    act(() => { controller.commanderUpgrade.value = null; });
    expect(queryByTestId('commander-upgrades')).toBeNull();
  });

  it('disables mutation controls for inspected allied or replay commanders', () => {
    const { getByTestId } = fixture({ ...available, active: true, queued: true, enabled: false, controllable: false });
    expect((getByTestId('commander-upgrade-pause') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('commander-upgrade-cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});
