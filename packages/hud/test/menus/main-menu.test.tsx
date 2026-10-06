// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { MainMenu, agoText } from '../../src/menus/main/index.ts';
import { applyMainMenuDemo } from '../../src/demo/index.ts';
import { agoParts, mainNavItems, nextEnabled } from '../../src/model/menus/main.ts';
import { fireEvent, flushSignals, screen, within } from '../support/index.tsx';
import { callsOf, focusedId, key, names, renderMenu } from './helpers.tsx';

describe('main menu model (pure)', () => {
  test('navigation order and locks: replays locked until MS11, tutorial always (post-MVP)', () => {
    expect(mainNavItems(false).map((i) => `${i.id}:${i.locked ? 'L' : '-'}`)).toEqual([
      'skirmish:-',
      'replays:L',
      'settings:-',
      'tutorial:L',
      'credits:-',
    ]);
    expect(mainNavItems(true).find((i) => i.id === 'replays')?.locked).toBe(false);
  });

  test('nextEnabled skips locked entries and wraps', () => {
    const locked = [false, true, false, true, false];
    expect(nextEnabled(locked, 0, 1)).toBe(2);
    expect(nextEnabled(locked, 2, 1)).toBe(4);
    expect(nextEnabled(locked, 4, 1)).toBe(0);
    expect(nextEnabled(locked, 0, -1)).toBe(4);
    expect(nextEnabled(locked, -1, 1)).toBe(0);
    expect(nextEnabled([true, true], 0, 1)).toBe(-1);
    expect(nextEnabled([], 0, 1)).toBe(-1);
  });

  test('agoParts picks the largest whole unit (at least one minute)', () => {
    expect(agoParts(5)).toEqual({ unit: 'minutes', n: 1 });
    expect(agoParts(59 * 60)).toEqual({ unit: 'minutes', n: 59 });
    expect(agoParts(2 * 3600 + 11 * 60)).toEqual({ unit: 'hours', n: 2 });
    expect(agoParts(3 * 86_400)).toEqual({ unit: 'days', n: 3 });
    expect(agoParts(-10)).toEqual({ unit: 'minutes', n: 1 });
  });
});

describe('MainMenu (ui.md §5.15, A3)', () => {
  test('word mark, tagline, nav, emblem, footer and last match from the demo', () => {
    renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m) });
    const root = screen.getByTestId('main-menu');
    expect(root.dataset['component']).toBe('MainMenu');
    expect(screen.getByTestId('wordmark').getAttribute('aria-label')).toBe('Flow & Fire');
    expect(screen.getByTestId('wordmark').getAttribute('role')).toBe('heading');
    expect(root.querySelector('.tagline')?.textContent).toBe('Die Charta kennt nur einen Weg. Erz wartet nicht.');
    expect(screen.getByTestId('emblem').getAttribute('aria-hidden')).toBe('true');
    const nav = screen.getByTestId('main-nav');
    expect(within(nav).getAllByRole('button').map((b) => b.dataset['testid'])).toEqual([
      'nav-skirmish',
      'nav-replays',
      'nav-settings',
      'nav-tutorial',
      'nav-credits',
    ]);
    expect(screen.getByTestId('nav-skirmish').className).toContain('is-primary');
    expect(screen.getByTestId('nav-replays').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('nav-replays').textContent).toContain('ab MS11');
    expect(screen.getByTestId('nav-tutorial').title).toBe('Die Einweisung (A20) folgt nach dem MVP.');
    expect(screen.getByTestId('menu-build').textContent).toBe('Build 3f9a1c2 · simId 0x7b21e04c');
    expect(screen.getByTestId('menu-tech').textContent).toBe('WebGL2 · Worker-Transport SAB · Preset Mittel');
    expect(screen.getByTestId('last-match-summary').textContent).toBe('Sieg gegen Haus Dorne (KI Normal) · Setons · 23:41');
    expect(screen.getByTestId('last-match').textContent).toContain('vor 2 Std.');
    expect(screen.getByTestId('last-match').textContent).toMatch(/Replay gespeichert · 118,4\sKB/);
  });

  test('focus starts on "Gefecht"; ↑/↓ skip locked entries (roving tabindex), Enter/click navigates', () => {
    const r = renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m) });
    expect(focusedId()).toBe('nav-skirmish');
    const nav = screen.getByTestId('main-nav');
    key(document.activeElement as Element, 'ArrowDown');
    expect(focusedId()).toBe('nav-settings');
    expect(screen.getByTestId('nav-settings').tabIndex).toBe(0);
    expect(screen.getByTestId('nav-skirmish').tabIndex).toBe(-1);
    key(document.activeElement as Element, 'ArrowDown');
    expect(focusedId()).toBe('nav-credits');
    key(document.activeElement as Element, 'ArrowDown');
    expect(focusedId()).toBe('nav-skirmish');
    key(document.activeElement as Element, 'ArrowUp');
    expect(focusedId()).toBe('nav-credits');
    key(nav, 'Home');
    expect(focusedId()).toBe('nav-skirmish');
    key(nav, 'End');
    expect(focusedId()).toBe('nav-credits');
    // Enter on a focused button is a native click.
    fireEvent.click(screen.getByTestId('nav-settings'));
    fireEvent.click(screen.getByTestId('nav-skirmish'));
    expect(callsOf(r.calls, 'navigate')).toEqual([['settings'], ['skirmish']]);
  });

  test('locked entries do not navigate', () => {
    const r = renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m) });
    fireEvent.click(screen.getByTestId('nav-replays'));
    fireEvent.click(screen.getByTestId('nav-tutorial'));
    expect(callsOf(r.calls, 'navigate')).toEqual([]);
  });

  test('replays unlock with MS11 (replaysAvailable) and are reachable with ↓', async () => {
    const r = renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m) });
    await flushSignals(() => {
      r.model.menus.main.replaysAvailable.value = true;
    });
    expect(screen.getByTestId('nav-replays').getAttribute('aria-disabled')).toBeNull();
    key(screen.getByTestId('nav-skirmish'), 'ArrowDown');
    expect(focusedId()).toBe('nav-replays');
    fireEvent.click(screen.getByTestId('nav-replays'));
    expect(callsOf(r.calls, 'navigate')).toEqual([['replays']]);
  });

  test('last match: replay and rematch commands; no replay disables "Ansehen"', async () => {
    const r = renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m) });
    fireEvent.click(screen.getByTestId('last-match-watch'));
    fireEvent.click(screen.getByTestId('last-match-rematch'));
    expect(names(r.calls)).toEqual(['watchReplay', 'rematch']);
    const last = r.model.menus.main.lastMatch.peek();
    await flushSignals(() => {
      r.model.menus.main.lastMatch.value = last ? { ...last, replayBytes: null, verdict: 'defeat', opponentAi: null } : null;
    });
    expect((screen.getByTestId('last-match-watch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('last-match-summary').textContent).toBe('Niederlage gegen Haus Dorne · Setons · 23:41');
    expect(screen.getByTestId('last-match').textContent).toContain('Kein Replay gespeichert');
  });

  test('empty last match', () => {
    renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m, 'empty') });
    expect(screen.getByTestId('last-match-empty').textContent).toBe('Noch keine Partie gespielt.');
    expect(screen.queryByTestId('last-match-watch')).toBeNull();
  });

  test('DE/EN switch: setLocale("en") and all texts change live (controller)', async () => {
    const r = renderMenu(<MainMenu />, { setup: (m) => applyMainMenuDemo(m), controller: true });
    const seg = screen.getByTestId('menu-language');
    expect(within(seg).getByRole('radio', { checked: true }).textContent).toBe('DE');
    await flushSignals(() => {
      fireEvent.click(within(seg).getByText('EN'));
    });
    expect(callsOf(r.calls, 'setLocale')).toEqual([['en']]);
    expect(r.model.locale.value).toBe('en');
    expect(r.model.menus.settings.values.value.locale).toBe('en');
    expect(screen.getByTestId('nav-skirmish').textContent).toContain('Skirmish');
    expect(screen.getByTestId('nav-settings').textContent).toContain('Settings');
    expect(screen.getByTestId('menu-tech').textContent).toBe('WebGL2 · worker transport SAB · preset Medium');
    expect(screen.getByTestId('last-match-summary').textContent).toBe('Victory against House Dorne (AI Normal) · Setons · 23:41');
    expect(screen.getByTestId('last-match').textContent).toContain('2 h ago');
    expect(within(seg).getByRole('radio', { checked: true }).textContent).toBe('EN');
    fireEvent.click(screen.getByTestId('menu-fullscreen'));
    expect(callsOf(r.calls, 'toggleFullscreen')).toEqual([[]]);
  });

  test('agoText uses plural forms', () => {
    expect(agoText(60)).toBe('vor 1 Min.');
    expect(agoText(86_400)).toBe('vor 1 Tag');
    expect(agoText(2 * 86_400)).toBe('vor 2 Tagen');
  });
});
