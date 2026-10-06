/**
 * Strategic icon sprite (content/icons, faction.md §6): one hidden <svg> with <symbol id="si-…"> per icon,
 * referenced by <svg><use href="#si-…"/></svg> (ui.md §9.2: no inline copy per node). Team colour stays a
 * CSS variable (`--team`) inside the symbols, so every <use> is recoloured by its own style.
 */
import { GHOST_ICON_IDS, ICON_IDS, ICON_SYMBOLS } from './icons.gen.ts';
import type { IconId } from './icons.gen.ts';
import type { UnitCatalog } from './catalog.ts';

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

/** Icon name of a unit type (catalog `icon`), or null for unknown types. */
export function iconOf(cat: UnitCatalog, typeId: string): IconId | null {
  const u = cat.find(typeId);
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
