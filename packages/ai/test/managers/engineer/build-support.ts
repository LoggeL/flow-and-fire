/**
 * Test helpers of the build managers (tai-p3): brains with selected managers, role → blueprint id
 * lookup (tests use roles like the code, never hard-coded ids), command decoding.
 */
import { CmdFlags, Op } from '@faf/protocol';
import {
  createBrain,
  decodeAiPayload,
  profileFor,
  type AiBrain,
  type AiProfile,
  type AiStatic,
  type EncodedCommand,
  type ManagerFactory,
} from '../../../src/index.ts';
import { economyManager } from '../../../src/managers/economy/index.ts';
import { engineerManager } from '../../../src/managers/engineer/index.ts';
import { openingManager } from '../../../src/managers/opening/index.ts';
import { techManager } from '../../../src/managers/tech/index.ts';
import type { Difficulty } from '../../../src/openings.ts';
import { loadOpenings, loadRoles, loadRoster } from '../../support/fixtures.ts';

export const doc = loadOpenings();
export const T = loadRoster();
export const roles = loadRoles();

/** Blueprint id of role@tech (roster via the roles of ai-openings.json). */
export function idOf(role: string, tech = 1): string {
  return roles.resolve(role, tech).id;
}

/** Blueprint index of role@tech. */
export function bpOf(role: string, tech = 1): number {
  return roles.resolve(role, tech).index;
}

export const COMMANDER_ID = T.list.find((b) => b.categoryNames.includes('COMMAND'))!.id;

export const MANAGERS = {
  opening: openingManager,
  economy: economyManager,
  tech: techManager,
  engineer: engineerManager,
} as const;

export interface BrainOptions {
  readonly difficulty?: Difficulty;
  readonly openingId?: string;
  readonly managers: readonly ManagerFactory[];
  readonly profile?: AiProfile;
}

export function brainFor(st: AiStatic, o: BrainOptions): AiBrain {
  const brain = createBrain({ managers: o.managers });
  brain.init(st, o.profile ?? profileFor(o.difficulty ?? 'normal', doc), {
    openings: doc,
    openingId: o.openingId ?? 'eco_standard',
  });
  return brain;
}

export interface DecodedBuild {
  readonly seq: number;
  readonly unit: number;
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly queued: boolean;
}

export function builds(cmds: readonly EncodedCommand[]): DecodedBuild[] {
  const out: DecodedBuild[] = [];
  for (const c of cmds) {
    if (c.op !== Op.Build) continue;
    const p = decodeAiPayload(c.op, c.payload);
    if (p.op !== 'build') continue;
    out.push({ seq: c.seq, unit: c.units[0]!, bp: p.value.bp, x: p.value.x, z: p.value.z, queued: (c.flags & CmdFlags.Queue) !== 0 });
  }
  return out;
}

export function ofOp(cmds: readonly EncodedCommand[], op: number): EncodedCommand[] {
  return cmds.filter((c) => c.op === op);
}

export function targetOf(c: EncodedCommand): number {
  const p = decodeAiPayload(c.op, c.payload);
  if (p.op !== 'target') throw new Error('not a target command');
  return p.value;
}

/** Compact, comparable form of a command stream (determinism tests). */
export function streamKey(cmds: readonly EncodedCommand[]): string {
  return cmds.map((c) => `${c.tick}:${c.seq}:${c.op}:${c.flags}:${c.units.join(',')}:${Array.from(c.payload).join('.')}`).join('|');
}
