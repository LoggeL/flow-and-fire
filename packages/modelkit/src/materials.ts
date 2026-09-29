/**
 * Material slots → vertex color (COLOR_0, linear) + mask (_MASK, RGBA u8 normalized).
 *
 * Mask layout (same as the final-art RGBA mask of faction.md §4.1, so placeholders and final art share one shader
 * path): R = team color weight (the shader multiplies COLOR_0 by the team color), G = glow / emissive strength,
 * B = metallic, A = ambient occlusion / soot (1 = unoccluded; baked from the face normal: undersides darker).
 */

/** Generic slots of every faction. Factions name them (aliases) in their palette. */
export const MATERIAL_SLOTS = ['base', 'dark', 'metal', 'team', 'glow', 'glass', 'accent'] as const;
export type CoreSlot = (typeof MATERIAL_SLOTS)[number];
/**
 * Optional faction accent slots (defined only by palettes that need them): `accent2` = second accent material
 * (Skarn crust, Sael lustre, Aurith amber edge), `glow2` = second, weaker light (Skarn nerve seam, Sael jade seam,
 * Aurith glyph bands; default glow 0.6). Palettes without them build exactly as before.
 */
export const EXTRA_SLOTS = ['accent2', 'glow2'] as const;
export type ExtraSlot = (typeof EXTRA_SLOTS)[number];
export type MaterialSlot = CoreSlot | ExtraSlot;
/** Slot index = matId (0–6 core, 7–8 extra; tools only, not exported to glTF). */
export const SLOT_INDEX: Record<MaterialSlot, number> = { base: 0, dark: 1, metal: 2, team: 3, glow: 4, glass: 5, accent: 6, accent2: 7, glow2: 8 };
const ALL_SLOTS: readonly MaterialSlot[] = [...MATERIAL_SLOTS, ...EXTRA_SLOTS];

export interface SlotStyle {
  /** sRGB hex `#RRGGBB` (converted to linear for COLOR_0). Team slots should be light neutral (tinted in the shader). */
  readonly color: string;
  /** Team color weight 0–1. Default: 1 for `team`, else 0. */
  readonly team?: number;
  /** Emissive strength 0–1. Default: 1 for `glow`, else 0. */
  readonly glow?: number;
  /** Metallic 0–1. Default: 0.8 for `metal`, 0.2 for `glass`, else 0. */
  readonly metal?: number;
}

export interface Palette {
  /** Faction slug (`varkan`, …). */
  readonly faction: string;
  readonly slots: Readonly<Record<CoreSlot, SlotStyle>> & Readonly<Partial<Record<ExtraSlot, SlotStyle>>>;
  /** Faction words for slots, e.g. `{ copper: 'metal', ceramic: 'accent', body: 'base' }`. */
  readonly aliases?: Readonly<Record<string, MaterialSlot>>;
  /**
   * Team-color conflicts (faction.md §4.3 of every faction): for armies with one of `teams` the renderer swaps the
   * slot color to `color` (Varkan white glow for red/orange, Aurith smoke quartz for orange/olive, …). View only;
   * the GLB always carries the default color.
   */
  readonly teamAlt?: readonly TeamAlt[];
}

export interface TeamAlt {
  readonly slot: MaterialSlot;
  /** Team color keys (`TEAM_COLORS[].key`). */
  readonly teams: readonly string[];
  /** sRGB hex `#RRGGBB`. */
  readonly color: string;
}

/** Slots a palette defines: the 7 core slots plus the extra slots it declares (in matId order). */
export function paletteSlots(p: Palette): MaterialSlot[] {
  return ALL_SLOTS.filter((s) => p.slots[s] !== undefined);
}

/** Neutral fallback palette (used when a faction has no own palette yet). */
export const DEFAULT_PALETTE: Palette = {
  faction: 'default',
  slots: {
    base: { color: '#6B6E73' },
    dark: { color: '#2A2C30' },
    metal: { color: '#A7A9AC' },
    team: { color: '#FFFFFF' },
    glow: { color: '#FFD27A' },
    glass: { color: '#7FB6D9' },
    accent: { color: '#D8D2C4' },
  },
};

export function definePalette<P extends Palette>(p: P): P {
  for (const s of MATERIAL_SLOTS) {
    const style = p.slots[s];
    if (style === undefined) throw new Error(`palette ${p.faction}: slot ${s} missing`);
    parseHex(style.color);
  }
  for (const s of EXTRA_SLOTS) {
    const style = p.slots[s];
    if (style !== undefined) parseHex(style.color);
  }
  for (const k of Object.keys(p.slots)) {
    if (!(ALL_SLOTS as readonly string[]).includes(k)) throw new Error(`palette ${p.faction}: unknown slot ${k}`);
  }
  const defined = paletteSlots(p) as readonly string[];
  for (const [alias, slot] of Object.entries(p.aliases ?? {})) {
    if (!defined.includes(slot)) throw new Error(`palette ${p.faction}: alias ${alias} → unknown slot ${slot}`);
  }
  const teamKeys = TEAM_COLORS.map((t) => t.key) as readonly string[];
  for (const alt of p.teamAlt ?? []) {
    if (!defined.includes(alt.slot)) throw new Error(`palette ${p.faction}: teamAlt for undefined slot ${alt.slot}`);
    parseHex(alt.color);
    for (const t of alt.teams) if (!teamKeys.includes(t)) throw new Error(`palette ${p.faction}: teamAlt team ${t} unknown (${teamKeys.join(', ')})`);
  }
  return p;
}

export function resolveSlot(name: string, palette: Palette): MaterialSlot {
  if ((MATERIAL_SLOTS as readonly string[]).includes(name)) return name as MaterialSlot;
  if ((EXTRA_SLOTS as readonly string[]).includes(name)) {
    if (palette.slots[name as ExtraSlot] === undefined) throw new Error(`material slot "${name}" is not defined by palette ${palette.faction}`);
    return name as MaterialSlot;
  }
  const alias = palette.aliases?.[name];
  if (alias !== undefined) return alias;
  throw new Error(
    `unknown material "${name}" (slots: ${paletteSlots(palette).join(', ')}; aliases: ${Object.keys(palette.aliases ?? {}).join(', ') || '–'})`,
  );
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) throw new Error(`color must be #RRGGBB (got ${hex})`);
  const v = Number.parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export interface SlotResolved {
  readonly slot: MaterialSlot;
  readonly linear: readonly [number, number, number];
  /** team, glow, metal (0–255). */
  readonly mask: readonly [number, number, number];
}

/** Resolved styles of the slots the palette defines (extra slots it does not define are absent). */
export function resolvePalette(p: Palette): Record<MaterialSlot, SlotResolved> {
  const out = {} as Record<MaterialSlot, SlotResolved>;
  for (const s of paletteSlots(p)) {
    const style = p.slots[s]!;
    const rgb = parseHex(style.color);
    const team = style.team ?? (s === 'team' ? 1 : 0);
    const glow = style.glow ?? (s === 'glow' ? 1 : s === 'glow2' ? 0.6 : 0);
    const metal = style.metal ?? (s === 'metal' ? 0.8 : s === 'glass' ? 0.2 : 0);
    out[s] = {
      slot: s,
      linear: [round4(srgbToLinear(rgb[0])), round4(srgbToLinear(rgb[1])), round4(srgbToLinear(rgb[2]))],
      mask: [to255(team), to255(glow), to255(metal)],
    };
  }
  return out;
}

function to255(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Baked AO from the face normal: tops 1.0, vertical 0.85, undersides 0.6. */
export function aoFromNormalY(ny: number): number {
  return to255(0.6 + 0.4 * Math.min(1, Math.max(0, (ny + 1) / 2)) ** 0.8);
}

/** The 8 team colors of PLAN/faction.md §4.3 (sRGB hex), index = army color slot. */
export const TEAM_COLORS = [
  { key: 'red', de: 'Rot', hex: '#C8372D' },
  { key: 'blue', de: 'Blau', hex: '#2F6FD0' },
  { key: 'green', de: 'Grün', hex: '#3E9A4A' },
  { key: 'violet', de: 'Violett', hex: '#7A4CC2' },
  { key: 'cyan', de: 'Cyan', hex: '#27A6B5' },
  { key: 'orange', de: 'Orange', hex: '#E07A1F' },
  { key: 'pink', de: 'Pink', hex: '#D0569A' },
  { key: 'olive', de: 'Oliv', hex: '#8A8F2E' },
] as const;
