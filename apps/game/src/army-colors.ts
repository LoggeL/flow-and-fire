import type { SkirmishConfig } from '@faf/hud';
import { DEFAULT_ARMY_COLORS } from '@faf/render';

/** Canonical house colors from the model palette and HUD team tokens (sRGB). */
export const HOUSE_ARMY_COLORS: Readonly<Record<string, number>> = {
  red: 0xc8372d, blue: 0x2f6fd0, green: 0x3e9a4a, violet: 0x7a4cc2,
  cyan: 0x27a6b5, orange: 0xe07a1f, pink: 0xd0569a, olive: 0x8a8f2e,
};

export function chosenArmyColor(color: string): number | undefined {
  return Object.hasOwn(HOUSE_ARMY_COLORS, color) ? HOUSE_ARMY_COLORS[color] : undefined;
}

/** Slot array order is simulation army order, independently of slot.index, team or map start.
 * Recordings omit color choices, so sessions without an accepted config keep the legacy palette. */
export function armyColorsForSkirmish(config: SkirmishConfig | undefined): readonly number[] | undefined {
  return config?.slots.map((slot, army) => {
    const chosen = chosenArmyColor(slot.color);
    if (chosen !== undefined) return chosen;
    const rgb = DEFAULT_ARMY_COLORS[army % DEFAULT_ARMY_COLORS.length]!;
    return (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);
  });
}
