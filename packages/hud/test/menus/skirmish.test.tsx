// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { DEMO_MAPS, DEMO_SEED_VALUE, DEMO_SIM_ID, DEMO_SLOTS, applySkirmishDemo } from '../../src/demo/index.ts';
import { SkirmishSetup } from '../../src/menus/skirmish/index.ts';
import {
  DEFAULT_SKIRMISH_RULES,
  canStartSkirmish,
  clampAix,
  compassOf,
  defaultStarts,
  mapKm,
  parseSeed,
  patchSkirmish,
  slotsForMap,
  swapStart,
  validateSkirmish,
} from '../../src/model/menus/skirmish.ts';
import type { SkirmishConfig, SkirmishSlot } from '../../src/model/menus/skirmish.ts';
import { fireEvent, flushSignals, screen, within } from '../support/index.tsx';
import { callsOf, focusedId, key, names, renderMenu } from './helpers.tsx';

const CONFIG: SkirmishConfig = { mapId: 'setons', slots: DEMO_SLOTS, rules: { ...DEFAULT_SKIRMISH_RULES, seed: DEMO_SEED_VALUE } };
const codes = (c: SkirmishConfig): string[] => validateSkirmish(c, DEMO_MAPS).map((p) => p.code);
const withSlot = (i: number, patch: Partial<SkirmishSlot>): readonly SkirmishSlot[] => DEMO_SLOTS.map((s, j) => (j === i ? { ...s, ...patch } : s));

describe('skirmish model (pure)', () => {
  test('the demo configuration is valid and can start once the check is ok', () => {
    expect(codes(CONFIG)).toEqual([]);
    expect(canStartSkirmish([], { state: 'ok', simId: DEMO_SIM_ID, message: null })).toBe(true);
    expect(canStartSkirmish([], { state: 'checking', simId: '', message: null })).toBe(false);
    expect(canStartSkirmish([], { state: 'error', simId: '', message: 'x' })).toBe(false);
  });

  test('validation codes with the slots involved', () => {
    expect(validateSkirmish({ ...CONFIG, slots: withSlot(1, { color: 'team-blau' }) }, DEMO_MAPS)).toEqual([{ code: 'sameColor', slots: [0, 1] }]);
    // Same colour is fine when colours come from the relation/cvd mode.
    expect(codes({ ...CONFIG, slots: withSlot(1, { color: 'team-blau' }), rules: { ...CONFIG.rules, teamColors: 'cvd' } })).toEqual([]);
    expect(codes({ ...CONFIG, slots: withSlot(1, { team: 1 }) })).toEqual(['sameTeam']);
    expect(codes({ ...CONFIG, slots: withSlot(1, { start: 0 }) })).toEqual(['sameStart']);
    expect(codes({ ...CONFIG, slots: withSlot(1, { start: 8 }) })).toEqual(['startOutOfRange']);
    expect(codes({ ...CONFIG, slots: withSlot(0, { controller: 'ai', ai: { difficulty: 'easy', aix: false, aixFactor: 1 } }) })).toEqual(['noHuman']);
    expect(codes({ ...CONFIG, slots: withSlot(1, { ai: { difficulty: 'hard', aix: true, aixFactor: 2.5 } }) })).toEqual(['aixRange']);
    expect(codes({ ...CONFIG, slots: withSlot(1, { ai: { difficulty: 'hard', aix: true, aixFactor: 1.25 } }) })).toEqual(['aixRange']);
    expect(codes({ ...CONFIG, mapId: 'braidwater' })).toEqual(['mapUnavailable', 'startOutOfRange']);
    expect(codes({ ...CONFIG, mapId: 'nowhere' })).toEqual(['mapMissing']);
    expect(codes({ ...CONFIG, rules: { ...CONFIG.rules, unitCap: 333 } })).toEqual(['unitCap']);
    expect(codes({ ...CONFIG, rules: { ...CONFIG.rules, seed: -1 } })).toEqual(['seed']);
    expect(codes({ ...CONFIG, rules: { ...CONFIG.rules, seed: 1.5 } })).toEqual(['seed']);
  });

  test('swapStart: free start moves the slot, a held start swaps both, same start is a no-op', () => {
    const moved = swapStart(DEMO_SLOTS, 2, 0);
    expect(moved.map((s) => s.start)).toEqual([2, 4]);
    const swapped = swapStart(DEMO_SLOTS, 4, 0);
    expect(swapped.map((s) => s.start)).toEqual([4, 0]);
    expect(swapStart(DEMO_SLOTS, 0, 0)).toBe(DEMO_SLOTS);
    expect(swapStart(DEMO_SLOTS, 3, 9)).toBe(DEMO_SLOTS);
  });

  test('map change keeps valid starts, repairs invalid ones', () => {
    const hollow = DEMO_MAPS.find((m) => m.id === 'hollow-ridge');
    expect(hollow).toBeDefined();
    if (!hollow) return;
    expect(defaultStarts(hollow)).toEqual([0, 1]);
    expect(defaultStarts({ starts: 8 })).toEqual([0, 4]);
    expect(slotsForMap(DEMO_SLOTS, hollow).map((s) => s.start)).toEqual([0, 1]);
    expect(slotsForMap(DEMO_SLOTS, { starts: 8 })).toBe(DEMO_SLOTS);
    const next = patchSkirmish(CONFIG, { mapId: 'hollow-ridge' }, DEMO_MAPS);
    expect(next.mapId).toBe('hollow-ridge');
    expect(next.slots.map((s) => s.start)).toEqual([0, 1]);
    expect(patchSkirmish(CONFIG, { rules: { ...CONFIG.rules, fog: 'revealed' } }, DEMO_MAPS).rules.fog).toBe('revealed');
  });

  test('helpers: seed parsing, AIx clamping, km, compass', () => {
    expect(parseSeed(' 48213 ')).toBe(48213);
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('2147483647')).toBe(2_147_483_647);
    expect(parseSeed('2147483648')).toBeNull();
    expect(parseSeed('-3')).toBeNull();
    expect(parseSeed('12a')).toBeNull();
    expect(parseSeed('')).toBeNull();
    expect(clampAix(1.34)).toBe(1.3);
    expect(clampAix(0.2)).toBe(1);
    expect(clampAix(9)).toBe(2);
    expect(clampAix(Number.NaN)).toBe(1);
    expect(mapKm(1024)).toBe(20);
    expect(mapKm(512)).toBe(10);
    expect(compassOf(0.14, 0.86)).toBe('southwest');
    expect(compassOf(0.86, 0.14)).toBe('northeast');
    expect(compassOf(0.5, 0.5)).toBe('center');
    expect(compassOf(0.5, 0.05)).toBe('north');
  });
});

describe('SkirmishSetup (A3)', () => {
  test('three columns: map list with meta, description, AI profile, preview with starts, houses and rules', () => {
    renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m) });
    const list = screen.getByTestId('map-list');
    expect(within(list).getAllByRole('option').map((o) => o.dataset['testid'])).toEqual(['map-setons', 'map-hollow-ridge', 'map-tessera', 'map-braidwater']);
    expect(screen.getByTestId('map-setons').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('map-setons').textContent).toBe('Setons1.024 WU · 20 km · 8 Starts · 108 Mex');
    expect(screen.getByTestId('map-braidwater').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('map-description-text').textContent).toContain('Zwei Seen trennen die Seiten');
    expect(screen.getByTestId('ai-profile').textContent).toContain('KI-Profil · Normal');
    const marks = screen.getByTestId('skirmish-preview').querySelectorAll('button.pmark');
    expect(marks).toHaveLength(8);
    expect(screen.getByTestId('start-1').getAttribute('aria-label')).toBe('Start 1 – Haus Ambrecht (Du)');
    expect(screen.getByTestId('start-5').getAttribute('aria-label')).toBe('Start 5 – Haus Dorne (KI)');
    expect(screen.getByTestId('start-3').className).toContain('is-free');
    expect(screen.getByTestId('map-facts').textContent).toContain('auf Start 1 ↔ 5');
    expect(screen.getByTestId('slot-1').textContent).toContain('Haus Ambrecht');
    expect(screen.getByTestId('slot-1').textContent).toContain('Du · Start 1 (Südwest)');
    expect(screen.getByTestId('slot-2').textContent).toContain('KI · Start 5 (Nordost)');
    expect(screen.getByTestId('slot-2-aix-value').textContent).toBe('×1,3');
    expect(screen.getByTestId('skirmish-check-state').textContent).toBe(`Karte und Blueprints geprüft · simId ${DEMO_SIM_ID}`);
    expect(screen.queryByTestId('skirmish-problems')).toBeNull();
    expect((screen.getByTestId('skirmish-seed') as HTMLInputElement).value).toBe('48213');
    expect(focusedId()).toBe('skirmish-start');
  });

  test('"Gefecht starten" sends the complete configuration (click and Enter)', () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m) });
    fireEvent.click(screen.getByTestId('skirmish-start'));
    const [cfg] = callsOf(r.calls, 'startSkirmish')[0] ?? [];
    expect(cfg).toEqual({
      mapId: 'setons',
      slots: [
        { index: 1, name: 'Ambrecht', controller: 'human', faction: 'varkan', color: 'team-blau', team: 1, start: 0, ai: null },
        { index: 2, name: 'Dorne', controller: 'ai', faction: 'varkan', color: 'team-rot', team: 2, start: 4, ai: { difficulty: 'normal', aix: true, aixFactor: 1.3 } },
      ],
      rules: { victory: 'assassination', unitCap: 500, startSpeed: 1, fog: 'explore', teamColors: 'house', seed: 48213 },
    });
    // Enter anywhere outside fields/buttons starts too (e.g. on the page).
    key(screen.getByTestId('skirmish-rules'), 'Enter');
    expect(callsOf(r.calls, 'startSkirmish')).toHaveLength(2);
    // Enter in the seed field does not start.
    key(screen.getByTestId('skirmish-seed'), 'Enter');
    expect(callsOf(r.calls, 'startSkirmish')).toHaveLength(2);
  });

  test('validation error (same colour + same team) shows problems, marks slots and blocks the start', () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m, 'invalid') });
    const problems = screen.getByTestId('skirmish-problems');
    expect(problems.getAttribute('role')).toBe('alert');
    expect(Array.from(problems.querySelectorAll('li')).map((li) => li.dataset['code'])).toEqual(['sameColor', 'sameTeam']);
    expect(problems.textContent).toContain('Zwei Häuser haben dieselbe Farbe.');
    expect(screen.getByTestId('slot-1').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('slot-2').className).toContain('is-invalid');
    const start = screen.getByTestId('skirmish-start');
    expect(start.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(start);
    key(screen.getByTestId('skirmish-rules'), 'Enter');
    expect(callsOf(r.calls, 'startSkirmish')).toEqual([]);
  });

  test('pending or failed external check blocks the start', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m, 'checking') });
    expect(screen.getByTestId('skirmish-check-state').dataset['state']).toBe('checking');
    expect(screen.getByTestId('skirmish-start').getAttribute('aria-disabled')).toBe('true');
    await flushSignals(() => {
      r.model.menus.skirmish.validation.value = { state: 'error', simId: '', message: 'ui.skirmish.check.blueprintHash' };
    });
    expect(screen.getByTestId('skirmish-check-state').textContent).toBe('Prüfung fehlgeschlagen: Blueprint-Hash weicht vom Build ab');
    fireEvent.click(screen.getByTestId('skirmish-start'));
    expect(callsOf(r.calls, 'startSkirmish')).toEqual([]);
  });

  test('click on a start marker swaps starts (updateSkirmish) and the controller applies it', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('start-3')));
    const patch = callsOf(r.calls, 'updateSkirmish')[0]?.[0] as { slots: readonly SkirmishSlot[] };
    expect(patch.slots.map((s) => s.start)).toEqual([2, 4]);
    expect(r.model.menus.skirmish.slots.value.map((s) => s.start)).toEqual([2, 4]);
    expect(screen.getByTestId('start-3').getAttribute('aria-label')).toBe('Start 3 – Haus Ambrecht (Du)');
    // Taking the AI's start swaps both.
    await flushSignals(() => fireEvent.click(screen.getByTestId('start-5')));
    expect(r.model.menus.skirmish.slots.value.map((s) => s.start)).toEqual([4, 2]);
    // Own start: nothing to send.
    fireEvent.click(screen.getByTestId('start-5'));
    expect(callsOf(r.calls, 'updateSkirmish')).toHaveLength(2);
  });

  test('map selection: updateSkirmish({mapId}); unavailable maps are ignored; ↓ moves in the list', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    fireEvent.click(screen.getByTestId('map-braidwater'));
    fireEvent.click(screen.getByTestId('map-setons'));
    expect(callsOf(r.calls, 'updateSkirmish')).toEqual([]);
    await flushSignals(() => fireEvent.click(screen.getByTestId('map-hollow-ridge')));
    expect(callsOf(r.calls, 'updateSkirmish')).toEqual([[{ mapId: 'hollow-ridge' }]]);
    expect(r.model.menus.skirmish.selectedMap.value).toBe('hollow-ridge');
    expect(r.model.menus.skirmish.slots.value.map((s) => s.start)).toEqual([0, 1]);
    expect(screen.getByTestId('skirmish-preview').querySelectorAll('button.pmark')).toHaveLength(2);
    screen.getByTestId('map-setons').focus();
    key(screen.getByTestId('map-setons'), 'ArrowDown');
    expect(focusedId()).toBe('map-hollow-ridge');
    key(screen.getByTestId('map-hollow-ridge'), 'ArrowDown');
    expect(focusedId()).toBe('map-tessera');
    key(screen.getByTestId('map-tessera'), 'ArrowDown');
    expect(focusedId()).toBe('map-setons');
  });

  test('AI slot: level, AIx switch and slider ×1,0–×2,0 send the whole slot list', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(within(screen.getByTestId('slot-2-level')).getByText('Schwer')));
    expect(r.model.menus.skirmish.slots.value[1]?.ai).toEqual({ difficulty: 'hard', aix: true, aixFactor: 1.3 });
    expect(screen.getByTestId('ai-profile').textContent).toContain('KI-Profil · Schwer');
    const slider = screen.getByTestId('slot-2-aix-factor') as HTMLInputElement;
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('20');
    expect(slider.getAttribute('aria-valuetext')).toBe('×1,3');
    await flushSignals(() => fireEvent.input(slider, { target: { value: '17' } }));
    expect(r.model.menus.skirmish.slots.value[1]?.ai?.aixFactor).toBe(1.7);
    expect(screen.getByTestId('slot-2-aix-value').textContent).toBe('×1,7');
    await flushSignals(() => fireEvent.click(screen.getByTestId('slot-2-aix')));
    expect(r.model.menus.skirmish.slots.value[1]?.ai?.aix).toBe(false);
    expect((screen.getByTestId('slot-2-aix-factor') as HTMLInputElement).disabled).toBe(true);
    const updates = callsOf(r.calls, 'updateSkirmish').map((a) => a[0] as { slots: readonly SkirmishSlot[] });
    expect(updates).toHaveLength(3);
    for (const u of updates) expect(u.slots).toHaveLength(2);
    expect(screen.queryByTestId('slot-1-level')).toBeNull();
  });

  test('colour picker (radio grid, taken colours marked, Esc closes) and team select', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    const swatch = screen.getByTestId('slot-1-color');
    expect(swatch.getAttribute('aria-label')).toBe('Farbe von Haus Ambrecht: Blau – ändern');
    await flushSignals(() => fireEvent.click(swatch));
    const grid = screen.getByTestId('slot-1-colors');
    expect(within(grid).getAllByRole('radio')).toHaveLength(8);
    expect(screen.getByTestId('color-team-rot').className).toBe('is-taken');
    expect(focusedId()).toBe('color-team-blau');
    key(document.activeElement as Element, 'ArrowRight');
    expect(focusedId()).toBe('color-team-gruen');
    await flushSignals(() => key(grid, 'Escape'));
    expect(screen.queryByTestId('slot-1-colors')).toBeNull();
    expect(focusedId()).toBe('slot-1-color');
    await flushSignals(() => fireEvent.click(swatch));
    await flushSignals(() => fireEvent.click(screen.getByTestId('color-team-rot')));
    expect(r.model.menus.skirmish.slots.value[0]?.color).toBe('team-rot');
    expect(screen.getByTestId('skirmish-problems').textContent).toContain('Zwei Häuser haben dieselbe Farbe.');
    await flushSignals(() => fireEvent.change(screen.getByTestId('slot-2-team'), { target: { value: '1' } }));
    expect(r.model.menus.skirmish.slots.value[1]?.team).toBe(1);
    expect(Array.from(screen.getByTestId('skirmish-problems').querySelectorAll('li')).map((li) => li.dataset['code'])).toEqual([
      'sameColor',
      'sameTeam',
    ]);
  });

  test('rules: victory, unit cap, speed, fog, team colour mode with preview (typed values)', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(within(screen.getByTestId('rule-victory')).getByText('Supremacy')));
    expect(screen.getByTestId('rule-victory-hint').textContent).not.toBe('');
    await flushSignals(() => fireEvent.change(screen.getByTestId('rule-unit-cap'), { target: { value: '750' } }));
    await flushSignals(() => fireEvent.change(screen.getByTestId('rule-speed'), { target: { value: '1.5' } }));
    await flushSignals(() => fireEvent.change(screen.getByTestId('rule-fog'), { target: { value: 'revealed' } }));
    await flushSignals(() => fireEvent.change(screen.getByTestId('rule-team-colors'), { target: { value: 'cvd' } }));
    const rules = r.model.menus.skirmish.rules.value;
    expect(rules).toEqual({ victory: 'supremacy', unitCap: 750, startSpeed: 1.5, fog: 'revealed', teamColors: 'cvd', seed: 48213 });
    expect(typeof rules.unitCap).toBe('number');
    const prev = screen.getByTestId('rule-team-preview').querySelectorAll('i');
    expect((prev[0] as HTMLElement).style.getPropertyValue('--team')).toBe('var(--cvd-blau)');
    expect((prev[1] as HTMLElement).style.getPropertyValue('--team')).toBe('var(--cvd-rot)');
    expect(screen.getByTestId('slot-1').style.getPropertyValue('--team')).toBe('var(--cvd-blau)');
    expect(screen.getByTestId('skirmish-setup').dataset['teamsPreview']).toBe('cvd');
  });

  test('seed: valid input updates the rules, invalid input is flagged; dice asks for a new seed', async () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m), controller: true });
    const seed = screen.getByTestId('skirmish-seed') as HTMLInputElement;
    await flushSignals(() => fireEvent.input(seed, { target: { value: '77' } }));
    expect(r.model.menus.skirmish.rules.value.seed).toBe(77);
    await flushSignals(() => fireEvent.input(seed, { target: { value: '7x' } }));
    expect(r.model.menus.skirmish.rules.value.seed).toBe(77);
    expect(seed.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByTestId('skirmish-reroll'));
    expect(callsOf(r.calls, 'rerollSeed')).toEqual([[]]);
    // A new seed from the game replaces the field text.
    await flushSignals(() => {
      r.model.menus.skirmish.rules.value = { ...r.model.menus.skirmish.rules.peek(), seed: 9001 };
    });
    expect(seed.value).toBe('9001');
    expect(seed.getAttribute('aria-invalid')).toBeNull();
  });

  test('Esc and "Zurück" go back to the main menu', () => {
    const r = renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m) });
    key(screen.getByTestId('skirmish-start'), 'Escape');
    fireEvent.click(screen.getByTestId('skirmish-back'));
    fireEvent.click(screen.getByTestId('skirmish-back-icon'));
    expect(names(r.calls)).toEqual(['navigate', 'navigate', 'navigate']);
    expect(callsOf(r.calls, 'navigate')).toEqual([['main'], ['main'], ['main']]);
  });

  test('cvd preset colours the slots by slot order; EN texts', () => {
    renderMenu(<SkirmishSetup />, { setup: (m) => applySkirmishDemo(m, 'cvd'), locale: 'en' });
    expect(screen.getByTestId('slot-2').style.getPropertyValue('--team')).toBe('var(--cvd-rot)');
    expect(screen.getByTestId('skirmish-start').textContent).toContain('Start');
    expect(screen.getByTestId('slot-1').textContent).toContain('House Ambrecht');
  });
});
