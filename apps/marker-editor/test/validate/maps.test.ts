import type { RtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { createValidator, type EditorIssue } from '../../src/validate/index.ts';
import { errors, loadMap, MAP_NAMES, withCode, withMarkers, wu } from './helpers.ts';

const summary = (issues: readonly EditorIssue[]): string[] =>
  issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity}:${i.code}:${i.refs.map((r) => `${r.type}${r.index}`).join(',')}`);

/**
 * Gate of the shipped maps (calibration, docs/status/track-editor-p3.md): no errors; the warnings
 * are listed exactly — a new warning means the rules or the maps changed and must be reviewed.
 */
const EXPECTED: Record<(typeof MAP_NAMES)[number], { warnings: string[]; symmetry: string }> = {
  // Two mass spots on gently sloped plateaus: 0.28 WU height change within 3 WU (> 0.1 WU).
  'hollow-ridge': { warnings: ['warning:spot-not-flat:spot6', 'warning:spot-not-flat:spot14'], symmetry: 'point' },
  tessera: { warnings: [], symmetry: 'point, diagonal, antiDiagonal' },
  braidwater: { warnings: [], symmetry: 'mirrorZ' },
  // The two islands (5 mass spots each, point-symmetric): air/naval expansions by design.
  setons: {
    warnings: [49, 50, 51, 52, 53, 103, 104, 105, 106, 107].map((i) => `warning:spot-unreachable:spot${i}`),
    symmetry: 'point',
  },
};

describe('shipped maps', () => {
  const validate = createValidator();
  const maps = new Map<string, RtsMap>(MAP_NAMES.map((n) => [n, loadMap(n)]));

  it.each(MAP_NAMES)('%s: 0 errors, the gated warning list and the detected symmetry', (name) => {
    const map = maps.get(name)!;
    const issues = validate(map);
    expect(errors(issues)).toEqual([]);
    expect(summary(issues)).toEqual(EXPECTED[name].warnings);
    const info = withCode(issues, 'asymmetric');
    expect(info).toHaveLength(1);
    expect(info[0]!.message).toContain(`(Symmetrie: ${EXPECTED[name].symmetry})`);
  });

  it('setons: moving markers produces the expected errors on the real terrain', () => {
    const setons = maps.get('setons')!;
    const { starts, spots } = setons.meta;
    const edited = withMarkers(setons, {
      // Spot 0 into the open sea at the map centre line far from land, spot 1 onto spot 2.
      spots: [{ ...spots[0]!, x: wu(512), z: wu(40) }, { ...spots[1]!, x: spots[2]!.x + wu(1), z: spots[2]!.z }, ...spots.slice(2)],
      // Start 1 right next to start 0.
      starts: [starts[0]!, { ...starts[1]!, x: starts[0]!.x + wu(30), z: starts[0]!.z }, ...starts.slice(2)],
    });
    const issues = validate(edited);
    expect(withCode(issues, 'spot-in-water').map((i) => i.refs[0])).toEqual([{ type: 'spot', index: 0 }]);
    expect(withCode(issues, 'spot-overlap').map((i) => i.refs)).toEqual([
      [
        { type: 'spot', index: 1 },
        { type: 'spot', index: 2 },
      ],
    ]);
    expect(withCode(issues, 'start-close').some((i) => i.severity === 'error')).toBe(true);
    // Same heights object: the analysis was reused.
    expect(validate.analysisBuilds()).toBe(4);
  });
});
