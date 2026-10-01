/**
 * Marker validation of the editor (TRACK-EDITOR P3): public API.
 *
 *   const validate = createValidator();
 *   store.setValidator(validate);   // called synchronously on every revision
 *
 * The validator caches the terrain analysis (slope, passability, components) by heightfield
 * identity — (heights object, heightScaleRaw, waterLevelRaw, sizeWu) — so moving markers only
 * re-runs the cheap marker rules; field expansions are cached per field object on top of it.
 */

import type { RtsMap } from '@faf/formats';
import { resolveValidationOptions, validateMap, type ValidationOptions } from './rules.ts';
import { createTerrainAnalysis, type TerrainAnalysis } from './terrain.ts';
import type { EditorIssue, Validator } from './types.ts';

export {
  DEFAULT_VALIDATION_OPTIONS,
  detectSymmetry,
  fieldExpansionStats,
  fieldPoints,
  fmtWu,
  mirrorPoint,
  resolveValidationOptions,
  SYMMETRY_MODES,
  validateMap,
  type FieldPoints,
  type ValidationOptions,
} from './rules.ts';
export {
  createTerrainAnalysis,
  DEFAULT_MAX_SLOPE_PERMILLE,
  heightfieldOf,
  MAX_SLOPE_PERMILLE_LIMIT,
  NO_COMPONENT,
  type TerrainAnalysis,
  type TerrainAnalysisOptions,
} from './terrain.ts';
export { ISSUE_CODES, type EditorIssue, type IssueCode, type MarkerRef, type SymmetryMode, type Validator } from './types.ts';

export interface ValidatorOptions extends Partial<ValidationOptions> {
  /** Land passability threshold in 1/1000 (default 600, PLAN §3.9). */
  readonly maxSlopePermille?: number;
}

/** A Validator with its cache state (for tests, benchmarks and the UI status line). */
export interface CachingValidator extends Validator {
  /** Number of terrain analyses built so far (1 per distinct heightfield in a row). */
  readonly analysisBuilds: () => number;
  /** The cached analysis (null before the first call). */
  readonly analysis: () => TerrainAnalysis | null;
}

/**
 * Creates a validator that keeps the terrain analysis of the last heightfield it saw. A map with
 * the same heights object, heightScaleRaw, waterLevelRaw and sizeWu reuses it; anything else
 * rebuilds it (the editor never mutates heights in place).
 */
export function createValidator(options: ValidatorOptions = {}): CachingValidator {
  const { maxSlopePermille, ...rest } = options;
  const ruleOptions = resolveValidationOptions(rest);
  const analysisOptions = maxSlopePermille === undefined ? {} : { maxSlopePermille };
  let cached: TerrainAnalysis | null = null;
  let builds = 0;
  const validate = (map: RtsMap): readonly EditorIssue[] => {
    const m = map.meta;
    if (cached === null || cached.heights !== map.heights || cached.heightScaleRaw !== m.heightScaleRaw || cached.waterLevelRaw !== m.waterLevelRaw || cached.sizeWu !== m.sizeWu) {
      cached = createTerrainAnalysis(map, analysisOptions);
      builds++;
    }
    return validateMap(map, cached, ruleOptions);
  };
  return Object.assign(validate, {
    analysisBuilds: (): number => builds,
    analysis: (): TerrainAnalysis | null => cached,
  });
}
