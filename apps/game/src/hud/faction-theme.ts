import { DEFAULT_ARMY_COLORS } from '@faf/render';
import type { SkirmishConfig } from '@faf/hud';
import { chosenArmyColor } from '../army-colors.ts';

export interface HudArmyTheme {
  readonly army: number;
  readonly color: string;
  readonly style: { readonly '--hud-house-color': string };
}

/** House chrome follows command identity in live games and the accepted frame perspective in replays.
 * Color-display accessibility modes never replace the player's chosen house accent. Recordings currently
 * omit house colors, so replay/legacy sessions use the same per-army fallback as the renderer. */
export function hudArmyTheme(game: { readonly client: { readonly viewArmy: number }; readonly skirmishConfig: SkirmishConfig | undefined } | null): HudArmyTheme {
  const army = game?.client.viewArmy ?? -1;
  if (!Number.isInteger(army) || army < 0) return { army: -1, color: 'observer', style: { '--hud-house-color': '#8b9ba7' } };
  // The accepted config's array order is army order; slot.index, team and start are separate identities.
  const color = game?.skirmishConfig?.slots[army]?.color;
  const chosen = color === undefined ? undefined : chosenArmyColor(color);
  if (chosen !== undefined) return { army, color: color!, style: { '--hud-house-color': `#${chosen.toString(16).padStart(6, '0')}` } };
  const rgb = DEFAULT_ARMY_COLORS[army % DEFAULT_ARMY_COLORS.length]!;
  const fallback = `#${rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
  return { army, color: 'renderer', style: { '--hud-house-color': fallback } };
}
