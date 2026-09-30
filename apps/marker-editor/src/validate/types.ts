/**
 * Validation types of the marker editor: the issue codes. The contract types (MarkerRef,
 * SymmetryMode, EditorIssue, Validator) are the editor model's (src/model/types.ts).
 */

export type { EditorIssue, MarkerRef, SymmetryMode, Validator } from '../model/types.ts';

/** Every issue code validateMap can emit (stable identifiers for UI, tests and E2E). */
export const ISSUE_CODES = [
  'start-count',
  'start-edge',
  'spot-edge',
  'start-in-water',
  'spot-in-water',
  'spot-not-flat',
  'start-not-flat',
  'spot-overlap',
  'spot-close',
  'spot-on-start',
  'start-close',
  'start-unreachable',
  'spot-unreachable',
  'field-invalid',
  'field-covers-spot',
  'field-empty',
  'prop-count',
  'asymmetric',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
