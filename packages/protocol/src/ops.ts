/**
 * Command opcodes (PLAN §3.6). APPEND-ONLY: existing values never change, new ops get new
 * numbers (200+ reserved for multiplayer meta commands). A test pins every value.
 */
export const Op = {
  Move: 1,
  AttackMove: 2,
  Attack: 3,
  AttackGround: 4,
  Patrol: 5,
  Guard: 6,
  Assist: 7,
  Build: 8,
  Repair: 9,
  Reclaim: 10,
  Upgrade: 11,
  FactoryQueue: 12,
  FactoryRepeat: 13,
  SetRally: 14,
  FireState: 15,
  TogglePause: 16,
  SetPriority: 17,
  ToggleAbility: 18,
  Overcharge: 19,
  SelfDestruct: 20,
  Stop: 21,
  FormationMove: 22,
  GroupMove: 23,
  Cheat: 250,
} as const;

/** Opcode value (u8). */
export type Op = (typeof Op)[keyof typeof Op];

/** Opcode names (u8 → name), for logs and the dev console. */
export type OpName = keyof typeof Op;

/** Sub-commands of `Op.Cheat` (first payload byte). Append-only. */
export const CheatSub = {
  Spawn: 1,
  Kill: 2,
} as const;
export type CheatSub = (typeof CheatSub)[keyof typeof CheatSub];

/** Envelope flags (bit set). Append-only. */
export const CmdFlags = {
  /** Shift: append to the order queue instead of replacing it. */
  Queue: 1,
} as const;
export type CmdFlags = (typeof CmdFlags)[keyof typeof CmdFlags];

const OP_NAMES: readonly OpName[] = Object.keys(Op) as OpName[];

/** True if `n` is a known opcode. */
export function isOp(n: number): n is Op {
  for (let i = 0; i < OP_NAMES.length; i++) if (Op[OP_NAMES[i]!] === n) return true;
  return false;
}

/** Name of a known opcode, or `op#<n>`. */
export function opName(n: number): string {
  for (let i = 0; i < OP_NAMES.length; i++) {
    const k = OP_NAMES[i]!;
    if (Op[k] === n) return k;
  }
  return `op#${n}`;
}
