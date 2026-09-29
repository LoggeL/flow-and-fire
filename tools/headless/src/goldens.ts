/**
 * L2 golden format and hash-chain comparison (environment-neutral; file IO lives in scripts/tests).
 */
import type { ScenarioResult } from './scenario.ts';

export const GOLDEN_FORMAT = 'faf-golden';
/** v2: + simBuild (the SIM_BUILD the chain was recorded with). */
export const GOLDEN_VERSION = 2;

/** u32 → `0x1234abcd`. */
export function hex32(v: number): string {
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

/** Hash chain of one run in its portable (JSON) form. */
export interface HashChain {
  readonly scenario: string;
  readonly ticks: number;
  readonly hashIntervalTicks: number;
  /** Rule hashes at ticks interval, 2·interval, … as hex strings. */
  readonly trail: readonly string[];
  readonly finalRuleHash: string;
  readonly finalFullHash: string;
}

/** Checked-in golden file (tools/headless/goldens/<scenario>.json). */
export interface Golden extends HashChain {
  readonly format: typeof GOLDEN_FORMAT;
  readonly version: number;
  readonly seed: string;
  /** SIM_BUILD (simId input) the chain was recorded with; a changed chain needs a new one. */
  readonly simBuild: string;
  /** Inputs the chain depends on: blueprint sim hash and arena layout hash. */
  readonly simHash: string;
  readonly layoutHash: string;
  readonly finalUnitCount: number;
  readonly commandCount: number;
}

export function toHashChain(r: ScenarioResult): HashChain {
  return {
    scenario: r.scenario,
    ticks: r.ticks,
    hashIntervalTicks: r.hashIntervalTicks,
    trail: r.trail.map(hex32),
    finalRuleHash: hex32(r.finalRuleHash),
    finalFullHash: hex32(r.finalFullHash),
  };
}

export function toGolden(r: ScenarioResult): Golden {
  return {
    format: GOLDEN_FORMAT,
    version: GOLDEN_VERSION,
    simBuild: r.simBuild,
    scenario: r.scenario,
    ticks: r.ticks,
    seed: hex32(r.seed),
    simHash: hex32(r.simHash),
    layoutHash: hex32(r.layoutHash),
    hashIntervalTicks: r.hashIntervalTicks,
    finalUnitCount: r.finalUnitCount,
    commandCount: r.commandCount,
    finalRuleHash: hex32(r.finalRuleHash),
    finalFullHash: hex32(r.finalFullHash),
    trail: r.trail.map(hex32),
  };
}

/** Pretty JSON with the trail as one hash per line (reviewable diffs). */
export function goldenJson(g: Golden): string {
  return JSON.stringify(g, null, 2) + '\n';
}

/** Parses and validates a golden file. */
export function parseGolden(text: string): Golden {
  const g = JSON.parse(text) as Partial<Golden>;
  if (g.format !== GOLDEN_FORMAT || g.version !== GOLDEN_VERSION) throw new Error(`not a faf-golden v${GOLDEN_VERSION} file`);
  if (typeof g.scenario !== 'string' || typeof g.simBuild !== 'string' || !Array.isArray(g.trail) || typeof g.finalFullHash !== 'string') {
    throw new Error('golden: missing fields');
  }
  return g as Golden;
}

/** Result of comparing a chain against a reference chain. */
export interface ChainDiff {
  readonly equal: boolean;
  /** First tick whose hash differs (trail tick, or `ticks` for a final-hash-only mismatch); null if equal. */
  readonly firstDivergentTick: number | null;
  readonly detail: string;
}

/** Compares `actual` against `expected` (golden or reference engine). */
export function compareChains(expected: HashChain, actual: HashChain): ChainDiff {
  if (expected.scenario !== actual.scenario) {
    return { equal: false, firstDivergentTick: 0, detail: `scenario ${actual.scenario} ≠ ${expected.scenario}` };
  }
  if (expected.ticks !== actual.ticks || expected.hashIntervalTicks !== actual.hashIntervalTicks) {
    return { equal: false, firstDivergentTick: 0, detail: `ticks/interval ${actual.ticks}/${actual.hashIntervalTicks} ≠ ${expected.ticks}/${expected.hashIntervalTicks}` };
  }
  const n = Math.max(expected.trail.length, actual.trail.length);
  for (let i = 0; i < n; i++) {
    const e = expected.trail[i];
    const a = actual.trail[i];
    if (e !== a) {
      const tick = (i + 1) * expected.hashIntervalTicks;
      return { equal: false, firstDivergentTick: tick, detail: `tick ${tick}: ${a ?? '(missing)'} ≠ ${e ?? '(missing)'}` };
    }
  }
  if (expected.finalRuleHash !== actual.finalRuleHash) {
    return { equal: false, firstDivergentTick: expected.ticks, detail: `final rule hash ${actual.finalRuleHash} ≠ ${expected.finalRuleHash}` };
  }
  if (expected.finalFullHash !== actual.finalFullHash) {
    return { equal: false, firstDivergentTick: expected.ticks, detail: `final full hash ${actual.finalFullHash} ≠ ${expected.finalFullHash}` };
  }
  return { equal: true, firstDivergentTick: null, detail: `${actual.trail.length} trail hashes + final rule/full hash equal` };
}

/** Outcome of `goldens --update` for one scenario. */
export type GoldenUpdateVerdict =
  | { readonly kind: 'new' }
  | { readonly kind: 'unchanged' }
  /** Chain changed and SIM_BUILD was bumped: rewrite. */
  | { readonly kind: 'changed'; readonly diff: ChainDiff }
  /** Chain changed but SIM_BUILD is still the golden's: refuse (old logs would share the simId). */
  | { readonly kind: 'needsBump'; readonly diff: ChainDiff };

/**
 * Decides whether `goldens --update` may write `next` over `old`. A changed hash chain (trail,
 * final hashes, simHash or layoutHash) is only accepted together with a new SIM_BUILD, so a sim
 * change can never keep the simId of logs recorded before it (PLAN §3.1).
 */
export function goldenUpdateVerdict(old: Golden | null, next: Golden): GoldenUpdateVerdict {
  if (old === null) return { kind: 'new' };
  const chain = compareChains(old, next);
  const inputsEqual = old.simHash === next.simHash && old.layoutHash === next.layoutHash;
  if (chain.equal && inputsEqual) return { kind: 'unchanged' };
  const diff: ChainDiff = chain.equal
    ? { equal: false, firstDivergentTick: 0, detail: `simHash/layoutHash ${next.simHash}/${next.layoutHash} ≠ ${old.simHash}/${old.layoutHash}` }
    : chain;
  return old.simBuild === next.simBuild ? { kind: 'needsBump', diff } : { kind: 'changed', diff };
}
