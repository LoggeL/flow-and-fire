/**
 * Default composition of the AI (ai.md §2.2): every manager of `managers/` in MANAGER_ORDER.
 * `createDefaultBrain()` is the brain the arena, the tournaments (tai-p6) and later the AI worker
 * (MS9) run; `options.managers` restricts it to a subset (scenarios, benchmarks).
 */
import { createBrain, MANAGER_ORDER, type AiBrain, type ManagerFactory, type ManagerName } from './brain.ts';
import { defenseManager } from './managers/defense/index.ts';
import { economyManager } from './managers/economy/index.ts';
import { engineerManager } from './managers/engineer/index.ts';
import { factoryManager } from './managers/factory/index.ts';
import { intelManager } from './managers/intel/index.ts';
import { openingManager } from './managers/opening/index.ts';
import { platoonManager } from './managers/platoon/index.ts';
import { techManager } from './managers/tech/index.ts';

/** Default factory per manager name (micro is MS14 and has none). */
export const DEFAULT_MANAGER_FACTORIES: Readonly<Partial<Record<ManagerName, ManagerFactory>>> = {
  intel: intelManager,
  opening: openingManager,
  economy: economyManager,
  tech: techManager,
  defense: defenseManager,
  factory: factoryManager,
  engineer: engineerManager,
  platoon: platoonManager,
};

/** Names of the managers the default brain runs, in MANAGER_ORDER. */
export const DEFAULT_MANAGERS: readonly ManagerName[] = MANAGER_ORDER.filter((n) => DEFAULT_MANAGER_FACTORIES[n] !== undefined);

export interface DefaultBrainOptions {
  /** Subset of managers (any order; executed in MANAGER_ORDER). Default: all of DEFAULT_MANAGERS. */
  readonly managers?: readonly ManagerName[];
}

/** The default factories for `names` in MANAGER_ORDER (unknown or factory-less names throw). */
export function defaultManagerFactories(names: readonly ManagerName[] = DEFAULT_MANAGERS): ManagerFactory[] {
  const wanted = new Set<ManagerName>();
  for (const n of names) {
    if (DEFAULT_MANAGER_FACTORIES[n] === undefined) throw new Error(`createDefaultBrain: no default manager '${n}'`);
    wanted.add(n);
  }
  const out: ManagerFactory[] = [];
  for (const n of MANAGER_ORDER) if (wanted.has(n)) out.push(DEFAULT_MANAGER_FACTORIES[n]!);
  return out;
}

/** Brain with all default managers (or the given subset) in MANAGER_ORDER. */
export function createDefaultBrain(options: { managers?: readonly ManagerName[] } = {}): AiBrain {
  return createBrain({ managers: defaultManagerFactories(options.managers ?? DEFAULT_MANAGERS) });
}
