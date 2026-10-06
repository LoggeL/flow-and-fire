// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { GameMenu } from '../../src/menus/gamemenu/index.ts';
import { applyGameMenuDemo } from '../../src/demo/index.ts';
import { GAME_MENU_ACTIONS } from '../../src/model/menus/gamemenu.ts';
import { fireEvent, flushSignals, screen } from '../support/index.tsx';
import { callsOf, focusedId, key, names, renderMenu } from './helpers.tsx';

describe('GameMenu (Esc, G12)', () => {
  test('renders nothing while closed', () => {
    renderMenu(<GameMenu />);
    expect(screen.queryByTestId('game-menu')).toBeNull();
  });

  test('modal dialog: aria-modal, labelled, z-layer, five actions in order, focus on "Fortsetzen"', () => {
    renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m) });
    const dlg = screen.getByTestId('game-menu');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Spielmenü');
    expect(dlg.dataset['component']).toBe('GameMenu');
    expect(screen.getByTestId('game-menu-layer').className).toBe('gm-layer');
    expect(GAME_MENU_ACTIONS).toEqual(['resume', 'settings', 'keys', 'surrender', 'quit']);
    const buttons = Array.from(dlg.querySelectorAll('button')).map((b) => b.dataset['testid']);
    expect(buttons).toEqual(['gm-resume', 'gm-settings', 'gm-keys', 'gm-surrender', 'gm-quit']);
    expect(focusedId()).toBe('gm-resume');
    expect(screen.getByTestId('gm-note').textContent).toBe('Die Simulation ist pausiert.');
  });

  test('focus trap: Tab wraps from the last to the first action, Shift+Tab the other way', () => {
    renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m) });
    const quit = screen.getByTestId('gm-quit');
    quit.focus();
    key(quit, 'Tab');
    expect(focusedId()).toBe('gm-resume');
    key(document.activeElement as Element, 'Tab', { shiftKey: true });
    expect(focusedId()).toBe('gm-quit');
    // Inside the list Tab stays native (not prevented).
    const settings = screen.getByTestId('gm-settings');
    settings.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    settings.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('actions: resume, settings, key overview, quit', () => {
    const r = renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m) });
    fireEvent.click(screen.getByTestId('gm-resume'));
    fireEvent.click(screen.getByTestId('gm-settings'));
    fireEvent.click(screen.getByTestId('gm-keys'));
    fireEvent.click(screen.getByTestId('gm-quit'));
    expect(names(r.calls)).toEqual(['resume', 'openSettings', 'openSettings', 'quitToMenu']);
    expect(callsOf(r.calls, 'openSettings')).toEqual([['graphics'], ['keys']]);
  });

  test('Esc resumes (controller closes the menu and gives the focus back)', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const r = renderMenu(<GameMenu />, { controller: true });
    await flushSignals(() => applyGameMenuDemo(r.model));
    expect(focusedId()).toBe('gm-resume');
    await flushSignals(() => key(document.activeElement as Element, 'Escape'));
    expect(names(r.calls)).toEqual(['resume']);
    expect(r.model.menus.gameMenu.open.value).toBe(false);
    expect(screen.queryByTestId('game-menu')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test('surrender needs a confirmation: alertdialog, focus on the safe choice, Esc goes back', async () => {
    const r = renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('gm-surrender')));
    expect(callsOf(r.calls, 'askSurrender')).toEqual([[true]]);
    expect(callsOf(r.calls, 'surrender')).toEqual([]);
    const dlg = screen.getByTestId('game-menu');
    expect(dlg.getAttribute('role')).toBe('alertdialog');
    expect(dlg.dataset['state']).toBe('confirm');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Aufgeben?');
    expect(focusedId()).toBe('gm-surrender-no');
    // Trap inside the confirmation.
    key(screen.getByTestId('gm-surrender-no'), 'Tab');
    expect(focusedId()).toBe('gm-surrender-yes');
    await flushSignals(() => key(document.activeElement as Element, 'Escape'));
    expect(callsOf(r.calls, 'askSurrender')).toEqual([[true], [false]]);
    expect(screen.getByTestId('game-menu').dataset['state']).toBe('open');
    expect(r.model.menus.gameMenu.open.value).toBe(true);
    // Confirm for real.
    await flushSignals(() => fireEvent.click(screen.getByTestId('gm-surrender')));
    fireEvent.click(screen.getByTestId('gm-surrender-yes'));
    expect(callsOf(r.calls, 'surrender')).toEqual([[]]);
  });

  test('"Weiterspielen" dismisses the confirmation; multiplayer note', async () => {
    const r = renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m, true), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('gm-surrender-no')));
    expect(callsOf(r.calls, 'askSurrender')).toEqual([[false]]);
    await flushSignals(() => {
      r.model.menus.gameMenu.singlePlayer.value = false;
    });
    expect(screen.getByTestId('gm-note').textContent).toBe('Die Partie läuft weiter.');
  });

  test('openSettings via the controller closes the menu and selects the tab', async () => {
    const r = renderMenu(<GameMenu />, { setup: (m) => applyGameMenuDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('gm-keys')));
    expect(r.model.menus.gameMenu.open.value).toBe(false);
    expect(r.model.menus.settings.tab.value).toBe('keys');
  });
});
