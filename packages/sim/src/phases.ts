/**
 * Sim tick phases in their binding order (PLAN §3.4). All 16 ids exist from MS1 on; MS3 runs
 * CommandApply, Orders, PathService, Movement, SpatialRebuild, Cleanup and Output. `HashTick` is a nested
 * measurement inside Output (the rule-hash computation, PLAN §3.12 L6 "Hash-Tick").
 */
export const PhaseId = {
  CommandApply: 1,
  Orders: 2,
  PathService: 3,
  Economy: 4,
  Construction: 5,
  Shields: 6,
  Movement: 7,
  SpatialRebuild: 8,
  Intel: 9,
  Targeting: 10,
  Weapons: 11,
  Projectiles: 12,
  Damage: 13,
  Death: 14,
  Cleanup: 15,
  Output: 16,
  HashTick: 17,
} as const;
export type PhaseId = (typeof PhaseId)[keyof typeof PhaseId];

/** Number of phase ids including HashTick (ids are 1-based; index 0 is unused). */
export const PHASE_ID_COUNT = 18;

/** Phase names indexed by id (index 0 = ''). */
export const PHASE_NAMES: readonly string[] = [
  '',
  'CommandApply',
  'Orders',
  'PathService',
  'Economy',
  'Construction',
  'Shields',
  'Movement',
  'SpatialRebuild',
  'Intel',
  'Targeting',
  'Weapons',
  'Projectiles',
  'Damage',
  'Death',
  'Cleanup',
  'Output',
  'HashTick',
];

/** Phases that run in MS3 (in execution order). */
export const ACTIVE_PHASES: readonly PhaseId[] = [
  PhaseId.CommandApply,
  PhaseId.Orders,
  PhaseId.PathService,
  PhaseId.Movement,
  PhaseId.SpatialRebuild,
  PhaseId.Cleanup,
  PhaseId.Output,
];

/**
 * Timing hook of the host. The sim only calls begin/end around each phase (and HashTick inside
 * Output on hash ticks); measuring wall-clock time is the host's job (sim-host, bench).
 */
export interface PhaseProbe {
  begin(phase: PhaseId): void;
  end(phase: PhaseId): void;
}
