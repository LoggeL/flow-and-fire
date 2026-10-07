/**
 * Strategic icon sprite (content/icons, faction.md §6): one hidden <svg> with <symbol id="si-…"> per icon,
 * referenced by <svg><use href="#si-…"/></svg> (ui.md §9.2: no inline copy per node). Team colour stays a
 * CSS variable (`--team`) inside the symbols, so every <use> is recoloured by its own style.
 */
import { GHOST_ICON_IDS, ICON_IDS, ICON_SYMBOLS } from './icons.gen.ts';
import type { IconId } from './icons.gen.ts';
import { findUnit, normalizeTypeId } from './roster.ts';

export { GHOST_ICON_IDS, ICON_IDS };
export type { IconId };

/** Element id of the injected sprite. */
export const ICON_SPRITE_ID = 'ff-si-sprite';

/** Complete sprite markup (hidden, zero-size; not display:none so <use> keeps rendering in all engines). */
export const ICON_SPRITE: string =
  `<svg xmlns="http://www.w3.org/2000/svg" id="${ICON_SPRITE_ID}" aria-hidden="true" focusable="false" ` +
  `style="position:absolute;width:0;height:0;overflow:hidden">` +
  ICON_SYMBOLS.join('') +
  `</svg>`;

export type IconState = 'normal' | 'ghost';

export function isIconId(name: string): name is IconId {
  return (ICON_IDS as readonly string[]).includes(name);
}

export function hasGhostIcon(icon: string): boolean {
  return (GHOST_ICON_IDS as readonly string[]).includes(icon);
}

/** Icon-only aliases for live content absent from the design roster. Unit identity stays intact. */
const RUNTIME_ICONS: Readonly<Record<string, IconId>> = {
  'core:eng_t1': 'eng_build_t1',
  'core:fac_land_t1': 'struct_fac_land_t1',
  'core:fac_land_t2': 'struct_fac_land_t2',
  'core:fac_land_t3': 'struct_fac_land_t3',
  'core:str_t1_estorage': 'struct_estore_t1',
  'core:cmd_commander_engineering': 'cmd_commander',
  'core:cmd_commander_armored': 'cmd_commander',
  'core:cmd_commander_cannon': 'cmd_commander',
  'core:cmd_commander_cannon_protection': 'cmd_commander',
  'core:cmd_commander_engineering_cannon': 'cmd_commander',
  'core:cmd_commander_enhanced': 'cmd_commander',
  'core:cmd_commander_protection': 'cmd_commander',
  'core:lnd_t3_heavy': 'land_direct_t3',
  // The legacy unarmed cube has no roster silhouette; use the existing generic ground marker.
  'core:cube': 'blip_ground',
};

/** Roster or live-content glyph, or null for unknown types. Does not rewrite command/type ids. */
export function iconOf(typeId: string): IconId | null {
  const runtime = RUNTIME_ICONS[normalizeTypeId(typeId)];
  if (runtime !== undefined) return runtime;
  const u = findUnit(typeId);
  return u !== undefined && isIconId(u.icon) ? u.icon : null;
}

/**
 * Symbol id for an icon in a state. Ghosts exist only for structures (content/icons); other icons fall
 * back to the normal symbol and are dimmed via the `is-ghost` class.
 */
export function iconSymbolId(icon: string, state: IconState = 'normal'): string {
  return state === 'ghost' && hasGhostIcon(icon) ? `si-${icon}--ghost` : `si-${icon}`;
}

/** Class that masks a one-node element with the icon silhouette (icons-mask.gen.css). */
export function iconMaskClass(icon: string): string {
  return `si-mask-${icon}`;
}

/** Inserts the sprite once into `doc.body` (idempotent). Returns the sprite element. */
export function ensureIconSprite(doc: Document = document): Element {
  const existing = doc.getElementById(ICON_SPRITE_ID);
  if (existing !== null) return existing;
  doc.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);
  return doc.getElementById(ICON_SPRITE_ID)!;
}
