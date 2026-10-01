import { describe, expect, test } from 'vitest';
import {
  COMMAND_NAMES,
  LEFT_CLICK,
  clickModsFromEvent,
  createNoopCommands,
  createRecordingCommands,
  modsFromEvent,
} from '../../src/commands/index.ts';

describe('commands', () => {
  test('names are unique and complete', () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
    expect(COMMAND_NAMES).toContain('toggleFlowDetails');
    expect(COMMAND_NAMES).toContain('quitToMenu');
    // Section owners may add commands; the p0 contract has 48.
    expect(COMMAND_NAMES.length).toBeGreaterThanOrEqual(48);
  });

  test('noop commands exist for every name', () => {
    const c = createNoopCommands() as unknown as Record<string, () => unknown>;
    for (const n of COMMAND_NAMES) expect(c[n]?.()).toBeUndefined();
  });

  test('recording commands log name and args, delegate, and clear', () => {
    let opened = 0;
    const rec = createRecordingCommands({ toggleFlowDetails: () => void opened++ });
    rec.commands.toggleFlowDetails();
    rec.commands.queueAdd('core:lnd_t1_tank', 5, false);
    rec.commands.cardActivate('KeyQ', { ...LEFT_CLICK, shift: true });
    rec.commands.setSetting('volMusic', 30);
    expect(opened).toBe(1);
    expect(rec.log).toEqual([
      { name: 'toggleFlowDetails', args: [] },
      { name: 'queueAdd', args: ['core:lnd_t1_tank', 5, false] },
      { name: 'cardActivate', args: ['KeyQ', { shift: true, ctrl: false, alt: false, button: 0 }] },
      { name: 'setSetting', args: ['volMusic', 30] },
    ]);
    rec.clear();
    expect(rec.log).toEqual([]);
  });

  test('modifiers from events (⌘ counts as Ctrl, non-primary = right)', () => {
    expect(modsFromEvent({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: true })).toEqual({ shift: true, ctrl: true, alt: false });
    expect(clickModsFromEvent({ shiftKey: false, ctrlKey: false, altKey: true, metaKey: false, button: 2 })).toEqual({
      shift: false,
      ctrl: false,
      alt: true,
      button: 2,
    });
    expect(clickModsFromEvent({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, button: 1 }).button).toBe(2);
  });
});
