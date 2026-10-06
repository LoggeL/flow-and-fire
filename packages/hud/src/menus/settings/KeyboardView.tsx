/**
 * Keyboard view of the settings (ui.md §5.15, §7.2, review R13): grid keys (command card), camera keys
 * and system keys on a physical layout; caps labelled per keyboard layout (keyLabel, UI-E6: German keyboards
 * show "Y" on the physical KeyZ). Grid captions come from the roster (land factory · builder) and the order
 * table, so they never drift from the command card. In the WASD scheme W/A/S/D turn into camera keys.
 */
import type { JSX } from 'preact';
import type { UnitCatalog } from '../../data/catalog.ts';
import { mvpUnits } from '../../data/roster.ts';
import { rosterSlot } from '../../data/card-logic.ts';
import type { HotbuildMenu } from '../../data/types.ts';
import { orderShort } from '../../hud/card/labels.ts';
import { unitShort } from '../../hud/card/labels.ts';
import { locale as localeSignal } from '../../i18n/locale.ts';
import type { Locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useUnitCatalog } from '../../model/index.ts';
import { orderAtSlot } from '../../model/orders.ts';
import type { KeySchemeSetting } from '../../model/menus/settings.ts';
import { cx } from '../../ui/cx.ts';
import { isSlotCode, keyLabel } from '../../ui/keys.ts';
import type { KeyboardLayout, SlotCode } from '../../ui/keys.ts';

export type KeyKind = 'grid' | 'cam' | 'sys' | 'none';

export interface KeyCap {
  readonly code: string;
  readonly kind: KeyKind;
  /** Caption key (i18n) for non-grid keys. */
  readonly caption?: MsgKey;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly width?: 'w15' | 'w2' | 'w6';
}

const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

/** Physical rows (ISO-ish, left block + arrows). */
export const KEYBOARD_ROWS: readonly (readonly KeyCap[])[] = [
  [
    { code: 'Escape', kind: 'sys', caption: 'ui.settings.kb.abort' },
    { code: 'F1', kind: 'sys', caption: 'ui.settings.kb.console' },
    { code: 'F2', kind: 'sys', caption: 'ui.settings.kb.land' },
    { code: 'F3', kind: 'sys', caption: 'ui.settings.kb.air' },
    { code: 'F4', kind: 'sys', caption: 'ui.settings.kb.factories' },
    { code: 'F5', kind: 'none', caption: 'ui.settings.kb.browser' },
    { code: 'F6', kind: 'sys', caption: 'ui.settings.kb.engineers' },
  ],
  [
    { code: 'Backquote', kind: 'sys', caption: 'ui.settings.kb.console' },
    ...digits.map((code, i) => ({ code, kind: 'sys' as const, caption: 'ui.settings.kb.group' as const, params: { n: (i + 1) % 10 } })),
  ],
  [
    { code: 'Tab', kind: 'sys', caption: 'ui.settings.kb.switchType', width: 'w15' },
    ...(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'] as const).map((code) => ({ code, kind: 'grid' as const })),
    { code: 'KeyY', kind: 'none' },
    { code: 'KeyU', kind: 'none' },
    { code: 'KeyI', kind: 'none' },
    { code: 'KeyO', kind: 'none' },
    { code: 'KeyP', kind: 'sys', caption: 'ui.settings.kb.pause' },
  ],
  [
    { code: 'CapsLock', kind: 'none', width: 'w15' },
    ...(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'] as const).map((code) => ({ code, kind: 'grid' as const })),
    { code: 'KeyH', kind: 'sys', caption: 'ui.settings.kb.commander' },
    { code: 'KeyJ', kind: 'none' },
    { code: 'KeyK', kind: 'none' },
    { code: 'KeyL', kind: 'none' },
  ],
  [
    { code: 'ShiftLeft', kind: 'sys', caption: 'ui.settings.kb.queue', width: 'w2' },
    ...(['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'] as const).map((code) => ({ code, kind: 'grid' as const })),
    { code: 'KeyN', kind: 'sys', caption: 'ui.settings.kb.step' },
    { code: 'KeyM', kind: 'none' },
    { code: 'Comma', kind: 'sys', caption: 'ui.settings.kb.idleFac' },
    { code: 'Period', kind: 'sys', caption: 'ui.settings.kb.idleEng' },
  ],
  [
    { code: 'ControlLeft', kind: 'sys', caption: 'ui.settings.kb.ctrl', width: 'w15' },
    { code: 'AltLeft', kind: 'sys', caption: 'ui.settings.kb.alt', width: 'w15' },
    { code: 'Space', kind: 'sys', caption: 'ui.settings.kb.space', width: 'w6' },
    { code: 'ArrowLeft', kind: 'cam', caption: 'ui.settings.kb.camera' },
    { code: 'ArrowUp', kind: 'cam' },
    { code: 'ArrowDown', kind: 'cam' },
    { code: 'ArrowRight', kind: 'cam' },
    { code: 'Delete', kind: 'sys', caption: 'ui.settings.kb.selfDestruct' },
  ],
];

const WASD: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

/** Kind of a key in a scheme (WASD turns W/A/S/D into camera keys, ui.md §7.2). */
export function keyKind(cap: KeyCap, scheme: KeySchemeSetting): KeyKind {
  return scheme === 'wasd' && WASD.includes(cap.code) ? 'cam' : cap.kind;
}

function lowestTier(cat: UnitCatalog, menu: HotbuildMenu, slot: SlotCode): string | null {
  const letter = rosterSlot(slot);
  let best: { id: string; tech: number } | null = null;
  for (const u of mvpUnits(cat)) {
    if (u.hotbuild?.menu !== menu || u.hotbuild.slot !== letter) continue;
    if (!best || u.tech < best.tech) best = { id: u.id, tech: u.tech };
  }
  return best?.id ?? null;
}

/**
 * Captions of a grid key: land factory unit, builder building (both lowest tier, from the roster) and the
 * order of that place (italic). B carries the uniform "Upgrade" (review R4: self-destruct has no grid key).
 */
export function gridCaptions(
  cat: UnitCatalog,
  slot: SlotCode,
  loc: Locale = localeSignal.value,
): { readonly units: readonly string[]; readonly order: string | null } {
  const units = [lowestTier(cat, 'Landwerk', slot), lowestTier(cat, 'Bau', slot)].flatMap((id) => (id ? [unitShort(cat, id, loc)] : []));
  const def = orderAtSlot(slot);
  const order = def && def.key !== null ? orderShort(def.id, loc) : slot === 'KeyB' ? t('ui.settings.kb.upgrade', undefined, loc) : null;
  return { units, order };
}

/** Cap label: layout-specific (Strg/Entf/Pos1, Y on KeyZ for DE) plus a few glyphs. */
export function capLabel(code: string, layout: KeyboardLayout): string {
  if (code === 'CapsLock') return '⇪';
  if (code === 'Space') return t('ui.settings.kb.spaceKey');
  return keyLabel(code, layout);
}

export interface KeyboardViewProps {
  readonly layout: KeyboardLayout;
  readonly scheme: KeySchemeSetting;
}

export function KeyboardView({ layout, scheme }: KeyboardViewProps): JSX.Element {
  const catalog = useUnitCatalog();
  return (
    <div class="kbd" role="img" aria-label={t('ui.settings.keyboard')} data-component="KeyboardView" data-testid="keyboard-view" data-layout={layout} data-scheme={scheme}>
      {KEYBOARD_ROWS.map((row, i) => (
        <div key={i} class={cx('kbd__row', i === 3 && 'kbd__row--indent')}>
          {row.map((cap) => {
            const kind = keyKind(cap, scheme);
            const slot = isSlotCode(cap.code) ? cap.code : null;
            let body: JSX.Element | string | null = null;
            if (kind === 'cam' && WASD.includes(cap.code)) {
              body = t('ui.settings.kb.pan');
            } else if (kind === 'grid' && slot) {
              const c = gridCaptions(catalog, slot);
              body = (
                <>
                  {c.units.map((u, j) => [j > 0 ? <br key={`b${j}`} /> : null, u])}
                  {c.order !== null ? (
                    <>
                      {c.units.length > 0 ? <br /> : null}
                      <i>{c.order}</i>
                    </>
                  ) : null}
                </>
              );
            } else if (cap.caption) {
              body = t(cap.caption, cap.params);
            }
            return (
              <div
                key={cap.code}
                class={cx('kk', kind !== 'none' && `is-${kind}`, cap.width && `kk--${cap.width}`)}
                data-code={cap.code}
                data-kind={kind}
              >
                <b>{capLabel(cap.code, layout)}</b>
                <span>{body}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
