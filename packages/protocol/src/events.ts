/** Append-only simulation event codes. Weapon events use lexical SimBpTable.weaponIds indices. */
export const EventType = { Shot: 1, Impact: 2, UnitDeath: 3, BuildComplete: 4, MatchEnd: 5, MassStall: 6, EnergyStall: 7, StorageFull: 8 } as const;
export type EventType = (typeof EventType)[keyof typeof EventType];
/** Resolve a weapon event visual without assuming a fixed content index. */
export function weaponEventId(ids: readonly string[], visual: number): string | undefined { return ids[visual]; }

/** Economy events use visual=army; NoPosition prevents a fabricated map location. */
export const EconomyEventFlags = { Energy: 1, NoPosition: 128 } as const;
