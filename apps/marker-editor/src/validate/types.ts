/**
 * Validation types of the marker editor. Structurally identical to the shared editor contract
 * (src/model, src/overlay define the same shapes; this module must not import them).
 * All coordinates are Fx raw (Q20.12, 1 WU = 4096).
 */

import type { RtsMap } from '@faf/formats';

export type MarkerRef =
  | { readonly type: 'start'; readonly index: number }
  | { readonly type: 'spot'; readonly index: number }
  | { readonly type: 'field'; readonly index: number }
  | { readonly type: 'fieldVertex'; readonly index: number; readonly vertex: number }
  | { readonly type: 'fieldRadius'; readonly index: number };

export type SymmetryMode = 'none' | 'point' | 'mirrorX' | 'mirrorZ' | 'diagonal' | 'antiDiagonal';

export interface EditorIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  /** Fx raw, null = no location (map-wide issue). */
  readonly x: number | null;
  /** Fx raw, null = no location (map-wide issue). */
  readonly z: number | null;
  readonly refs: readonly MarkerRef[];
}

export type Validator = (map: RtsMap) => readonly EditorIssue[];

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
