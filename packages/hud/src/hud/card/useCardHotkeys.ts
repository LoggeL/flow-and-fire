/**
 * Optional keyboard binding of the grid and strip keys to HudCommands (gallery, prototypes). The game
 * binds its own input layer later (MS4/MS6) with the same pure resolvers.
 */
import { useEffect } from 'preact/hooks';
import type { HudCommands } from '../../commands/index.ts';
import { LEFT_CLICK } from '../../commands/mods.ts';
import { useCommands, useHud } from '../../model/index.ts';
import type { HudModel } from '../../model/index.ts';
import { armedOrder } from '../../model/orders.ts';
import { resolveStripKey, stripShouldPreventDefault } from '../strip/stripKeys.ts';
import type { StripKeyAction } from '../strip/stripKeys.ts';
import { isTextTarget, keyInputFromEvent, resolveGridKey, shouldPreventDefault } from './gridKeys.ts';
import type { GridKeyAction, GridKeyContext, InputMode, KeyInput } from './gridKeys.ts';
import { isMacPlatform } from './labels.ts';
import { cardSpec } from './spec.ts';

export interface CardHotkeysOptions {
  /** macOS (Ctrl+⌫ self-destruct); default: detected. */
  readonly mac?: boolean | undefined;
  /** Also resolve strip keys (filters, idle, groups); default true. */
  readonly strip?: boolean | undefined;
}

/** Keyboard context from the model at the time of the key press (no subscriptions). */
export function gridKeyContext(model: HudModel, textFocus: boolean, mac: boolean): GridKeyContext {
  const spec = cardSpec(model).peek();
  const states = model.orders.states.peek();
  const mode: InputMode = model.card.armedSlot.peek() !== null ? 'placement' : armedOrder(states) !== null ? 'orderArmed' : 'idle';
  return {
    page: spec.page,
    cells: spec.cells,
    scheme: model.menus.settings.values.peek().keyScheme,
    mode,
    textFocus,
    modal: model.menus.gameMenu.open.peek(),
    capReached: model.card.capReached.peek(),
    orders: states,
    mac,
  };
}

/** Calls the command for a resolved grid action (camera and passthrough stay with the game). */
export function dispatchGridAction(action: GridKeyAction, commands: HudCommands): void {
  switch (action.kind) {
    case 'card':
      commands.cardActivate(action.slot, action.mods);
      return;
    case 'order':
      commands.activateOrder(action.id, action.mods);
      return;
    case 'selfDestruct':
      commands.activateOrder('selfDestruct', { ...LEFT_CLICK, ctrl: true });
      return;
    case 'cancel':
      commands.cancelMode();
      return;
    case 'camera':
    case 'passthrough':
      return;
  }
}

/** Calls the command for a resolved strip action. */
export function dispatchStripAction(action: StripKeyAction, commands: HudCommands): void {
  switch (action.kind) {
    case 'filter':
      commands.filter(action.filter, action.shift);
      return;
    case 'idleEngineer':
      commands.selectIdleEngineer(action.all);
      return;
    case 'idleFactory':
      commands.selectIdleFactory();
      return;
    case 'recallGroup':
      commands.recallGroup(action.index, action.mods);
      return;
    case 'saveGroup':
      commands.saveGroup(action.index, action.add);
      return;
    case 'none':
      return;
  }
}

/**
 * Handles one key event against model and commands; returns the grid action (tests, logging).
 * Calls preventDefault where ui.md §7.2 requires it (Alt + grid key, Alt keyup, consumed keys).
 */
export function handleHotkey(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'type' | 'repeat' | 'target' | 'preventDefault'>,
  model: HudModel,
  commands: HudCommands,
  opts: { readonly mac: boolean; readonly strip: boolean },
): GridKeyAction {
  const input: KeyInput = keyInputFromEvent(e);
  const ctx = gridKeyContext(model, isTextTarget(e.target), opts.mac);
  const action = resolveGridKey(input, ctx);
  let prevent = shouldPreventDefault(input, ctx, action);
  if (action.kind === 'passthrough' && opts.strip) {
    const strip = resolveStripKey(input, ctx);
    dispatchStripAction(strip, commands);
    prevent = prevent || stripShouldPreventDefault(strip);
  } else {
    dispatchGridAction(action, commands);
  }
  if (prevent) e.preventDefault();
  return action;
}

/**
 * Binds keydown/keyup on `target` (default: window) to the grid and strip resolvers while mounted.
 * Needs a HudProvider above.
 */
export function useCardHotkeys(target?: EventTarget | null, options: CardHotkeysOptions = {}): void {
  const model = useHud();
  const commands = useCommands();
  const mac = options.mac ?? isMacPlatform();
  const strip = options.strip ?? true;
  useEffect(() => {
    const t = target === undefined ? (typeof window === 'undefined' ? null : window) : target;
    if (t === null) return undefined;
    const onKey = (e: Event): void => {
      handleHotkey(e as KeyboardEvent, model, commands, { mac, strip });
    };
    t.addEventListener('keydown', onKey);
    t.addEventListener('keyup', onKey);
    return () => {
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('keyup', onKey);
    };
  }, [target, model, commands, mac, strip]);
}
