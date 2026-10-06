/**
 * Team colour modes (ui.md §8.2): house colours (faction.md §4.3, freely chosen per house), own/enemy
 * (fixed) and the colour-blind safe palette (slot order, slot 2 = red since review R8). Hex values are the
 * source for the colour-vision simulation in the settings preview; components colour through CSS tokens.
 */

export type TeamColorMode = 'house' | 'relation' | 'cvd';
export const TEAM_COLOR_MODES: readonly TeamColorMode[] = ['house', 'relation', 'cvd'];

/** Relation of a house to the local player. */
export type TeamRelation = 'self' | 'ally' | 'enemy';

export interface PaletteColor {
  /** CSS custom property without the leading dashes, e.g. "team-blau". */
  readonly token: string;
  readonly hex: string;
}

/** House colours in lobby order (tokens.css --team-*). */
export const HOUSE_COLORS: readonly PaletteColor[] = [
  { token: 'team-rot', hex: '#c8372d' },
  { token: 'team-blau', hex: '#2f6fd0' },
  { token: 'team-gruen', hex: '#3e9a4a' },
  { token: 'team-violett', hex: '#7a4cc2' },
  { token: 'team-cyan', hex: '#27a6b5' },
  { token: 'team-orange', hex: '#e07a1f' },
  { token: 'team-pink', hex: '#d0569a' },
  { token: 'team-oliv', hex: '#8a8f2e' },
];

/** Colour-blind safe palette in slot order (tokens.css --cvd-*): blue, red, orange, sky, … */
export const CVD_COLORS: readonly PaletteColor[] = [
  { token: 'cvd-blau', hex: '#0072b2' },
  { token: 'cvd-rot', hex: '#d7263d' },
  { token: 'cvd-orange', hex: '#e69f00' },
  { token: 'cvd-himmel', hex: '#56b4e9' },
  { token: 'cvd-blaugruen', hex: '#009e73' },
  { token: 'cvd-rotviolett', hex: '#cc79a7' },
  { token: 'cvd-purpur', hex: '#aa3377' },
  { token: 'cvd-rosa', hex: '#ee6677' },
];

/** Own/enemy mode (ui.md §8.2); menus.css exposes them as --rel-self/--rel-ally/--rel-enemy. */
export const RELATION_COLORS: Readonly<Record<TeamRelation, PaletteColor>> = {
  self: { token: 'rel-self', hex: '#3d8bff' },
  ally: { token: 'rel-ally', hex: '#27b5a0' },
  enemy: { token: 'rel-enemy', hex: '#e8462f' },
};

export function isHouseColor(token: string): boolean {
  return HOUSE_COLORS.some((c) => c.token === token);
}

/** Hex of a house colour token (falls back to graphite for unknown tokens). */
export function houseColorHex(token: string): string {
  return HOUSE_COLORS.find((c) => c.token === token)?.hex ?? '#6b625a';
}

/**
 * CSS colour of a house for a mode: house → its chosen colour; relation → own/ally/enemy;
 * cvd → palette colour of its slot order (0 = first house).
 */
export function teamColorCss(mode: TeamColorMode, houseToken: string, order: number, relation: TeamRelation): string {
  if (mode === 'relation') return `var(--${RELATION_COLORS[relation].token})`;
  if (mode === 'cvd') return `var(--${(CVD_COLORS[order % CVD_COLORS.length] as PaletteColor).token})`;
  return `var(--${isHouseColor(houseToken) ? houseToken : 'team-self'})`;
}

/** The palette shown in the settings preview for a mode. */
export function paletteOf(mode: TeamColorMode): readonly PaletteColor[] {
  if (mode === 'cvd') return CVD_COLORS;
  if (mode === 'relation') return [RELATION_COLORS.self, RELATION_COLORS.ally, RELATION_COLORS.enemy];
  return HOUSE_COLORS;
}

// ---------- colour-vision simulation (Machado 2009, severity 1.0; same maths as tools/cvd-check.py) ----------

export type VisionKind = 'normal' | 'deutan' | 'protan' | 'tritan';
export const VISION_KINDS: readonly VisionKind[] = ['normal', 'deutan', 'protan', 'tritan'];

type Mat3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const MACHADO: Readonly<Record<Exclude<VisionKind, 'normal'>, Mat3>> = {
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Parses "#rrggbb" into 0..255 channels. */
export function parseHex(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`parseHex: '${hex}' is not #rrggbb`);
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Simulated colour as "rgb(r,g,b)" (normal vision returns the input hex). */
export function simulateVision(hex: string, kind: VisionKind): string {
  if (kind === 'normal') return hex.toLowerCase();
  const m = MACHADO[kind];
  const [r, g, b] = parseHex(hex).map((c) => toLinear(c / 255)) as unknown as [number, number, number];
  const out = m.map((row) => Math.round(toGamma(row[0] * r + row[1] * g + row[2] * b) * 255));
  return `rgb(${out.join(',')})`;
}
