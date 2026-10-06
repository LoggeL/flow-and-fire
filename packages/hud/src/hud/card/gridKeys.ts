/**
 * Keyboard layers of the command grid (ui.md §7.2, §7.3; UI-E1, R3, R4, R5). Pure functions: no DOM
 * listeners, no state. Keys bind by physical position (`KeyboardEvent.code`); the layout only changes
 * labels, so `KeyZ` is the bottom-left grid key on every layout (labelled „Y“ on German keyboards).
 *
 * Resolution order (first matching layer wins):
 *   1. text field focused → everything goes to the field
 *   2. modal / menu open → the modal handles keys (Esc closes it)
 *   3. command mode (placement, orderArmed): Esc cancels, Shift keeps the mode (click modifier)
 *   4. Alt + grid key → order grid (always, independent of the selection)
 *   5. grid key → page of the command card (build / production / structure / orders); empty cells fall through
 *   6. global keys outside the grid (here only Ctrl+Delete / macOS Ctrl+⌫ = self-destruct, R4)
 *   7. camera: arrows always; WASD only in the „WASD“ scheme (there before layer 5)
 */
import type { CardCellSpec } from '../../data/card-logic.ts';
import type { ClickMods } from '../../commands/mods.ts';
import type { CardPage } from '../../model/card.ts';
import { orderForKey, orderState } from '../../model/orders.ts';
import type { OrderId, OrderStates } from '../../model/orders.ts';
import { isSlotCode } from '../../ui/keys.ts';
import type { SlotCode } from '../../ui/keys.ts';

/** Key scheme (Settings → Tasten, UI-E1). */
export type KeyScheme = 'grid' | 'wasd';

/** Pointer/command mode of the cursor FSM (ui.md §7.1) as far as the keyboard cares. */
export type InputMode = 'idle' | 'placement' | 'orderArmed';

/** Event-like key input (from a KeyboardEvent or a test). */
export interface KeyInput {
  readonly code: string;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  /** Default keydown. */
  readonly type?: 'keydown' | 'keyup' | undefined;
  /** Auto-repeat of a held key. */
  readonly repeat?: boolean | undefined;
}

export interface GridKeyContext {
  readonly page: CardPage;
  /** 15 cells of the current page from resolveCardPage (SLOT_CODES order). */
  readonly cells: readonly CardCellSpec[];
  readonly scheme: KeyScheme;
  readonly mode: InputMode;
  /** A text field (console, seed, names) has focus. */
  readonly textFocus: boolean;
  /** A modal (Esc menu, settings in game) is open. */
  readonly modal: boolean;
  /** Unit cap reached: unit cells on build/production pages are disabled (U7). */
  readonly capReached?: boolean | undefined;
  /** Order states (disabled orders do not fire). */
  readonly orders?: OrderStates | undefined;
  /** macOS: Ctrl+⌫ is an additional self-destruct combination. */
  readonly mac?: boolean | undefined;
}

export type CameraDirection = 'up' | 'down' | 'left' | 'right';

/** Why a key is not handled by the grid layers (the game's global bindings may still take it). */
export type PassReason =
  | 'textField'
  | 'modal'
  | 'keyup'
  | 'repeat'
  | 'modifier'
  | 'noSelection'
  | 'emptyCell'
  | 'locked'
  | 'capReached'
  | 'disabled'
  | 'noOrder'
  | 'global';

export type GridKeyAction =
  | { readonly kind: 'card'; readonly slot: SlotCode; readonly mods: ClickMods }
  | { readonly kind: 'order'; readonly id: OrderId; readonly slot: SlotCode; readonly mods: ClickMods }
  | { readonly kind: 'selfDestruct' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'camera'; readonly direction: CameraDirection }
  | { readonly kind: 'passthrough'; readonly reason: PassReason };

const ARROWS: Readonly<Record<string, CameraDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** WASD camera keys of the „WASD“ scheme (physical positions). */
const WASD: Readonly<Record<string, CameraDirection>> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const pass = (reason: PassReason): GridKeyAction => ({ kind: 'passthrough', reason });

function keyMods(input: KeyInput, shift: boolean = input.shift): ClickMods {
  return { shift, ctrl: input.ctrl || input.meta, alt: input.alt, button: 0 };
}

/** True for Ctrl+Delete (and Ctrl+⌫ on macOS); ⌘ counts as Ctrl like everywhere in the HUD. */
export function isSelfDestructKey(input: KeyInput, mac: boolean): boolean {
  if (input.alt) return false;
  const ctrl = input.ctrl || input.meta;
  if (!ctrl) return false;
  return input.code === 'Delete' || (mac && input.code === 'Backspace');
}

function orderAction(slot: SlotCode, input: KeyInput, ctx: GridKeyContext, shift: boolean): GridKeyAction {
  // Self-destruct sits on the B place without a key (R4): B / Alt+B never trigger it; V is free.
  const def = orderForKey(slot);
  if (def === undefined) return pass('noOrder');
  if (ctx.orders !== undefined && !orderState(ctx.orders, def.id).enabled) return pass('disabled');
  return { kind: 'order', id: def.id, slot, mods: keyMods(input, shift) };
}

function cardAction(slot: SlotCode, input: KeyInput, ctx: GridKeyContext): GridKeyAction {
  if (ctx.page === 'orders') return orderAction(slot, input, ctx, input.shift);
  const cell = ctx.cells.find((c) => c.slot === slot);
  if (cell === undefined || cell.kind === 'empty') return pass('emptyCell');
  if (cell.locked !== null) return pass('locked');
  if (cell.kind === 'unit' && ctx.capReached === true && (ctx.page === 'build' || ctx.page === 'production')) {
    return pass('capReached');
  }
  if (cell.kind === 'pause' && ctx.orders !== undefined && !orderState(ctx.orders, 'pause').enabled) return pass('disabled');
  // Alt has no meaning on card cells (ui.md §7.3); in the WASD scheme it is only part of the chord.
  return { kind: 'card', slot, mods: { ...keyMods(input), alt: false } };
}

/**
 * Resolves one key event through the layers of ui.md §7.2. The caller dispatches the action
 * (cardActivate / activateOrder / cancelMode / camera) and calls shouldPreventDefault.
 */
export function resolveGridKey(input: KeyInput, ctx: GridKeyContext): GridKeyAction {
  // 1–2: text field and modal own the keyboard.
  if (ctx.textFocus) return pass('textField');
  if (ctx.modal) return pass('modal');
  if (input.type === 'keyup') return pass('keyup');

  const { code } = input;
  const ctrl = input.ctrl || input.meta;

  // 3: command mode – Esc cancels (outside a mode Esc belongs to the global layer: clear selection → menu).
  if (code === 'Escape') return ctx.mode !== 'idle' ? { kind: 'cancel' } : pass('global');

  // 6 (checked early because it is not a grid key): Ctrl+Delete / macOS Ctrl+⌫.
  if (isSelfDestructKey(input, ctx.mac === true)) {
    if (ctx.page === 'empty') return pass('noSelection');
    if (input.repeat === true) return pass('repeat');
    return { kind: 'selfDestruct' };
  }

  // 7a: arrows always pan.
  const arrow = ARROWS[code];
  if (arrow !== undefined) return ctrl || input.alt ? pass('modifier') : { kind: 'camera', direction: arrow };

  if (!isSlotCode(code)) return pass('global');
  // Ctrl/⌘ + letter is never a grid key (browser shortcuts, Strg+A = select all).
  if (ctrl) return pass('modifier');

  // 7b: WASD scheme – W/A/S/D pan before the grid (layer 7 before 5); with Alt they reach the grid.
  if (ctx.scheme === 'wasd' && !input.alt) {
    const dir = WASD[code];
    if (dir !== undefined) return { kind: 'camera', direction: dir };
  }

  if (input.repeat === true) return pass('repeat');
  if (ctx.page === 'empty') return pass('noSelection');

  // 4: Alt + grid key → order grid. WASD scheme: Alt + key is the card page (W/A/S/D places),
  // Alt+Shift + key the order grid (ui.md §7.2 „Schemata“); the Shift there is part of the chord.
  if (input.alt) {
    if (ctx.scheme === 'wasd' && ctx.page !== 'orders') {
      return input.shift ? orderAction(code, input, ctx, false) : cardAction(code, input, ctx);
    }
    return orderAction(code, input, ctx, input.shift);
  }

  // 5: grid key → page of the card.
  return cardAction(code, input, ctx);
}

const CONSUMED: ReadonlySet<PassReason> = new Set<PassReason>(['locked', 'capReached', 'disabled', 'repeat', 'noOrder']);

/**
 * Whether the handler must call preventDefault (ui.md §7.2 „Alt im Browser“): every Alt + grid key keydown
 * and the keyup of Alt itself while the game has focus (Firefox/Windows menu bar), plus every key the
 * grid layers consumed. Text fields keep their default behaviour.
 */
export function shouldPreventDefault(input: KeyInput, ctx: Pick<GridKeyContext, 'textFocus'>, action?: GridKeyAction): boolean {
  if (ctx.textFocus) return false;
  if (input.type === 'keyup') return input.code === 'AltLeft' || input.code === 'AltRight';
  if (input.alt && isSlotCode(input.code)) return true;
  if (action === undefined) return false;
  if (action.kind === 'passthrough') return CONSUMED.has(action.reason);
  return true;
}

/** Key input from a DOM KeyboardEvent. */
export function keyInputFromEvent(e: {
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly type: string;
  readonly repeat: boolean;
}): KeyInput {
  return {
    code: e.code,
    alt: e.altKey,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    type: e.type === 'keyup' ? 'keyup' : 'keydown',
    repeat: e.repeat,
  };
}

/** True if the event target is a text input (layer 1). */
export function isTextTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Partial<HTMLElement>).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
  }
  return el.isContentEditable === true;
}
