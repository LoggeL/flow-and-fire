// @vitest-environment happy-dom
/**
 * Gallery coverage contract (ui.md §6 via src/required-states.ts):
 *  - every component that has at least one story covers ALL of its target states;
 *  - FAF_HUD_REQUIRE_ALL=1 (hud-p7-final): every component in the matrix has stories and every story's
 *    component is part of the matrix.
 */
import { describe, expect, it } from 'vitest';
import { REGISTRY_ERRORS, STORIES } from '../src/registry.ts';
import { REQUIRED_STATES, computeCoverage, coverageProblems } from '../src/required-states.ts';

const requireAll = process.env['FAF_HUD_REQUIRE_ALL'] !== '0';

describe('gallery coverage', () => {
  it('the registry loads every stories file without errors', () => {
    expect(REGISTRY_ERRORS).toEqual([]);
    expect(STORIES.length).toBeGreaterThan(0);
  });

  it(`stories cover the required states${requireAll ? ' (FAF_HUD_REQUIRE_ALL=1: all components)' : ''}`, () => {
    const problems = coverageProblems(
      STORIES.map((s) => s.meta),
      requireAll,
    );
    expect(problems).toEqual([]);
  });

  it('the matrix itself is well-formed', () => {
    const names = REQUIRED_STATES.map((c) => c.component);
    expect(new Set(names).size).toBe(names.length);
    for (const c of REQUIRED_STATES) {
      expect(c.states.length, c.component).toBeGreaterThan(0);
      expect(new Set(c.states).size, c.component).toBe(c.states.length);
    }
    // The components named by the TRACK-HUD task (docs/plans/TRACK-HUD.json, hud-p1 B2) are all present.
    for (const n of [
      'Button', 'Tab', 'Segmented', 'Switch', 'Check', 'Range', 'Select', 'Input', 'Bar', 'Badge', 'Key', 'Vet',
      'ResourceMeter', 'FlowDetails', 'MatchStatus', 'PauseBanner', 'Minimap', 'SelectionPanel', 'OrderQueue',
      'CommandCard', 'CardCell', 'FactoryQueue', 'OrderBar', 'OrderButton', 'SelectionFilter', 'IdleButton',
      'ControlGroups', 'Alert', 'Tooltip', 'MainMenu', 'SkirmishSetup', 'Settings', 'LoadingScreen', 'ScoreScreen',
      'GameMenu', 'Hud',
    ]) {
      expect(names, n).toContain(n);
    }
    const byName = (n: string): readonly string[] => REQUIRED_STATES.find((c) => c.component === n)!.states;
    expect(byName('PauseBanner')).toContain('Context-Loss');
    expect(byName('LoadingScreen')).toContain('Fehler');
    expect(byName('Settings')).toEqual(expect.arrayContaining(['Grafik', 'Audio', 'Tasten', 'Barrierefreiheit', 'Spiel & Sprache']));
    expect(byName('ScoreScreen')).toEqual(expect.arrayContaining(['Übersicht', 'Wirtschaft', 'Armee', 'Einheiten']));
    expect(byName('Hud')).toEqual(['vogt', 'armee', 'fabrik-stall', 'pause-cvd', 'dichtester Fall', '1440', '1440-kompakt', '720']);
  });

  it('coverage logic: partial components fail, untouched ones only with requireAll', () => {
    const stories = [
      { component: 'OrderBar', state: 'sichtbar' },
      { component: 'MatchStatus', state: 'normal' },
      { component: 'MatchStatus', state: 'Tempo ≠ 1' },
      { component: 'MatchStatus', state: 'Cap nah' },
      { component: 'MatchStatus', state: 'Cap erreicht' },
      { component: 'MatchStatus', state: 'Extra-Variante' },
      { component: 'Unbekannt', state: 'x' },
    ];
    const lax = coverageProblems(stories, false);
    expect(lax).toEqual(['OrderBar (card.stories.tsx): missing states „ausgeblendet“']);
    const strict = coverageProblems(stories, true);
    expect(strict).toContain('Unbekannt: not in required-states.ts (stories: 1)');
    expect(strict).toContain('Button (primitives.stories.tsx): no stories');
    const ms = computeCoverage(stories).find((c) => c.component === 'MatchStatus')!;
    expect(ms.missing).toEqual([]);
    expect(ms.extra).toEqual(['Extra-Variante']);
  });
});
