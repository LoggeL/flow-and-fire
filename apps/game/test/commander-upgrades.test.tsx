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
  weaponRange: 22, weaponDps: 100, activeEnhancementId: null,
  enhancements: [
    { id: 'engineering', slot: 'left', installed: false, enabled: true, targetTypeId: 'core:cmd_commander_engineering', mass: 300, energy: 1800, buildTime: 400, targetBuildPower: 60, targetHpMax: 12000, targetWeaponRange: 22, targetWeaponDps: 100 },
    { id: 'armor', slot: 'back', installed: false, enabled: true, targetTypeId: 'core:cmd_commander_armor', mass: 400, energy: 5000, buildTime: 800, targetBuildPower: 20, targetHpMax: 18000, targetWeaponRange: 22, targetWeaponDps: 100 },
    { id: 'cannon', slot: 'right', installed: false, enabled: true, targetTypeId: 'core:cmd_commander_cannon', mass: 250, energy: 2500, buildTime: 500, targetBuildPower: 20, targetHpMax: 10000, targetWeaponRange: 32, targetWeaponDps: 150 },
  ],
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
    expect(controller.startCommanderUpgrade).toHaveBeenCalledWith('engineering');
    act(() => { controller.commanderUpgrade.value = { ...available, enabled: false, enhancements: available.enhancements.map(item => ({ ...item, enabled: false })) }; });
    expect(start.disabled).toBe(true);
  });

  it('selects independent left, back and right slots and submits the chosen module with its actual effects', () => {
    const { getByTestId, controller } = fixture();
    expect(getByTestId('commander-slot-left').getAttribute('aria-pressed')).toBe('true');
    act(() => getByTestId('commander-slot-right').click());
    expect(getByTestId('commander-slot-right').getAttribute('aria-pressed')).toBe('true');
    const start = getByTestId('commander-upgrade-start');
    expect(start.textContent).toContain('Range 22 → 32');
    expect(start.textContent).toContain('DPS 100 → 150');
    act(() => start.click());
    expect(controller.startCommanderUpgrade).toHaveBeenLastCalledWith('cannon');
    act(() => getByTestId('commander-slot-back').click());
    expect(getByTestId('commander-upgrade-start').textContent).toContain('HP 10,000 → 18,000');
    act(() => getByTestId('commander-upgrade-start').click());
    expect(controller.startCommanderUpgrade).toHaveBeenLastCalledWith('armor');
  });

  it('shows installed modules without charging them again and retains other slot choices', () => {
    const { getByTestId, queryByTestId } = fixture({ ...available, enhancements: available.enhancements.map(item => item.id === 'engineering' ? { ...item, installed: true, enabled: false } : item) });
    expect(getByTestId('commander-slot-left').getAttribute('data-installed')).toBe('true');
    expect(getByTestId('commander-enhancement-installed').textContent).toContain('Installed');
    expect(queryByTestId('commander-upgrade-start')).toBeNull();
    act(() => getByTestId('commander-slot-right').click());
    expect(getByTestId('commander-upgrade-start').getAttribute('data-enhancement')).toBe('cannon');
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

  it('explains the idle economy of a paused upgrade and that cancelling resumes the commander', () => {
    const { getByTestId, queryByTestId, controller } = fixture({ ...available, active: true, queued: true, enabled: false, progress: .35 });
    expect(queryByTestId('commander-upgrade-paused-note')).toBeNull();
    expect(getByTestId('commander-upgrade-cancel').textContent).toBe('Cancel');
    act(() => { controller.commanderUpgrade.value = { ...available, active: true, queued: true, paused: true, enabled: false, progress: .35 }; });
    expect(getByTestId('commander-upgrade-paused-note').textContent).toContain('income and build power are idle');
    expect(getByTestId('commander-upgrade-cancel').textContent).toBe('Cancel & resume');
    expect(getByTestId('commander-upgrade-cancel').getAttribute('title')).toContain('resumes the unit');
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

  it('does not reset the running module when another body slot is inspected', () => {
    const { getByTestId } = fixture({ ...available, active: true, queued: true, activeEnhancementId: 'cannon', progress: .42 });
    act(() => getByTestId('commander-slot-back').click());
    expect(getByTestId('commander-upgrade-progress').getAttribute('aria-label')).toContain('Main cannon amplifier: 42%');
    expect(getByTestId('commander-slot-right').className).toContain('is-fitting');
  });
});
