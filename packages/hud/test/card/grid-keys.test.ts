import { describe, expect, it } from 'vitest';
import { resolveCardPage } from '../../src/data/card-logic.ts';
import type { CardPageSpec } from '../../src/data/card-logic.ts';
import { isSelfDestructKey, keyInputFromEvent, resolveGridKey, shouldPreventDefault } from '../../src/hud/card/gridKeys.ts';
import type { GridKeyAction, GridKeyContext, KeyInput } from '../../src/hud/card/gridKeys.ts';
import { resolveStripKey, stripShouldPreventDefault } from '../../src/hud/strip/stripKeys.ts';
import { ARMY_ORDERS, BUILDER_ORDERS, FACTORY_ORDERS } from '../../src/demo/card.ts';
import { keyLabel } from '../../src/ui/keys.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

const VOGT = 'core:cmd_commander';
const LAND1 = 'core:str_t1_fac_land';
const MEX = 'core:str_t1_mex';
const TANK = 'core:lnd_t1_tank';

function key(code: string, mods: Partial<Omit<KeyInput, 'code'>> = {}): KeyInput {
  return { code, alt: false, shift: false, ctrl: false, meta: false, ...mods };
}

function ctxFor(selected: readonly string[], extra: Partial<GridKeyContext> = {}): GridKeyContext {
  const spec: CardPageSpec = resolveCardPage(CAT, selected);
  return { page: spec.page, cells: spec.cells, scheme: 'grid', mode: 'idle', textFocus: false, modal: false, ...extra };
}

const card = (slot: string, shift = false, ctrl = false): GridKeyAction => ({
  kind: 'card',
  slot: slot as never,
  mods: { shift, ctrl, alt: false, button: 0 },
});
const order = (id: string, slot: string, alt: boolean, shift = false): GridKeyAction => ({
  kind: 'order',
  id: id as never,
  slot: slot as never,
  mods: { shift, ctrl: false, alt, button: 0 },
});
const pass = (reason: string): GridKeyAction => ({ kind: 'passthrough', reason: reason as never });

interface Case {
  readonly name: string;
  readonly input: KeyInput;
  readonly ctx: GridKeyContext;
  readonly expected: GridKeyAction;
}

const vogt = ctxFor([VOGT], { orders: BUILDER_ORDERS });
const factory = ctxFor([LAND1], { orders: FACTORY_ORDERS });
const army = ctxFor([TANK, 'core:lnd_t1_arty'], { orders: ARMY_ORDERS });
const mex = ctxFor([MEX], { orders: FACTORY_ORDERS });
const none = ctxFor([]);

/** Matrix from ui.md §7.2 (layers), §7.3 (modifiers), §5.8 (R4, R5) and UI-E1 (R3). */
const CASES: readonly Case[] = [
  // Layer 5: grid key → card page.
  { name: 'Vogt: Q places Zapfstelle (build page)', input: key('KeyQ'), ctx: vogt, expected: card('KeyQ') },
  { name: 'Vogt: W places Glutkessel', input: key('KeyW'), ctx: vogt, expected: card('KeyW') },
  { name: 'Vogt: KeyZ (labelled Y on DE) = Riegel slot', input: key('KeyZ'), ctx: vogt, expected: card('KeyZ') },
  { name: 'Vogt: KeyY (labelled Z on DE) is not a grid key', input: key('KeyY'), ctx: vogt, expected: pass('global') },
  { name: 'Vogt: Shift+W keeps placement (mods.shift)', input: key('KeyW', { shift: true }), ctx: vogt, expected: card('KeyW', true) },
  { name: 'Vogt: S = Luftwerk, not Stop (R5)', input: key('KeyS'), ctx: vogt, expected: card('KeyS') },
  { name: 'Vogt: F Schirm locked (needs T2 engineer)', input: key('KeyF'), ctx: vogt, expected: pass('locked') },
  { name: 'Vogt: V Tiegel locked', input: key('KeyV'), ctx: vogt, expected: pass('locked') },
  { name: 'Vogt: G empty cell falls through', input: key('KeyG'), ctx: vogt, expected: pass('emptyCell') },
  { name: 'Vogt: B empty on build page, never self-destruct', input: key('KeyB'), ctx: vogt, expected: pass('emptyCell') },
  { name: 'Factory: Q = +1 tank', input: key('KeyQ'), ctx: factory, expected: card('KeyQ') },
  { name: 'Factory: Shift+Q = +5 tanks', input: key('KeyQ', { shift: true }), ctx: factory, expected: card('KeyQ', true) },
  { name: 'Factory: B = Upgrade (never self-destruct, R4)', input: key('KeyB'), ctx: factory, expected: card('KeyB') },
  { name: 'Factory: D Schürze locked (needs Landwerk II)', input: key('KeyD'), ctx: factory, expected: pass('locked') },
  {
    name: 'Factory at unit cap: unit cells blocked',
    input: key('KeyQ'),
    ctx: { ...factory, capReached: true },
    expected: pass('capReached'),
  },
  { name: 'Factory at unit cap: B upgrade still works', input: key('KeyB'), ctx: { ...factory, capReached: true }, expected: card('KeyB') },
  { name: 'Structure (mex): B = Upgrade', input: key('KeyB'), ctx: mex, expected: card('KeyB') },
  { name: 'Structure (mex): D = Pause', input: key('KeyD'), ctx: mex, expected: card('KeyD') },
  { name: 'Structure (mex): Q empty falls through', input: key('KeyQ'), ctx: mex, expected: pass('emptyCell') },
  // Layer 5 on the orders page: orders without Alt.
  { name: 'Army: Q = Move', input: key('KeyQ'), ctx: army, expected: order('move', 'KeyQ', false) },
  { name: 'Army: S = Stop', input: key('KeyS'), ctx: army, expected: order('stop', 'KeyS', false) },
  { name: 'Army: KeyZ = attack ground', input: key('KeyZ'), ctx: army, expected: order('attackGround', 'KeyZ', false) },
  { name: 'Army: Shift+A keeps attack armed', input: key('KeyA', { shift: true }), ctx: army, expected: order('attack', 'KeyA', false, true) },
  { name: 'Army: B never self-destructs (R4)', input: key('KeyB'), ctx: army, expected: pass('noOrder') },
  { name: 'Army: V is free', input: key('KeyV'), ctx: army, expected: pass('noOrder') },
  { name: 'Army: R reclaim disabled for tanks', input: key('KeyR'), ctx: army, expected: pass('disabled') },
  // Layer 4: Alt + grid key → order grid.
  { name: 'Vogt: Alt+S = Stop for builders (R5)', input: key('KeyS', { alt: true }), ctx: vogt, expected: order('stop', 'KeyS', true) },
  { name: 'Vogt: Alt+R = Reclaim', input: key('KeyR', { alt: true }), ctx: vogt, expected: order('reclaim', 'KeyR', true) },
  { name: 'Factory: Alt+B never self-destructs (R4)', input: key('KeyB', { alt: true }), ctx: factory, expected: pass('noOrder') },
  { name: 'Factory: Alt+Q (move) disabled for factories', input: key('KeyQ', { alt: true }), ctx: factory, expected: pass('disabled') },
  { name: 'Army: Alt+Q = Move as well', input: key('KeyQ', { alt: true }), ctx: army, expected: order('move', 'KeyQ', true) },
  // Layer 6: global self-destruct.
  { name: 'Ctrl+Delete = self-destruct', input: key('Delete', { ctrl: true }), ctx: army, expected: { kind: 'selfDestruct' } },
  { name: '⌘+Delete = self-destruct (⌘ counts as Ctrl)', input: key('Delete', { meta: true }), ctx: vogt, expected: { kind: 'selfDestruct' } },
  {
    name: 'macOS: Ctrl+Backspace = self-destruct',
    input: key('Backspace', { ctrl: true }),
    ctx: { ...army, mac: true },
    expected: { kind: 'selfDestruct' },
  },
  { name: 'non-macOS: Ctrl+Backspace is no self-destruct', input: key('Backspace', { ctrl: true }), ctx: army, expected: pass('global') },
  { name: 'Delete without Ctrl is nothing', input: key('Delete'), ctx: army, expected: pass('global') },
  { name: 'Ctrl+Delete without selection', input: key('Delete', { ctrl: true }), ctx: none, expected: pass('noSelection') },
  // Layer 3: command modes.
  { name: 'Esc in placement cancels', input: key('Escape'), ctx: { ...vogt, mode: 'placement' }, expected: { kind: 'cancel' } },
  { name: 'Esc with armed order cancels', input: key('Escape'), ctx: { ...army, mode: 'orderArmed' }, expected: { kind: 'cancel' } },
  { name: 'Esc idle goes to the global layer', input: key('Escape'), ctx: vogt, expected: pass('global') },
  { name: 'placement: another grid key switches (hotbuild)', input: key('KeyQ'), ctx: { ...vogt, mode: 'placement' }, expected: card('KeyQ') },
  // Layers 1–2.
  { name: 'text field gets every key', input: key('KeyQ'), ctx: { ...vogt, textFocus: true }, expected: pass('textField') },
  { name: 'text field gets Esc too', input: key('Escape'), ctx: { ...vogt, textFocus: true, mode: 'placement' }, expected: pass('textField') },
  { name: 'modal owns the keyboard', input: key('KeyQ', { alt: true }), ctx: { ...army, modal: true }, expected: pass('modal') },
  // Layer 7: camera.
  { name: 'arrows always pan', input: key('ArrowLeft'), ctx: vogt, expected: { kind: 'camera', direction: 'left' } },
  { name: 'grid scheme: W never pans (R3)', input: key('KeyW'), ctx: army, expected: order('patrol', 'KeyW', false) },
  { name: 'grid scheme: empty selection, W does not pan either', input: key('KeyW'), ctx: none, expected: pass('noSelection') },
  { name: 'WASD scheme: W pans', input: key('KeyW'), ctx: { ...vogt, scheme: 'wasd' }, expected: { kind: 'camera', direction: 'up' } },
  { name: 'WASD scheme: D pans on the orders page too', input: key('KeyD'), ctx: { ...army, scheme: 'wasd' }, expected: { kind: 'camera', direction: 'right' } },
  { name: 'WASD scheme: Q still builds', input: key('KeyQ'), ctx: { ...vogt, scheme: 'wasd' }, expected: card('KeyQ') },
  { name: 'WASD scheme: Alt+W reaches the W cell', input: key('KeyW', { alt: true }), ctx: { ...vogt, scheme: 'wasd' }, expected: card('KeyW') },
  {
    name: 'WASD scheme: Alt+Shift+S = Stop on build pages',
    input: key('KeyS', { alt: true, shift: true }),
    ctx: { ...vogt, scheme: 'wasd' },
    expected: order('stop', 'KeyS', true, false),
  },
  // Modifiers / browser-safe.
  { name: 'Ctrl+A is select-all, not the grid', input: key('KeyA', { ctrl: true }), ctx: vogt, expected: pass('modifier') },
  { name: 'key repeat does not spam the grid', input: key('KeyQ', { repeat: true }), ctx: factory, expected: pass('repeat') },
  { name: 'keyup is never a grid action', input: key('KeyQ', { type: 'keyup' }), ctx: factory, expected: pass('keyup') },
];

describe('resolveGridKey (ui.md §7.2 layers, matrix)', () => {
  it('has at least 30 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(resolveGridKey(c.input, c.ctx)).toEqual(c.expected);
  });

  it('KeyZ is labelled Y on German and Z on English keyboards, the binding stays KeyZ', () => {
    expect(keyLabel('KeyZ', 'de')).toBe('Y');
    expect(keyLabel('KeyZ', 'en')).toBe('Z');
    expect(resolveGridKey(key('KeyZ'), vogt)).toEqual(card('KeyZ'));
  });

  it('B / Alt+B never resolve to self-destruct on any page', () => {
    for (const ctx of [vogt, factory, army, mex, none]) {
      for (const alt of [false, true]) {
        for (const shift of [false, true]) {
          const a = resolveGridKey(key('KeyB', { alt, shift }), ctx);
          expect(a.kind).not.toBe('selfDestruct');
          if (a.kind === 'order') expect(a.id).not.toBe('selfDestruct');
        }
      }
    }
  });

  it('Ctrl+grid key is never a card action (browser shortcuts)', () => {
    for (const code of ['KeyW', 'KeyT', 'KeyR', 'KeyA']) {
      expect(resolveGridKey(key(code, { ctrl: true }), vogt).kind).toBe('passthrough');
    }
  });
});

describe('shouldPreventDefault (ui.md §7.2 „Alt im Browser“)', () => {
  it('prevents every Alt + grid key keydown, even when it resolves to nothing', () => {
    const input = key('KeyB', { alt: true });
    expect(shouldPreventDefault(input, factory, resolveGridKey(input, factory))).toBe(true);
    const v = key('KeyV', { alt: true });
    expect(shouldPreventDefault(v, vogt, resolveGridKey(v, vogt))).toBe(true);
  });

  it('prevents the keyup of Alt (Firefox menu bar) but no other keyup', () => {
    expect(shouldPreventDefault(key('AltLeft', { type: 'keyup' }), vogt)).toBe(true);
    expect(shouldPreventDefault(key('AltRight', { type: 'keyup' }), vogt)).toBe(true);
    expect(shouldPreventDefault(key('KeyQ', { type: 'keyup' }), vogt)).toBe(false);
  });

  it('keeps defaults in text fields', () => {
    const input = key('KeyQ', { alt: true });
    expect(shouldPreventDefault(input, { textFocus: true })).toBe(false);
    expect(shouldPreventDefault(key('AltLeft', { type: 'keyup' }), { textFocus: true })).toBe(false);
  });

  it('prevents consumed keys and leaves passthrough keys alone', () => {
    const q = key('KeyQ');
    expect(shouldPreventDefault(q, vogt, resolveGridKey(q, vogt))).toBe(true);
    const f = key('KeyF');
    expect(shouldPreventDefault(f, vogt, resolveGridKey(f, vogt))).toBe(true); // locked cell swallows the key
    const g = key('KeyG');
    expect(shouldPreventDefault(g, vogt, resolveGridKey(g, vogt))).toBe(false); // empty cell falls through
    const ctrlA = key('KeyA', { ctrl: true });
    expect(shouldPreventDefault(ctrlA, vogt, resolveGridKey(ctrlA, vogt))).toBe(false);
  });
});

describe('helpers', () => {
  it('isSelfDestructKey: Ctrl/⌘ + Delete, Backspace only on macOS, never with Alt', () => {
    expect(isSelfDestructKey(key('Delete', { ctrl: true }), false)).toBe(true);
    expect(isSelfDestructKey(key('Backspace', { ctrl: true }), true)).toBe(true);
    expect(isSelfDestructKey(key('Backspace', { ctrl: true }), false)).toBe(false);
    expect(isSelfDestructKey(key('Delete', { ctrl: true, alt: true }), false)).toBe(false);
  });

  it('keyInputFromEvent maps a KeyboardEvent', () => {
    expect(
      keyInputFromEvent({ code: 'KeyQ', altKey: true, shiftKey: false, ctrlKey: false, metaKey: true, type: 'keyup', repeat: true }),
    ).toEqual({ code: 'KeyQ', alt: true, shift: false, ctrl: false, meta: true, type: 'keyup', repeat: true });
  });
});

describe('resolveStripKey (ui.md §5.9, §5.10, §7.2 global keys)', () => {
  const ctx = { textFocus: false, modal: false };
  it.each([
    ['F2 = all land', key('F2'), { kind: 'filter', filter: 'land', shift: false }],
    ['Shift+F3 filters the selection to air', key('F3', { shift: true }), { kind: 'filter', filter: 'air', shift: true }],
    ['F4 = factories', key('F4'), { kind: 'filter', filter: 'factories', shift: false }],
    ['F6 = engineers', key('F6'), { kind: 'filter', filter: 'engineers', shift: false }],
    ['F5 is the browser reload, not ours', key('F5'), { kind: 'none' }],
    ['. = next idle engineer', key('Period'), { kind: 'idleEngineer', all: false }],
    ['Shift+. = all idle engineers', key('Period', { shift: true }), { kind: 'idleEngineer', all: true }],
    [', = idle factory', key('Comma'), { kind: 'idleFactory' }],
    ['1 = recall group 1', key('Digit1'), { kind: 'recallGroup', index: 0, mods: { shift: false, ctrl: false, alt: false } }],
    ['Shift+0 = add group 10 to selection', key('Digit0', { shift: true }), { kind: 'recallGroup', index: 9, mods: { shift: true, ctrl: false, alt: false } }],
    ['Alt+2 = save group 2', key('Digit2', { alt: true }), { kind: 'saveGroup', index: 1, add: false }],
    ['Shift+Alt+3 = add to group 3', key('Digit3', { alt: true, shift: true }), { kind: 'saveGroup', index: 2, add: true }],
    ['Ctrl+1 stays with the browser', key('Digit1', { ctrl: true }), { kind: 'none' }],
  ] as const)('%s', (_n, input, expected) => {
    expect(resolveStripKey(input, ctx)).toEqual(expected);
  });

  it('text fields and modals own digits and function keys', () => {
    expect(resolveStripKey(key('Digit1'), { textFocus: true, modal: false })).toEqual({ kind: 'none' });
    expect(resolveStripKey(key('F2'), { textFocus: false, modal: true })).toEqual({ kind: 'none' });
  });

  it('Alt+digit is prevented (Linux tab switching), nothing else unresolved', () => {
    expect(stripShouldPreventDefault(resolveStripKey(key('Digit4', { alt: true }), ctx))).toBe(true);
    expect(stripShouldPreventDefault(resolveStripKey(key('KeyP'), ctx))).toBe(false);
  });
});
