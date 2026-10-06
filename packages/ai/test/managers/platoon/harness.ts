/**
 * Test harness of the army/situation managers (tai-p4): brain with selected managers on a flat
 * 512-WU map, manager instance capture, command helpers. Test code may use blueprint ids; the
 * managers themselves only use roles/categories.
 */
import { Op } from '@faf/protocol';
import {
  createBrain,
  decodeAiPayload,
  profileFor,
  type AiBrain,
  type AiStatic,
  type Difficulty,
  type EncodedCommand,
  type Manager,
  type ManagerFactory,
  type ThinkResult,
} from '../../../src/index.ts';
import { FakeWorld, flatStatic, runThinks, type RunThinksOptions } from '../../../src/testing/index.ts';
import { loadOpenings, loadRoster } from '../../support/fixtures.ts';

export const T = loadRoster();
export const doc = loadOpenings();

export const ID = {
  acu: 'core:cmd_commander',
  eng: 'core:lnd_t1_engineer',
  tank: 'core:lnd_t1_tank',
  bot: 'core:lnd_t1_bot',
  arty: 'core:lnd_t1_arty',
  aa: 'core:lnd_t1_aa',
  scout: 'core:lnd_t1_scout',
  tank2: 'core:lnd_t2_tank',
  arty2: 'core:lnd_t2_mml',
  fac: 'core:str_t1_fac_land',
  fac2: 'core:str_t2_fac_land',
  mex: 'core:str_t1_mex',
  pgen: 'core:str_t1_pgen',
  pd: 'core:str_t1_pd',
  estore: 'core:str_t1_estore',
  bomber: 'core:air_t1_bomber',
} as const;

export function bpIndex(id: string): number {
  return T.byId(id)!.index;
}

/** Flat 512-WU map: army 0 starts at (128|128), army 1 at (384|384). */
export function flat512(spots: { kind: 'mass' | 'hydro'; x: number; z: number }[] = [], size = 512): AiStatic {
  const q = size / 4;
  return flatStatic({
    bps: T,
    sizeWu: size,
    starts: [
      { x: q, z: q },
      { x: 3 * q, z: 3 * q },
    ],
    spots,
    name: `flat${size}`,
  });
}

export interface Harness<M extends Manager> {
  readonly brain: AiBrain;
  readonly world: FakeWorld;
  manager(): M;
  run(n: number, o?: RunThinksOptions): ThinkResult[];
}

/** Wraps a factory so the test can reach the created manager instance. */
export function capture<M extends Manager>(f: ManagerFactory): { factory: ManagerFactory; get: () => M } {
  let inst: M | null = null;
  return {
    factory: {
      name: f.name,
      create: (init) => {
        inst = f.create(init) as M;
        return inst;
      },
    },
    get: () => {
      if (inst === null) throw new Error('manager not created');
      return inst;
    },
  };
}

export interface HarnessOptions {
  readonly difficulty?: Difficulty;
  readonly openingId?: string;
  readonly static?: AiStatic;
  readonly tick?: number;
  /** Additional managers (e.g. intel next to platoon). */
  readonly extra?: readonly ManagerFactory[];
}

export function harness<M extends Manager>(f: ManagerFactory, o: HarnessOptions = {}): Harness<M> {
  const cap = capture<M>(f);
  const brain = createBrain({ managers: [cap.factory, ...(o.extra ?? [])] });
  const st = o.static ?? flat512();
  brain.init(st, profileFor(o.difficulty ?? 'normal', doc), { openings: doc, openingId: o.openingId ?? 'eco_standard' });
  const world = new FakeWorld(brain.static, { tick: o.tick ?? 0 });
  return {
    brain,
    world,
    manager: cap.get,
    run: (n, ro) => runThinks(brain, world, n, ro),
  };
}

/** Commands of a think result with decoded payloads. */
export function decoded(r: ThinkResult | readonly EncodedCommand[]) {
  const cmds = Array.isArray(r) ? r : (r as ThinkResult).commands;
  return (cmds as readonly EncodedCommand[]).map((c) => ({ op: c.op, units: [...c.units] as number[], flags: c.flags, pl: decodeAiPayload(c.op, c.payload) }));
}

export type Decoded = ReturnType<typeof decoded>[number];

export function ofOp(r: ThinkResult | readonly EncodedCommand[], op: number): Decoded[] {
  return decoded(r).filter((c) => c.op === op);
}

/** Canonical string of a command stream (determinism tests). */
export function streamKey(results: readonly ThinkResult[]): string {
  return results
    .map((r) => r.commands.map((c) => `${c.tick}:${c.seq}:${c.op}:${c.flags}:${c.units.join(',')}:${Array.from(c.payload).join('.')}`).join('|'))
    .join('\n');
}

export { Op };
