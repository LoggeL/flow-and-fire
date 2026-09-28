/**
 * Debug switch of @faf/fixed. When on, arithmetic helpers verify their invariants
 * (fxMulSmall == fxMul, exact products, SafeInt integrality) and throw on violation.
 * Module-level configuration only — never simulation state.
 */
let debugOn = false;

/** Enables or disables the debug invariant checks. */
export function setFixedDebug(on: boolean): void {
  debugOn = on;
}

/** Whether the debug invariant checks are active. */
export function isFixedDebug(): boolean {
  return debugOn;
}
