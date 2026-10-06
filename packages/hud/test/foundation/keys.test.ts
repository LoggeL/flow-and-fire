import { describe, expect, test } from 'vitest';
import { GRID_ROWS, SLOT_CODES, detectLayout, isSlotCode, keyLabel, layoutFromLanguage, slotPosition } from '../../src/ui/keys.ts';

describe('grid', () => {
  test('15 slots QWERT / ASDFG / ZXCVB by physical position', () => {
    expect(GRID_ROWS).toEqual([
      ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
      ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
      ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
    ]);
    expect(SLOT_CODES).toHaveLength(15);
    expect(new Set(SLOT_CODES).size).toBe(15);
    expect(slotPosition('KeyZ')).toEqual({ row: 2, col: 0 });
    expect(slotPosition('KeyG')).toEqual({ row: 1, col: 4 });
    expect(isSlotCode('KeyB')).toBe(true);
    expect(isSlotCode('KeyY')).toBe(false);
  });
});

describe('keyLabel (UI-E6)', () => {
  test('German layout swaps Y and Z', () => {
    expect(GRID_ROWS[2]?.map((c) => keyLabel(c, 'de'))).toEqual(['Y', 'X', 'C', 'V', 'B']);
    expect(keyLabel('KeyY', 'de')).toBe('Z');
    expect(GRID_ROWS[2]?.map((c) => keyLabel(c, 'en'))).toEqual(['Z', 'X', 'C', 'V', 'B']);
  });

  test('French AZERTY', () => {
    expect(GRID_ROWS[0]?.map((c) => keyLabel(c, 'fr'))).toEqual(['A', 'Z', 'E', 'R', 'T']);
    expect(GRID_ROWS[1]?.map((c) => keyLabel(c, 'fr'))).toEqual(['Q', 'S', 'D', 'F', 'G']);
    expect(keyLabel('KeyZ', 'fr')).toBe('W');
  });

  test('special keys and digits', () => {
    expect(keyLabel('Delete', 'de')).toBe('Entf');
    expect(keyLabel('Delete', 'en')).toBe('Del');
    expect(keyLabel('ControlLeft', 'de')).toBe('Strg');
    expect(keyLabel('Home', 'de')).toBe('Pos1');
    expect(keyLabel('Digit1', 'fr')).toBe('1');
    expect(keyLabel('F2', 'de')).toBe('F2');
    expect(keyLabel('Period', 'de')).toBe('.');
    expect(keyLabel('Numpad7', 'en')).toBe('7');
  });
});

describe('detectLayout', () => {
  const mapOf = (entries: Record<string, string>) => ({ get: (c: string) => entries[c] });

  test('uses the keyboard layout map when available', async () => {
    const de = { language: 'en-US', keyboard: { getLayoutMap: async () => mapOf({ KeyZ: 'y', KeyQ: 'q' }) } };
    expect(await detectLayout(de)).toBe('de');
    const fr = { language: 'de', keyboard: { getLayoutMap: async () => mapOf({ KeyZ: 'w', KeyQ: 'a' }) } };
    expect(await detectLayout(fr)).toBe('fr');
    const us = { language: 'de', keyboard: { getLayoutMap: async () => mapOf({ KeyZ: 'z', KeyQ: 'q' }) } };
    expect(await detectLayout(us)).toBe('en');
  });

  test('falls back to navigator.language', async () => {
    expect(await detectLayout({ language: 'de-AT' })).toBe('de');
    expect(await detectLayout({ language: 'fr-CA' })).toBe('fr');
    expect(await detectLayout({ language: 'pt-BR' })).toBe('en');
    const failing = { language: 'de-DE', keyboard: { getLayoutMap: () => Promise.reject(new Error('denied')) } };
    expect(await detectLayout(failing)).toBe('de');
    expect(layoutFromLanguage(undefined)).toBe('en');
  });
});
