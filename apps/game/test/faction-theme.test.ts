import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIRMISH_RULES, SKIRMISH_COLORS, type SkirmishConfig } from '@faf/hud';
import { TEAM_COLORS } from '@faf/modelkit/materials';
import { hudArmyTheme } from '../src/hud/faction-theme.ts';

function config(colors: readonly string[]): SkirmishConfig {
  return { mapId: 'hollow-ridge', rules: DEFAULT_SKIRMISH_RULES, slots: colors.map((color, army) => ({
    index: 10 - army, start: 1 - army, team: 0, name: `Army ${army}`, controller: army === 0 ? 'human' : 'ai',
    faction: 'varkan', color, ai: null,
  })) };
}
function renderedHex(theme: ReturnType<typeof hudArmyTheme>): string {
  return theme.style['--hud-house-color'];
}

describe('HUD accepted army accent', () => {
  it('uses the chosen house palette for every supported skirmish choice', () => {
    for (const color of SKIRMISH_COLORS) {
      const game = { client: { viewArmy: 0 }, skirmishConfig: config([color, 'cyan']) };
      const theme = hudArmyTheme(game);
      expect(theme.color).toBe(color);
      expect(renderedHex(theme).toUpperCase()).toBe(TEAM_COLORS.find(entry => entry.key === color)!.hex);
    }
  });

  it('uses command army array order, even when starts, teams and slot indices differ', () => {
    const game = { client: { viewArmy: 1 }, skirmishConfig: config(['orange', 'green']) };
    expect(hudArmyTheme(game).color).toBe('green');
    expect(renderedHex(hudArmyTheme(game))).toBe('#3e9a4a');
  });

  it('keeps actual chosen house accents in relation and color-vision display modes', () => {
    for (const teamColors of ['house', 'relation', 'cvd'] as const) {
      const cfg = config(['red', 'blue']);
      const game = { client: { viewArmy: 0 }, skirmishConfig: { ...cfg, rules: { ...cfg.rules, teamColors } } };
      expect(renderedHex(hudArmyTheme(game))).toBe('#c8372d');
    }
  });

  it('follows an accepted replay perspective using renderer fallback when a recording has no chosen color', () => {
    const game = { client: { viewArmy: 0 }, skirmishConfig: undefined };
    expect(hudArmyTheme(game)).toMatchObject({ army: 0, color: 'renderer' });
    game.client.viewArmy = 1;
    expect(renderedHex(hudArmyTheme(game))).toBe('#eb3329');
    game.client.viewArmy = -1;
    expect(hudArmyTheme(game)).toMatchObject({ army: -1, color: 'observer' });
    expect(renderedHex(hudArmyTheme(game))).toBe('#8b9ba7');
  });

  it('does not select a house for observers or unavailable identity, and invalid colors use the renderer fallback', () => {
    expect(hudArmyTheme(null).color).toBe('observer');
    expect(hudArmyTheme({ client: { viewArmy: NaN }, skirmishConfig: config(['orange']) }).color).toBe('observer');
    expect(hudArmyTheme({ client: { viewArmy: 0 }, skirmishConfig: config(['unknown']) }).color).toBe('renderer');
  });
});
