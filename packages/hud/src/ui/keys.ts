import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/**
 * The 15-key command grid (ui.md §5.6, §7.2): bound by physical position (`KeyboardEvent.code`),
 * labelled by keyboard layout (UI-E6). On German keyboards the physical `KeyZ` shows "Y".
 */
export type SlotCode =
  | 'KeyQ'
  | 'KeyW'
  | 'KeyE'
  | 'KeyR'
  | 'KeyT'
  | 'KeyA'
  | 'KeyS'
  | 'KeyD'
  | 'KeyF'
  | 'KeyG'
  | 'KeyZ'
  | 'KeyX'
  | 'KeyC'
  | 'KeyV'
  | 'KeyB';

/** Grid rows top to bottom (QWERT / ASDFG / ZXCVB by physical position). */
export const GRID_ROWS: readonly (readonly SlotCode[])[] = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
];

/** All 15 slots in reading order (row-major). */
export const SLOT_CODES: readonly SlotCode[] = GRID_ROWS.flat();

export function isSlotCode(code: string): code is SlotCode {
  return (SLOT_CODES as readonly string[]).includes(code);
}

/** Row/column of a slot in the 5 × 3 grid. */
export function slotPosition(slot: SlotCode): { readonly row: number; readonly col: number } {
  const i = SLOT_CODES.indexOf(slot);
  return { row: Math.floor(i / 5), col: i % 5 };
}

/** Keyboard layouts with their own labels (ui.md §7.2: getLayoutMap or a table by navigator.language). */
export type KeyboardLayout = 'de' | 'en' | 'fr';

/** Letter keys whose label differs from the US QWERTY letter. */
const LETTER_REMAP: Readonly<Record<KeyboardLayout, Readonly<Record<string, string>>>> = {
  en: {},
  de: { KeyZ: 'Y', KeyY: 'Z' },
  fr: { KeyQ: 'A', KeyA: 'Q', KeyW: 'Z', KeyZ: 'W', KeyM: ',', Semicolon: 'M' },
};

/** Non-letter keys: short cap labels per layout (Strg/Entf/Pos1 on German keyboards). */
const SPECIAL: Readonly<Record<string, Readonly<Record<KeyboardLayout, string>>>> = {
  Escape: { de: 'Esc', en: 'Esc', fr: 'Échap' },
  Delete: { de: 'Entf', en: 'Del', fr: 'Suppr' },
  Backspace: { de: '⌫', en: '⌫', fr: '⌫' },
  Space: { de: '␣', en: '␣', fr: '␣' },
  Enter: { de: '↵', en: '↵', fr: '↵' },
  Tab: { de: 'Tab', en: 'Tab', fr: 'Tab' },
  ShiftLeft: { de: '⇧', en: '⇧', fr: '⇧' },
  ShiftRight: { de: '⇧', en: '⇧', fr: '⇧' },
  ControlLeft: { de: 'Strg', en: 'Ctrl', fr: 'Ctrl' },
  ControlRight: { de: 'Strg', en: 'Ctrl', fr: 'Ctrl' },
  AltLeft: { de: 'Alt', en: 'Alt', fr: 'Alt' },
  AltRight: { de: 'Alt Gr', en: 'Alt', fr: 'Alt Gr' },
  MetaLeft: { de: '⌘', en: '⌘', fr: '⌘' },
  Home: { de: 'Pos1', en: 'Home', fr: 'Début' },
  End: { de: 'Ende', en: 'End', fr: 'Fin' },
  Pause: { de: 'Pause', en: 'Pause', fr: 'Pause' },
  ArrowUp: { de: '↑', en: '↑', fr: '↑' },
  ArrowDown: { de: '↓', en: '↓', fr: '↓' },
  ArrowLeft: { de: '←', en: '←', fr: '←' },
  ArrowRight: { de: '→', en: '→', fr: '→' },
  Period: { de: '.', en: '.', fr: ';' },
  Comma: { de: ',', en: ',', fr: ';' },
  Minus: { de: 'ß', en: '-', fr: ')' },
  Equal: { de: '´', en: '=', fr: '=' },
  Backquote: { de: '^', en: '`', fr: '²' },
  NumpadAdd: { de: '+', en: '+', fr: '+' },
  NumpadSubtract: { de: '−', en: '−', fr: '−' },
  BracketRight: { de: '+', en: ']', fr: '$' },
  Slash: { de: '-', en: '/', fr: '!' },
};

/**
 * Label of a physical key for a layout, e.g. keyLabel('KeyZ', 'de') === 'Y'.
 * Unknown codes fall back to the code without its `Key`/`Digit` prefix.
 */
export function keyLabel(code: string, layout: KeyboardLayout): string {
  const remapped = LETTER_REMAP[layout][code];
  if (remapped !== undefined) return remapped;
  const special = SPECIAL[code];
  if (special) return special[layout];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  // Digits: AZERTY prints symbols on that row, but caps and the HUD show the digit (group keys).
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length === 7) return code.slice(6);
  return code;
}

/** Layout from a navigator language tag ("de-AT" → de, "fr-CA" → fr, else en). */
export function layoutFromLanguage(language: string | undefined): KeyboardLayout {
  const tag = (language ?? '').toLowerCase();
  if (tag.startsWith('de')) return 'de';
  if (tag.startsWith('fr')) return 'fr';
  return 'en';
}

/** Minimal shape of `navigator` used for layout detection (injectable for tests). */
export interface LayoutNavigator {
  readonly language?: string;
  readonly keyboard?: {
    getLayoutMap?: () => Promise<{ get(code: string): string | undefined }>;
  };
}

/**
 * Detects the keyboard layout (UI-E6): Keyboard API layout map where available (Chromium),
 * otherwise the language table. Never rejects.
 */
export async function detectLayout(nav?: LayoutNavigator): Promise<KeyboardLayout> {
  const n: LayoutNavigator | undefined = nav ?? (typeof navigator === 'undefined' ? undefined : (navigator as LayoutNavigator));
  if (!n) return 'en';
  const getMap = n.keyboard?.getLayoutMap;
  if (getMap) {
    try {
      const map = await getMap.call(n.keyboard);
      const z = map.get('KeyZ')?.toLowerCase();
      const q = map.get('KeyQ')?.toLowerCase();
      if (q === 'a') return 'fr';
      if (z === 'y') return 'de';
      if (z === 'z') return 'en';
    } catch {
      // Permission policy or insecure context: fall back to the language table.
    }
  }
  return layoutFromLanguage(n.language);
}

/** Shared default layout signal for code outside a HudModel (the model carries its own). */
export const keyboardLayout: Signal<KeyboardLayout> = signal<KeyboardLayout>('de');
