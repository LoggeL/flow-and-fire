/**
 * Shared prop definitions of the .rtsmap format, used by rtsmap.ts (PROP chunk) and propfields.ts
 * (PFLD chunk). A separate module so that propfields.ts does not depend on rtsmap.ts (rtsmap.ts
 * depends on propfields.ts; no dependency cycles, see .dependency-cruiser.cjs). rtsmap.ts
 * re-exports everything public from here, so the package API is unchanged.
 *
 * Determinism contract (PLAN §3.12): integers only — this module runs in the sim worker.
 */

export const MAP_MAX_PROPS = 65536;
export const MAP_MAX_PROP_ID_BYTES = 128;

/** Namespace blueprint id of a prop, e.g. 'core:rock_01'. */
export const PROP_ID_RE = /^[a-z0-9_]+:[a-z0-9_./-]+$/;

export interface MapProp {
  /** Namespace blueprint id, e.g. 'core:rock_01'. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Ang16. */
  readonly yaw: number;
  /** Uniform scale in 1/1000 (1..65535). */
  readonly scalePermille: number;
}
